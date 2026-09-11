// Real bundled Tesseract 7 smoke test. Everything, including OCR assets, is
// served from a temporary loopback server; no app server or database is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const bundle = await build({
  stdin: { contents: `import {recognizeMenuPhotos} from './src/lib/menu/browser-ocr';import {readPriceListPhoto} from './src/lib/quotes/price-list-ocr';window.readMenus=recognizeMenuPhotos;window.readPrices=readPriceListPhoto;`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser',
});

test('bundled English OCR reads a printed menu and preserves raw supplier prices entirely locally', { timeout: 60_000 }, async () => {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<html><head><title>Local OCR</title></head><body><script src="/app.js"></script></body></html>'); return; }
    if (path === '/app.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].contents); return; }
    if (/^\/ocr\/(?:worker\.min\.js|core\/[a-z.-]+\.js|lang\/eng\.traineddata\.gz)$/.test(path)) {
      try {
        const bytes = await readFile(`${process.cwd()}/public${path}`);
        response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
        response.end(bytes); return;
      } catch { /* Missing bundled assets must fail the test. */ }
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const requests = [], errors = [];
    context.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const photo = async lines => {
        const canvas = document.createElement('canvas'); canvas.width=1400; canvas.height=400;
        const ctx=canvas.getContext('2d'); ctx.fillStyle='white'; ctx.fillRect(0,0,1400,400);
        ctx.fillStyle='black'; ctx.font='56px Arial';
        lines.forEach((line,i)=>ctx.fillText(line,60,100+i*100));
        return new File([await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))], 'printed.png', {type:'image/png'});
      };
      const menu = await window.readMenus([await photo(['Paneer Tikka 240', 'Dal Fry 180'])], { signal: new AbortController().signal, onProgress(){} });
      const prices = await window.readPrices(await photo(['Tomato 42/kg', 'Paneer 320/kg']), { signal: new AbortController().signal, onProgress(){} });
      return { menu, prices };
    });
    assert.equal(result.menu.text, 'Paneer Tikka\nDal Fry');
    assert.equal(result.menu.confidences.length, 2);
    assert.ok(result.menu.confidences.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.match(result.prices, /Tomato 42\/kg/);
    assert.match(result.prices, /Paneer 320\/kg/);
    assert.deepEqual(errors, []);
    assert.ok(requests.every(request => request.method === 'GET' && new URL(request.url).origin === origin));
    assert.ok(requests.some(request => request.url.endsWith('/ocr/worker.min.js')));
    assert.ok(requests.some(request => request.url.endsWith('/ocr/lang/eng.traineddata.gz')));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
