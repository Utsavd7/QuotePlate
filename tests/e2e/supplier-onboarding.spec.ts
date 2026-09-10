import { expect, test, type Page } from '@playwright/test';
import { resetSignupClientRateLimit } from './helpers/signup';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';
import { resetSupplierPortalClientRateLimit } from './helpers/public-client-rate-limit';

test.beforeEach(async ({ request }) => { await resetSupplierPortalClientRateLimit(request); });
test.afterEach(async ({ request }) => { await resetSupplierPortalClientRateLimit(request); });

async function restaurant(page: Page, label: string) {
  await resetSignupClientRateLimit(page.request);
  const email = `contacts-${label}-${Date.now()}@example.com`;
  const password = 'Local-only supplier onboarding password 42!';
  const response = await page.request.post('/api/auth/start', { data: {
    method: 'email', restaurantName: 'Contact Test Kitchen', ownerName: 'Asha Rao', email, password,
    addressLine: '18 Koregaon Park Road', city: 'Pune', state: 'Maharashtra', pin: '411001',
    phone: '+91 98765 43210', timezone: 'Asia/Kolkata', gstin: '27ABCDE1234F1Z5',
  } });
  expect(response.status(), await response.text()).toBe(201);
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.isVisible()) await skip.click();
  await page.goto('/suppliers');
  await page.locator('summary').filter({ hasText: 'Add existing contacts' }).click();
}

test('reviews real supplier imports and opens the selected private workspace without messaging anyone', async ({ page, browser }, info) => {
  await restaurant(page, info.project.name);
  const imports: string[] = [];
  const external: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/suppliers/import')) imports.push(request.method());
    if (request.url().includes('wa.me')) external.push(request.url());
  });
  await page.getByLabel('Supplier contact list').fill('Test Fresh Foods,98765 43210,produce@example.com\nTest Dairy,9876543210,dairy@example.com');
  await page.getByRole('button', { name: 'Review contacts', exact: true }).click();
  await expect(page.getByText(/This phone or email is repeated/)).toBeVisible();
  const add = page.getByRole('button', { name: 'Add 2 suppliers', exact: true });
  await expect(add).toBeDisabled();
  expect(imports).toEqual([]);
  await page.getByRole('textbox', { name: 'Phone, row 2', exact: true }).fill('9988776655');
  await expect(add).toBeEnabled();
  await expectNoSeriousAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('review-supplier-contacts.png'), fullPage: true });
  const saved = page.waitForResponse(r => r.url().endsWith('/api/suppliers/import') && r.request().method() === 'POST');
  await add.click();
  const result = await saved;
  expect(result.status(), await result.text()).toBe(201);
  await expect(page.getByRole('link', { name: 'Open workspace for Test Dairy' })).toBeVisible();
  expect(imports).toEqual(['POST']);
  await page.getByRole('link', { name: 'Open workspace for Test Dairy' }).click();
  await expect(page.getByRole('combobox', { name: 'Supplier', exact: true })).not.toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Test Dairy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create private link', exact: true }).click();
  const link = await page.getByRole('textbox', { name: 'New private link', exact: true }).inputValue();
  const whatsapp = page.getByRole('link', { name: 'Share on WhatsApp', exact: true });
  await expect(whatsapp).toBeVisible();
  expect(new URL((await whatsapp.getAttribute('href'))!).searchParams.get('text')).toContain(link);
  const emailDraft = new URL((await page.getByRole('link', { name: 'Email', exact: true }).getAttribute('href'))!);
  expect(emailDraft.protocol).toBe('mailto:');
  expect(decodeURIComponent(emailDraft.pathname)).toBe('dairy@example.com');
  expect(emailDraft.searchParams.get('body')).toContain(link);
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  expect(external).toEqual([]);
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor });
  try {
    const supplier = await context.newPage();
    await supplier.goto(link);
    await expect(supplier.getByRole('heading', { name: 'Contact Test Kitchen', exact: true })).toBeVisible();
    const data = await supplier.evaluate(async () => (await fetch('/api/public/supplier-portal')).json());
    expect(data.businessDetails).toMatchObject({ phone: '+919988776655', email: 'dairy@example.com' });
    expect(JSON.stringify(data)).not.toContain('produce@example.com');
    await expectNoSeriousAxeViolations(supplier);
    expect(await supplier.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await supplier.screenshot({ path: info.outputPath('supplier-first-visit.png'), fullPage: true });
  } finally { await context.close(); }
});

test('an existing contact prevents the whole import and leaves the review editable', async ({ page }, info) => {
  await restaurant(page, `${info.project.name}-conflict`);
  const existing = await page.request.post('/api/suppliers', { data: { businessName: 'Existing Supplier', phone: '9876543210' } });
  expect(existing.status(), await existing.text()).toBe(201);
  await page.getByLabel('Supplier contact list').fill('Duplicate Supplier,9876543210\nNew Supplier,9988776655');
  await page.getByRole('button', { name: 'Review contacts', exact: true }).click();
  const response = page.waitForResponse(r => r.url().endsWith('/api/suppliers/import'));
  await page.getByRole('button', { name: 'Add 2 suppliers', exact: true }).click();
  expect((await response).status()).toBe(422);
  await expect(page.getByRole('alert').filter({ hasText: 'Phone already belongs' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Business name, row 2', exact: true })).toHaveValue('New Supplier');
  const listing = await page.request.get('/api/suppliers?active=true&limit=50');
  const body = await listing.json();
  expect(body.suppliers.map((s: { businessName: string }) => s.businessName)).toEqual(['Existing Supplier']);
});
