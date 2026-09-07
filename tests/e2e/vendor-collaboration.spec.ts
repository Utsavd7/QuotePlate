import { expect, test, type APIRequestContext, type APIResponse, type Browser, type Page, type TestInfo } from '@playwright/test';
import type { RestaurantPortalView, SupplierPortalView } from '../../src/lib/supplier-portal/types';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';
import { resetSignupClientRateLimit } from './helpers/signup';

// Real PostgreSQL fixture + real application APIs. No route mocks, discovery,
// outbound messages, or shared-server lifecycle changes. Both configured browser
// projects run this suite; fresh tenants keep us below the 30-order portal limit.
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });
const publicPath = '/api/public/supplier-portal';
const fixtureOrigin = process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562';
const restaurantName = 'Vendor Collaboration Kitchen';
const rationale = 'PRIVATE internal award decision: split deliveries for resilience.';
async function resetQuoteSubmitClientRateLimit(request: APIRequestContext) {
  const response = await request.post(`${fixtureOrigin}/__test/database/reset-quote-submit-client-rate-limit`);
  expect(response.status(), await response.text()).toBe(204);
}
// Isolate the shared localhost client at journey boundaries, including failures.
// Never reset between quote submissions or alter a supplier grant's own quota.
test.beforeEach(async ({ request }) => { await resetQuoteSubmitClientRateLimit(request); });
test.afterEach(async ({ request }) => { await resetQuoteSubmitClientRateLimit(request); });
type Fixture = {
  requestId: string; itemId: string; itemName: string; supplierName: string;
  supplierId: string; grantId: string;
  competitor?: { supplierId: string; grantId: string; supplierName: string; itemId: string; itemName: string };
};
type HttpResult = Pick<APIResponse, 'text' | 'status' | 'ok' | 'headers'>;
async function json<T>(response: HttpResult, status?: number): Promise<T> {
  const body = await response.text();
  if (status !== undefined) expect(response.status(), body).toBe(status);
  else expect(response.ok(), body).toBe(true);
  return JSON.parse(body) as T;
}
function privateHeaders(response: HttpResult) {
  expect(response.headers()['cache-control']).toContain('private');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
}
async function ownerFixture(page: Page, info: TestInfo, competitor = false) {
  await resetSignupClientRateLimit(page.request);
  const email = `vendor-${info.project.name}-${Date.now()}-${info.retry}@example.com`;
  const password = 'Local-only collaboration password 42!';
  await json(await page.request.post('/api/auth/start', { data: {
    method: 'email', restaurantName, ownerName: 'Asha Rao', email, password,
    addressLine: '18 Koregaon Park Road', city: 'Pune', state: 'Maharashtra', pin: '411001',
    phone: '+91 98765 43210', timezone: 'Asia/Kolkata', gstin: '27ABCDE1234F1Z5',
  } }), 201);
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.isVisible()) await skip.click();
  return json<Fixture>(await page.request.post(`${fixtureOrigin}/__test/database/procurement-export-journey`, {
    data: { email, vendorCollaboration: competitor },
  }), 201);
}
async function supplierContext(browser: Browser, info: TestInfo) {
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  return browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor,
    baseURL: String(info.project.use.baseURL) });
}
async function chooseSupplier(page: Page, fixture: Fixture) {
  await page.goto('/supplier-collaboration');
  const select = page.getByRole('combobox', { name: 'Supplier', exact: true });
  await expect(select.getByRole('option', { name: fixture.supplierName, exact: true })).toHaveCount(1);
  await select.selectOption(fixture.supplierId);
  await expect(page.getByRole('heading', { name: fixture.supplierName, exact: true })).toBeVisible();
}
async function createLink(page: Page, replace = false) {
  await page.getByRole('button', { name: replace ? 'Replace private link' : 'Create private link', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'New private link', exact: true });
  await expect(field).toHaveValue(/\/supplier-portal#token=[A-Za-z0-9_-]{43}$/);
  return field.inputValue();
}
async function openPortal(page: Page, link: string) {
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token');
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const seenUrls: string[] = [];
  const requestListener = (request: import('@playwright/test').Request) => seenUrls.push(request.url());
  page.on('request', requestListener);
  try {
    const exchanged = page.waitForResponse(r => r.url().endsWith(`${publicPath}/access`) && r.request().method() === 'POST');
    await page.goto(link);
    const response = await exchanged;
    expect(response.ok(), `Portal exchange status ${response.status()}`).toBe(true);
    await expect(page.getByRole('heading', { name: restaurantName, exact: true })).toBeVisible();
    await expect(page).toHaveURL(new URL('/supplier-portal', link).href);
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(seenUrls.some(url => url.includes(token!))).toBe(false);
    const cookies = (await page.context().cookies()).filter(cookie => cookie.path === publicPath);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
    expect(cookies[0].expires).toBeGreaterThan(Date.now() / 1000);
    expect(await page.evaluate(() => document.cookie)).not.toContain(cookies[0].name);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    await page.reload(); // Cookie-only return visit, without replaying the fragment.
    await expect(page.getByRole('heading', { name: restaurantName, exact: true })).toBeVisible();
  } finally { page.off('request', requestListener); }
}
// Chromium treats loopback as trustworthy for Secure cookies. Playwright's
// separate HTTP client does not; assert public APIs using the actual browser session.
async function publicRequest(page: Page, method = 'GET', data?: unknown): Promise<HttpResult> {
  const result = await page.evaluate(async ({ path, method, data }) => {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.text() };
  }, { path: publicPath, method, data });
  return { status: () => result.status, ok: () => result.status >= 200 && result.status < 300,
    headers: () => result.headers, text: async () => result.body };
}
async function publicView(page: Page) {
  const response = await publicRequest(page);
  privateHeaders(response);
  return json<SupplierPortalView>(response, 200);
}
async function ownerView(page: Page, fixture: Fixture) {
  return json<RestaurantPortalView>(await page.request.get(`/api/suppliers/${fixture.supplierId}/portal`), 200);
}
function ownOrder(view: SupplierPortalView | RestaurantPortalView, fixture: Fixture) {
  expect(view.orders).toHaveLength(1);
  expect(view.orders[0].requestId).toBe(fixture.requestId);
  return view.orders[0];
}
async function refreshPublic(page: Page) {
  await page.getByRole('button', { name: 'Refresh records', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Latest records loaded.');
}
async function comparison(page: Page, fixture: Fixture) {
  return json<{ request: { version: number; award: {
    id: string; allocationLines: unknown; suppliers: unknown; deliverySnapshot: unknown;
    receiving: { suppliers: { supplierId: string; check: { checkedAt: string } | null }[] };
  } } }>(await page.request.get(`/api/requests/${fixture.requestId}/comparison`), 200);
}
async function awardSplit(page: Page, browser: Browser, info: TestInfo, fixture: Fixture) {
  const competitor = fixture.competitor!;
  expect(competitor).toBeTruthy();
  for (const [grantId, rate] of [[fixture.grantId, '100'], [competitor.grantId, '137.19']]) {
    const current = await json<{ request: { version: number } }>(await page.request.get(`/api/requests/${fixture.requestId}`), 200);
    const rotated = await json<{ link: { url: string } }>(await page.request.post(`/api/requests/${fixture.requestId}/links`, {
      data: { supplierRequestId: grantId, expectedVersion: current.request.version, action: 'rotate' },
    }));
    const context = await supplierContext(browser, info);
    try {
      const supplier = await context.newPage();
      await supplier.goto(rotated.link.url);
      for (const itemId of [fixture.itemId, competitor.itemId]) {
        await supplier.locator(`input[name="rate:${itemId}"]`).fill(rate);
        await supplier.locator(`input[name="gst:${itemId}"]`).fill('0');
      }
      await supplier.locator('input[name="freightInr"]').fill('0');
      await supplier.getByRole('button', { name: 'Submit quote', exact: true }).click();
      await expect(supplier.getByText('Revision 1 submitted successfully.')).toBeVisible();
    } finally { await context.close(); }
  }
  const current = await json<{ request: { version: number } }>(await page.request.get(`/api/requests/${fixture.requestId}`), 200);
  await json(await page.request.post(`/api/requests/${fixture.requestId}/award`, { data: {
    mode: 'SPLIT', expectedRequestVersion: current.request.version, rationale,
    selections: [
      { requestItemId: fixture.itemId, supplierRequestId: fixture.grantId, quoteRevision: 1, quantity: '60' },
      { requestItemId: fixture.itemId, supplierRequestId: competitor.grantId, quoteRevision: 1, quantity: '40' },
      { requestItemId: competitor.itemId, supplierRequestId: competitor.grantId, quoteRevision: 1, quantity: '20' },
    ],
  } }), 201);
}
async function receive(page: Page, fixture: Fixture, replacement = false) {
  const { request: { award } } = await comparison(page, fixture);
  const checkedAt = award.receiving.suppliers.find(s => s.supplierId === fixture.supplierId)?.check?.checkedAt ?? null;
  await json(await page.request.post(`/api/awards/${award.id}/receiving`, { data: {
    supplierId: fixture.supplierId, expectedCheckedAt: checkedAt,
    outcome: replacement ? 'MATCHED' : 'ISSUES', invoiceTotalPaise: '600000',
    issueCodes: replacement ? [] : ['MISSING_QUANTITY'], note: replacement ? 'Replacement delivery accepted.' : 'Ten kilograms still due.',
    details: { items: [{ requestItemId: fixture.itemId, receivedQuantity: replacement ? '60' : '50',
      rejectedQuantity: '0', billedQuantity: '60', billedUnitRatePaise: '10000' }],
    actualDeliveryDate: '2099-09-05', creditClaimedPaise: '100000',
    creditReceivedPaise: replacement ? '100000' : '0', settlementNote: 'Credit note CN-COLLAB-1' },
  } }), 200);
}
async function deliveryResponse(page: Page, decision: 'agree' | 'dispute', reference: string) {
  const form = page.getByRole('form', { name: /^Respond to delivery for/ });
  // The wrapping label's DOM text includes the option text; use the control's
  // accessible name rather than an exact match against that full label text.
  await form.getByRole('combobox', { name: 'Decision', exact: true }).selectOption(decision);
  await form.getByLabel(/^Explanation/).fill(decision === 'dispute' ? 'Our delivery note records the full shipment.' : 'Replacement and credit recorded correctly.');
  await form.getByLabel('Evidence reference (optional)', { exact: true }).fill(reference);
  await form.getByRole('button', { name: 'Save delivery response' }).click();
  await expect(page.getByText(decision === 'dispute' ? 'You disputed this record' : 'You agreed with this record', { exact: true })).toBeVisible();
}
async function blocked(page: Page, link: string) {
  const exchange = page.waitForResponse(r => r.url().endsWith(`${publicPath}/access`));
  await page.goto(link);
  expect((await exchange).status()).toBe(410);
  await expect(page).toHaveURL(new URL('/supplier-portal', link).href);
  await expect(page.getByRole('main').getByRole('alert').filter({
    hasText: 'This supplier portal is invalid or no longer available.',
  })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your orders', exact: true })).toHaveCount(0);
}

test('supplier sees only own split award, confirms and disputes receiving; corrections stale feedback and rotated/revoked links stop access', async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const fixture = await ownerFixture(page, info, true);
  await awardSplit(page, browser, info, fixture);
  const before = (await comparison(page, fixture)).request.award;
  await chooseSupplier(page, fixture);
  const link = await createLink(page);
  const context = await supplierContext(browser, info);
  const freshContext = await supplierContext(browser, info);
  try {
    const supplier = await context.newPage();
    await openPortal(supplier, link);
    const view = await publicView(supplier);
    const selected = ownOrder(view, fixture);
    expect(selected.status).toBe('selected');
    expect(selected.items).toEqual([{ itemId: fixture.itemId, name: fixture.itemName, quantity: '60', unit: 'KILOGRAM', unitPricePaise: '10000' }]);
    for (const secret of [fixture.competitor!.supplierName, fixture.competitor!.supplierId, fixture.competitor!.itemId, fixture.competitor!.itemName, rationale, '13719']) {
      expect(JSON.stringify(view)).not.toContain(secret);
      expect(await supplier.locator('body').innerText()).not.toContain(secret);
    }
    expect(JSON.stringify(view)).not.toMatch(/"(?:quotes|rationale|allocationLines|supplierSnapshots|totalPaise)":/);
    // Opening another supplier in a second tab must not redirect this tab's response.
    const otherLink = await json<{ url: string }>(await page.request.post(`/api/suppliers/${fixture.competitor!.supplierId}/portal`, { data: {} }), 200);
    const otherTab = await context.newPage();
    await openPortal(otherTab, otherLink.url);
    const otherView = await publicView(otherTab);
    expect(otherView.portalId).not.toBe(view.portalId);
    expect(otherView.orders[0]).toMatchObject({ requestId: fixture.requestId, status: 'selected', version: selected.version });
    const blockedResponse = supplier.waitForResponse(r => r.url().endsWith(publicPath) && r.request().method() === 'POST');
    await supplier.getByRole('form', { name: /^Acknowledge / }).getByRole('button', { name: 'Save order response' }).click();
    const mismatch = await blockedResponse;
    expect(mismatch.request().postDataJSON().portalId).toBe(view.portalId);
    expect(mismatch.status()).toBe(409);
    // The client handles 409 by refreshing without reading the response body.
    // Assert status and rendered recovery; waiting for Response.body can stall here.
    await expect(supplier.getByRole('main').getByRole('alert').filter({ hasText: 'The record changed' })).toBeVisible();
    expect(ownOrder(await ownerView(page, fixture), fixture).acknowledgement).toBeNull();
    const otherOwnerView = await json<RestaurantPortalView>(await page.request.get(`/api/suppliers/${fixture.competitor!.supplierId}/portal`), 200);
    expect(otherOwnerView.orders[0].acknowledgement).toBeNull();
    await otherTab.close();
    await openPortal(supplier, link);
    await expect(supplier.getByText('60 kilogram', { exact: false })).toBeVisible();
    const ack = supplier.getByRole('form', { name: /^Acknowledge / });
    await ack.getByLabel('Order response').selectOption('confirmed');
    await ack.getByRole('button', { name: 'Save order response' }).click();
    await expect(supplier.getByText('You confirmed this order', { exact: true })).toBeVisible();
    expect(ownOrder(await ownerView(page, fixture), fixture).acknowledgement?.status).toBe('confirmed');
    await receive(page, fixture);
    await refreshPublic(supplier);
    const checked = ownOrder(await publicView(supplier), fixture);
    expect(checked.delivery?.lines).toEqual([expect.objectContaining({ itemId: fixture.itemId, ordered: '60', received: '50', accepted: '50', outstanding: '10' })]);
    expect(checked.delivery?.credit).toEqual({ claimedPaise: '100000', receivedPaise: '0', outstandingPaise: '100000' });
    const restaurantCheck = (await comparison(page, fixture)).request.award.receiving;
    await deliveryResponse(supplier, 'dispute', 'DN-COLLAB-60');
    expect((await comparison(page, fixture)).request.award.receiving).toEqual(restaurantCheck);
    const disputed = ownOrder(await ownerView(page, fixture), fixture);
    expect(disputed).toMatchObject({ responseIsCurrent: true, response: { decision: 'dispute', evidenceReference: 'DN-COLLAB-60', fingerprint: checked.delivery!.fingerprint } });
    await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
    await expect(page.getByText('Evidence reference: DN-COLLAB-60', { exact: true })).toBeVisible();
    await receive(page, fixture, true);
    await refreshPublic(supplier);
    await expect(supplier.getByText('Delivery record changed — review and respond again', { exact: true })).toBeVisible();
    const stale = ownOrder(await publicView(supplier), fixture);
    expect(stale.responseIsCurrent).toBe(false);
    expect(stale.response).toEqual(disputed.response);
    expect(stale.delivery!.fingerprint).not.toBe(checked.delivery!.fingerprint);
    // A stale browser cannot re-confirm the previous check, even with today's version.
    const conflict = await publicRequest(supplier, 'POST', {
      portalId: view.portalId, action: 'delivery-response', requestId: fixture.requestId, expectedVersion: stale.version,
      fingerprint: checked.delivery!.fingerprint, decision: 'agree', note: '', evidenceReference: '',
    });
    expect(conflict.status(), await conflict.text()).toBe(409);
    expect(ownOrder(await publicView(supplier), fixture).response).toEqual(disputed.response);
    await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
    await expect(page.getByText('Outdated response', { exact: true })).toBeVisible();
    await deliveryResponse(supplier, 'agree', 'CN-COLLAB-1');
    expect(ownOrder(await ownerView(page, fixture), fixture)).toMatchObject({ responseIsCurrent: true, response: { decision: 'agree', evidenceReference: 'CN-COLLAB-1', fingerprint: stale.delivery!.fingerprint } });
    const after = (await comparison(page, fixture)).request.award;
    for (const key of ['allocationLines', 'suppliers', 'deliverySnapshot'] as const) expect(after[key]).toEqual(before[key]);
    expect(await supplier.evaluate(() => location.hash)).toBe('');
    await supplier.screenshot({ path: info.outputPath('supplier-portal.png'), fullPage: true });
    await expectNoSeriousAxeViolations(supplier);
    expect(await supplier.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const replacement = await createLink(page, true);
    expect(replacement).not.toBe(link);
    const denied = await publicRequest(supplier); // Existing session is invalid too.
    privateHeaders(denied);
    expect(denied.status()).toBe(410);
    await refreshPublicDenied(supplier);
    const fresh = await freshContext.newPage();
    await blocked(fresh, link); // A fresh browser cannot exchange the old fragment.
    await openPortal(fresh, replacement);
    await page.getByRole('button', { name: 'Revoke access', exact: true }).click();
    await expect(page.getByText('Supplier access revoked.', { exact: true })).toBeVisible();
    expect((await publicRequest(fresh)).status()).toBe(410);
    const deniedWrite = await publicRequest(fresh, 'POST', {
      portalId: view.portalId, action: 'acknowledge', requestId: fixture.requestId, expectedVersion: stale.version, status: 'confirmed', note: '',
    });
    expect(deniedWrite.status()).toBe(410);
    await refreshPublicDenied(fresh);
    await context.clearCookies();
    await blocked(supplier, replacement);
  } finally { await context.close(); await freshContext.close(); }
});
async function refreshPublicDenied(page: Page) {
  await page.getByRole('button', { name: 'Refresh records', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert').filter({
    hasText: 'This supplier portal is invalid or no longer available.',
  })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your orders', exact: true })).toHaveCount(0);
}

type SavedPlan = {
  id: string; version: number; name: string; document: { serviceAt: string };
  readiness: { ingredients: { itemKey: string; name: string; deficit: string; requiredUsable: string; stock: string }[] };
};
async function saveDemandPlan(page: Page) {
  // Same approved-menu/service-planning journey as service-readiness.spec.ts.
  // Two real shortages ensure 'only selected' cannot pass vacuously.
  await page.goto('/menus');
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.isVisible()) await skip.click();
  await page.getByRole('button', { name: 'Add menu' }).first().click();
  await page.getByRole('dialog', { name: 'How would you like to add it?' }).getByRole('button', { name: /Type or paste/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Type or paste dish names' });
  await dialog.getByLabel('One dish per line').fill('Private kitchen curry');
  await dialog.getByRole('button', { name: 'Save and review' }).click();
  await expect(page).toHaveURL(/\/menus\/[^/]+$/);
  await page.getByLabel('Menu name', { exact: true }).fill('Private recipe collection');
  for (const [index, name, quantity] of [['1', 'Tomato', '10'], ['2', 'Carrot', '3']]) {
    await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
    await page.getByLabel(`Private kitchen curry ingredient ${index}`, { exact: true }).fill(name);
    await page.getByLabel(`${name} quantity`, { exact: true }).fill(quantity);
    await page.getByLabel(`${name} unit`, { exact: true }).selectOption('KILOGRAM');
    await page.getByLabel(`${name} category`, { exact: true }).selectOption('VEGETABLES');
  }
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Approve menu', exact: true }).first().click();
  await expect(page.getByText(/Approved · v\d+/).first()).toBeVisible();
  await page.goto('/service-planning');
  const menu = page.getByLabel('Start from an approved menu');
  const option = menu.getByRole('option', { name: /^Private recipe collection · v/ });
  await expect(option).toHaveCount(1);
  await menu.selectOption((await option.getAttribute('value'))!);
  await page.getByLabel('Plan name', { exact: true }).fill('Private staffing plan');
  await page.getByLabel('Service date and time (your local timezone)').fill('2099-09-10T19:00');
  await page.getByRole('textbox', { name: /^Batch servings for/ }).fill('10');
  await page.getByRole('textbox', { name: /^Desired portions for/ }).fill('10');
  for (const [name, stock, yieldPercent] of [['Tomato', '4', '80'], ['Carrot', '0', '100']]) {
    const inventory = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await inventory.getByLabel('Usable yield %', { exact: true }).fill(yieldPercent);
    await inventory.getByLabel('Current usable stock', { exact: true }).fill(stock);
  }
  const saved = page.waitForResponse(r => r.url().endsWith('/api/service-planning') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save and calculate readiness', exact: true }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(201);
  const plan = await response.json() as SavedPlan;
  await expect(page.getByText('Saved plan loaded.', { exact: true })).toBeVisible();
  expect(plan.readiness.ingredients).toHaveLength(2);
  expect(plan.readiness.ingredients.find(i => i.name === 'Tomato')).toMatchObject({ deficit: '7.5' });
  expect(plan.readiness.ingredients.find(i => i.name === 'Carrot')).toMatchObject({ deficit: '3' });
  return plan;
}

test('owner reviews and shares only chosen purchase shortages; supplier sees private estimate and withdrawal removes it', async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const fixture = await ownerFixture(page, info);
  const plan = await saveDemandPlan(page);
  const tomato = plan.readiness.ingredients.find(i => i.name === 'Tomato')!;
  const carrot = plan.readiness.ingredients.find(i => i.name === 'Carrot')!;
  await chooseSupplier(page, fixture);
  const link = await createLink(page);
  const context = await supplierContext(browser, info);
  try {
    const supplier = await context.newPage();
    await openPortal(supplier, link);
    expect((await publicView(supplier)).forecasts).toEqual([]);
    const savedPlans = page.getByRole('combobox', { name: 'Saved service plan', exact: true });
    await expect(savedPlans.getByRole('option', { name: /^Private staffing plan · v/ })).toHaveCount(1);
    await savedPlans.selectOption(plan.id);
    const rows = page.getByRole('group', { name: 'Choose exact purchase shortages to share' });
    await expect(rows.getByRole('checkbox')).toHaveCount(2);
    const chosen = rows.getByRole('checkbox', { name: /Tomato/ });
    const omitted = rows.getByRole('checkbox', { name: /Carrot/ });
    await expect(chosen).not.toBeChecked();
    await expect(omitted).not.toBeChecked();
    const share = page.getByRole('button', { name: /^Share .*selected ingredient/ });
    await expect(share).toBeDisabled();
    await chosen.check();
    await expect(omitted).not.toBeChecked();
    await expect(rows).toContainText('7.5 kilogram');
    const shared = page.waitForResponse(r => r.url().endsWith(`/suppliers/${fixture.supplierId}/portal/demand`) && r.request().method() === 'POST');
    await share.click();
    const response = await shared;
    expect(response.ok(), await response.text()).toBe(true);
    expect(response.request().postDataJSON()).toEqual({ planId: plan.id, expectedPlanVersion: plan.version, itemKeys: [tomato.itemKey] });
    await expect(page.getByText('Selected ingredients shared as an estimate. No order or message was sent.', { exact: true })).toBeVisible();
    await expect(chosen).not.toBeChecked();
    await expect(share).toBeDisabled();
    await refreshPublic(supplier);
    const view = await publicView(supplier);
    expect(view.forecasts).toHaveLength(1);
    expect(view.forecasts[0]).toMatchObject({ planId: plan.id, planVersion: plan.version, serviceAt: plan.document.serviceAt, stale: false });
    expect(view.forecasts[0].items).toEqual([expect.objectContaining({ itemKey: tomato.itemKey, name: 'Tomato', quantity: '7.5', unit: 'KILOGRAM' })]);
    expect(Object.keys(view.forecasts[0]).sort()).toEqual(['id', 'items', 'planId', 'planVersion', 'serviceAt', 'sharedAt', 'stale']);
    expect(Object.keys(view.forecasts[0].items[0]).sort()).toEqual(['itemKey', 'name', 'quantity', 'specification', 'unit']);
    const payload = JSON.stringify(view);
    for (const secret of ['Private staffing plan', 'Private recipe collection', 'Private kitchen curry', 'Carrot', carrot.itemKey]) expect(payload).not.toContain(secret);
    expect(payload).not.toMatch(/"(?:menuSnapshot|dishes|inventory|stock|yieldPercent|portions|batchServings|prices)":/);
    const estimates = supplier.getByRole('region', { name: 'Upcoming ingredient estimates' });
    await expect(estimates.getByText('7.5 kilogram', { exact: true })).toBeVisible();
    await expect(estimates).toContainText('Estimate only — these are not confirmed orders or instructions to deliver.');
    await expect(estimates).not.toContainText('Carrot');
    await expect(supplier.locator('body')).not.toContainText('Private kitchen curry');
    await expect(supplier.locator('body')).not.toContainText('Private staffing plan');
    expect(await supplier.evaluate(() => location.hash)).toBe('');
    await supplier.screenshot({ path: info.outputPath('supplier-portal.png'), fullPage: true });
    await expectNoSeriousAxeViolations(supplier);
    expect(await supplier.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await ownerView(page, fixture)).forecasts).toEqual(view.forecasts);
    const withdrawn = page.waitForResponse(r => r.url().endsWith(`/suppliers/${fixture.supplierId}/portal/demand`) && r.request().method() === 'DELETE');
    await page.getByRole('button', { name: /^Withdraw estimate for/ }).click();
    const withdrawal = await withdrawn;
    expect(withdrawal.ok(), await withdrawal.text()).toBe(true);
    expect(withdrawal.request().postDataJSON()).toEqual({ shareId: view.forecasts[0].id });
    await expect(page.getByText('Estimate withdrawn from the supplier portal.', { exact: true })).toBeVisible();
    await refreshPublic(supplier);
    expect((await publicView(supplier)).forecasts).toEqual([]);
    expect((await ownerView(page, fixture)).forecasts).toEqual([]);
    await expect(estimates.getByText('7.5 kilogram', { exact: true })).toHaveCount(0);
    await expect(estimates).toContainText('The restaurant has not shared upcoming demand with you.');
    await supplier.reload();
    await expect(estimates).toContainText('The restaurant has not shared upcoming demand with you.');
  } finally { await context.close(); }
});
