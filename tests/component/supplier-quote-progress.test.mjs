// Real supplier form and browser, with all HTTP requests intercepted; no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const request = {
  restaurantName: 'Restaurant', supplierName: 'Supplier', title: 'Weekly prices',
  deliveryDetails: {}, deliveryDate: '2099-09-12', quoteDeadline: '2099-09-11T10:00:00Z',
  commercialTerms: 'Packing included', latestQuote: null,
  items: ['Rice', 'Milk', 'Onion'].map(name => ({ id: name.toLowerCase(), itemKey: name.toLowerCase(), name,
    quantity: '10', unit: 'KILOGRAM', specification: { v: 1, category: 'OTHER' } })),
  previousPrices: { submittedAt: '2099-09-01T10:00:00Z', items: [{ requestItemId: 'milk', unitRatePaise: '500', gstBasisPoints: 0, taxInclusive: false }] },
};
const output = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {SupplierQuoteForm} from './src/app/quote/SupplierQuoteForm'; createRoot(document.getElementById('root')).render(<SupplierQuoteForm request={${JSON.stringify(request)}} onSaved={()=>{}} onRefresh={async()=>{}}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, outdir: '/tmp/supplier-quote-progress-test', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
});

async function harness(run, mobile = false) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    page.setDefaultTimeout(5000);
    const writes = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Quote progress</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
      if (path === '/app.js') return route.fulfill({ contentType: 'application/javascript', body: output.outputFiles.find(f => f.path.endsWith('.js')).text });
      if (path === '/app.css') return route.fulfill({ contentType: 'text/css', body: output.outputFiles.find(f => f.path.endsWith('.css')).text });
      if (req.method() !== 'GET') writes.push(req.postDataJSON());
      return route.fulfill({ status: 422, json: { detail: 'Check delivery before sending again.' } });
    });
    await page.goto('http://quote.test/');
    await run(page, writes);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

test('remaining-item shortcut preserves zero, partial quantities, tax edits and unavailable rows through final review', async () => {
  await harness(async (page, writes) => {
    await expect(page.getByText('3 items left to complete', { exact: true })).toBeVisible();
    await page.locator('[name="rate:rice"]').fill('0');
    await page.locator('[name="quantity:rice"]').fill('2.125');
    await page.locator('[name="gst:rice"]').fill('5');
    await page.locator('[name="inclusive:rice"]').check();
    await page.locator('[name="noQuote:onion"]').check();
    await expect(page.getByText('1 item left to complete', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Go to first unfinished item' }).click();
    await expect(page.locator('[name="rate:milk"]')).toBeFocused();
    await page.locator('[name="rate:milk"]').pressSequentially('4');
    await expect(page.locator('[name="rate:milk"]')).toBeFocused();
    await expect(page.getByText('All items complete. Review delivery and total before sending.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to first unfinished item' })).toHaveCount(0);
    await page.locator('[name="noQuote:onion"]').uncheck();
    await expect(page.getByText('1 item left to complete', { exact: true })).toBeVisible();
    await page.locator('[name="rate:onion"]').fill('0');
    await page.locator('[name="noQuote:onion"]').check();
    await page.locator('[name="noQuote:onion"]').uncheck();
    await expect(page.getByText('All items complete. Review delivery and total before sending.', { exact: true })).toBeVisible();
    await page.locator('[name="noQuote:onion"]').check();
    await page.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review your quote' })).toBeFocused();
    assert.equal(writes.length, 0);
    await page.getByRole('button', { name: 'Send quote', exact: true }).click();
    assert.deepEqual(writes[0].items.map(({ requestItemId, noQuote, availableQuantity, unitRateInr, gstPercent, taxInclusive }) => ({ requestItemId, noQuote, availableQuantity, unitRateInr, gstPercent, taxInclusive })), [
      { requestItemId: 'rice', noQuote: false, availableQuantity: '2.125', unitRateInr: '0', gstPercent: '5', taxInclusive: true },
      { requestItemId: 'milk', noQuote: false, availableQuantity: '10', unitRateInr: '4', gstPercent: '0', taxInclusive: false },
      { requestItemId: 'onion', noQuote: true, availableQuantity: undefined, unitRateInr: undefined, gstPercent: undefined, taxInclusive: undefined },
    ]);
    await expect(page.getByRole('alert')).toContainText('Check delivery before sending again.');
  });
});

test('guided shortcut reveals quantity and tax errors without losing edits or moving typing focus', async () => {
  await harness(async (page, writes) => {
    await page.locator('[name="rate:rice"]').fill('12');
    await page.locator('[name="rate:milk"]').fill('0');
    await page.locator('[name="quantity:milk"]').fill('11');
    await page.locator('[name="gst:milk"]').fill('101');
    await page.locator('[name="noQuote:onion"]').check();
    await page.getByRole('button', { name: 'One item at a time' }).click();
    await page.getByRole('button', { name: 'Go to first unfinished item' }).click();
    await expect(page.getByRole('article', { name: 'Milk', exact: true })).toBeVisible();
    await expect(page.locator('[name="quantity:milk"]')).toBeFocused();
    await expect(page.getByRole('alert')).toContainText('up to 10');
    await page.getByRole('button', { name: 'Go to first unfinished item' }).click();
    await expect(page.locator('[name="quantity:milk"]')).toHaveValue('11');
    await page.locator('[name="quantity:milk"]').fill('2');
    await page.getByRole('button', { name: 'Go to first unfinished item' }).click();
    await expect(page.locator('[name="gst:milk"]')).toBeFocused();
    await page.locator('[name="gst:milk"]').fill('');
    await page.locator('[name="gst:milk"]').pressSequentially('18');
    await expect(page.locator('[name="gst:milk"]')).toBeFocused();
    await expect(page.locator('[name="gst:milk"]')).toHaveValue('18');
    await expect(page.getByText('All items complete. Review delivery and total before sending.', { exact: true })).toBeVisible();
    await expect(page.locator('[name="rate:rice"]')).toHaveValue('12');
    assert.equal(writes.length, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }, true);
});

test('progress refreshes after explicit previous-price and prepared-price fills', async () => {
  await harness(async (page, writes) => {
    await page.locator('[name="noQuote:onion"]').check();
    await page.getByRole('button', { name: 'Use previous prices' }).click();
    await expect(page.getByText('1 item left to complete', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use a price list', exact: true }).click();
    await page.getByLabel('Prices from your list').fill('Rice 0/kg');
    await page.getByRole('button', { name: 'Read prices', exact: true }).click();
    await page.getByRole('button', { name: 'Use checked prices' }).click();
    await expect(page.getByText('All items complete. Review delivery and total before sending.', { exact: true })).toBeVisible();
    await expect(page.locator('[name="rate:milk"]')).toHaveValue('5');
    await expect(page.locator('[name="rate:rice"]')).toHaveValue('0');
    assert.equal(writes.length, 0);
  });
});
