/**
 * Real local application recording for the 165-second feature overview.
 * Default invocation only checks preparation. Capture requires the explicit flag
 * after the parent has validated and refreshed the UI build. No server control.
 * Sessions, passwords and private links stay in memory; no external messages.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedShots, loadCheckpoint, writeCheckpoint } from './capture_checkpoint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const run = promisify(execFile);
const work = process.env.QUOTEPLATE_FILM_WORK || '/tmp/quoteplate-feature-overview-film';
const origin = process.env.QUOTEPLATE_FILM_ORIGIN || 'http://127.0.0.1:52560';
const priorPhone = process.env.QUOTEPLATE_PHONE_ASSETS || '/tmp/quoteplate-vendor-phone-film';
const storyPath = path.join(root, 'docs/media/quoteplate-product-film-164.json');
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Local tenant only');
assert.equal(new URL(origin).protocol, 'http:');
process.env.QUOTEPLATE_FILM_WORK = work;
const { recorder } = await import('./motion_capture.mjs');
const names = ['Amber Fresh Produce', 'Copper Pot Produce'];
const title = 'First lunch purchase';
const slots = {
  'first-workspace': 2, 'menu-options': 8, 'first-menu': 12,
  'supplier-contacts': 8, 'first-request': 15, 'request-sharing': 7,
  'vendor-phone': 19, 'completion-comparison': 7, 'completion-award': 7,
  'completion-delivery': 8, 'completion-credit': 6, 'completion-today': 4,
  'workspace-sharing': 4, 'supplier-confirmation': 9, 'nearby-discovery': 5,
  'meal-planning': 5, 'purchase-reports': 5, 'purchase-history': 5,
};
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const json = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
const localDate = (days = 0) => new Date(Date.now() + (330 * 60 + days * 86400) * 1000).toISOString().slice(0, 10);
const deadline = () => localDate(1) + 'T18:00';
let stage = 'preparation';
const active = new Set();
const captured = new Set();
const retained = new Set();
const pending = new WeakMap();
const progressPath = path.join(work, 'capture-progress.json');
const evidence = { nativeDesktop: [3840, 2400], nativePhone: [1560, 2400], localTenant: true,
  browserResponseMocks: false, externalMessages: 0, privacy: 'Private link text masked in capture only; authentication off camera.', shots: {} };
function mark(value) { stage = value; console.log('Film: ' + value); }

async function prepare() {
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(path.join(work, 'captures'), { recursive: true });
  const story = JSON.parse(await fs.readFile(storyPath, 'utf8'));
  assert.equal(story.scenes.reduce((sum, s) => sum + s.duration, 0), 165);
  for (const name of ['phone-canvas.png', 'printed-price-fixture.png']) await fs.access(path.join(priorPhone, name));
  for (const [name, expected] of Object.entries(slots)) {
    const shot = story.scenes.flatMap(s => s.shots).find(s => s.file === name + '.mp4');
    assert.equal(shot?.duration, expected, name + ' timeline slot');
  }
  await json(path.join(work, 'capture-plan.json'), {
    status: 'prepared; awaiting parent UI validation before capture',
    origin, durationSeconds: 165, slots, authentication: 'Unrecorded ordinary signup; random credentials in memory.',
    phoneAssets: priorPhone, serverControl: 'Parent only',
    retained: ['kitchen-intro.mp4', 'first-restaurant.mp4', 'first-owner.mp4', 'kitchen-end.mp4'],
    nearby: 'One actual public-source search; show real controls if unavailable, never fixture results.',
  });
  console.log('Preparation ready: 18 application clips; 165-second timeline; no browser started.');
}

async function ownerJson(page, endpoint, method = 'GET', body) {
  const result = await page.evaluate(async ({ endpoint, method, body }) => {
    const response = await fetch(endpoint, { method, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { endpoint, method, body });
  assert(result.status >= 200 && result.status < 300, endpoint + ' HTTP ' + result.status);
  return result.body;
}

async function createOwner(browser) {
  mark('off-camera local signup');
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  assert.equal(page.video(), null);
  const email = 'film-' + randomUUID() + '@monsoon-table.example';
  const password = randomUUID() + 'aA1!';
  const response = await page.request.post(origin + '/api/auth/start', { data: {
    method: 'email', restaurantName: 'Monsoon Table', ownerName: 'Asha Rao', email, password,
    addressLine: '12 Example Lane', city: 'Bengaluru', state: 'Karnataka', pin: '560001',
    phone: '+919876543210', timezone: 'Asia/Kolkata', gstin: '27ABCDE1234F1Z5',
  } });
  assert.equal(response.status(), 201, 'Ordinary local signup');
  await page.goto(origin + '/signin');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await safePage(page);
  const account = await ownerJson(page, '/api/account');
  const storageState = await context.storageState();
  await context.close();
  return { storageState, workspaceId: account.workspaceId };
}

async function safePage(page) {
  await expect(page.locator('[aria-label="Demo workspace notice"]')).toHaveCount(0);
  for (const name of ['Skip for now', 'Collapse setup guide']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
}

async function makeRecorder(label, storageState, captureMode = 'desktop') {
  const r = await recorder(null, label + (retained.size ? '-resume' : ''), { baseURL: origin, captureMode, ...(storageState ? { storageState } : {}) });
  active.add(r);
  pending.set(r, []);
  r.page.setDefaultTimeout(20000);
  r.page.setDefaultNavigationTimeout(30000);
  // This is a privacy mask, not replacement application content. It is installed
  // before navigation so tokens cannot flash in even the untrimmed raw recording.
  await r.context.addInitScript(() => {
    const install = () => {
      if (!document.documentElement) return false;
      const style = document.createElement('style');
      style.textContent = 'code{filter:blur(8px)!important}input[readonly]{-webkit-text-security:disc!important}';
      document.documentElement.append(style);
      return true;
    };
    if (!install()) new MutationObserver((_records, observer) => { if (install()) observer.disconnect(); })
      .observe(document, { childList: true, subtree: true });
  });
  await r.context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    evidence.externalMessages += /wa\.me|whatsapp|mailto:/i.test(url.href) ? 1 : 0;
    return route.abort();
  });
  const originalClick = r.click;
  r.click = async locator => {
    const href = await locator.getAttribute('href');
    assert(!href || !/^(?:mailto:|https?:\/\/(?:wa\.me|[^/]*whatsapp))/i.test(href), 'Never open a messaging application');
    return originalClick(locator);
  };
  return r;
}

async function clip(r, name, act) {
  mark((retained.has(name) ? 'recreate local state for ' : 'record ') + name);
  const duration = slots[name];
  assert(duration);
  await safePage(r.page);
  assert.equal(new URL(r.page.url()).hash, '', 'Access fragment must be exchanged before recording');
  if (retained.has(name)) await act(r);
  else await r.clip(name === 'vendor-phone' ? 'phone-native' : name, duration, () => act(r));
  if (!retained.has(name)) pending.get(r).push(name);
}
async function inspectShot(name) {
  const file = path.join(work, 'captures', name + '.mp4');
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames', '-of', 'json', file]);
  const stream = JSON.parse(stdout).streams[0];
  return { width: stream.width, height: stream.height, frames: Number(stream.nb_frames), sha256: await hash(file) };
}
async function commitShots(names) {
  // Verify the entire export batch before adding any completion claims.
  const records = await verifiedShots(names, slots, inspectShot);
  Object.assign(evidence.shots, records);
  for (const name of names) captured.add(name);
  await writeCheckpoint(progressPath, stage, evidence.shots);
}
async function finish(r) {
  await r.finish(); active.delete(r);
  // The phone clip is committed only after its native surface is composited.
  await commitShots(pending.get(r).filter(name => name !== 'vendor-phone'));
  pending.delete(r);
}
async function paste(r, locator, value) { await r.move(locator); await locator.fill(String(value)); await r.pause(180); }
async function confirmClick(r, button, message) {
  const accepted = r.page.waitForEvent('dialog').then(async dialog => {
    assert.equal(dialog.type(), 'confirm');
    assert(dialog.message().startsWith(message), 'Unexpected confirmation');
    await dialog.accept();
  });
  await r.click(button); await accepted;
}
const responseFor = (page, suffix) => page.waitForResponse(r => new URL(r.url()).pathname.endsWith(suffix) && r.request().method() === 'POST', { timeout: 45000 });

async function captureRestaurant(owner) {
  const r = await makeRecorder('overview-restaurant', owner.storageState), p = r.page;
  await p.goto(origin + '/dashboard'); await expect(p.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await clip(r, 'first-workspace', async () => r.move(p.getByRole('heading', { name: 'Today', exact: true })));
  await p.goto(origin + '/menus');
  await p.getByRole('button', { name: 'Add menu', exact: true }).first().click();
  await clip(r, 'menu-options', async () => {
    await r.move(p.getByRole('button', { name: /^Type or paste/ })); await r.pause(700);
    await r.click(p.getByRole('button', { name: /^Photos Use your camera/ }));
    await r.move(p.locator('label[for="menu-photos"]')); await r.pause(900);
    await r.move(p.getByRole('button', { name: /^Use your phone/ })); await r.pause(800);
    await r.click(p.getByRole('button', { name: 'All options', exact: true }));
    await r.move(p.getByRole('button', { name: /^Permitted website link/ }));
  });
  await p.getByRole('button', { name: 'Close menu form', exact: true }).click();
  await clip(r, 'first-menu', async () => {
    await r.click(p.getByRole('button', { name: 'Add menu', exact: true }).first());
    await r.click(p.getByRole('button', { name: /^Type or paste/ }));
    await r.type(p.getByLabel('One dish per line'), 'Tomato curry');
    await r.click(p.getByRole('button', { name: 'Save and review', exact: true }));
    await r.type(p.getByLabel('Menu name', { exact: true }), 'Lunch menu');
    await r.click(p.getByRole('button', { name: 'Add ingredient', exact: true }).first());
    await r.type(p.getByLabel('Tomato curry ingredient 1'), 'Tomato');
    await r.type(p.getByLabel('Tomato quantity', { exact: true }), '10');
    await p.getByLabel('Tomato unit', { exact: true }).selectOption('KILOGRAM');
    await p.getByLabel('Tomato category', { exact: true }).selectOption('VEGETABLES');
    await confirmClick(r, p.getByRole('button', { name: 'Approve menu', exact: true }).first(), 'Approve this menu?');
    await expect(p.getByText(/Approved · v/).first()).toBeVisible();
  });
  await p.goto(origin + '/suppliers');
  await p.locator('summary').filter({ hasText: 'Add existing contacts' }).click();
  await clip(r, 'supplier-contacts', async () => {
    await paste(r, p.getByLabel('Supplier contact list'),
      'Amber Fresh Produce,9000000011,orders@amber-produce.example\nCopper Pot Produce,9000000012,orders@copper-pot.example');
    await r.click(p.getByRole('button', { name: 'Review contacts', exact: true }));
    await r.move(p.getByRole('textbox', { name: 'Business name, row 1', exact: true })); await r.pause(750);
    const added = responseFor(p, '/api/suppliers/import');
    await r.click(p.getByRole('button', { name: 'Add 2 suppliers', exact: true }));
    assert.equal((await added).status(), 201);
    await expect(p.getByRole('link', { name: 'Open workspace for ' + names[0] })).toBeVisible();
  });
  const { suppliers } = await ownerJson(p, '/api/suppliers?active=true&limit=50');
  for (const name of names) {
    const supplier = suppliers.find(s => s.businessName === name); assert(supplier);
    // Ordinary reviewed capabilities saved through the real owner API.
    await ownerJson(p, '/api/suppliers/' + supplier.id, 'PUT', {
      capabilities: { v: 1, categories: [{ category: 'VEGETABLES', tier: 'CAPABLE', rank: 1 }], items: [] },
    });
  }
  await p.goto(origin + '/procurement/new');
  await expect(p.getByLabel(/Request title/)).toBeVisible();
  await clip(r, 'first-request', async () => {
    await r.type(p.getByLabel(/Request title/), title);
    await r.move(p.getByLabel(/Approved menu/)); await p.getByLabel(/Approved menu/).selectOption({ label: 'Lunch menu' });
    for (const name of names) {
      const box = p.getByRole('checkbox', { name: new RegExp(name) });
      if (!await box.isChecked()) await r.click(box);
    }
    const discovery = p.getByRole('checkbox', { name: /Also invite new verified suppliers/ });
    if (await discovery.isChecked()) await r.click(discovery);
    await paste(r, p.getByLabel(/Delivery date/), localDate(2));
    await paste(r, p.getByLabel(/Quote deadline/), deadline());
    await r.click(p.getByRole('button', { name: 'Save draft', exact: true }));
    await expect(p.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await r.move(p.getByRole('button', { name: 'Create supplier links', exact: true }));
  });
  let opened;
  await clip(r, 'request-sharing', async () => {
    const pending = responseFor(p, '/open');
    await confirmClick(r, p.getByRole('button', { name: 'Create supplier links', exact: true }), 'Open');
    const response = await pending; assert(response.ok()); opened = await response.json();
    const row = p.locator('article').filter({ hasText: names[0] }).filter({ has: p.getByRole('button', { name: 'Copy link', exact: true }) });
    await inspectShareControls(r, row, 'orders@amber-produce.example');
  });
  const request = opened.request;
  assert.equal(request.status, 'OPEN'); assert.equal(request.items.items.length, 1);
  assert.equal(request.items.items[0].quantity, '10'); assert.equal(request.items.items[0].name, 'Tomato');
  const handoff = { ...owner, requestId: request.id, item: request.items.items[0], suppliers: names.map((name, i) => {
    const grant = request.supplierRequests.find(g => g.supplier.businessName === name); assert(grant);
    const link = opened.links.find(l => l.supplierId === grant.supplierId); assert(link);
    assert.equal(new URL(link.url).origin, origin);
    return { name, id: grant.supplierId, grantId: grant.id, quoteUrl: link.url, rate: i ? '44' : '40', totalPaise: i ? '44000' : '40000' };
  }) };
  await finish(r);
  return handoff;
}

async function inspectShareControls(r, scope, email) {
  const whatsapp = scope.getByRole('link', { name: 'Share on WhatsApp', exact: true });
  assert.equal(new URL(await whatsapp.getAttribute('href')).hostname, 'wa.me');
  assert(await whatsapp.locator('svg path').count() > 0, 'Real WhatsApp glyph');
  const draft = scope.getByRole('link', { name: 'Email', exact: true });
  const mail = new URL(await draft.getAttribute('href'));
  assert.equal(mail.protocol, 'mailto:'); assert.equal(decodeURIComponent(mail.pathname), email);
  await r.move(whatsapp); await r.pause(650);
  await r.move(draft); await r.pause(500);
  await r.click(scope.getByRole('button', { name: 'Copy link', exact: true }));
}

async function capturePhone(h, browser) {
  const r = await makeRecorder('overview-phone', undefined, 'phone'), p = r.page;
  const loaded = responseForGet(p, '/api/public/quote');
  await p.goto(h.suppliers[0].quoteUrl);
  const data = await (await loaded).json();
  assert.equal(data.supplierName, names[0]); assert(!data.latestQuote);
  await p.getByRole('button', { name: 'Use a price list', exact: true }).scrollIntoViewIfNeeded();
  const photo = await fs.readFile(path.join(priorPhone, 'printed-price-fixture.png'));
  await clip(r, 'vendor-phone', async () => {
    const began = performance.now();
    const holdUntil = seconds => r.pause(Math.max(0, seconds * 1000 - (performance.now() - began)));
    await r.click(p.getByRole('button', { name: 'Use a price list', exact: true }));
    const chooser = p.waitForEvent('filechooser');
    await r.click(p.getByRole('button', { name: 'Choose photo', exact: true }));
    await (await chooser).setFiles({ name: 'printed-price-fixture.png', mimeType: 'image/png', buffer: photo });
    await expect(p.getByLabel('Amount for price 1')).toHaveValue('40', { timeout: 90000 });
    await r.move(p.getByLabel('Amount for price 1')); await holdUntil(6.2);
    await r.click(p.getByRole('button', { name: 'Use checked prices', exact: true }));
    await r.click(p.getByRole('button', { name: 'Back to my quote', exact: true }));
    await r.click(p.getByRole('button', { name: 'One item at a time', exact: true }));
    await expect(p.locator('[name="rate:' + h.item.id + '"]')).toHaveValue('40'); await holdUntil(11.2);
    await r.click(p.getByRole('button', { name: 'Continue to delivery', exact: true }));
    await r.click(p.getByRole('button', { name: 'Review delivery & total', exact: true }));
    await r.move(p.getByText('Total to restaurant', { exact: true })); await holdUntil(16.2);
    const sent = responseFor(p, '/api/public/quote');
    await r.click(p.getByRole('button', { name: 'Send quote', exact: true }));
    const response = await sent, quote = await response.json();
    assert.equal(response.status(), 201); assert.equal(quote.totalPaise, '40000');
    await r.move(p.getByRole('status').filter({ hasText: 'Quote sent.' }));
  });
  await finish(r);
  const native = path.join(work, 'captures/phone-native.mp4');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-loop', '1', '-framerate', '30', '-i', path.join(priorPhone, 'phone-canvas.png'), '-i', native,
    '-filter_complex', '[0:v][1:v]overlay=x=2280:y=0:shortest=1[v]', '-map', '[v]', '-an',
    '-frames:v', '570', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(work, 'captures/vendor-phone.mp4')]);
  await commitShots(['vendor-phone']);
  evidence.phone = { realOCR: true, realSubmission: true, rate: '40', quantity: '10', totalPaise: '40000',
    nativePhone: [1560, 2400], canvas: [3840, 2400], placement: [2280, 0], upscaled: false,
    printedFixtureSha256: await hash(path.join(priorPhone, 'printed-price-fixture.png')) };
  // Second real offer supports the comparison, without inventing any results.
  const c = await browser.newContext(), q = await c.newPage();
  await q.goto(h.suppliers[1].quoteUrl);
  await q.locator('[name="rate:' + h.item.id + '"]').fill('44');
  await q.locator('[name="gst:' + h.item.id + '"]').fill('0');
  await q.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
  const sent = responseFor(q, '/api/public/quote');
  await q.getByRole('button', { name: 'Send quote', exact: true }).click();
  const result = await sent; assert.equal(result.status(), 201); assert.equal((await result.json()).totalPaise, '44000');
  await c.close();
}
const responseForGet = (page, endpoint) => page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'GET');

async function captureCompletion(h) {
  const r = await makeRecorder('overview-completion', h.storageState), p = r.page;
  await p.goto(origin + '/procurement/' + h.requestId);
  await clip(r, 'completion-comparison', async () => {
    await r.click(p.getByRole('button', { name: 'Refresh quotes', exact: true }));
    const comparison = await ownerJson(p, '/api/requests/' + h.requestId + '/comparison');
    assert.equal(comparison.quotes.length, 2);
    assert.deepEqual(comparison.quotes.map(q => q.totalPaise).sort(), ['40000', '44000']);
    await r.move(p.getByRole('heading', { name: 'Supplier prices', exact: true })); await r.pause(900);
    await p.mouse.wheel(0, 240); await r.pause(900);
  });
  await p.getByRole('heading', { name: 'Choose supplier', exact: true }).scrollIntoViewIfNeeded();
  await clip(r, 'completion-award', async () => {
    await r.click(p.getByRole('button', { name: 'One supplier', exact: true }));
    await r.click(p.locator('label').filter({ has: p.locator('input[name="whole-award"]') }).filter({ hasText: names[0] }));
    await r.type(p.getByLabel(/Reason for this decision/), 'Lower complete price.');
    const saved = responseFor(p, '/award');
    await confirmClick(r, p.getByRole('button', { name: 'Confirm supplier choice', exact: true }), 'Record the final award');
    const response = await saved; assert(response.ok());
    const { award } = await response.json(); assert.equal(award.totalPaise, '40000');
    await expect(p.getByText('Supplier choice saved', { exact: true })).toBeVisible();
  });
  const delivery = p.locator('[aria-labelledby="delivery-check-heading"]');
  const form = delivery.locator('form').filter({ hasText: names[0] });
  const item = form.getByRole('group', { name: 'Tomato', exact: true });
  await delivery.scrollIntoViewIfNeeded();
  await clip(r, 'completion-delivery', async () => {
    await r.type(form.getByLabel(/^Invoice total in rupees/), '400');
    await r.type(item.getByLabel('Received so far', { exact: true }), '9');
    await r.type(item.getByLabel('Rejected so far', { exact: true }), '0');
    await r.click(item.locator('summary').filter({ hasText: 'Invoice quantity & rate (optional)' }));
    await r.type(item.getByLabel('Billed quantity (optional)', { exact: true }), '10');
    await r.type(item.getByLabel('Billed rate in rupees', { exact: true }), '40');
    await paste(r, form.getByLabel('Actual delivery date', { exact: true }), localDate());
  });
  await clip(r, 'completion-credit', async () => {
    await r.type(form.getByLabel('Credit claimed in rupees', { exact: true }), '40');
    await r.type(form.getByLabel('Settlement notes', { exact: true }), 'FIRST-CN-01');
    await r.click(form.getByLabel('Report a problem', { exact: true }));
    await r.click(form.getByLabel('Missing quantity', { exact: true }));
    const saved = responseFor(p, '/receiving');
    await r.click(form.getByRole('button', { name: 'Save delivery check', exact: true }));
    assert((await saved).ok());
    await expect(delivery.getByRole('button', { name: 'Update check', exact: true })).toBeVisible();
  });
  await clip(r, 'completion-today', async () => {
    await r.click(p.getByRole('navigation', { name: 'Workspace navigation', exact: true }).getByRole('link', { name: 'Today', exact: true }));
    await r.move(p.getByRole('link', { name: 'Check delivery for ' + title, exact: true }));
  });
  evidence.purchase = { title, item: 'Tomato', quantity: '10', offersPaise: ['40000', '44000'],
    awardPaise: '40000', received: '9', invoiceInr: '400', creditClaimedInr: '40' };
  await finish(r);
}

async function captureWorkspace(h) {
  const r = await makeRecorder('overview-workspace', h.storageState), p = r.page;
  await p.goto(origin + '/supplier-collaboration?supplier=' + h.suppliers[0].id);
  await expect(p.getByRole('heading', { name: names[0], exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'Create private link', exact: true }).click();
  const input = p.getByRole('textbox', { name: 'New private link', exact: true });
  await expect(input).toBeVisible();
  const link = await input.inputValue(); assert.equal(new URL(link).origin, origin);
  const panel = p.locator('[aria-labelledby="portal-access-title"]');
  await panel.getByRole('link', { name: 'Share on WhatsApp', exact: true }).scrollIntoViewIfNeeded();
  await clip(r, 'workspace-sharing', () => inspectShareControls(r, panel, 'orders@amber-produce.example'));
  await finish(r);
  const supplier = await makeRecorder('overview-confirmation'), q = supplier.page;
  await q.goto(link);
  await expect(q.getByRole('heading', { name: 'Monsoon Table', exact: true })).toBeVisible();
  const initial = await ownerJson(q, '/api/public/supplier-portal');
  assert.equal(initial.supplierName, names[0]);
  assert.equal(initial.businessDetails.email, 'orders@amber-produce.example');
  assert(!JSON.stringify(initial).includes('orders@copper-pot.example'));
  await q.getByRole('button', { name: 'Confirm business details', exact: true }).click();
  await clip(supplier, 'supplier-confirmation', async () => {
    await supplier.type(q.getByLabel('Contact name (optional)', { exact: true }), 'Meera');
    await supplier.move(q.getByRole('checkbox', { name: 'Vegetables', exact: true }));
    await expect(q.getByRole('checkbox', { name: 'Vegetables', exact: true })).toBeChecked();
    await supplier.click(q.getByRole('button', { name: 'Continue to delivery details', exact: true }));
    await q.locator('select[name="wholesale"]').selectOption('yes');
    await supplier.type(q.getByLabel('Delivery PIN codes (up to 100, optional)', { exact: true }), '560001');
    const saved = responseFor(q, '/api/public/supplier-portal');
    await supplier.click(q.getByRole('button', { name: 'Save business details', exact: true }));
    const response = await saved; assert.equal(response.status(), 200);
    const result = await response.json(); assert(result.tradingProfile.businessDetailsConfirmedAt);
    await expect(q.getByText('Supplier-confirmed', { exact: true })).toBeVisible();
    await supplier.click(q.getByRole('link', { name: 'Go to orders and quotes', exact: true }));
  });
  evidence.supplierConfirmation = { saved: true, onlyOwnContacts: true, category: 'VEGETABLES', servedPin: '560001' };
  await finish(supplier);
}

async function recreatePurchaseForOverview(owner, browser) {
  mark('off-camera API setup for remaining overview shots');
  const context = await browser.newContext({ baseURL: origin, storageState: owner.storageState });
  const p = await context.newPage();
  await p.goto(origin + '/dashboard');
  assert.equal(p.video(), null);
  const { menu } = await ownerJson(p, '/api/menus', 'POST', {
    name: 'Lunch menu', sourceText: 'Tomato curry',
    document: { v: 1, source: { kind: 'PASTE', canonicalUrl: null, permissionConfirmed: false },
      dishes: [{ id: 'dish_tomato', name: 'Tomato curry', position: 0, ingredients: [{
        id: 'ingredient_tomato', itemKey: 'tomato', name: 'Tomato', quantity: '10', unit: 'KILOGRAM',
        specification: { v: 1, category: 'VEGETABLES' },
      }] }] },
  });
  await ownerJson(p, '/api/menus/' + menu.id + '/approve', 'POST', { expectedVersion: menu.version });
  const suppliers = [];
  for (const [index, name] of names.entries()) {
    const { supplier } = await ownerJson(p, '/api/suppliers', 'POST', {
      businessName: name, phone: index ? '9000000012' : '9000000011',
      email: index ? 'orders@copper-pot.example' : 'orders@amber-produce.example',
      relationshipType: 'CURRENT',
      capabilities: { v: 1, categories: [{ category: 'VEGETABLES', tier: 'CAPABLE', rank: 1 }], items: [] },
    });
    suppliers.push(supplier);
  }
  const { request: draft } = await ownerJson(p, '/api/requests', 'POST', {
    title, menuId: menu.id, selectedItemIds: ['ingredient_tomato'],
    defaultSourcing: { v: 1, modes: ['CURRENT'], currentSupplierIds: suppliers.map(s => s.id),
      selectedNewSupplierIds: [], acceptVerifiedApplications: false },
    sourcingOverrides: {}, deliveryDetails: { addressLine: '12 Example Lane', city: 'Bengaluru', state: 'Karnataka', pin: '560001' },
    deliveryDate: localDate(2), quoteDeadline: new Date(deadline() + ':00+05:30').toISOString(), commercialTerms: null,
  });
  const opened = await ownerJson(p, '/api/requests/' + draft.id + '/open', 'POST', { expectedVersion: draft.version });
  const h = { ...owner, requestId: draft.id, item: opened.request.items.items[0], suppliers: suppliers.map((supplier, i) => ({
    name: supplier.businessName, id: supplier.id, grantId: opened.request.supplierRequests.find(g => g.supplierId === supplier.id).id,
    quoteUrl: opened.links.find(l => l.supplierId === supplier.id).url, rate: i ? '44' : '40', totalPaise: i ? '44000' : '40000',
  })) };
  for (const supplier of h.suppliers) {
    const c = await browser.newContext(), q = await c.newPage();
    await q.goto(supplier.quoteUrl);
    await q.locator('[name="rate:' + h.item.id + '"]').fill(supplier.rate);
    await q.locator('[name="gst:' + h.item.id + '"]').fill('0');
    await q.getByRole('button', { name: 'Review delivery & total', exact: true }).click();
    const sent = responseFor(q, '/api/public/quote');
    await q.getByRole('button', { name: 'Send quote', exact: true }).click();
    const response = await sent; assert.equal(response.status(), 201);
    assert.equal((await response.json()).totalPaise, supplier.totalPaise);
    await c.close();
  }
  const comparison = await ownerJson(p, '/api/requests/' + h.requestId + '/comparison');
  const { award } = await ownerJson(p, '/api/requests/' + h.requestId + '/award', 'POST', {
    mode: 'WHOLE', expectedRequestVersion: comparison.request.version, supplierRequestId: h.suppliers[0].grantId,
    quoteRevision: 1, rationale: 'Lower complete price.',
  });
  assert.equal(award.totalPaise, '40000');
  await ownerJson(p, '/api/awards/' + award.id + '/receiving', 'POST', {
    supplierId: h.suppliers[0].id, expectedCheckedAt: null, outcome: 'ISSUES', invoiceTotalPaise: '40000',
    issueCodes: ['MISSING_QUANTITY'], note: null,
    details: { items: [{ requestItemId: h.item.id, receivedQuantity: '9', rejectedQuantity: '0',
      billedQuantity: '10', billedUnitRatePaise: '4000' }], actualDeliveryDate: localDate(),
      creditClaimedPaise: '4000', creditReceivedPaise: '0', settlementNote: 'FIRST-CN-01' },
  });
  evidence.purchase = { title, item: 'Tomato', quantity: '10', offersPaise: ['40000', '44000'],
    awardPaise: '40000', received: '9', invoiceInr: '400', creditClaimedInr: '40' };
  evidence.phone = { retainedFromCompletedLocalCapture: true, realOCR: true, realSubmission: true,
    rate: '40', quantity: '10', totalPaise: '40000', nativePhone: [1560, 2400], placement: [2280, 0], upscaled: false };
  await context.close();
  return h;
}

async function captureOverview(h) {
  mark('prepare nearby discovery');
  const r = await makeRecorder('overview-features', h.storageState), p = r.page;
  if (!retained.has('nearby-discovery')) {
  await p.goto(origin + '/suppliers');
  await p.locator('#supplier-discovery > summary').click();
  const area = p.getByLabel('Restaurant area in India', { exact: true });
  await expect(area).toBeVisible();
  await area.fill('Bengaluru 560001');
  const resolved = responseFor(p, '/api/suppliers/discover').catch(() => null);
  await p.getByRole('button', { name: 'Find my area', exact: true }).click();
  const resolveResponse = await resolved;
  evidence.nearby = { resolveStatus: resolveResponse?.status() ?? 'unavailable', source: 'actual public request', resultsMocked: false };
  if (resolveResponse?.ok()) {
    const choose = p.getByRole('combobox', { name: /Several areas matched/ });
    if (await choose.isVisible()) {
      const value = await choose.locator('option').nth(1).getAttribute('value');
      if (value) await choose.selectOption(value);
    }
    const search = p.getByRole('button', { name: 'Find nearby suppliers', exact: true });
    if (await search.isEnabled()) {
      const searched = responseFor(p, '/api/suppliers/discover').catch(() => null);
      await search.click(); const response = await searched;
      evidence.nearby.searchStatus = response?.status() ?? 'unavailable';
      if (response?.ok()) evidence.nearby.resultCount = (await response.json()).results.length;
    }
  }
  const results = p.getByRole('region', { name: 'Nearby supplier results', exact: true });
  await clip(r, 'nearby-discovery', async () => {
    if (await results.isVisible()) {
      await r.move(results.getByRole('status')); await r.pause(700);
      const review = results.getByRole('button', { name: /^Review and add/ }).first();
      if (await review.isVisible()) await r.move(review);
      await p.mouse.wheel(0, 200);
    } else {
      evidence.nearby.controlsOnly = true;
      await r.move(area);
      await r.move(p.getByRole('combobox', { name: 'Category', exact: true }));
      await r.move(p.getByRole('combobox', { name: 'Search radius', exact: true }));
    }
  });
  }
  await p.goto(origin + '/service-planning');
  const menus = p.getByLabel('Start from an approved menu');
  const option = menus.getByRole('option', { name: /^Lunch menu · v/ });
  await expect(option).toHaveCount(1); await menus.selectOption(await option.getAttribute('value'));
  await p.getByLabel('Plan name', { exact: true }).fill('Lunch stock check');
  await p.getByLabel('Service date and time (local time)').fill(localDate(2) + 'T12:00');
  await p.getByRole('textbox', { name: /^Batch servings for/ }).fill('10');
  await p.getByRole('textbox', { name: /^Desired portions for/ }).fill('10');
  await p.getByLabel('Usable yield %').fill('100');
  await p.getByLabel('Current usable stock').fill('4');
  await clip(r, 'meal-planning', async () => {
    await r.move(p.getByRole('textbox', { name: /^Desired portions for/ }));
    await r.move(p.getByLabel('Current usable stock'));
    const saved = responseFor(p, '/api/service-planning');
    await r.click(p.getByRole('button', { name: 'Save and check missing ingredients', exact: true }));
    assert.equal((await saved).status(), 201);
    const readiness = p.getByRole('region', { name: 'Service readiness', exact: true });
    await r.move(readiness.getByRole('row').filter({ hasText: 'Tomato' }));
    await expect(readiness).toContainText('6 KILOGRAM');
  });
  await p.goto(origin + '/insights');
  await expect(p.getByRole('region', { name: 'Procurement summary', exact: true })).toBeVisible();
  await p.getByRole('region', { name: 'Observed supplier price ranges', exact: true }).scrollIntoViewIfNeeded();
  await r.pause(1000);
  await clip(r, 'purchase-reports', async () => {
    await r.move(p.getByRole('region', { name: 'Observed supplier price ranges', exact: true }));
    await r.pause(1500);
    await r.click(p.getByRole('link', { name: 'See delivery performance and credits owed', exact: true }));
    await expect(p.getByRole('heading', { name: 'Delivery record', exact: true })).toBeVisible();
    await r.move(p.getByRole('region', { name: 'Delivery and credit summary', exact: true }));
  });
  if (!retained.has('purchase-history')) {
  await p.goto(origin + '/history');
  const order = p.locator('article').filter({ hasText: title }).filter({ has: p.getByRole('button', { name: 'Repeat order', exact: true }) });
  await expect(order).toBeVisible();
  await clip(r, 'purchase-history', async () => {
    await r.move(order); await r.pause(650);
    await r.click(order.getByRole('button', { name: 'Repeat order', exact: true }));
    await expect(p.getByRole('dialog', { name: 'Create a new draft', exact: true })).toBeVisible();
    await r.move(p.getByRole('button', { name: 'Create draft', exact: true }));
    await r.click(p.getByRole('button', { name: 'Create draft', exact: true }));
    await expect(p).toHaveURL(/\/procurement\/[^/]+$/);
    await expect(p.getByRole('button', { name: 'Create supplier links', exact: true })).toBeVisible();
  });
  }
  await finish(r);
}

async function complete() {
  assert.equal(captured.size, Object.keys(slots).length);
  assert.equal(evidence.externalMessages, 0);
  const story = JSON.parse(await fs.readFile(storyPath, 'utf8'));
  for (const scene of story.scenes) for (const shot of scene.shots) {
    if (captured.has(shot.file.replace(/\.mp4$/, ''))) {
      shot.sourceStart = 0; shot.playbackRate = 1;
      evidence.shots[shot.file.replace(/\.mp4$/, '')].sha256 = await hash(path.join(work, 'captures', shot.file));
    }
  }
  story.visualRefresh.clips = [...captured].map(name => name + '.mp4');
  story.visualRefresh.description = 'Fresh local recordings after the coordinated UI review; real contact import, manual sharing, phone OCR, purchase, receiving, supplier confirmation, discovery, planning, reports and repeat orders.';
  await json(path.join(work, 'storyboard.json'), story);
  await json(path.join(work, 'capture-evidence.json'), evidence);
  await writeCheckpoint(progressPath, 'complete', evidence.shots, true);
  console.log('Capture complete. Staged only; review clips before rendering or replacing public assets.');
}

await prepare();
if (process.argv.includes('--capture-after-ui-validation')) {
  let browser;
  try {
    if (process.argv.includes('--resume-completed')) {
      const records = await loadCheckpoint(progressPath, slots, Object.keys(slots).slice(0, 12), inspectShot);
      for (const [name, record] of Object.entries(records)) {
        retained.add(name); captured.add(name);
        evidence.shots[name] = { ...record, retainedFromCompletedLocalCapture: true };
      }
      if (process.argv.includes('--pickup-planning-reports')) {
        const prior = JSON.parse(await fs.readFile(path.join(work, 'capture-evidence.json'), 'utf8'));
        evidence.nearby = prior.nearby;
        for (const name of ['meal-planning', 'purchase-reports']) {
          retained.delete(name); captured.delete(name); delete evidence.shots[name];
        }
      }
      evidence.continuity = 'One fictional purchase recreated in ordinary isolated local tenants. Completed footage retained after a capture-selector correction; no application responses are fabricated.';
    }
    browser = await chromium.launch({ headless: true });
    const owner = await createOwner(browser);
    const h = retained.size ? await recreatePurchaseForOverview(owner, browser) : await captureRestaurant(owner);
    if (!retained.size) {
      await capturePhone(h, browser);
      await captureCompletion(h);
    }
    if (!retained.has('supplier-confirmation')) await captureWorkspace(h);
    else evidence.supplierConfirmation = { saved: true, onlyOwnContacts: true, category: 'VEGETABLES',
      servedPin: '560001', retainedFromCompletedLocalCapture: true };
    await captureOverview(h);
    await complete();
  } catch (error) {
    console.error('Capture stopped at ' + stage + ' (' + error.name + ').');
    console.error(String(error.message).replace(/(?:https?:|mailto:)\S+|[A-Za-z0-9_-]{43,}/g, '[private value]').slice(0, 1400));
    // Preserve a rejected checkpoint for diagnosis; never replace it with empty claims.
    if (browser) await writeCheckpoint(progressPath, stage, evidence.shots);
    process.exitCode = 1;
  } finally {
    for (const r of active) await r.abort().catch(() => {});
    if (browser) await browser.close();
  }
}
