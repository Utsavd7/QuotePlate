import { expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';

const request = {
  restaurantName: 'Monsoon Table Pune', supplierName: 'Shakti Fresh Foods',
  title: 'Vegetables and dairy', deliveryDetails: { city: 'Pune' },
  deliveryDate: '2099-09-02', quoteDeadline: '2099-09-01T10:00:00.000Z',
  commercialTerms: 'Packing included', latestQuote: null,
  items: [
    { id: 'tomato', itemKey: 'tomato', name: 'Tomato', quantity: '20', unit: 'KILOGRAM', specification: { v: 1, category: 'VEGETABLES' } },
    { id: 'paneer', itemKey: 'paneer', name: 'Paneer', quantity: '5', unit: 'KILOGRAM', specification: { v: 1, category: 'DAIRY' } },
    { id: 'onion', itemKey: 'onion', name: 'Onion', quantity: '10', unit: 'KILOGRAM', specification: { v: 1, category: 'VEGETABLES' } },
  ],
};

async function openQuote(page: Page) {
  const submissions: Record<string, unknown>[] = [];
  await page.route('**/api/public/quote/access', route => route.fulfill({ status: 201, json: { ok: true } }));
  await page.route('**/api/public/quote', async route => {
    if (route.request().method() === 'GET') await route.fulfill({ json: request });
    else {
      submissions.push(route.request().postDataJSON());
      await route.fulfill({ status: 422, json: { detail: 'Test response: please check delivery.' } });
    }
  });
  await page.goto(`/quote#token=${'A'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: request.title })).toBeVisible();
  return submissions;
}

async function printedPhoto(context: BrowserContext) {
  const fixture = await context.newPage();
  await fixture.setViewportSize({ width: 1200, height: 400 });
  await fixture.setContent('<main style="background:white;color:black;font:48px Arial;padding:48px"><div>Tomato 42/kg</div><div style="margin-top:32px">Paneer 320/kg</div></main>');
  const photo = await fixture.locator('main').screenshot();
  await fixture.close();
  return { name: 'printed-prices.png', mimeType: 'image/png', buffer: photo };
}

test('price-list review fills only blank available prices and preserves all commercial edits', async ({ page }) => {
  const submissions = await openQuote(page);
  await page.locator('[name="rate:tomato"]').fill('45');
  await page.locator('[name="quantity:paneer"]').fill('3');
  await page.locator('[name="gst:paneer"]').fill('5');
  await page.locator('[name="inclusive:paneer"]').check();
  await page.locator('[name="noQuote:onion"]').check();
  await page.getByRole('button', { name: 'Use a price list', exact: true }).click();
  await page.getByLabel('Prices from your list').fill('Tomato 42/kg\nPaneer 320/kg\nOnion 25/kg');
  await page.getByRole('button', { name: 'Read prices', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Prepared prices' })).toBeVisible();
  await expect(page.locator('[name="rate:paneer"]')).toHaveValue('');
  await page.getByLabel('Amount for price 2').fill('325.50');
  await page.getByLabel('Amount for price 2').press('Enter');
  await expect(page.getByRole('heading', { name: 'Review your quote' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use checked prices' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 price filled' })).toBeVisible();
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('45');
  await expect(page.locator('[name="rate:paneer"]')).toHaveValue('325.50');
  await expect(page.locator('[name="quantity:paneer"]')).toHaveValue('3');
  await expect(page.locator('[name="gst:paneer"]')).toHaveValue('5');
  await expect(page.locator('[name="inclusive:paneer"]')).toBeChecked();
  await expect(page.locator('[name="rate:onion"]')).toHaveValue('');
  await page.getByRole('button', { name: 'Back to my quote' }).click();
  await page.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
  expect(submissions).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Review your quote' })).toContainText('₹976.50');
  await page.getByRole('button', { name: 'Send quote', exact: true }).click();
  expect(submissions).toEqual([expect.objectContaining({ items: [
    expect.objectContaining({ requestItemId: 'tomato', unitRateInr: '45' }),
    expect.objectContaining({ requestItemId: 'paneer', unitRateInr: '325.50', availableQuantity: '3', gstPercent: '5', taxInclusive: true }),
    expect.objectContaining({ requestItemId: 'onion', noQuote: true }),
  ] })]);
});

test('ambiguous names, duplicate prices and different units never silently fill a quote', async ({ page }) => {
  await openQuote(page);
  await page.getByRole('button', { name: 'Use a price list', exact: true }).click();
  await page.getByLabel('Prices from your list').fill('Tomato 42/kg\nTomato 43/kg\nPaneer 320/g\nRed onion 25/kg');
  await page.getByRole('button', { name: 'Read prices', exact: true }).click();
  await expect(page.getByText('3 lines need checking')).toBeVisible();
  await expect(page.getByLabel('Item for price 1')).toHaveValue('');
  await expect(page.getByLabel('Use price 1')).not.toBeChecked();
  await page.getByRole('button', { name: 'Use checked prices' }).click();
  await expect(page.getByRole('region', { name: 'Price list assistant' }).getByRole('alert')).toContainText('Select at least one');
  await page.getByLabel('Item for price 1').selectOption('onion');
  await page.getByRole('button', { name: 'Use checked prices' }).click();
  await expect(page.locator('[name="rate:onion"]')).toHaveValue('25');
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('');
  await expect(page.locator('[name="rate:paneer"]')).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('guided entry validates the visible item, keeps edits across navigation, then reviews before sending', async ({ page }) => {
  const submissions = await openQuote(page);
  await page.locator('[name="freightInr"]').fill('wrong');
  await page.getByRole('button', { name: 'One item at a time' }).click();
  await expect(page.getByRole('article', { name: 'Tomato', exact: true })).toBeVisible();
  await expect(page.locator('[name="rate:paneer"]')).toBeHidden();
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await expect(page.locator('[name="rate:tomato"]')).toBeFocused();
  await page.locator('[name="rate:tomato"]').pressSequentially('42');
  await expect(page.locator('[name="rate:tomato"]')).toBeFocused();
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('42');
  await page.locator('[name="quantity:tomato"]').fill('21');
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await expect(page.locator('[name="quantity:tomato"]')).toBeFocused();
  await page.locator('[name="quantity:tomato"]').fill('10');
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paneer', exact: true })).toBeFocused();
  await page.locator('[name="rate:paneer"]').fill('320');
  await page.getByRole('button', { name: 'Previous item', exact: true }).click();
  await expect(page.locator('[name="quantity:tomato"]')).toHaveValue('10');
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await expect(page.locator('[name="rate:paneer"]')).toHaveValue('320');
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await page.locator('[name="noQuote:onion"]').check();
  await page.getByRole('button', { name: 'Continue to delivery' }).click();
  await expect(page.getByRole('heading', { name: 'Delivery & terms' })).toBeFocused();
  await page.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
  await expect(page.locator('[name="freightInr"]')).toBeFocused();
  await page.locator('[name="freightInr"]').fill('0');
  await page.locator('[name="deliveryDate"]').fill('');
  await page.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
  await expect(page.locator('[name="deliveryDate"]')).toBeFocused();
  await page.locator('[name="deliveryDate"]').fill(request.deliveryDate);
  await page.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your quote' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Review your quote' })).toContainText('₹2,020.00');
  expect(submissions).toHaveLength(0);
  await page.getByRole('button', { name: 'Edit prices or delivery' }).click();
  await page.getByRole('button', { name: 'Show all items' }).click();
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('42');
  await expect(page.locator('[name="rate:paneer"]')).toHaveValue('320');
  await expect(page.locator('[name="noQuote:onion"]')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an oversized clipboard paste is rejected intact instead of turning a cut amount into a price', async ({ page, context }) => {
  await openQuote(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Use a price list', exact: true }).click();
  const text = page.getByLabel('Prices from your list');
  await text.fill('Paneer 320/kg');
  await page.evaluate(() => navigator.clipboard.writeText(' '.repeat(11_992) + 'Tomato 420/kg'));
  await text.focus();
  await text.selectText();
  await text.press('ControlOrMeta+V');
  await expect(page.getByRole('region', { name: 'Price list assistant' }).getByRole('alert')).toContainText('Nothing was pasted or cut short');
  await expect(text).toHaveValue('Paneer 320/kg');
  await expect(page.getByRole('region', { name: 'Prepared prices' })).toHaveCount(0);
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('');
});

test('a real printed photo is read with local OCR assets and never uploaded', async ({ page, context }) => {
  // A deterministic printed image tests the actual worker, WASM and language data.
  const photo = await printedPhoto(context);
  const submissions = await openQuote(page);
  const remoteRequests: string[] = [];
  const writes: string[] = [];
  page.on('request', req => {
    if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== new URL(page.url()).origin) remoteRequests.push(req.url());
    if (!['GET', 'HEAD'].includes(req.method())) writes.push(req.url());
  });
  await page.getByRole('button', { name: 'Use a price list', exact: true }).click();
  await page.getByLabel('Choose price list photo', { exact: true }).setInputFiles(photo);
  await expect(page.getByRole('heading', { name: 'Check these prices' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByLabel('Amount for price 1')).toHaveValue('42');
  await expect(page.getByLabel('Amount for price 2')).toHaveValue('320');
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('');
  await page.getByRole('button', { name: 'Use checked prices' }).click();
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('42');
  await expect(page.locator('[name="rate:paneer"]')).toHaveValue('320');
  expect(remoteRequests).toEqual([]);
  expect(writes).toEqual([]);
  expect(submissions).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed startup and cancelled photo reading terminate real workers before a retry', async ({ page, context }) => {
  const photo = await printedPhoto(context);
  await openQuote(page);
  const liveWorkers = new Set<Worker>();
  let created = 0;
  page.on('worker', worker => {
    created += 1;
    liveWorkers.add(worker);
    worker.on('close', () => liveWorkers.delete(worker));
  });
  await page.route('**/ocr/lang/**', route => route.fulfill({ status: 404, body: 'Missing test asset' }));
  await page.getByRole('button', { name: 'Use a price list', exact: true }).click();
  const upload = page.getByLabel('Choose price list photo', { exact: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await upload.setInputFiles(photo);
    await expect(page.getByRole('region', { name: 'Price list assistant' }).getByRole('alert')).toContainText('Could not read this photo');
    await expect.poll(() => liveWorkers.size).toBe(0);
  }
  expect(created).toBe(2);
  await page.unroute('**/ocr/lang/**');
  let releaseAsset!: () => void;
  let downloading = false;
  const assetGate = new Promise<void>(resolve => { releaseAsset = resolve; });
  await page.route('**/ocr/lang/**', async route => {
    downloading = true;
    await assetGate;
    await route.continue().catch(() => undefined);
  });
  await upload.setInputFiles(photo);
  try {
    await expect.poll(() => downloading).toBe(true);
    await page.getByRole('button', { name: 'Cancel photo reading' }).click();
    await expect.poll(() => liveWorkers.size).toBe(0);
    await page.getByLabel('Prices from your list').fill('Tomato 49/kg');
    await page.getByRole('button', { name: 'Read prices', exact: true }).click();
    await expect(page.getByLabel('Amount for price 1')).toHaveValue('49');
    await expect(page.locator('[name="rate:tomato"]')).toHaveValue('');
  } finally { releaseAsset(); }
});

test('failed images leave text entry available and closing never applies unreviewed prices', async ({ page }) => {
  await openQuote(page);
  await page.getByRole('button', { name: 'Use a price list', exact: true }).click();
  const upload = page.getByLabel('Choose price list photo', { exact: true });
  await upload.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('region', { name: 'Price list assistant' }).getByRole('alert')).toContainText('Could not open this image');
  await page.getByLabel('Prices from your list').fill('Tomato 42/kg');
  await page.getByRole('button', { name: 'Read prices', exact: true }).click();
  await expect(page.getByLabel('Amount for price 1')).toHaveValue('42');
  await page.getByRole('button', { name: 'Close price list assistant' }).click();
  await expect(page.getByRole('button', { name: 'Use a price list', exact: true })).toBeFocused();
  await expect(page.locator('[name="rate:tomato"]')).toHaveValue('');
});
