// Local React harness: no app server, database, image upload or real OCR request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const output = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReviewedTextIntake} from './src/components/procurement/ReviewedTextIntake';import {QuotePriceAssistant} from './src/app/quote/QuotePriceAssistant';
    const root=createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();
    const mode=location.hash.slice(1);
    root.render(<form onSubmit={e=>{e.preventDefault();window.submitted=true}}>{mode==='supplier'?<QuotePriceAssistant items={[{id:'t',name:'Tomatoes',unit:'KILOGRAM'}]} disabled={false} onApply={rows=>{window.applied=rows;return {applied:rows.length,skipped:0}}}/>:<ReviewedTextIntake mode={mode==='invoice'?'invoice':'shopping'} awarded={[{requestItemId:'t',itemName:'Tomatoes',unit:'KILOGRAM'}]} onApply={rows=>{window.applied=rows;return null}}/>}</form>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, outdir: '/tmp/photo-preview-test', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'local-ocr', setup(b) {
    b.onResolve({ filter: /quotes\/price-list-ocr$/ }, () => ({ path: 'ocr', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `export async function readPriceListPhoto(file,{signal,onProgress}) {window.ocrSignal=signal;onProgress(.4);return new Promise((resolve,reject)=>{window.finishOCR=()=>resolve(location.hash==='#supplier'?'Tomatoes 42/kg':'Tomatoes 2 kg @ 30');window.failOCR=()=>reject(new Error('Unreadable photo'));});}`, loader: 'js' }));
  } }],
});
const js = output.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = output.outputFiles.find(f => f.path.endsWith('.css')).text;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');

async function harness(mode, run) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(3000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.created = []; window.revoked = [];
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = file => { const url=create(file);window.created.push(url);return url; };
      URL.revokeObjectURL = url => { window.revoked.push(url);revoke(url); };
    });
    await page.route('**/*', route => {
      requests.push(route.request().url());
      const path = new URL(route.request().url()).pathname;
      if (path === '/app.js') return route.fulfill({ contentType: 'application/javascript', body: js });
      if (path === '/app.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><link rel="stylesheet" href="/app.css"></head><body style="margin:16px"><div id="root"></div><script src="/app.js"></script></body></html>' });
      return route.abort();
    });
    await page.goto(`https://photo-review.test/#${mode}`);
    const label = mode === 'invoice' ? 'Invoice' : 'Shopping list';
    const supplier = mode === 'supplier';
    const open = page.getByRole('button', { name: supplier ? 'Use a price list' : mode === 'invoice' ? 'Read invoice photo or text' : 'Add a shopping list', exact: true });
    await open.click();
    const input = page.getByLabel(supplier ? 'Choose price list photo' : `${label} photo`, { exact: true });
    const source = page.getByLabel(supplier ? 'Prices from your list' : `${label} text or description`);
    const select = async name => {
      await input.setInputFiles({ name, mimeType: 'image/png', buffer: png });
      if (!supplier) await page.getByRole('button', { name: 'Read photo', exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.finishOCR)).toBe('function');
    };
    await run({ page, open, source, select, supplier });
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => Boolean(window.submitted)), false);
    assert.equal(requests.every(url => /^https:\/\/photo-review.test\/(?:app\.(?:js|css))?$/.test(url)), true);
  } finally { await browser.close(); }
}

for (const mode of ['shopping', 'invoice', 'supplier']) {
  test(`${mode}: original photo remains visible beside editable text and review rows`, async () => {
    await harness(mode, async ({ page, source, select, supplier }) => {
      await select('original.png');
      const preview = page.getByRole('img', { name: /Selected photo/ });
      await expect(preview).toBeVisible();
      assert.equal(await preview.evaluate(image => image.src.startsWith('blob:')), true);
      await page.evaluate(() => window.finishOCR());
      await expect(source).toBeEnabled();
      await expect(preview).toBeVisible();
      await source.fill(supplier ? 'Tomatoes 42/kg' : 'Tomatoes 2 kg @ 30');
      await page.getByRole('button', { name: supplier ? 'Read prices' : 'Review text', exact: true }).click();
      await expect(preview).toBeVisible();
      if (!supplier) await expect(page.getByLabel('Checked row 1')).not.toBeChecked();
      assert.equal(await page.evaluate(() => window.applied), undefined);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.evaluate(() => window.unmount());
      assert.deepEqual(await page.evaluate(() => window.revoked), await page.evaluate(() => window.created));
    });
  });

  test(`${mode}: cancel and failed OCR keep manual text and photo; replacing, closing and unmounting release previews`, async () => {
    await harness(mode, async ({ page, open, source, select, supplier }) => {
      await source.fill('My manually entered text');
      await select('first.png');
      const first = await page.getByRole('img', { name: /Selected photo/ }).getAttribute('src');
      await page.getByRole('button', { name: supplier ? 'Cancel photo reading' : 'Cancel reading', exact: true }).click();
      await page.evaluate(() => window.finishOCR());
      await expect(source).toHaveValue('My manually entered text');
      await expect(page.getByRole('img', { name: /Selected photo/ })).toBeVisible();
      await select('second.png');
      await page.evaluate(() => window.failOCR());
      await expect(page.getByRole('alert')).toContainText('Unreadable photo');
      await expect(source).toHaveValue('My manually entered text');
      await expect(page.getByRole('img', { name: /Selected photo.*second.png/ })).toBeVisible();
      assert.equal(await page.evaluate(url => window.revoked.includes(url), first), true);
      if (supplier) await page.getByRole('button', { name: 'Back to my quote' }).click();
      else await open.click();
      assert.deepEqual(await page.evaluate(() => window.revoked), await page.evaluate(() => window.created));
      await open.click();
      await expect(page.getByRole('img', { name: /Selected photo.*second.png/ })).toBeVisible();
      await page.evaluate(() => window.unmount());
      assert.deepEqual(await page.evaluate(() => window.revoked), await page.evaluate(() => window.created));
    });
  });
}
