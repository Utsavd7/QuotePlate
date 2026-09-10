import { expect, test } from '@playwright/test';
import { resetSignupClientRateLimit } from './helpers/signup';

const token = 'Q'.repeat(43);
const request = {
  restaurantName: 'Monsoon Table Pune',
  supplierName: 'Shakti Fresh Foods',
  title: 'Weekly vegetables and dairy',
  deliveryDetails: {
    addressLine: '18 Koregaon Park Road',
    city: 'Pune',
    state: 'Maharashtra',
    pin: '411001',
  },
  deliveryDate: '2099-09-02',
  quoteDeadline: '2099-09-01T10:00:00.000Z',
  commercialTerms: 'Rates must include packing.',
  items: [
    {
      id: 'tomato',
      itemKey: 'tomato',
      name: 'Tomato',
      quantity: '100',
      unit: 'KILOGRAM',
      specification: { v: 1, category: 'VEGETABLES' },
    },
    {
      id: 'paneer',
      itemKey: 'paneer',
      name: 'Paneer',
      quantity: '25.5',
      unit: 'KILOGRAM',
      specification: { v: 1, category: 'DAIRY' },
    },
  ],
  latestQuote: null,
};

test('scrubs the link, loads the real quote form, and submits a server-calculated revision', async ({
  page,
}) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/public/quote/access', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route('**/api/public/quote', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(request),
      });
      return;
    }
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        revision: 1,
        subtotalPaise: '1234567',
        gstPaise: '61728',
        freightPaise: '45000',
        totalPaise: '1341295',
        deliveryDate: '2099-09-02',
        validUntil: '2099-09-01',
        commercialTerms: 'Payment within 15 days',
        notes: null,
        submittedAt: '2026-08-28T10:00:00.000Z',
        items: [],
      }),
    });
  });

  await page.goto(`/quote#token=${token}`);
  await expect(page).toHaveURL(/\/quote$/);
  await expect(page.getByRole('heading', { name: request.title })).toBeVisible();
  await expect(page.getByText(request.restaurantName)).toBeVisible();
  await expect(page.getByText(request.supplierName)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review your quote' })).toHaveCount(0);
  await expect(page.locator('button[type="submit"]')).toHaveCount(1);
  const tomatoRow = page.getByRole('article', { name: 'Tomato', exact: true });
  await expect(tomatoRow.getByLabel('Price per kg')).toBeVisible();
  await expect(tomatoRow.getByLabel('Quantity you can supply')).toBeVisible();
  const boxes = await Promise.all([
    tomatoRow.locator('[name="rate:tomato"]').boundingBox(),
    tomatoRow.locator('[name="quantity:tomato"]').boundingBox(),
  ]);
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.locator('input[name="rate:tomato"]').fill('42');
  await page.locator('input[name="gst:tomato"]').fill('5');
  await page.locator('input[name="rate:paneer"]').fill('320');
  await page.locator('input[name="gst:paneer"]').fill('5');
  await page.locator('input[name="inclusive:paneer"]').check();
  await page.locator('input[name="freightInr"]').fill('450');
  await page.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your quote' })).toBeFocused();
  await expect(page.locator('input[name="rate:tomato"]')).toBeHidden();
  await expect(page.locator('input[name="freightInr"]')).toBeHidden();
  expect(submitted).toBeUndefined();
  await page.getByRole('button', { name: 'Edit prices or delivery' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your prices' })).toBeFocused();
  await expect(page.locator('input[name="rate:tomato"]')).toHaveValue('42');
  await expect(page.locator('input[name="inclusive:paneer"]')).toBeChecked();
  await expect(page.locator('input[name="freightInr"]')).toHaveValue('450');
  await page.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
  await page.getByRole('button', { name: /^Send (updated )?quote$/, exact: true }).click();

  await expect(page.getByText('Quote sent. Version 1 is saved with the restaurant.')).toBeVisible();
  expect(submitted).toEqual(
    expect.objectContaining({
      expectedLatestRevision: 0,
      freightInr: '450',
      items: expect.arrayContaining([
        expect.objectContaining({
          requestItemId: 'tomato',
          unitRateInr: '42',
          gstPercent: '5',
        }),
        expect.objectContaining({
          requestItemId: 'paneer',
          unitRateInr: '320',
          taxInclusive: true,
        }),
      ]),
    }),
  );
  expect(JSON.stringify(submitted)).not.toMatch(/subtotalPaise|totalPaise|gstPaise/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test('price-sheet errors reveal fields and preserve partial supply, no quote, GST and notes through review', async ({ page }) => {
  const posts: unknown[] = [];
  await page.route('**/api/public/quote/access', route => route.fulfill({ status: 201, json: { ok: true } }));
  await page.route('**/api/public/quote', async route => {
    if (route.request().method() === 'GET') await route.fulfill({ json: request });
    else {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 422, json: { detail: 'Check the delivery date with the restaurant.' } });
    }
  });
  await page.goto(`/quote#token=${token}`);
  const next = page.getByRole('button', { name: 'Review delivery & total', exact: true });
  const tomato = page.getByRole('article', { name: 'Tomato', exact: true });
  const paneer = page.getByRole('article', { name: 'Paneer', exact: true });
  await next.click();
  await expect(tomato.getByLabel('Price per kg')).toBeFocused();
  await expect(tomato.getByLabel('Price per kg')).toHaveAttribute('aria-invalid', 'true');
  await tomato.getByLabel('Price per kg').fill('55');
  await paneer.getByLabel('Price per kg').fill('320');
  await paneer.getByLabel('Cannot supply this item').check();
  await expect(paneer.getByLabel('Price per kg')).toBeDisabled();
  await paneer.getByLabel('Cannot supply this item').uncheck();
  await expect(paneer.getByLabel('Price per kg')).toHaveValue('320');
  await paneer.getByLabel('Cannot supply this item').check();
  await tomato.getByLabel('Quantity you can supply').fill('101');
  await next.click();
  await expect(tomato.getByLabel('Quantity you can supply')).toBeFocused();
  await tomato.getByLabel('Quantity you can supply').fill('7.5');
  await tomato.getByLabel('GST %').fill('101');
  await next.click();
  await expect(tomato.getByLabel('GST %')).toBeFocused();
  await tomato.getByLabel('GST %').fill('5');
  await tomato.getByLabel('GST is included').check();
  await tomato.getByLabel('Item or pack note').fill('Three 2.5 kg packs');
  await page.getByLabel('Note to the restaurant', { exact: true }).fill('Call before delivery');
  await page.locator('[name="deliveryDate"]').fill('');
  await next.click();
  await expect(page.locator('[name="deliveryDate"]')).toBeFocused();
  await page.locator('[name="deliveryDate"]').fill(request.deliveryDate);
  await next.click();
  const review = page.getByRole('region', { name: 'Review your quote' });
  await expect(review).toContainText('₹412.50');
  await expect(review).toContainText('GST 5% included');
  await expect(review).toContainText('Three 2.5 kg packs');
  await expect(review).toContainText('Cannot supply this item');
  await expect(review).toContainText('Call before delivery');
  expect(posts).toHaveLength(0);
  await page.getByRole('button', { name: 'Edit prices or delivery' }).click();
  await expect(tomato.getByLabel('Quantity you can supply')).toHaveValue('7.5');
  await expect(tomato.getByLabel('GST is included')).toBeChecked();
  await expect(paneer.getByLabel('Cannot supply this item')).toBeChecked();
  await next.click();
  await page.getByRole('button', { name: 'Send quote', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Check the delivery date' })).toBeFocused();
  await expect(page.locator('[name="deliveryDate"]')).toBeVisible();
  await expect(tomato.getByLabel('Item or pack note')).toBeVisible();
  await expect(tomato.getByLabel('Item or pack note')).toHaveValue('Three 2.5 kg packs');
  await expect(page.getByRole('button', { name: 'Send quote', exact: true })).toHaveCount(0);
  expect(posts).toEqual([expect.objectContaining({ items: [
    expect.objectContaining({ requestItemId: 'tomato', availableQuantity: '7.5', unitRateInr: '55', gstPercent: '5', taxInclusive: true, substitution: 'Three 2.5 kg packs' }),
    { requestItemId: 'paneer', noQuote: true },
  ], notes: 'Call before delivery' })]);
});

test('previous prices require a click, preserve current inputs, and use normal submission validation', async ({ page }) => {
  const posts: unknown[] = [];
  await page.route('**/api/public/quote/access', (route) => route.fulfill({ status: 201, json: { ok: true } }));
  await page.route('**/api/public/quote', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { ...request, previousPrices: { submittedAt: '2026-08-31T00:00:00.000Z', items: [
        { requestItemId: 'tomato', unitRatePaise: '4275', gstBasisPoints: 500, taxInclusive: true },
        { requestItemId: 'paneer', unitRatePaise: '32000', gstBasisPoints: 500, taxInclusive: false },
      ] } } });
    } else {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 422, json: { detail: 'Check current availability.' } });
    }
  });
  await page.goto(`/quote#token=${token}`);
  await expect(page.getByText(/Previous quote:.*31 Aug 2026/)).toBeVisible();
  const rate = page.locator('[name="rate:tomato"]');
  await expect(rate).toHaveValue('');
  await page.locator('[name="rate:paneer"]').fill('333');
  await page.locator('[name="quantity:tomato"]').fill('7');
  await page.locator('[name="freightInr"]').fill('17');
  await page.locator('[name="commercialTerms"]').fill('Current payment terms');
  expect(posts).toHaveLength(0);
  await page.getByRole('button', { name: 'Use previous prices' }).click();
  await expect(rate).toHaveValue('42.75');
  await expect(page.locator('[name="gst:tomato"]')).toHaveValue('5');
  await expect(page.locator('[name="inclusive:tomato"]')).toBeChecked();
  await expect(page.locator('[name="rate:paneer"]')).toHaveValue('333');
  await expect(page.locator('[name="quantity:tomato"]')).toHaveValue('7');
  await expect(page.locator('[name="freightInr"]')).toHaveValue('17');
  await expect(page.locator('[name="commercialTerms"]')).toHaveValue('Current payment terms');
  await expect(page.locator('[name="deliveryDate"]')).toHaveValue(request.deliveryDate);
  expect(posts).toHaveLength(0);
  await rate.fill('43');
  await page.getByRole('button', { name: 'Use previous prices' }).click();
  await expect(rate).toHaveValue('43');
  await page.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
  await page.getByRole('button', { name: /^Send (updated )?quote$/, exact: true }).click();
  await expect(page.getByRole('alert').filter({hasText: 'Check current availability.'})).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ expectedLatestRevision: 0, freightInr: '17', commercialTerms: 'Current payment terms', items: [
    expect.objectContaining({ requestItemId: 'tomato', availableQuantity: '7', unitRateInr: '43', gstPercent: '5', taxInclusive: true }),
    expect.objectContaining({ requestItemId: 'paneer', unitRateInr: '333' }),
  ] });
});

test('existing revisions cannot be replaced by historical prices', async ({ page }) => {
  await page.route('**/api/public/quote/access', (route) => route.fulfill({ status: 201, json: { ok: true } }));
  await page.route('**/api/public/quote', (route) => route.fulfill({ json: {
    ...request,
    latestQuote: { revision: 1, totalPaise: '4400', freightPaise: '0', deliveryDate: request.deliveryDate, validUntil: '2099-09-01', items: [{ requestItemId: 'tomato', unitRatePaise: '4400' }] },
    previousPrices: { submittedAt: '2026-08-31T00:00:00.000Z', items: [{ requestItemId: 'tomato', unitRatePaise: '4275', gstBasisPoints: 500, taxInclusive: true }] },
  } }));
  await page.goto(`/quote#token=${token}`);
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('44');
  await expect(page.getByRole('button', { name: 'Use previous prices' })).toHaveCount(0);
});

test('a conflicting revision returns to entry and requires a fresh review without losing edits', async ({ page }) => {
  const posts: Array<Record<string, unknown>> = [];
  let conflicted = false;
  await page.route('**/api/public/quote/access', route => route.fulfill({ status: 201, json: { ok: true } }));
  await page.route('**/api/public/quote', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { ...request, latestQuote: conflicted ? {
        revision: 1, subtotalPaise: '40000', gstPaise: '0', freightPaise: '0', totalPaise: '40000',
        deliveryDate: request.deliveryDate, validUntil: '2099-09-01', items: [],
      } : null } });
    } else {
      posts.push(route.request().postDataJSON());
      conflicted = true;
      await route.fulfill({ status: posts.length === 1 ? 409 : 422, json: { detail: 'Check delivery.' } });
    }
  });
  await page.goto(`/quote#token=${token}`);
  await page.locator('[name="rate:tomato"]').fill('42.75');
  await page.locator('[name="rate:paneer"]').fill('320');
  await page.locator('[name="gst:tomato"]').fill('5');
  const next = page.getByRole('button', { name: 'Review delivery & total', exact: true });
  await next.click();
  await page.getByRole('button', { name: 'Send quote', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'A newer quote was saved' })).toBeVisible();
  await expect(page.getByText('Last sent: version 1')).toBeVisible();
  await expect(page.locator('[name="rate:tomato"]')).toBeVisible();
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('42.75');
  await expect(page.locator('[name="gst:tomato"]')).toHaveValue('5');
  await expect(page.getByRole('button', { name: 'Send updated quote', exact: true })).toHaveCount(0);
  await next.click();
  await page.getByRole('button', { name: 'Send updated quote', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Check delivery.' })).toBeVisible();
  expect(posts.map(post => post.expectedLatestRevision)).toEqual([0, 1]);
});


test('real awarded request repeats with private historical prices and saves only after review', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  await resetSignupClientRateLimit(page.request);
  const email = `repeat-quote-${testInfo.project.name}-${Date.now()}@example.com`;
  const password = 'Local-only repeat quote password 42!';
  const created = await page.request.post('/api/auth/start', { data: {
    method: 'email', restaurantName: 'Repeat Quote Kitchen', ownerName: 'Asha Rao', email, password,
    addressLine: '18 Koregaon Park Road', city: 'Pune', state: 'Maharashtra', pin: '411001',
    phone: '+91 98765 43210', timezone: 'Asia/Kolkata', gstin: '27ABCDE1234F1Z5',
  } });
  expect(created.status(), await created.text()).toBe(201);
  await page.goto('/signin');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.isVisible()) await skip.click();
  const seeded = await page.request.post('http://127.0.0.1:52562/__test/database/procurement-export-journey', { data: { email } });
  expect(seeded.status(), await seeded.text()).toBe(201);
  const fixture = await seeded.json() as { requestId: string; itemId: string; supplierName: string };
  await page.goto(`/procurement/${fixture.requestId}`);
  await page.getByRole('button', { name: 'New link' }).click();
  const link = await page.locator('code').filter({ hasText: '/quote#token=' }).textContent();
  expect(link).toBeTruthy();
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = testInfo.project.use;
  const supplierContext = await browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor });
  try {
    const supplierPage = await supplierContext.newPage();
    await supplierPage.goto(link!);
    await expect(supplierPage.locator(`[name="rate:${fixture.itemId}"]`)).toBeVisible();
    await expect(supplierPage.locator(`[name="rate:${fixture.itemId}"]`)).toHaveValue('');
    await expect(supplierPage.getByRole('button', { name: 'Use previous prices' })).toHaveCount(0);
    await supplierPage.locator(`[name="rate:${fixture.itemId}"]`).fill('42.75');
    await supplierPage.locator(`[name="gst:${fixture.itemId}"]`).fill('5');
    await supplierPage.locator(`[name="inclusive:${fixture.itemId}"]`).check();
    await supplierPage.locator('[name="freightInr"]').fill('99');
    await supplierPage.locator('[name="commercialTerms"]').fill('Old quote payment terms');
    await supplierPage.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
    await supplierPage.getByRole('button', { name: /^Send (updated )?quote$/, exact: true }).click();
    await expect(supplierPage.getByText('Quote sent. Version 1 is saved with the restaurant.')).toBeVisible();
    await page.getByRole('button', { name: 'Refresh quotes' }).click();
    await page.getByRole('radio', { name: new RegExp(fixture.supplierName) }).check();
    await page.getByLabel(/Reason for this decision/).fill('Confirmed this offer for the repeat quote workflow.');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Confirm supplier choice' }).click();
    await page.locator('summary').filter({hasText:'Download records & purchase orders'}).click();
  await expect(page.getByText('Award decision CSV')).toBeVisible();
    const sourceResponse = await page.request.get(`/api/requests/${fixture.requestId}`);
    expect(sourceResponse.status()).toBe(200);
    const source = (await sourceResponse.json()).request;
    const headers = { origin: new URL(page.url()).origin, 'sec-fetch-site': 'same-origin' };
    const repeatedResponse = await page.request.post(`/api/requests/${fixture.requestId}/repeat`, { headers, data: {
      expectedSourceVersion: source.version, title: 'Repeat tomatoes', deliveryDate: '2099-09-10', quoteDeadline: '2099-09-09T10:00:00.000Z',
    } });
    expect(repeatedResponse.status(), await repeatedResponse.text()).toBe(201);
    const repeated = (await repeatedResponse.json()).request;
    const openedResponse = await page.request.post(`/api/requests/${repeated.id}/open`, { headers, data: { expectedVersion: repeated.version } });
    expect(openedResponse.status(), await openedResponse.text()).toBe(200);
    const opened = await openedResponse.json();
    expect(opened.links[0].url).not.toBe(link);
    await supplierPage.goto(opened.links[0].url);
    await expect(supplierPage.getByRole('heading', { name: 'Repeat tomatoes', exact: true })).toBeVisible();
    const rate = supplierPage.locator(`[name="rate:${fixture.itemId}"]`);
    await expect(supplierPage.getByText(/Previous quote:/)).toBeVisible();
    await expect(rate).toHaveValue('');
    await expect(supplierPage.locator(`[name="gst:${fixture.itemId}"]`)).toHaveValue('0');
    await expect(supplierPage.locator(`[name="inclusive:${fixture.itemId}"]`)).not.toBeChecked();
    await expect(supplierPage.locator('[name="freightInr"]')).toHaveValue('0');
    await expect(supplierPage.locator('[name="commercialTerms"]')).toHaveValue('Payment in 15 days.');
    // Use browser fetch: the local HTTP harness uses Secure cookies, which
    // Chromium sends on loopback but APIRequestContext does not.
    async function readCurrentQuote() {
      return supplierPage.evaluate(async () => {
        const response = await fetch('/api/public/quote', {
          credentials: 'same-origin', cache: 'no-store',
        });
        return {
          status: response.status,
          cacheControl: response.headers.get('cache-control'),
          body: await response.json(),
        };
      });
    }
    const before = await readCurrentQuote();
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.cacheControl).toBe('private, no-store');
    expect(before.body.latestQuote).toBeNull();
    await supplierPage.getByRole('button', { name: 'Use previous prices' }).click();
    await expect(rate).toHaveValue('42.75');
    await expect(supplierPage.locator(`[name="gst:${fixture.itemId}"]`)).toHaveValue('5');
    await expect(supplierPage.locator(`[name="inclusive:${fixture.itemId}"]`)).toBeChecked();
    await expect(supplierPage.locator('[name="deliveryDate"]')).toHaveValue('2099-09-10');
    const afterClick = await readCurrentQuote();
    expect(afterClick.status, JSON.stringify(afterClick.body)).toBe(200);
    expect(afterClick.body.latestQuote).toBeNull();
    await supplierPage.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
    await supplierPage.getByRole('button', { name: /^Send (updated )?quote$/, exact: true }).click();
    await expect(supplierPage.getByText('Quote sent. Version 1 is saved with the restaurant.')).toBeVisible();
    await supplierPage.reload();
    await expect(rate).toHaveValue('42.75');
    await expect(supplierPage.getByRole('button', { name: 'Use previous prices' })).toHaveCount(0);
  } finally { await supplierContext.close(); }
});
