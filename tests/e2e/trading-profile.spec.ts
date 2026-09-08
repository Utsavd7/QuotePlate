import { expect, test } from '@playwright/test';
import { resetSignupClientRateLimit } from './helpers/signup';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';
import type { SupplierPortalView } from '../../src/lib/supplier-portal/types';

// Uses the real application, isolated PostgreSQL fixture, authentication and RLS.
// Parent runs this with the combined e2e harness; no route mocks.
test('supplier confirms trading terms, restaurant sees them after reload, stale writes conflict', async ({ page, browser }, info) => {
 test.setTimeout(120000);
 await resetSignupClientRateLimit(page.request);
 const email = `trading-${info.project.name}-${Date.now()}@example.com`;
 const password = 'Local-only trading profile password 42!';
 const signup = await page.request.post('/api/auth/start', { data: { method: 'email', restaurantName: 'Trading Kitchen', ownerName: 'Asha Rao', email, password, addressLine: '18 Koregaon Park Road', city: 'Pune', state: 'Maharashtra', pin: '411001', phone: '+91 98765 43210', timezone: 'Asia/Kolkata', gstin: '27ABCDE1234F1Z5' } });
 expect(signup.status(), await signup.text()).toBe(201);
 await page.goto('/signin');
 await page.getByLabel('Work email').fill(email);
 await page.getByLabel('Password').fill(password);
 await page.getByRole('button', { name: 'Sign in with email' }).click();
 await expect(page).toHaveURL(/\/dashboard$/);
 const skip = page.getByRole('button', { name: 'Skip for now' });
 if (await skip.isVisible()) await skip.click();
 const seeded = await page.request.post(`${process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562'}/__test/database/procurement-export-journey`, { data: { email } });
 expect(seeded.status(), await seeded.text()).toBe(201);
 const fixture = await seeded.json() as { supplierId: string; supplierName: string };
 await page.goto('/supplier-collaboration');
 await page.getByRole('combobox', { name: 'Supplier', exact: true }).selectOption(fixture.supplierId);
 await page.getByRole('button', { name: 'Create private link', exact: true }).click();
 const link = await page.getByRole('textbox', { name: 'New private link', exact: true }).inputValue();
 const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
 const context = await browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor });
 try {
  const supplier = await context.newPage();
  await supplier.goto(link);
  await supplier.locator('summary').filter({hasText:'Your business details (optional)'}).click();
  const form = supplier.getByRole('form', { name: 'Edit trading profile' });
  await expect(form).toBeVisible();
  const initial = await supplier.evaluate(async () => (await fetch('/api/public/supplier-portal')).json()) as SupplierPortalView;
  expect(initial.tradingProfile).toBeNull();
  await form.getByLabel('Wholesale supply').selectOption('yes');
  await form.getByLabel('Delivery PIN codes').fill('411001, 411002');
  await form.getByLabel('Minimum order').fill('2500.00');
  await form.getByLabel('Order by this time').fill('16:30');
  await form.getByLabel('Days needed before delivery').fill('1');
  await form.getByLabel('Supplier note').fill('Call before placing a bulk order.');
  await form.getByRole('button', { name: 'Save business details' }).click();
  await expect(supplier.getByRole('status')).toContainText('Trading profile confirmed and saved.');
  await supplier.reload();
  await supplier.locator('summary').filter({hasText:'Your business details (optional)'}).click();
  await expect(form.getByLabel('Minimum order')).toHaveValue('2500.00');
  await page.reload();
  await page.getByRole('combobox', { name: 'Supplier', exact: true }).selectOption(fixture.supplierId);
  await page.locator('summary').filter({hasText:'Supplier delivery terms'}).click();
  const readView = page.getByRole('region', { name: 'Supplier trading profile' });
  await expect(readView).toContainText('Supplier-declared');
  await expect(readView).toContainText('not verified');
  await expect(readView).toContainText('411001, 411002');
  await expect(readView).toContainText('₹2500.00');
  await expect(readView).toContainText('16:30');
  await expect(readView).toContainText('Call before placing a bulk order.');
  const conflict = await supplier.evaluate(async portalId => {
   const response = await fetch('/api/public/supplier-portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'trading-profile', portalId, expectedRevision: 0, profile: { wholesale: 'no', servedPins: [], minimumOrderInr: null, orderCutoffIst: null, leadTimeDays: null, note: null } }) });
   return { status: response.status, body: await response.json() };
  }, initial.portalId);
  expect(conflict.status).toBe(409);
  expect(conflict.body.detail).toContain('Trading profile changed');
  await supplier.reload();
  await supplier.locator('summary').filter({hasText:'Your business details (optional)'}).click();
  await expect(form.getByLabel('Wholesale supply')).toHaveValue('yes');
  await expectNoSeriousAxeViolations(supplier);
 } finally { await context.close(); }
});
