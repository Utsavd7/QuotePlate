/** Final-gap pickups for the existing LOCAL recorder. No server or paid services. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prior = '/tmp/quoteplate-feature-overview-film';
const website = 'https://www.shubhamtradingco.in/contact';
const business = 'Shubham Trading Company';
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');

async function preserveCopy(source, target, expected, hash) {
  assert.equal(await hash(source), expected, 'Prior approved source changed: ' + path.basename(source));
  try {
    await fs.access(target);
    assert.equal(await hash(target), expected, 'Existing staged asset differs; preserve it and use a fresh work directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.copyFile(source, target);
  }
}

export async function prepareGapAssets(g, story) {
  assert.notEqual(path.resolve(g.work), path.resolve(prior), 'Preserve the previous film directory');
  const approved = JSON.parse(await fs.readFile(path.join(prior, 'verification.json'), 'utf8'));
  const reuse = {};
  for (const name of ['kitchen-intro.mp4', 'kitchen-end.mp4']) {
    const expected = approved.freshCaptures[name];
    assert(expected, 'Missing approved kitchen hash');
    await preserveCopy(path.join(prior, 'captures', name), path.join(g.work, 'captures', name), expected, g.hash);
    reuse[name] = { source: path.join(prior, 'captures', name), sha256: expected };
  }
  const audio = JSON.parse(await fs.readFile(path.join(prior, 'audio/timing.json'), 'utf8'));
  await fs.mkdir(path.join(g.work, 'audio'), { recursive: true });
  // Only initialize the cache once. Local Kokoro checks each scene's text, timing,
  // model, voice and WAV hash before reuse; changed narration is regenerated.
  try { await fs.access(path.join(g.work, 'audio/timing.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    for (const [name, record] of Object.entries(audio.scenes)) {
      await preserveCopy(path.join(prior, 'audio', name + '.wav'), path.join(g.work, 'audio', name + '.wav'), record.wavSha256, g.hash);
    }
    await writeJson(path.join(g.work, 'audio/timing.json'), audio);
  }
  await fs.mkdir(path.join(g.work, 'fixtures'), { recursive: true });
  const sharp = require('sharp');
  const fixtures = {};
  for (const [name, text] of [['shopping-list.png', 'Tomato 10 kg'], ['invoice.png', 'Tomato 10 kg @ 40']]) {
    const output = path.join(g.work, 'fixtures', name);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="800"><rect width="1800" height="800" fill="white"/><text x="100" y="400" font-family="Arial" font-size="100" fill="black">${text}</text></svg>`;
    try { await fs.access(output); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await sharp(Buffer.from(svg)).png().toFile(output); }
    fixtures[name] = { text, fictionalPrintedFixture: true, sha256: await g.hash(output) };
  }
  const sources = {};
  async function walk(directory) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) sources[path.relative(root, file)] = await g.hash(file);
    }
  }
  await walk(path.join(root, 'src'));
  await writeJson(path.join(g.work, 'ui-source-hashes.json'), sources);
  await writeJson(path.join(g.work, 'reuse-manifest.json'), { approvedVerificationSha256: await g.hash(path.join(prior, 'verification.json')), reuse, fixtures });
  await writeJson(path.join(g.work, 'planned-storyboard.json'), story);
  g.evidence.edition = story.edition;
  g.evidence.reuse = reuse;
  g.evidence.fixtures = fixtures;
  g.evidence.websiteCandidate = { url: website, businessName: business,
    note: 'Actual public supplier contact page, checked during preparation. App lookup must still succeed after validation. Not part of the fictional quotes.' };
}

export async function selectWebsiteNarration(g) {
  if (g.evidence.website.saved) return;
  const alternate = path.join(g.work, 'website-unavailable');
  const fallback = JSON.parse(await fs.readFile(path.join(alternate, 'audio/timing.json'), 'utf8'));
  const timingPath = path.join(g.work, 'audio/timing.json');
  const timing = JSON.parse(await fs.readFile(timingPath, 'utf8'));
  const source = path.join(alternate, 'audio/website.wav');
  assert.equal(await g.hash(source), fallback.scenes.website.wavSha256, 'Unavailable narration cache changed');
  for (const key of ['model', 'voices', 'voice', 'recipe', 'sourceSha256']) assert.equal(fallback[key], timing[key]);
  await fs.copyFile(source, path.join(g.work, 'audio/website.wav'));
  timing.scenes.website = fallback.scenes.website;
  await writeJson(timingPath, timing);
  // Re-run the normal audio command with storyboard.json to validate all cache
  // keys and regenerate the final measured VTT/transcript without new synthesis.
}

export async function captureSignup(r, g) {
  const p = r.page;
  await p.goto(g.origin + '/start');
  await g.expect(p.getByRole('heading', { name: 'Create your workspace', exact: true })).toBeVisible();
  await g.expect(p.locator('body')).not.toContainText(/approved.pilot|pilot access|approved owners/i);
  const google = p.getByRole('button', { name: 'Continue with Google', exact: true });
  await g.expect(google).toBeEnabled();
  if (g.productionGoogleOnly) {
    await g.expect(p.locator('input[type="password"]')).toHaveCount(0);
    await g.expect(p.getByRole('button', { name: /Create workspace with email/i })).toHaveCount(0);
  }
  await g.clip(r, 'first-restaurant', async () => {
    await r.type(p.getByLabel('Restaurant name', { exact: true }), 'Monsoon Table');
    await g.paste(r, p.getByLabel('Restaurant phone', { exact: true }), '9000000010');
    await g.paste(r, p.getByLabel('Street address', { exact: true }), '12 Example Lane');
    await g.paste(r, p.getByLabel('City', { exact: true }), 'Bengaluru');
    await g.paste(r, p.getByLabel('State', { exact: true }), 'Karnataka');
    await g.paste(r, p.getByLabel('PIN code', { exact: true }), '560001');
  });
  await g.clip(r, 'first-owner', async () => {
    await r.type(p.getByLabel('Your name', { exact: true }), 'Asha Rao');
    await g.paste(r, p.getByLabel('Work email', { exact: true }), 'asha@monsoon-table.example');
    await r.move(google);
    await r.pause(700);
  });
  g.evidence.signup = { fresh: true, pilotRestrictionVisible: false, googleEnabled: true,
    authenticationRecorded: false, formSubmitted: false, fictionalFormOnly: true,
    ...(g.productionGoogleOnly ? { productionGoogleOnly: true, passwordFieldAbsent: true,
      emailCreateControlAbsent: true, origin: g.origin } : {}) };
}

export async function captureWebsite(r, g) {
  const p = r.page;
  const retainedEvidence = g.isRetained('website-lookup') && g.isRetained('website-review') ? g.evidence.website : null;
  await p.goto(g.origin + '/suppliers');
  await p.getByRole('button', { name: 'Add supplier', exact: true }).first().click();
  const editor = p.getByRole('dialog', { name: 'Add supplier', exact: true });
  await g.expect(editor).toBeVisible();
  await editor.getByLabel(/^Business name/).fill(business);
  await editor.locator('summary').filter({ hasText: 'Find contacts on the supplier’s website' }).click();
  const url = editor.getByLabel('Supplier website', { exact: true });
  let requested = 0;
  const listener = req => { if (new URL(req.url()).pathname === '/api/suppliers/website-contacts') requested++; };
  p.on('request', listener);
  let response;
  await g.clip(r, 'website-lookup', async () => {
    await g.paste(r, url, website);
    assert.equal(requested, 0, 'Website lookup must wait for the explicit button');
    response = g.responseFor(p, '/api/suppliers/website-contacts').catch(() => null);
    await r.click(editor.getByRole('button', { name: 'Check website', exact: true }));
  });
  // A real edit cuts network waiting between two motion clips. Never mock the API.
  const result = await response;
  const body = result?.ok() ? await result.json() : null;
  await g.expect(editor.getByRole('button', { name: 'Check website', exact: true })).toBeVisible({ timeout: 20000 });
  p.off('request', listener);
  assert.equal(requested, 1, 'One explicit public lookup');
  const evidence = g.evidence.website = { url: website, businessName: business, explicitLookup: true,
    requests: requested, httpStatus: result?.status() ?? 'unavailable', status: body?.status ?? 'unavailable',
    resultsMocked: false, saved: false, resultSha256: body ? (await import('node:crypto')).createHash('sha256').update(JSON.stringify(body)).digest('hex') : null };
  await g.clip(r, 'website-review', async () => {
    if (body?.status === 'found' && body.contacts?.length) {
      const review = editor.getByRole('region', { name: 'Review published website contacts', exact: true });
      const contact = body.contacts.find(c => c.kind === 'email') ?? body.contacts[0];
      assert(['phone', 'email'].includes(contact.kind));
      assert.equal(new URL(contact.sourceUrl).protocol, 'https:');
      assert.equal(new URL(contact.sourceUrl).hostname.replace(/^www\./, ''), new URL(website).hostname.replace(/^www\./, ''));
      const row = review.getByRole('listitem').filter({ hasText: contact.value }).first();
      const source = row.getByRole('link', { name: 'Published source', exact: true });
      assert.equal(await source.getAttribute('href'), contact.sourceUrl);
      await r.move(source); await r.pause(900);
      await r.click(row.getByRole('button', { name: 'Use this ' + contact.kind, exact: true }));
      const field = editor.getByLabel(contact.kind === 'email' ? 'Email' : 'Phone', { exact: true });
      await r.move(field); await g.expect(field).toHaveValue(contact.value);
      const saved = g.responseFor(p, '/api/suppliers');
      await r.click(editor.getByRole('button', { name: 'Add supplier', exact: true }));
      const res = await saved; assert.equal(res.status(), 201);
      const { supplier } = await res.json();
      assert.equal(supplier.businessName, business); assert.equal(supplier[contact.kind], contact.value);
      evidence.saved = true; evidence.contact = contact;
      await g.expect(editor).not.toBeVisible();
    } else {
      const status = editor.getByRole('status').filter({ hasText: /could not be checked|No public phone/ });
      const target = await status.count() ? status : editor.getByRole('alert');
      await r.move(target); await r.pause(1800);
      evidence.unavailableText = await target.innerText();
      await r.move(editor.getByLabel('Email', { exact: true }));
    }
  });
  if (!evidence.saved) await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  if (retainedEvidence) g.evidence.website = { ...retainedEvidence, recreatedForContinuity: true };
}

async function choosePhoto(r, scope, mode, g) {
  const name = mode === 'shopping' ? 'shopping-list.png' : 'invoice.png';
  const label = mode === 'shopping' ? 'Shopping list photo' : 'Invoice photo';
  const chooser = r.page.waitForEvent('filechooser');
  await r.click(scope.getByLabel(label, { exact: true }));
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: await fs.readFile(path.join(g.work, 'fixtures', name)) });
  await r.click(scope.getByRole('button', { name: 'Read photo', exact: true }));
}

export async function captureShopping(r, g) {
  const p = r.page;
  await g.expect(p.getByLabel(/Approved menu/)).toHaveValue('');
  await g.clip(r, 'shopping-source', async () => {
    await r.click(p.getByRole('button', { name: 'Add a shopping list', exact: true }));
    await choosePhoto(r, p, 'shopping', g);
  });
  await g.expect(p).toHaveURL(/\/procurement\/new$/);
  await g.expect(p.getByRole('button', { name: 'Add a shopping list', exact: true })).toHaveAttribute('aria-expanded', 'true');
  // React-controlled textarea content can become part of a wrapping label's
  // textContent. Prefix matching survives OCR updating the source value.
  const text = p.getByLabel(/^Shopping list text or description/);
  await g.expect(text).toHaveCount(1, { timeout: 5000 });
  await g.expect(text).toHaveValue(/Tomato\s+10\s+kg/i, { timeout: 90000 });
  await g.clip(r, 'shopping-review', async () => {
    await r.move(text);
    await r.click(p.getByRole('button', { name: 'Review text', exact: true }));
    await g.expect(p.getByLabel('Item name, row 1', { exact: true })).toHaveValue('Tomato');
    await g.expect(p.getByLabel('Quantity, row 1', { exact: true })).toHaveValue('10');
    await g.expect(p.getByLabel('Unit, row 1', { exact: true })).toHaveValue('KILOGRAM');
    await r.click(p.getByRole('checkbox', { name: 'Checked row 1', exact: true }));
    await r.click(p.getByRole('button', { name: 'Add checked rows to draft', exact: true }));
    await g.expect(p.getByRole('status').filter({ hasText: 'Checked rows added to your draft.' })).toBeVisible();
  });
  await p.getByRole('button', { name: 'Add a shopping list', exact: true }).click();
  g.evidence.shopping = { realOCR: true, reviewed: true, applied: true, menuSelected: false, item: 'Tomato', quantity: '10', unit: 'KILOGRAM' };
}

export async function captureInvoice(r, form, item, g) {
  const received = item.getByLabel('Received so far', { exact: true });
  const rejected = item.getByLabel('Rejected so far', { exact: true });
  const total = form.getByLabel(/^Invoice total in rupees/);
  const before = { received: await received.inputValue(), rejected: await rejected.inputValue(), total: await total.inputValue(),
    credit: await form.getByLabel('Credit claimed in rupees', { exact: true }).inputValue() };
  await g.clip(r, 'invoice-source', async () => {
    await r.click(form.getByRole('button', { name: 'Read invoice photo or text', exact: true }));
    await choosePhoto(r, form, 'invoice', g);
  });
  await g.expect(form.getByRole('button', { name: 'Read invoice photo or text', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const text = form.getByLabel(/^Invoice text or description/);
  await g.expect(text).toHaveCount(1, { timeout: 5000 });
  await g.expect(text).toHaveValue(/Tomato\s+10\s+kg\s*@\s*40/i, { timeout: 90000 });
  await g.clip(r, 'invoice-review', async () => {
    await r.move(text);
    await r.click(form.getByRole('button', { name: 'Review text', exact: true }));
    await g.expect(form.getByLabel('Billed rate, row 1', { exact: true })).toHaveValue('40');
    await r.click(form.getByRole('checkbox', { name: 'Checked row 1', exact: true }));
    await r.click(form.getByRole('button', { name: 'Apply checked billed values', exact: true }));
    await r.move(item.getByLabel('Billed quantity (optional)', { exact: true }));
    await g.expect(item.getByLabel('Billed quantity (optional)', { exact: true })).toHaveValue('10');
    await g.expect(item.getByLabel('Billed rate in rupees', { exact: true })).toHaveValue('40');
  });
  assert.deepEqual({ received: await received.inputValue(), rejected: await rejected.inputValue(), total: await total.inputValue(),
    credit: await form.getByLabel('Credit claimed in rupees', { exact: true }).inputValue() }, before);
  await form.getByRole('button', { name: 'Read invoice photo or text', exact: true }).click();
  g.evidence.invoice = { realOCR: true, reviewed: true, applied: true, billedQuantity: '10', billedRateInr: '40', physicalCountsTotalCreditsUnchanged: true };
}
