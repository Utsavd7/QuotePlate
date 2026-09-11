/** Six-shot adapter. No browser, signup or capture before this revision's barrier. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkBarrier, verifyBaseline, hash, pickups, prior } from './prepare_workflow_pickups.mjs';
import { createWorkflowRecorder, captureContactPickup, captureShoppingPickup,
  capturePhonePickup, captureInvoicePickup } from './workflow_pickup_actions.mjs';
import { verifiedShots } from './capture_checkpoint.mjs';

const [flag, work, origin] = process.argv.slice(2);
assert.equal(flag, '--capture-after-ui-validation');
assert(work && origin && process.argv.length === 5, 'Provide prepared work directory and validated origin');
const approval = await checkBarrier(work, origin);
assert.equal(origin, 'http://127.0.0.1:52560', 'This adapter targets the parent-owned isolated harness');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = async (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
// A failed attempt is kept intact. Recovery starts from a new preparation/tenant.
await write(path.join(work, 'workflow-capture-attempt.json'), { startedAt: new Date().toISOString(), status: 'started' });
const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const story = await read(path.join(work, 'proposed-storyboard.json'));
const old = await read(path.join(work, 'baseline/capture-evidence.json'));
const plan = await read(path.join(work, 'pickup-plan.json'));
const slots = Object.fromEntries(story.scenes.flatMap(s => s.shots).map(s => [path.parse(s.file).name, s.duration]));
const changed = new Set(pickups.map(file => path.parse(file).name));
const runId = randomUUID().slice(0, 8);
const names = ['Amber Fresh Produce', 'Copper Pot Produce'];
const capabilities = { v: 1, categories: [{ category: 'VEGETABLES', tier: 'CAPABLE', rank: 1 }], items: [] };
const active = new Set();
const evidence = { ...structuredClone(old), workflowActions: {}, shots: {}, motion: {} };
const newEvidence = evidence.workflowActions;
const localDate = days => new Date(Date.now() + (330 * 60 + days * 86400) * 1000).toISOString().slice(0, 10);
const responseFor = (p, suffix) => p.waitForResponse(res => new URL(res.url()).pathname.endsWith(suffix) && res.request().method() === 'POST');
async function api(p, endpoint, method = 'GET', body) {
  assert(endpoint.startsWith('/api/') && !endpoint.includes('://'));
  const result = await p.evaluate(async ({ endpoint, method, body }) => {
    const res = await fetch(endpoint, { method, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: res.status, data: await res.json() };
  }, { endpoint, method, body });
  assert(result.status >= 200 && result.status < 300, 'Local fixture API failed: ' + method + ' ' + endpoint.split('/').slice(0, 3).join('/') + ' ' + result.status);
  return result.data;
}
async function safe(p) {
  await expect(p.locator('[aria-label="Demo workspace notice"]')).toHaveCount(0);
  for (const name of ['Skip for now', 'Collapse setup guide']) {
    const button = p.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
}
const g = { work, origin, evidence: newEvidence, expect,
  clip: async (r, name, act) => {
    await safe(r.page);
    assert.equal(new URL(r.page.url()).hash, '', 'Private fragment must be exchanged before clip');
    await r.clip(name === 'vendor-phone' ? 'phone-native' : name, slots[name], act);
  } };
async function record(label, storageState, phone = false) {
  const r = await createWorkflowRecorder({ work, origin, label: `workflow-${label}-${runId}`, storageState, phone });
  r.label = `workflow-${label}-${runId}`;
  r.page.setDefaultTimeout(20000);
  active.add(r);
  return r;
}
async function finish(r, phone = false) {
  await r.finish(); active.delete(r);
  if (phone) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
    '-loop', '1', '-framerate', '30', '-i', '/tmp/quoteplate-vendor-phone-film/phone-canvas.png',
    '-i', path.join(work, 'captures/phone-native.mp4'), '-filter_complex', '[0:v][1:v]overlay=x=2280:y=0:shortest=1[v]',
    '-map', '[v]', '-an', '-frames:v', '570', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(work, 'captures/vendor-phone.mp4')]);
  const timing = await read(path.join(work, r.label + '-recording.json'));
  const recorded = timing.shots.map(shot => shot.name === 'phone-native' ? 'vendor-phone' : shot.name);
  Object.assign(evidence.shots, await verifiedShots(recorded, slots, async name => {
    const file = path.join(work, 'captures', name + '.mp4');
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]));
    const video = info.streams.find(s => s.codec_type === 'video');
    const sha256 = await hash(file);
    assert.notEqual(sha256, old.shots[name].sha256, 'Unchanged capture cannot be called a pickup');
    return { width: video.width, height: video.height, frames: +video.nb_frames, sha256 };
  }));
  for (const shot of timing.shots) {
    const name = shot.name === 'phone-native' ? 'vendor-phone' : shot.name;
    evidence.motion[name] = { raw: timing.raw, rawSha256: await hash(timing.raw), start: shot.start,
      elapsed: shot.elapsed, duration: shot.duration, actionCompression: shot.elapsed / shot.duration,
      nativeResolution: timing.nativeResolution, recordingManifest: r.label + '-recording.json' };
  }
}

let browser;
let stage = 'browser startup';
try {
  await fs.mkdir(path.join(work, 'fixtures'), { recursive: true });
  for (const name of ['shopping-list.png', 'invoice.png']) await fs.copyFile(path.join(prior, 'fixtures', name), path.join(work, 'fixtures', name), fs.constants.COPYFILE_EXCL);
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  stage = 'unrecorded unique local signup';
  const context = await browser.newContext({ baseURL: origin });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const p = await context.newPage();
  assert.equal(p.video(), null);
  const email = 'workflow-film-' + randomUUID() + '@monsoon-table.example';
  const password = randomUUID() + 'aA1!';
  const signup = await p.request.post(origin + '/api/auth/start', { data: {
    method: 'email', restaurantName: 'Monsoon Table', ownerName: 'Asha Rao', email, password,
    addressLine: '12 Example Lane', city: 'Bengaluru', state: 'Karnataka', pin: '560001',
    phone: '9000000010', timezone: 'Asia/Kolkata', gstin: '',
  } });
  assert.equal(signup.status(), 201, 'Unique ordinary local tenant signup');
  await p.goto(origin + '/signin');
  await p.getByLabel('Work email').fill(email);
  await p.getByLabel('Password', { exact: true }).fill(password);
  await p.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await expect(p).toHaveURL(/\/dashboard$/); await safe(p);
  const account = await api(p, '/api/account');
  assert(account.workspaceId);
  await api(p, '/api/suppliers', 'POST', { businessName: names[0], phone: '9000000011',
    email: 'orders@amber-produce.example', relationshipType: 'CURRENT', capabilities });
  const storageState = await context.storageState();
  stage = 'supplier contact pickup';
  const desktop = await record('intake', storageState);
  await captureContactPickup(desktop, g);
  const { suppliers } = await api(p, '/api/suppliers?active=true&limit=50');
  assert.deepEqual(suppliers.map(s => s.businessName).sort(), [...names].sort());
  newEvidence.contactPickup.savedSupplierCount = suppliers.length;
  for (const supplier of suppliers) await api(p, '/api/suppliers/' + supplier.id, 'PUT', { capabilities });
  const d = desktop.page;
  await d.goto(origin + '/procurement/new');
  await expect(d.getByLabel(/Request title/)).toBeVisible();
  stage = 'shopping photo pickups';
  await captureShoppingPickup(desktop, g);
  // Save the actual reviewed draft outside the replacement slots for continuity.
  await d.getByLabel(/Request title/).fill('First lunch purchase');
  await d.getByLabel('Draft category, row 1', { exact: true }).selectOption('VEGETABLES');
  for (const name of names) await d.getByRole('checkbox', { name: new RegExp(name) }).check();
  await d.getByRole('checkbox', { name: /Also invite new verified suppliers/ }).uncheck();
  await d.getByLabel(/Delivery date/).fill(localDate(2));
  await d.getByLabel(/Quote deadline/).fill(localDate(1) + 'T18:00');
  const saved = responseFor(d, '/api/requests');
  await d.getByRole('button', { name: 'Save draft', exact: true }).click();
  const savedResponse = await saved; assert.equal(savedResponse.status(), 201);
  const { request: draft } = await savedResponse.json();
  assert.equal(draft.menuId, null);
  newEvidence.shopping.savedDraft = true; newEvidence.shopping.savedMenuId = null;
  const opened = await api(p, '/api/requests/' + draft.id + '/open', 'POST', { expectedVersion: draft.version });
  assert.deepEqual(opened.request.supplierRequests.map(s => s.supplier.businessName).sort(), [...names].sort());
  const item = opened.request.items.items[0];
  assert.equal(opened.request.items.items.length, 1); assert.equal(item.name, 'Tomato'); assert.equal(item.quantity, '10');
  await finish(desktop);
  stage = 'phone pickup';
  const amber = suppliers.find(s => s.businessName === names[0]);
  const link = opened.links.find(s => s.supplierId === amber.id);
  assert.equal(new URL(link.url).origin, origin);
  const phone = await record('phone', undefined, true);
  await capturePhonePickup(phone, g, { quoteUrl: link.url, itemId: item.id });
  await finish(phone, true);
  const comparison = await api(p, '/api/requests/' + draft.id + '/comparison');
  const grant = opened.request.supplierRequests.find(s => s.supplierId === amber.id);
  const { award } = await api(p, '/api/requests/' + draft.id + '/award', 'POST', {
    mode: 'WHOLE', expectedRequestVersion: comparison.request.version, supplierRequestId: grant.id,
    quoteRevision: 1, rationale: 'Lower complete price.',
  });
  assert.equal(award.totalPaise, '40000');
  const invoice = await record('invoice', storageState);
  stage = 'invoice pickups';
  await invoice.page.goto(origin + '/procurement/' + draft.id);
  await safe(invoice.page);
  const delivery = invoice.page.locator('[aria-labelledby="delivery-check-heading"]');
  const form = delivery.locator('form').filter({ hasText: names[0] });
  await expect(form).toBeVisible();
  await captureInvoicePickup(invoice, form, form.getByRole('group', { name: 'Tomato', exact: true }), g);
  await finish(invoice);
  assert.deepEqual(Object.keys(evidence.shots).sort(), [...changed].sort());
  await checkBarrier(work, origin);
  // Retained sources are copies, never symlinks or re-exports with new provenance.
  for (const retained of plan.retained) {
    await fs.copyFile(path.join(prior, 'captures', retained.file), path.join(work, 'captures', retained.file), fs.constants.COPYFILE_EXCL);
    const name = path.parse(retained.file).name;
    if (!old.shots[name]) continue;
    evidence.shots[name] = structuredClone(old.shots[name]);
    const motion = structuredClone(old.motion[name]);
    const destination = path.join(work, 'raw', 'retained-' + path.basename(motion.raw));
    try { await fs.copyFile(motion.raw, destination, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await hash(destination), motion.rawSha256); }
    motion.raw = destination;
    evidence.motion[name] = motion;
  }
  evidence.shopping = newEvidence.shopping;
  evidence.invoice = newEvidence.invoice;
  evidence.phone = { ...old.phone, realOCR: true, realSubmission: true };
  evidence.workflowPickup = { status: 'captured; awaiting source and final render review', approval,
    pickupPlanSha256: await hash(path.join(work, 'pickup-plan.json')),
    baselineManifestSha256: await hash(path.join(work, 'baseline-manifest.json')),
    changedClips: pickups, retainedClips: plan.retained.map(s => s.file),
    changedNarrationScenes: plan.changedNarrationScenes, uniqueFictionalTenant: true,
    workspaceIdSha256: (await import('node:crypto')).createHash('sha256').update(account.workspaceId).digest('hex'),
    externalMessages: 0, productionWrites: 0 };
  story.workflowPickup = { changedClips: pickups, retainedClips: plan.retained.map(s => s.file) };
  story.sources = 'Six new local workflow clips after parent UI validation; 22 unchanged previous captures retained by hash, including the licensed kitchen bookends and Google-only signup. No production writes or supplier messages.';
  story.visualRefresh = { clips: pickups, retainedClips: plan.retained.map(s => s.file), description: story.sources };
  await verifyBaseline(work);
  await write(path.join(work, 'capture-evidence.json'), evidence);
  await write(path.join(work, 'storyboard.json'), story);
  console.log('Six native pickups exported; 22 clips retained by hash. Source review and render remain pending.');
} catch (error) {
  // Never print Playwright call logs that can contain private quote URLs or input values.
  const summary = error.message.split('\n')[0].replace(/https?:\/\/\S+/g, '[local URL excluded]')
    .replace(/[\w.+-]+@[\w.-]+/g, '[email excluded]').replace(/[A-Za-z0-9_-]{32,}/g, '[token excluded]');
  await fs.writeFile(path.join(work, 'workflow-capture-failure.txt'), `Stage: ${stage}\n${summary}\nCapture incomplete. Existing raw/exports preserved. No public files changed.\n`);
  throw new Error(`Workflow pickup failed at ${stage}: ${summary}. Private call logs withheld.`);
} finally {
  for (const r of active) await r.abort();
  await browser?.close();
}
