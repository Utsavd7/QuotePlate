import { expect, request as apiRequest, test, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { resetSignupClientRateLimit } from './helpers/signup';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';

// Real local application APIs and PostgreSQL; no route, OCR or database mocks.
// Use the parent's already-running 52560 app and 52562 fixture gateway. This
// file never starts a server. The journey uses text to test the shared parser
// and explicit invoice application independently of photo recognition accuracy.
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });
const fixtureOrigin = process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562';
const supplierName = 'List Journey Produce';
const title = 'Reviewed list only purchase';

async function json(response: APIResponse, expectedStatus = 200) {
  const text = await response.text();
  expect(response.status(), text).toBe(expectedStatus);
  return JSON.parse(text);
}

async function signInOwner(page: Page, info: TestInfo) {
  // Check both destinations before resetting a fixture or creating any records.
  expect(info.project.use.baseURL).toBe('http://127.0.0.1:52560');
  expect(new URL(fixtureOrigin).origin).toBe('http://127.0.0.1:52562');
  const fixtureClient = await apiRequest.newContext({ timeout: 15_000 });
  try { await resetSignupClientRateLimit(fixtureClient); }
  finally { await fixtureClient.dispose(); }
  const email = `list-intake-${info.project.name}-${Date.now()}-${info.retry}@example.com`;
  const password = 'Local-only list intake password 42!';
  await json(await page.request.post('/api/auth/start', { data: {
    method: 'email', restaurantName: 'List Intake Test Kitchen', ownerName: 'Asha Rao', email, password,
    addressLine: '18 Market Road', city: 'Pune', state: 'Maharashtra', pin: '411001',
    phone: '+91 98765 43210', timezone: 'Asia/Kolkata',
  } }), 201);
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const skip = page.getByRole('button', { name: 'Skip for now' });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(skip).toBeHidden();
}

async function resetQuoteLimit(page: Page) {
  const response = await page.request.post(`${fixtureOrigin}/__test/database/reset-quote-submit-client-rate-limit`, { timeout: 15_000 });
  expect(response.status()).toBe(204);
}

test('list-only purchase persists through a public quote, award, checked invoice suggestion and explicit delivery save', async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  await signInOwner(page, info);
  await resetQuoteLimit(page);
  try {
    await test.step('start without any menu and add a real supplier', async () => {
      expect((await json(await page.request.get('/api/menus'))).menus).toEqual([]);
      expect((await json(await page.request.get('/api/requests'))).requests).toEqual([]);
      await page.goto('/suppliers');
      await page.getByRole('button', { name: 'Add supplier', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Add supplier', exact: true });
      await dialog.getByLabel(/Business name/).fill(supplierName);
      await dialog.getByLabel('Contact person').fill('Meera Shah');
      await dialog.getByLabel('Phone', { exact: true }).fill('+91 98765 43210');
      await dialog.getByLabel('Email', { exact: true }).fill('orders@list-produce.example');
      await dialog.getByLabel('City', { exact: true }).fill('Pune');
      await dialog.getByLabel('State', { exact: true }).fill('Maharashtra');
      await dialog.getByRole('button', { name: 'Add supplier', exact: true }).click();
      await expect(page.getByText('Supplier added.', { exact: true })).toBeVisible();
    });

    let requestId = '';
    let itemId = '';
    await test.step('review and save a list-only draft through the actual form', async () => {
      await page.goto('/procurement/new');
      await page.getByLabel(/Request title/).fill(title);
      await expect(page.getByLabel(/Approved menu/)).toHaveValue('');
      await page.getByRole('button', { name: 'Add a shopping list', exact: true }).click();
      await page.getByLabel('Shopping list text or description').fill('Tomatoes 10 kg');
      await page.getByRole('button', { name: 'Review text', exact: true }).click();
      await expect(page.getByLabel('Checked row 1')).not.toBeChecked();
      await expect(page.getByRole('button', { name: 'Add checked rows to draft' })).toBeDisabled();
      await page.getByLabel('Checked row 1').check();
      await page.getByRole('button', { name: 'Add checked rows to draft' }).click();
      await expect(page.getByLabel('Draft quantity, row 1')).toHaveValue('10');
      await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
      expect((await json(await page.request.get('/api/requests'))).requests).toEqual([]);
      const supplier = page.locator('label').filter({ hasText: supplierName }).getByRole('checkbox');
      await supplier.focus(); await supplier.press('Space');
      await expect(supplier).toBeChecked();
      await page.getByLabel(/Delivery date/).fill('2099-09-10');
      await page.getByLabel(/Quote deadline/).fill('2099-09-09T10:00');
      await page.getByLabel('Draft category, row 1').selectOption('VEGETABLES');
      await expectNoSeriousAxeViolations(page);
      const createdPromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/requests' && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      const created = await createdPromise;
      expect(created.status(), await created.text()).toBe(201);
      const createdBody = await created.json();
      requestId = createdBody.request.id;
      const sent = created.request().postDataJSON();
      expect(sent).toMatchObject({ menuId: null, selectedItemIds: [], additionalItems: { v: 1, items: [{ name: 'Tomatoes', quantity: '10', unit: 'KILOGRAM' }] } });
      await expect(page).toHaveURL(new RegExp(`/procurement/${requestId}$`));
      const stored = (await json(await page.request.get(`/api/requests/${requestId}`))).request;
      expect(stored).toMatchObject({ status: 'DRAFT', menuId: null, items: { v: 1, items: [{ name: 'Tomatoes', quantity: '10', unit: 'KILOGRAM', specification: { category: 'VEGETABLES' } }] } });
      expect(stored.items.items).toHaveLength(1);
      itemId = stored.items.items[0].id;
      expect((await json(await page.request.get('/api/menus'))).menus).toEqual([]);
      await page.reload();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    });

    await test.step('open a private supplier grant and submit an actual public quote', async () => {
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Create supplier links', exact: true }).click();
      const code = page.locator('code').filter({ hasText: '/quote#token=' });
      await expect(code).toBeVisible();
      const link = (await code.textContent())!.trim();
      expect(new URL(link).origin).toBe('http://127.0.0.1:52560');
      expect(link).toMatch(/\/quote#token=[A-Za-z0-9_-]{43}$/);
      const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
      const supplierContext = await browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor });
      try {
        const publicPage = await supplierContext.newPage();
        await publicPage.goto(link);
        await expect(publicPage.getByRole('heading', { name: title, exact: true })).toBeVisible();
        // The grant permits quoting, not access to the restaurant's private data.
        expect((await supplierContext.request.get(`http://127.0.0.1:52560/api/requests/${requestId}`)).status()).toBe(401);
        await publicPage.locator(`input[name="rate:${itemId}"]`).fill('40');
        await publicPage.locator(`input[name="gst:${itemId}"]`).fill('0');
        await publicPage.locator('input[name="freightInr"]').fill('0');
        await publicPage.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
        await publicPage.getByRole('button', { name: /^Send (updated )?quote$/, exact: true }).click();
        await expect(publicPage.getByText('Quote sent. Version 1 is saved with the restaurant.', { exact: true })).toBeVisible();
      } finally { await supplierContext.close(); }
    });

    const award = async () => (await json(await page.request.get(`/api/requests/${requestId}/comparison`))).request.award;
    await test.step('award the persisted quote explicitly', async () => {
      await page.getByRole('button', { name: 'Refresh quotes', exact: true }).click();
      await page.getByRole('radio', { name: new RegExp(supplierName) }).check();
      await page.getByLabel(/Reason for this decision/).fill('Checked list demand and supplier price with the requested delivery date.');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Confirm supplier choice', exact: true }).click();
      await expect(page.getByText('Award recorded. The request and winning prices are now locked.', { exact: true })).toBeVisible();
      const saved = await award();
      expect(saved.allocationLines.lines).toEqual(expect.arrayContaining([expect.objectContaining({ requestItemId: itemId, quantity: '10', unitRatePaise: '4000' })]));
      expect(saved.receiving.suppliers[0].check).toBeNull();
    });

    const before = await award();
    const receiving = page.getByRole('region', { name: 'Check delivery', exact: true });
    let receivingWrites = 0;
    page.on('request', request => {
      if (/\/api\/awards\/[^/]+\/receiving$/.test(new URL(request.url()).pathname) && request.method() === 'POST') receivingWrites++;
    });
    await test.step('only checked invoice billing applies; physical receipt and credits remain manual', async () => {
      await receiving.getByLabel('Received so far', { exact: true }).fill('9');
      await receiving.getByLabel('Rejected so far', { exact: true }).fill('1');
      await receiving.getByLabel('Credit claimed in rupees', { exact: true }).fill('20');
      await receiving.getByRole('button', { name: 'Read invoice photo or text' }).click();
      await receiving.getByLabel('Invoice text or description').fill('Tomatoes 10 kg @ 42\nOnions 5 kg @ 20');
      await receiving.getByRole('button', { name: 'Review text', exact: true }).click();
      await expect(receiving.getByRole('button', { name: 'Apply checked billed values' })).toBeDisabled();
      await expect(receiving.getByLabel('Checked row 2')).toBeDisabled();
      await receiving.getByLabel('Checked row 1').check();
      await receiving.getByRole('button', { name: 'Apply checked billed values' }).click();
      await expect(receiving.getByLabel('Billed quantity (optional)', { exact: true })).toHaveValue('10');
      await expect(receiving.getByLabel('Billed rate in rupees', { exact: true })).toHaveValue('42');
      await expect(receiving.getByLabel('Received so far', { exact: true })).toHaveValue('9');
      await expect(receiving.getByLabel('Rejected so far', { exact: true })).toHaveValue('1');
      await expect(receiving.getByLabel('Invoice total in rupees')).toHaveValue('');
      await expect(receiving.getByLabel('Credit claimed in rupees', { exact: true })).toHaveValue('20');
      await expect(receiving.getByLabel('Credit received in rupees', { exact: true })).toHaveValue('0');
      expect(receivingWrites).toBe(0);
      expect((await award()).receiving.suppliers[0].check).toBeNull();
    });

    await test.step('save the delivery explicitly and verify the database after reload', async () => {
      await receiving.getByLabel('Invoice total in rupees').fill('420');
      await receiving.getByLabel('Actual delivery date').fill('2099-09-10');
      await receiving.getByRole('radio', { name: 'Report a problem', exact: true }).check();
      await receiving.getByRole('checkbox', { name: 'Price difference', exact: true }).check();
      await receiving.getByRole('checkbox', { name: 'Missing quantity', exact: true }).check();
      const savedPromise = page.waitForResponse(response => /\/receiving$/.test(response.url()) && response.request().method() === 'POST');
      await receiving.getByRole('button', { name: 'Save delivery check', exact: true }).click();
      const saved = await savedPromise;
      // The UI refreshes immediately on save. Avoid awaiting Chromium's body
      // capture across that refresh; verify status and independent DB reads.
      expect(saved.status()).toBe(200);
      expect(receivingWrites).toBe(1);
      await expect(receiving.getByText(/Partial delivery · quantities outstanding/)).toBeVisible();
      await page.reload();
      await expect(receiving.getByText(/Partial delivery · quantities outstanding/)).toBeVisible();
      const persisted = await award();
      expect(persisted.receiving.suppliers[0].check).toMatchObject({
        invoiceTotalPaise: '42000', deliveryComplete: false, creditRemainingPaise: '2000',
        details: { actualDeliveryDate: '2099-09-10', creditClaimedPaise: '2000', creditReceivedPaise: '0', items: [
          { requestItemId: itemId, receivedQuantity: '9', rejectedQuantity: '1', billedQuantity: '10', billedUnitRatePaise: '4200' },
        ] },
        itemDetails: [{ acceptedQuantity: '8', pendingQuantity: '2' }],
      });
      expect(persisted.allocationLines).toEqual(before.allocationLines);
      expect(persisted.suppliers).toEqual(before.suppliers);
      expect((await json(await page.request.get(`/api/requests/${requestId}`))).request.menuId).toBeNull();
      expect((await json(await page.request.get('/api/menus'))).menus).toEqual([]);
      await receiving.getByRole('button', { name: 'Update check', exact: true }).click();
      await expect(receiving.getByLabel('Billed quantity (optional)', { exact: true })).toHaveValue('10');
      await expect(receiving.getByLabel('Billed rate in rupees', { exact: true })).toHaveValue('42');
      await expect(receiving.getByLabel('Received so far', { exact: true })).toHaveValue('9');
      await expect(receiving.getByLabel('Credit received in rupees', { exact: true })).toHaveValue('0');
      await expectNoSeriousAxeViolations(page);
    });
  } finally { await resetQuoteLimit(page); }
});

test('a supplied approved menu may contribute zero selected rows but still requires approval and valid additional demand', async ({ page }, info) => {
  await signInOwner(page, info);
  const menuDraft = { name: 'Optional menu association', sourceText: null, document: {
    v: 1, source: { kind: 'MANUAL', canonicalUrl: null, permissionConfirmed: false },
    dishes: [{ id: 'dish-a', name: 'Cabbage dish', position: 0, ingredients: [{
      id: 'cabbage', itemKey: 'cabbage', name: 'Cabbage', quantity: '5', unit: 'KILOGRAM', specification: { v: 1, category: 'VEGETABLES' },
    }] }],
  } };
  const { menu } = await json(await page.request.post('/api/menus', { data: menuDraft }), 201);
  const data = {
    title: 'Additional rows with menu association', menuId: menu.id, selectedItemIds: [],
    additionalItems: { v: 1, items: [{ id: 'list-rice', itemKey: 'rice', name: 'Rice', quantity: '2', unit: 'KILOGRAM', specification: { v: 1, category: 'GRAINS_PULSES' }, sourcingOverride: null }] },
    defaultSourcing: { v: 1, modes: ['VERIFIED_NEW'], currentSupplierIds: [], selectedNewSupplierIds: [], acceptVerifiedApplications: true },
    sourcingOverrides: {}, deliveryDetails: { addressLine: '18 Market Road', city: 'Pune', state: 'Maharashtra', pin: '411001' },
    deliveryDate: '2099-09-10', quoteDeadline: '2099-09-09T04:30:00.000Z',
  };
  const unapproved = await page.request.post('/api/requests', { data });
  expect(unapproved.status(), await unapproved.text()).toBe(404);
  await json(await page.request.post(`/api/menus/${menu.id}/approve`, { data: { expectedVersion: menu.version } }));
  const before = (await json(await page.request.get(`/api/menus/${menu.id}`))).menu;
  const { request: created } = await json(await page.request.post('/api/requests', { data }), 201);
  const stored = (await json(await page.request.get(`/api/requests/${created.id}`))).request;
  expect(stored.menuId).toBe(menu.id);
  expect(stored.items.items).toHaveLength(1);
  expect(stored.items.items[0]).toMatchObject({ id: 'list-rice', name: 'Rice', quantity: '2' });
  expect((await json(await page.request.get(`/api/menus/${menu.id}`))).menu).toEqual(before);
  const empty = await page.request.post('/api/requests', { data: { ...data, additionalItems: { v: 1, items: [] } } });
  expect(empty.status(), await empty.text()).toBe(422);
  const missing = await page.request.post('/api/requests', { data: { ...data, menuId: 'not-this-tenants-menu' } });
  expect(missing.status(), await missing.text()).toBe(404);
});

test('real bundled OCR reads a synthetic printed English photo and still requires explicit review and apply', async ({ page }, info) => {
  test.setTimeout(180_000);
  await signInOwner(page, info);
  await page.goto('/procurement/new');
  await page.getByRole('button', { name: 'Add a shopping list', exact: true }).click();
  // Synthetic, high-contrast printed fixture, not a real vendor invoice/photo.
  // Canvas stays offscreen; only its PNG bytes are passed to the actual file input.
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1100; canvas.height = 260;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000'; ctx.font = '64px Arial'; ctx.textBaseline = 'top';
    ctx.fillText('Tomatoes 5 kg', 70, 90);
    return canvas.toDataURL('image/png');
  });
  const photo = Buffer.from(dataUrl.split(',')[1], 'base64');
  await info.attach('Synthetic printed English fixture — not a vendor photo', { body: photo, contentType: 'image/png' });
  const writes: string[] = [];
  const ocrRequests: string[] = [];
  page.context().on('request', request => {
    if (request.method() === 'POST' || request.method() === 'PUT' || request.method() === 'PATCH') writes.push(request.url());
    if (new URL(request.url()).pathname.startsWith('/ocr/')) ocrRequests.push(request.url());
  });
  await page.getByLabel('Shopping list photo', { exact: true }).setInputFiles({ name: 'synthetic-printed-tomatoes.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByLabel('Checked row 1')).toHaveCount(0);
  await expect(page.getByLabel('Draft quantity, row 1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Read photo', exact: true }).click();
  await expect(page.getByLabel('Shopping list text or description')).toHaveValue(/Tomatoes\s+5\s+kg/i, { timeout: 130_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Photo text appended below' })).toBeVisible();
  expect(ocrRequests.some(url => new URL(url).pathname === '/ocr/worker.min.js')).toBe(true);
  expect(ocrRequests.every(url => new URL(url).origin === 'http://127.0.0.1:52560')).toBe(true);
  await expect(page.getByLabel('Checked row 1')).toHaveCount(0);
  await expect(page.getByLabel('Draft quantity, row 1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review text', exact: true }).click();
  await expect(page.getByLabel('Item name, row 1', { exact: true })).toHaveValue('Tomatoes');
  await expect(page.getByLabel('Quantity, row 1', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Unit, row 1', { exact: true })).toHaveValue('KILOGRAM');
  await expect(page.getByLabel('Checked row 1')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Add checked rows to draft' })).toBeDisabled();
  await expect(page.getByLabel('Draft quantity, row 1')).toHaveCount(0);
  await page.getByLabel('Checked row 1').check();
  await page.getByRole('button', { name: 'Add checked rows to draft' }).click();
  await expect(page.getByLabel('Draft quantity, row 1')).toHaveValue('5');
  await expect(page.getByLabel('Draft unit, row 1')).toHaveValue('KILOGRAM');
  expect(writes).toEqual([]); // Reading/review/apply neither uploads the PNG nor saves a purchase.
  expect((await json(await page.request.get('/api/requests'))).requests).toEqual([]);
});
