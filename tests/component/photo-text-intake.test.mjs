// Real React in an isolated browser, with local routes only; no server or database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const output = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReviewedTextIntake} from './src/components/procurement/ReviewedTextIntake';import {NewRequestForm} from './src/components/procurement/NewRequestForm';import {SupplierCheckForm} from './src/components/procurement/DeliveryCheckPanel';
    const mode=location.hash==='#invoice'?'invoice':'shopping';
    const supplier={supplierId:'s',supplierName:'Foods',deliveryDate:'2099-10-10',expectedTotalPaise:'40000',check:null,items:[{requestItemId:'t',itemKey:'tomatoes',itemName:'Tomatoes',unit:'KILOGRAM',orderedQuantity:'10',unitRatePaise:'4000',gstBasisPoints:0,taxInclusive:false}]};
    createRoot(document.getElementById('root')).render(location.hash==='#new'?<NewRequestForm initialData={{menus:[],suppliers:[],account:{addressLine:'12 Market Road',city:'Mumbai',state:'Maharashtra',pin:'400001'}}}/>:location.hash==='#receiving'?<SupplierCheckForm awardId="award" supplier={supplier} onSaved={()=>{window.saved=true}}/>:<form onSubmit={e=>{e.preventDefault();window.submitted=true}}><ReviewedTextIntake mode={mode} awarded={[{requestItemId:'t',itemName:'Tomatoes',unit:'KILOGRAM'}]} billing={[{requestItemId:'t',billedQuantity:'',billedRateInr:''}]} onApply={rows=>{window.applied=rows;return null}}/></form>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, outdir: '/tmp/intake-test', jsx: 'automatic',
  // Next's existing composed CSS triggers this esbuild-only ordering warning.
  logOverride: { 'undefined-composes-from': 'silent' },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'local-ocr', setup(b) {
    b.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'next-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'next-stub' }, args => ({ contents: args.path.endsWith('navigation') ? `export const useRouter=()=>({push:url=>{window.navigated=url}});export const usePathname=()=>'/procurement/new';` : `import React from 'react';export default function Link(props){return React.createElement('a',props)}`, loader: 'js', resolveDir: process.cwd() }));
    b.onResolve({ filter: /quotes\/price-list-ocr$/ }, () => ({ path: 'ocr', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `export async function readPriceListPhoto(file,{signal,onProgress}) {window.ocrSignal=signal;onProgress(.4);return new Promise((resolve,reject)=>{window.finishOCR=()=>resolve('Tomatoes 2 kg @ 30');window.failOCR=()=>reject(new Error('Unreadable photo'));});}`, loader: 'js' }));
  } }],
});
const js = output.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = output.outputFiles.find(f => f.path.endsWith('.css')).text;

async function harness(mode, run) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/requests' || path === '/api/awards/award/receiving') {
        return page.evaluate(body => { window.payload = body; }, route.request().postDataJSON()).then(() => route.fulfill({ json: { request: { id: 'saved-draft' } } }));
      }
      if (path === '/app.js') return route.fulfill({ contentType: 'application/javascript', body: js });
      if (path === '/app.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Intake test</title><link rel="stylesheet" href="/app.css"></head><body style="margin:16px"><div id="root"></div><script src="/app.js"></script></body></html>' });
      throw new Error(`Unexpected network access: ${route.request().url()}`);
    });
    await page.goto(`https://intake.test/#${mode}`);
    await page.getByRole('button', { name: ['shopping', 'new'].includes(mode) ? 'Add a shopping list' : 'Read invoice photo or text' }).click();
    await run(page);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => Boolean(window.submitted)), false);
  } finally { await browser.close(); }
}

test('shopping rows require correction and explicit review/apply on a phone', async () => {
  await harness('shopping', async page => {
    await page.getByLabel('Shopping list text or description').fill('tomatoes 10 kg\n5 kg onions\nrice');
    await page.getByRole('button', { name: 'Review text' }).click();
    await expect(page.getByRole('button', { name: 'Add checked rows to draft' })).toBeDisabled();
    await page.getByLabel('Checked row 1').check();
    await page.getByLabel('Quantity, row 1', { exact: true }).fill('12');
    await expect(page.getByLabel('Checked row 1')).not.toBeChecked();
    await expect(page.getByLabel('Checked row 3')).toBeDisabled();
    await page.getByLabel('Quantity, row 3', { exact: true }).fill('2');
    await page.getByLabel('Unit, row 3', { exact: true }).selectOption('KILOGRAM');
    await page.getByLabel('Checked row 3').check();
    await page.getByRole('button', { name: 'Add checked rows to draft' }).click();
    const applied = await page.evaluate(() => window.applied);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].name, 'rice');
    assert.equal(applied[0].quantity, '2');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  });
});

test('list-only draft retains applied rows, validates required fields and only saves explicitly', async () => {
  await harness('new', async page => {
    await page.getByLabel('Shopping list text or description').fill('tomatoes 10 kg');
    await page.getByRole('button', { name: 'Review text' }).click();
    await page.getByLabel('Checked row 1').check();
    await page.getByRole('button', { name: 'Add checked rows to draft' }).click();
    await page.getByLabel('Shopping list text or description').fill('5 kg onions');
    await page.getByRole('button', { name: 'Review text' }).click();
    await page.getByLabel('Checked row 1').check();
    await page.getByRole('button', { name: 'Add checked rows to draft' }).click();
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    assert.equal(await page.evaluate(() => window.payload), undefined);
    await page.getByLabel('Request title').fill('Local shopping');
    await page.getByLabel('Also invite new verified suppliers').check();
    await page.getByLabel('Delivery date', { exact: false }).fill('2099-10-10');
    await page.getByLabel('Quote deadline').fill('2099-10-09T10:00');
    await page.getByLabel('Draft quantity, row 1').fill('');
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    await page.getByLabel('Draft quantity, row 1').fill('12');
    await page.getByLabel('Draft item name, row 1').fill('plum tomatoes');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect.poll(() => page.evaluate(() => window.payload?.additionalItems?.items.length)).toBe(2);
    const payload = await page.evaluate(() => window.payload);
    assert.equal(payload.menuId, null);
    assert.deepEqual(payload.selectedItemIds, []);
    assert.deepEqual(payload.additionalItems.items.map(i => [i.name, i.quantity, i.unit]), [['plum tomatoes', '12', 'KILOGRAM'], ['onions', '5', 'KILOGRAM']]);
    assert.equal(payload.additionalItems.items[0].itemKey, 'plum-tomatoes');
  });
});

test('invoice integration preserves manual billing and only changes empty billed fields', async () => {
  await harness('receiving', async page => {
    await page.getByText('Invoice quantity & rate (optional)', { exact: true }).click();
    await page.getByLabel('Billed quantity (optional)', { exact: true }).fill('7');
    await page.getByLabel('Billed rate in rupees', { exact: true }).fill('32');
    await page.getByLabel('Received so far').fill('6');
    await page.getByLabel('Rejected so far').fill('1');
    await page.getByLabel('Credit claimed in rupees').fill('3');
    await page.getByLabel('Invoice text or description').fill('Tomatoes 10 kg @ 40');
    await page.getByRole('button', { name: 'Review text' }).click();
    await expect(page.getByLabel('Checked row 1')).toBeDisabled();
    await expect(page.getByText(/Existing billed values: 7/)).toBeVisible();
    await page.getByLabel('Billed quantity (optional)', { exact: true }).fill('');
    // The helper's input has an explicit row label, so this finds the receiving field.
    await page.getByLabel('Billed rate in rupees', { exact: true }).fill('');
    await page.getByLabel('Checked row 1').check();
    await page.getByRole('button', { name: 'Apply checked billed values' }).click();
    await expect(page.getByLabel('Billed quantity (optional)', { exact: true })).toHaveValue('10');
    await expect(page.getByLabel('Billed rate in rupees', { exact: true })).toHaveValue('40');
    await expect(page.getByLabel('Received so far')).toHaveValue('6');
    await expect(page.getByLabel('Rejected so far')).toHaveValue('1');
    await expect(page.getByLabel('Credit claimed in rupees')).toHaveValue('3');
    await expect(page.getByLabel('Invoice total in rupees')).toHaveValue('');
    assert.equal(await page.evaluate(() => window.payload), undefined);
  });
});

test('invoice only applies unique exact matches and rejects duplicate invoice rows', async () => {
  await harness('invoice', async page => {
    await page.getByLabel('Invoice text or description').fill('Tomatoes 2 kg @ 30\nTomatoes 3 kg @ 40\nOnions 2 kg @ 15');
    await page.getByRole('button', { name: 'Review text' }).click();
    for (const i of [1, 2, 3]) await expect(page.getByLabel(`Checked row ${i}`)).toBeDisabled();
    await page.getByRole('button', { name: 'Remove row 2' }).click();
    await page.getByLabel('Checked row 1').check();
    await page.getByRole('button', { name: 'Apply checked billed values' }).click();
    assert.equal((await page.evaluate(() => window.applied))[0].rate, '30');
  });
});

test('photo cancellation ignores late OCR, retains text, and allows retry after errors', async () => {
  await harness('shopping', async page => {
    await page.getByLabel('Shopping list text or description').fill('onions 1 kg');
    await page.getByLabel('Shopping list photo').setInputFiles({ name: 'list.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
    await page.getByRole('button', { name: 'Read photo' }).click();
    await expect(page.getByRole('progressbar')).toHaveAttribute('value', '40');
    await page.getByRole('button', { name: 'Cancel reading' }).click();
    assert.equal(await page.evaluate(() => window.ocrSignal.aborted), true);
    await page.evaluate(() => window.finishOCR());
    await expect(page.getByLabel('Shopping list text or description')).toHaveValue('onions 1 kg');
    await page.getByRole('button', { name: 'Read photo' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await page.evaluate(() => window.failOCR());
    await expect(page.getByRole('alert')).toContainText('Unreadable photo');
    await page.getByRole('button', { name: 'Read photo' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await page.evaluate(() => window.finishOCR());
    await expect(page.getByLabel('Shopping list text or description')).toHaveValue('onions 1 kg\nTomatoes 2 kg @ 30');
  });
});

test('empty and oversized input stays editable with an accessible error', async () => {
  await harness('shopping', async page => {
    await page.getByRole('button', { name: 'Review text' }).click();
    await expect(page.getByRole('alert')).toContainText('Enter at least one item line');
    await page.getByLabel('Shopping list text or description').fill(Array(101).fill('Rice 1 kg').join('\n'));
    await page.getByRole('button', { name: 'Review text' }).click();
    await expect(page.getByRole('alert')).toContainText('100 nonempty lines');
    await expect(page.getByLabel('Shopping list text or description')).toHaveValue(Array(101).fill('Rice 1 kg').join('\n'));
    assert.equal(await page.evaluate(() => window.applied), undefined);
  });
});

for (const mode of ['shopping', 'invoice']) {
  test(`${mode} pending review protects corrections and checks until explicitly discarded`, async () => {
    await harness(mode, async page => {
      const label = mode === 'shopping' ? 'Shopping list' : 'Invoice';
      await page.getByLabel(`${label} photo`).setInputFiles({ name: 'next.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
      await page.getByLabel(`${label} text or description`).fill(mode === 'shopping' ? 'Rice 1 kg' : 'Tomatoes 1 kg @ 30');
      await page.getByRole('button', { name: 'Review text', exact: true }).click();
      await page.getByLabel('Quantity, row 1', { exact: true }).fill('2');
      if (mode === 'invoice') await page.getByLabel('Billed rate, row 1').fill('31');
      await page.getByLabel('Checked row 1').check();
      if (mode === 'shopping') {
        await page.getByRole('button', { name: 'Add item manually', exact: true }).click();
        await page.getByLabel('Item name, row 2').fill('Onions');
        await page.getByLabel('Quantity, row 2', { exact: true }).fill('3');
        await page.getByLabel('Unit, row 2', { exact: true }).selectOption('KILOGRAM');
        await page.getByLabel('Checked row 2').check();
      }
      await expect(page.locator('fieldset[hidden] button').filter({ hasText: /^Read photo$/ })).toBeDisabled();
      await expect(page.locator('fieldset[hidden] button').filter({ hasText: /^Review text$/ })).toBeDisabled();
      await expect(page.locator('fieldset[hidden]')).toBeHidden();
      await expect(page.getByLabel(`${label} text or description`)).toBeDisabled();
      await expect(page.getByLabel(`${label} photo`)).toBeDisabled();
      await expect(page.getByLabel(`${label} text or description`)).toBeHidden();
      await expect(page.getByLabel(`${label} photo`)).toBeHidden();
      await expect(page.getByLabel('Quantity, row 1', { exact: true })).toHaveValue('2');
      await expect(page.getByLabel('Checked row 1')).toBeChecked();
      if (mode === 'invoice') await expect(page.getByLabel('Billed rate, row 1')).toHaveValue('31');
      else {
        await expect(page.getByLabel('Quantity, row 2', { exact: true })).toHaveValue('3');
        await expect(page.getByLabel('Checked row 2')).toBeChecked();
      }
      await expect(page.getByText('This discards pending corrections, manually added review rows and checks. Applied values are kept.', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Discard review and change source', exact: true }).click();
      await expect(page.getByLabel('Checked row 1')).toHaveCount(0);
      await expect(page.getByLabel('Checked row 2')).toHaveCount(0);
      await expect(page.getByLabel(`${label} text or description`)).toBeEnabled();
      await page.getByRole('button', { name: 'Read photo', exact: true }).click();
      await expect(page.getByRole('progressbar')).toBeVisible();
      await page.evaluate(() => window.finishOCR());
      await expect(page.getByLabel(`${label} text or description`)).toHaveValue(/Tomatoes 2 kg @ 30/);
      await expect(page.getByLabel('Checked row 1')).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.applied), undefined);
    });
  });
}
