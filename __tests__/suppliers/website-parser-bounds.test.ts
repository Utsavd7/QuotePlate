import { Worker } from 'node:worker_threads';
import { buildSync } from 'esbuild';

const bundle = buildSync({
  entryPoints: ['src/lib/suppliers/website-discovery.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external',
}).outputFiles[0].text;

// A hung parser must fail this test without hanging Jest or its shared process.
async function isolatedDiscovery(html: string): Promise<{ status: string; elapsedMs: number }> {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const Module = require('node:module');
    const filename = require('node:path').join(workerData.cwd, 'website-parser-test.cjs');
    const mod = new Module(filename); mod.filename = filename;
    mod.paths = Module._nodeModulePaths(workerData.cwd); mod._compile(workerData.bundle, filename);
    const started = performance.now();
    parentPort.postMessage({ ready: true });
    mod.exports.discoverWebsiteContacts(new URL('https://supplier.com'), {
      now: Date.now,
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      request: async ({ url }) => ({ statusCode: url.pathname === '/robots.txt' ? 404 : 200,
        headers: { 'content-type': 'text/html' }, body: Buffer.from(url.pathname === '/robots.txt' ? '' : workerData.html) }),
    }).then(result => parentPort.postMessage({ status: result.status, elapsedMs: performance.now() - started }));
  `, { eval: true, workerData: { bundle, html, cwd: process.cwd() } });
  try {
    return await new Promise((resolve, reject) => {
      let timer = setTimeout(() => reject(new Error('Parser worker did not start')), 3000);
      worker.on('message', result => {
        clearTimeout(timer);
        if (result.ready) timer = setTimeout(() => reject(new Error('Parser exceeded 1500ms CPU budget')), 1500);
        else resolve(result);
      });
      worker.on('error', error => { clearTimeout(timer); reject(error); });
    });
  } finally { await worker.terminate(); }
}

it('rejects 1 MB of unterminated comment openers promptly', async () => {
  const result = await isolatedDiscovery('<!--'.repeat(250_000));
  expect(result.status).toBe('unavailable');
  expect(result.elapsedMs).toBeLessThan(1500);
});
it.each([
  ['unterminated quoted tag', '<a href="'.repeat(100_000)],
  ['oversized attribute', `<div title="${'a'.repeat(500_000)}">Contact</div>`],
  ['excessive nesting', '<div>'.repeat(1000) + 'orders@supplier.com' + '</div>'.repeat(1000)],
  ['unterminated script', '<script>' + '<!--'.repeat(200_000)],
] as const)('rejects %s within the parser budget', async (_label, html) => {
  const result = await isolatedDiscovery(html);
  expect(result.status).toBe('unavailable');
  expect(result.elapsedMs).toBeLessThan(1500);
});
it.each([
  ['complete comments', '<!-- harmless -->'.repeat(50_000)],
  ['a megabyte of plain visible text', 'a'.repeat(1_000_000)],
  ['phone label with hostile whitespace', '<p>Phone' + ' '.repeat(900_000) + 'x</p>'],
] as const)('scans %s without backtracking', async (_label, html) => {
  const result = await isolatedDiscovery(html);
  expect(result.status).toBe('no-public-contacts');
  expect(result.elapsedMs).toBeLessThan(1500);
});
