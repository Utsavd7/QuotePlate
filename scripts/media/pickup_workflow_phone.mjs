/** A staged phone-only pacing correction. Never replaces captures or publishes. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkBarrier, hash } from './prepare_workflow_pickups.mjs';
import { createWorkflowRecorder, capturePhonePickup } from './workflow_pickup_actions.mjs';

const [work, child] = process.argv.slice(2);
assert(work && child && process.argv.length === 4);
const origin = 'http://127.0.0.1:52560';
await checkBarrier(work, origin);
assert(path.resolve(child).startsWith(path.resolve(work) + '/phone-pacing-'));
await fs.mkdir(child);
for (const name of ['pickup-plan.json', 'baseline-manifest.json', 'ui-source-hashes.json', 'workflow-parent-ui-validation.json'])
  await fs.copyFile(path.join(work, name), path.join(child, name));
const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
let r;
try {
  const context = await browser.newContext({ baseURL: origin });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const p = await context.newPage();
  assert.equal(p.video(), null);
  const email = 'phone-film-' + randomUUID() + '@monsoon-table.example', password = randomUUID() + 'aA1!';
  const response = await p.request.post(origin + '/api/auth/start', { data: {
    method: 'email', restaurantName: 'Monsoon Table', ownerName: 'Asha Rao', email, password,
    addressLine: '12 Example Lane', city: 'Bengaluru', state: 'Karnataka', pin: '560001', phone: '9000000010', timezone: 'Asia/Kolkata', gstin: '',
  } });
  assert.equal(response.status(), 201);
  await p.goto('/signin'); await p.getByLabel('Work email').fill(email); await p.getByLabel('Password', { exact: true }).fill(password);
  await p.getByRole('button', { name: 'Sign in with email', exact: true }).click(); await expect(p).toHaveURL(/\/dashboard$/);
  async function api(endpoint, method, body) {
    const result = await p.evaluate(async ({ endpoint, method, body }) => {
      const res = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, data: await res.json() };
    }, { endpoint, method, body });
    assert(result.status >= 200 && result.status < 300, 'Local fixture API failed'); return result.data;
  }
  const { menu } = await api('/api/menus', 'POST', { name: 'Lunch menu', sourceText: 'Tomato curry',
    document: { v: 1, source: { kind: 'PASTE', canonicalUrl: null, permissionConfirmed: false }, dishes: [{
      id: 'dish_tomato', name: 'Tomato curry', position: 0, ingredients: [{ id: 'ingredient_tomato', itemKey: 'tomato', name: 'Tomato', quantity: '10', unit: 'KILOGRAM', specification: { v: 1, category: 'VEGETABLES' } }],
    }] } });
  await api('/api/menus/' + menu.id + '/approve', 'POST', { expectedVersion: menu.version });
  const { supplier } = await api('/api/suppliers', 'POST', { businessName: 'Amber Fresh Produce', phone: '9000000011', email: 'orders@amber-produce.example', relationshipType: 'CURRENT',
    capabilities: { v: 1, categories: [{ category: 'VEGETABLES', tier: 'CAPABLE', rank: 1 }], items: [] } });
  const localDate = days => new Date(Date.now() + (330 * 60 + days * 86400) * 1000).toISOString().slice(0, 10);
  const { request: draft } = await api('/api/requests', 'POST', { title: 'First lunch purchase', menuId: menu.id, selectedItemIds: ['ingredient_tomato'],
    defaultSourcing: { v: 1, modes: ['CURRENT'], currentSupplierIds: [supplier.id], selectedNewSupplierIds: [], acceptVerifiedApplications: false }, sourcingOverrides: {},
    deliveryDetails: { addressLine: '12 Example Lane', city: 'Bengaluru', state: 'Karnataka', pin: '560001' },
    deliveryDate: localDate(2), quoteDeadline: new Date(localDate(1) + 'T18:00:00+05:30').toISOString(), commercialTerms: null });
  const opened = await api('/api/requests/' + draft.id + '/open', 'POST', { expectedVersion: draft.version });
  const label = 'workflow-phone-paced-' + randomUUID().slice(0, 8);
  r = await createWorkflowRecorder({ work: child, origin, label, phone: true });
  const evidence = {};
  await capturePhonePickup(r, { origin, expect, evidence, clip: (rec, _name, act) => rec.clip('phone-native', 19, act) },
    { quoteUrl: opened.links[0].url, itemId: opened.request.items.items[0].id });
  await r.finish(); r = null;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-loop', '1', '-framerate', '30',
    '-i', '/tmp/quoteplate-vendor-phone-film/phone-canvas.png', '-i', path.join(child, 'captures/phone-native.mp4'),
    '-filter_complex', '[0:v][1:v]overlay=x=2280:y=0:shortest=1[v]', '-map', '[v]', '-an', '-frames:v', '570',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(child, 'captures/vendor-phone.mp4')]);
  const timing = JSON.parse(await fs.readFile(path.join(child, label + '-recording.json'), 'utf8'));
  const shot = timing.shots[0];
  await fs.writeFile(path.join(child, 'phone-evidence.json'), JSON.stringify({ actions: evidence.phonePickup,
    sha256: await hash(path.join(child, 'captures/vendor-phone.mp4')), motion: { raw: timing.raw, rawSha256: await hash(timing.raw),
      start: shot.start, elapsed: shot.elapsed, duration: shot.duration, actionCompression: shot.elapsed / shot.duration,
      nativeResolution: timing.nativeResolution, recordingManifest: label + '-recording.json' } }, null, 2) + '\n');
  console.log('Paced phone candidate staged. Original six captures remain untouched pending inspection.');
} finally { if (r) await r.abort(); await browser.close(); }
