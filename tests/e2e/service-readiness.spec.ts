import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';
import { resetSignupClientRateLimit } from './helpers/signup';

// Reuse the real auth and procurement-export-journey setup from product-workspace.spec.ts.
// No application routes are mocked: the harness starts isolated PostgreSQL with migrations/RLS.
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

const fixtureOrigin = 'http://127.0.0.1:52562';
const password = 'Local-only export test password 42!';
async function signInOwner(page: Page, testInfo: TestInfo, purpose: string) {
  await resetSignupClientRateLimit(page.request);
  const email = `readiness-${purpose}-${testInfo.project.name}-${Date.now()}@example.com`;
  const created = await page.request.post('/api/auth/start', { data: {
    method: 'email', restaurantName: 'Service Readiness Kitchen', ownerName: 'Asha Rao', email, password,
    addressLine: '18 Koregaon Park Road', city: 'Pune', state: 'Maharashtra', pin: '411001',
    phone: '+91 98765 43210', timezone: 'Asia/Kolkata', gstin: '27ABCDE1234F1Z5',
  } });
  expect(created.status(), await created.text()).toBe(201);
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const skipSetup = page.getByRole('button', { name: 'Skip for now' });
  if (await skipSetup.isVisible()) await skipSetup.click();
  return email;
}
async function comparison(page: Page, requestId: string) {
  const response = await page.request.get(`/api/requests/${requestId}/comparison`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).request.award;
}

test('persists partial item receiving, replacement quantities and credits in supplier performance', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const email = await signInOwner(page, testInfo, 'receiving');
  const seeded = await page.request.post(`${fixtureOrigin}/__test/database/procurement-export-journey`, { data: { email } });
  expect(seeded.status(), await seeded.text()).toBe(201);
  const fixture = await seeded.json() as { requestId: string; itemId: string; itemName: string; supplierName: string };
  await page.goto(`/procurement/${fixture.requestId}`);
  await page.getByRole('button', { name: 'New link' }).click();
  const supplierLink = await page.locator('code').filter({ hasText: '/quote#token=' }).textContent();
  expect(supplierLink).toMatch(/\/quote#token=[A-Za-z0-9_-]{43}$/);
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = testInfo.project.use;
  const supplierContext = await browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor });
  try {
    const supplierPage = await supplierContext.newPage();
    await supplierPage.goto(supplierLink!);
    await supplierPage.locator(`input[name="rate:${fixture.itemId}"]`).fill('100');
    await supplierPage.locator(`input[name="gst:${fixture.itemId}"]`).fill('0');
    await supplierPage.locator('input[name="freightInr"]').fill('0');
    await supplierPage.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
    await supplierPage.getByRole('button', { name: /^Send (updated )?quote$/, exact: true }).click();
    await expect(supplierPage.getByText('Quote sent. Version 1 is saved with the restaurant.')).toBeVisible();
  } finally { await supplierContext.close(); }
  await page.getByRole('button', { name: 'Refresh quotes' }).click();
  await page.getByRole('radio', { name: new RegExp(fixture.supplierName) }).check();
  await page.getByLabel(/Reason for this decision/).fill('Confirmed tomato allocation and agreed delivery rate.');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Confirm supplier choice' }).click();
  await page.locator('summary').filter({hasText:'Download records & purchase orders'}).click();
  await expect(page.getByText('Award decision CSV')).toBeVisible();
  const before = await comparison(page, fixture.requestId);
  const receiving = page.getByRole('region', { name: 'Check delivery', exact: true });
  await receiving.getByLabel('Invoice total in rupees').fill('10000');
  await receiving.getByLabel('Received so far', { exact: true }).fill('60');
  await receiving.getByLabel('Rejected so far', { exact: true }).fill('10');
  await receiving.locator('summary').filter({hasText: 'Invoice quantity & rate (optional)'}).click();
  await receiving.getByLabel('Billed quantity').fill('100');
  await receiving.getByLabel('Billed rate in rupees').fill('100');
  await receiving.getByLabel('Actual delivery date').fill('2099-09-05');
  await receiving.getByLabel('Credit claimed in rupees').fill('5000');
  await receiving.getByLabel('Credit received in rupees').fill('2000');
  await receiving.getByLabel('Settlement notes').fill('CN-100: partial refund received; balance pending.');
  const savedResponse = page.waitForResponse(r => /\/receiving$/.test(r.url()) && r.request().method() === 'POST');
  await receiving.getByRole('button', { name: 'Save delivery check' }).click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(200);
  await expect(receiving.getByText(/Partial delivery · quantities outstanding/)).toBeVisible();
  await page.reload();
  await expect(receiving.getByText('CN-100: partial refund received; balance pending.')).toBeVisible();
  const partial = await comparison(page, fixture.requestId);
  expect(partial.receiving).toMatchObject({ checkedCount: 1, complete: false, suppliers: [{ check: {
    deliveryComplete: false, discrepancyPaise: '500000', creditRemainingPaise: '300000',
    itemDetails: [{ orderedQuantity: '100', receivedQuantity: '60', rejectedQuantity: '10', acceptedQuantity: '50', pendingQuantity: '50' }],
  } }] });
  expect(partial.allocationLines).toEqual(before.allocationLines);
  expect(partial.suppliers).toEqual(before.suppliers);
  expect(partial.deliverySnapshot).toEqual(before.deliverySnapshot);

  await page.goto('/supplier-performance');
  await expect(page.getByRole('heading', { name: 'Delivery record', exact: true })).toBeVisible();
  const metrics = page.getByRole('region', { name: 'Delivery and credit summary' });
  await expect(metrics.locator('article').filter({ hasText: 'Still owed' })).toContainText('₹3,000.00');
  await page.locator('summary').filter({ hasText: 'Ingredient quantities & costs' }).first().click();
  const itemRow = page.getByRole('row').filter({ hasText: fixture.itemName });
  await expect(itemRow.getByRole('cell').nth(1)).toHaveText('100');
  await expect(itemRow.getByRole('cell').nth(2)).toHaveText('50');
  await expect(itemRow.getByRole('cell').nth(3)).toHaveText('50%');
  await expect(itemRow.getByRole('cell').nth(5)).toContainText('₹200.00 / kg');
  await expect(itemRow.getByRole('cell').nth(5)).toContainText('partial; provisional');
  const followUps = page.getByRole('region', { name: 'Needs your attention' });
  await expect(followUps).toContainText('₹3,000.00 owed');
  await expect(followUps.getByRole('link', { name: /Review purchase/ })).toHaveAttribute('href', `/procurement/${fixture.requestId}`);
  await expect(page.getByText('1 checked; 0 unchecked; 1 partial')).toBeVisible();

  await page.goto(`/procurement/${fixture.requestId}`);
  await receiving.getByRole('button', { name: 'Update check' }).click();
  await expect(receiving.getByLabel('Received so far', { exact: true })).toHaveValue('60');
  await receiving.getByLabel('Received so far', { exact: true }).fill('110');
  await receiving.getByLabel('Credit received in rupees').fill('5000');
  await receiving.getByLabel('Settlement notes').fill('CN-100 settled; replacement shipment accepted.');
  const updatedResponse = page.waitForResponse(r => /\/receiving$/.test(r.url()) && r.request().method() === 'POST');
  await receiving.getByRole('button', { name: 'Save delivery check' }).click();
  const updated = await updatedResponse;
  expect(updated.status()).toBe(200);
  await expect(receiving.getByText(/Delivery complete · Actual delivery/)).toBeVisible();
  const complete = await comparison(page, fixture.requestId);
  expect(complete.receiving).toMatchObject({ checkedCount: 1, complete: true, suppliers: [{ check: { deliveryComplete: true, creditRemainingPaise: '0', itemDetails: [{ receivedQuantity: '110', rejectedQuantity: '10', acceptedQuantity: '100', pendingQuantity: '0' }] } }] });
  expect(complete.allocationLines).toEqual(before.allocationLines);
  expect(complete.suppliers).toEqual(before.suppliers);
  await page.goto('/supplier-performance');
  await page.locator('summary').filter({ hasText: 'Ingredient quantities & costs' }).first().click();
  await expect(metrics.locator('article').filter({ hasText: 'Still owed' })).toContainText('₹0.00');
  await expect(followUps).toContainText('No delivery or credit follow-ups');
  await expect(itemRow.getByRole('cell').nth(5)).toContainText('₹100.00 / kg');
  await expect(metrics.locator('article').filter({ hasText: 'Credits received' })).toContainText('₹5,000.00');
  await expect(itemRow.getByRole('cell').nth(2)).toHaveText('100');
  await expect(itemRow.getByRole('cell').nth(3)).toHaveText('100%');
  await expect(page.getByText('1 checked; 0 unchecked; 0 partial')).toBeVisible();
  await page.screenshot({ path: `/tmp/quoteplate-supplier-performance-${testInfo.project.name}.png`, fullPage: true });
  await expectNoSeriousAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('creates an approved menu, saves readiness, and drafts only the stock shortage', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await signInOwner(page, testInfo, 'planning');
  await page.goto('/menus');
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.isVisible()) await skip.click();
  await page.getByRole('button', { name: 'Add menu' }).first().click();
  await page.getByRole('dialog', { name: 'How would you like to add it?' }).getByRole('button', { name: /Type or paste/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Type or paste dish names' });
  await dialog.getByLabel('One dish per line').fill('Tomato curry');
  await dialog.getByRole('button', { name: 'Save and review' }).click();
  await expect(page).toHaveURL(/\/menus\/[^/]+$/);
  await page.getByLabel('Menu name').fill('Readiness dinner');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page.getByLabel('Tomato curry ingredient 1').fill('Tomato');
  await page.getByLabel('Tomato quantity').fill('10');
  await page.getByLabel('Tomato unit').selectOption('KILOGRAM');
  await page.getByLabel('Tomato category').selectOption('VEGETABLES');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Approve menu' }).first().click();
  await expect(page.getByText(/Approved · v\d+/).first()).toBeVisible();
  await page.goto('/service-planning');
  const menuChoice = page.getByLabel('Start from an approved menu');
  const approvedOption = menuChoice.getByRole('option', { name: /^Readiness dinner · v/ });
  await expect(approvedOption).toHaveCount(1);
  await menuChoice.selectOption((await approvedOption.getAttribute('value'))!);
  await page.getByLabel('Plan name', { exact: true }).fill('Dinner shortage check');
  await page.getByLabel('Service date and time (local time)').fill('2099-09-10T19:00');
  await page.getByRole('textbox', { name: /^Batch servings for/ }).fill('10');
  await page.getByRole('textbox', { name: /^Desired portions for/ }).fill('20');
  await page.getByLabel('Usable yield %').fill('100');
  await page.getByLabel('Current usable stock').fill('5');
  const saveResponse = page.waitForResponse(r => r.url().endsWith('/api/service-planning') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save and check missing ingredients' }).click();
  const saved = await saveResponse;
  expect(saved.status(), await saved.text()).toBe(201);
  const plan = await saved.json();
  await expect(page.getByText('Saved plan loaded.')).toBeVisible();
  const readiness = page.getByRole('region', { name: 'Service readiness' });
  await expect(readiness.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible();
  const shortage = readiness.getByRole('row').filter({ hasText: 'Tomato' });
  await expect(shortage.getByRole('cell').nth(0)).toHaveText('15 KILOGRAM');
  await shortage.locator('summary').click();
  await expect(shortage).toContainText('Required usable: 20');
  await expect(shortage).toContainText('Usable by service: 5');
  await page.screenshot({ path: `/tmp/quoteplate-planning-results-${testInfo.project.name}.png`, fullPage: true });
  await expectNoSeriousAxeViolations(page);
  await page.reload();
  await page.getByLabel('Saved plan').selectOption(plan.id);
  await expect(page.getByLabel('Current usable stock')).toHaveValue('5');
  await page.screenshot({ path: `/tmp/quoteplate-planning-results-${testInfo.project.name}.png`, fullPage: true });
  await expectNoSeriousAxeViolations(page);
  await page.getByLabel('Required delivery date').fill('2099-09-10');
  await page.getByLabel('Quote deadline (local time)').fill('2099-09-09T10:00');
  const draftResponse = page.waitForResponse(r => /\/service-planning\/[^/]+\/procurement$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create purchase draft' }).click();
  const drafted = await draftResponse;
  expect(drafted.status()).toBe(201);
  await expect(page).toHaveURL(/\/procurement\/[^/]+$/);
  const requestId = new URL(page.url()).pathname.split('/').pop();
  await expect(page.getByRole('button', { name: 'Edit draft' })).toBeVisible();
  const persisted = await page.request.get(`/api/requests/${requestId}`);
  expect(persisted.status()).toBe(200);
  const request = await persisted.json();
  expect(request.request.status).toBe('DRAFT');
  expect(request.request.items.items).toEqual([expect.objectContaining({ name: 'Tomato', quantity: '15', unit: 'KILOGRAM' })]);
});
