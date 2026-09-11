/** Bounded pickup actions. Harness/tenant setup and final publication stay separate. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { checkBarrier, pickups } from './prepare_workflow_pickups.mjs';
import { captureShopping, captureInvoice } from './gap_capture_helpers.mjs';

let recorderWork;
async function requireAbsent(file) {
  try { await fs.access(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('Preserve existing capture; choose a new pickup directory/label: ' + path.basename(file));
}

export async function createWorkflowRecorder({ work, origin, label, storageState, phone = false }) {
  // This runs before importing/launching the browser, including for a phone pickup.
  await checkBarrier(work, origin);
  assert(label.startsWith('workflow-'), 'Use a unique workflow recording label');
  await requireAbsent(path.join(work, label + '-recording.json'));
  assert(!recorderWork || recorderWork === work, 'One pickup work directory per process');
  recorderWork = work;
  process.env.QUOTEPLATE_FILM_WORK = work;
  const { recorder } = await import('./motion_capture.mjs');
  const r = await recorder(null, label, { baseURL: origin, captureMode: phone ? 'phone' : 'desktop', storageState });
  await r.context.addInitScript(() => {
    const install = () => {
      if (!document.documentElement) return false;
      const style = document.createElement('style');
      style.textContent = 'code{filter:blur(8px)!important}input[readonly]{-webkit-text-security:disc!important}input[type=password]{visibility:hidden!important}';
      document.documentElement.append(style);
      return true;
    };
    if (!install()) new MutationObserver((_records, observer) => { if (install()) observer.disconnect(); })
      .observe(document, { childList: true, subtree: true });
  });
  await r.context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  const recordClip = r.clip;
  const names = new Set();
  r.clip = async (name, duration, action) => {
    assert(pickups.includes(name + '.mp4') || (phone && name === 'phone-native'), 'Unplanned pickup');
    assert(!names.has(name), 'Duplicate shot in one recording');
    await requireAbsent(path.join(work, 'captures', name + '.mp4'));
    names.add(name);
    await assertSafePage(r.page);
    await recordClip(name, duration, action);
    await assertSafePage(r.page);
  };
  return r;
}

async function assertSafePage(page) {
  const pathname = new URL(page.url()).pathname;
  assert(!/^\/(?:start|signin|login)(?:\/|$)/.test(pathname), 'Never record authentication');
  const body = await page.locator('body').innerText();
  assert(!/demo credentials|demo workspace|internal demo|password:/i.test(body), 'Internal or credential content visible');
}

export async function captureContactPickup(r, g) {
  const p = r.page;
  await p.goto(g.origin + '/suppliers');
  await g.expect(p.getByRole('link', { name: 'Open workspace for Amber Fresh Produce', exact: true })).toBeVisible();
  await g.expect(p.getByRole('link', { name: 'Open workspace for Copper Pot Produce', exact: true })).toHaveCount(0);
  await p.locator('summary').filter({ hasText: 'Add existing contacts' }).click();
  // Pasting is setup outside the slot; the seven-second pickup shows review/remove/save.
  await p.getByLabel('Supplier contact list').fill('Amber Fresh Produce,9000000011,orders@amber-produce.example\nCopper Pot Produce,9000000012,orders@copper-pot.example');
  await g.clip(r, 'supplier-contacts', async () => {
    await r.click(p.getByRole('button', { name: 'Review contacts', exact: true }));
    const warning = p.getByText(/^Contact already saved: Amber Fresh Produce/);
    await g.expect(warning).toBeVisible();
    await r.move(warning);
    await r.pause(650);
    await r.click(p.getByRole('button', { name: 'Remove row 1', exact: true }));
    await g.expect(p.getByRole('textbox', { name: 'Business name, row 1', exact: true })).toHaveValue('Copper Pot Produce');
    const saved = p.waitForResponse(res => new URL(res.url()).pathname === '/api/suppliers/import' && res.request().method() === 'POST');
    await r.click(p.getByRole('button', { name: 'Add 1 supplier', exact: true }));
    assert.equal((await saved).status(), 201);
    await g.expect(p.getByRole('link', { name: 'Open workspace for Copper Pot Produce', exact: true })).toBeVisible();
  });
  g.evidence.contactPickup = { savedContactWarning: true, duplicateRemovedByUser: true,
    remainingSupplierSaved: true, automaticDeduplicationClaimed: false };
}

function withPreviewReview(g, scope, mode) {
  return { ...g, clip: async (r, name, action) => g.clip(r, name, async () => {
    if (name === mode + '-review') {
      const photo = scope.getByRole('img', { name: `Selected photo: ${mode === 'shopping' ? 'shopping-list' : 'invoice'}.png`, exact: true });
      await g.expect(photo).toBeVisible();
      assert(await photo.evaluate(img => img.complete && img.naturalWidth > 0), 'Source preview did not decode');
      await r.move(photo);
      await r.pause(350);
      g.evidence[mode + 'Preview'] = { visible: true, decoded: true, reviewedAlongsideText: true };
    }
    await action();
  }) };
}

export const captureShoppingPickup = (r, g) => captureShopping(r, withPreviewReview(g, r.page, 'shopping'));
export const captureInvoicePickup = (r, form, item, g) => captureInvoice(r, form, item, withPreviewReview(g, form, 'invoice'));

export async function capturePhonePickup(r, g, { quoteUrl, itemId }) {
  assert.equal(new URL(quoteUrl).origin, g.origin, 'Local fictional quote only');
  const p = r.page;
  await p.goto(quoteUrl);
  await g.expect(p.getByText('For Amber Fresh Produce', { exact: true })).toBeVisible();
  const quantity = p.locator(`[name="quantity:${itemId}"]`);
  // Begin with one genuinely unfinished quantity; the price assistant fills rates only.
  await quantity.fill('');
  await p.getByRole('button', { name: 'Use a price list', exact: true }).scrollIntoViewIfNeeded();
  await r.pause(900);
  const photo = await fs.readFile(path.join('/tmp/quoteplate-vendor-phone-film', 'printed-price-fixture.png'));
  await g.clip(r, 'vendor-phone', async () => {
    const began = performance.now();
    const holdUntil = seconds => r.pause(Math.max(0, seconds * 1000 - (performance.now() - began)));
    await r.click(p.getByRole('button', { name: 'Use a price list', exact: true }));
    const chooser = p.waitForEvent('filechooser');
    await r.click(p.getByRole('button', { name: 'Choose photo', exact: true }));
    await (await chooser).setFiles({ name: 'printed-price-fixture.png', mimeType: 'image/png', buffer: photo });
    await g.expect(p.getByLabel('Amount for price 1')).toHaveValue('40', { timeout: 90000 });
    const preview = p.getByRole('img', { name: 'Selected photo: printed-price-fixture.png', exact: true });
    await g.expect(preview).toBeVisible();
    assert(await preview.evaluate(img => img.complete && img.naturalWidth > 0));
    await r.move(preview);
    await holdUntil(3.0);
    await r.move(p.getByLabel('Amount for price 1'));
    await holdUntil(6.2);
    await r.click(p.getByRole('button', { name: 'Use checked prices', exact: true }));
    await r.click(p.getByRole('button', { name: 'Back to my quote', exact: true }));
    await g.expect(p.getByRole('group', { name: 'Item progress', exact: true })).toContainText('1 item left to complete');
    await r.click(p.getByRole('button', { name: 'Go to first unfinished item', exact: true }));
    await g.expect(quantity).toBeFocused();
    await r.type(quantity, '10');
    await g.expect(p.getByRole('group', { name: 'Item progress', exact: true })).toContainText('All items complete');
    await r.move(p.getByRole('group', { name: 'Item progress', exact: true }));
    await holdUntil(11.2);
    await r.click(p.getByRole('button', { name: 'Review delivery & total', exact: true }));
    await r.move(p.getByText('Total to restaurant', { exact: true }));
    await holdUntil(16.2);
    const sent = p.waitForResponse(res => new URL(res.url()).pathname === '/api/public/quote' && res.request().method() === 'POST');
    await r.click(p.getByRole('button', { name: 'Send quote', exact: true }));
    const response = await sent;
    assert.equal(response.status(), 201);
    assert.equal((await response.json()).totalPaise, '40000');
    const confirmation = p.getByRole('status').filter({ hasText: 'Quote sent.' });
    await g.expect(confirmation).toBeVisible();
    await r.move(confirmation);
  });
  g.evidence.phonePickup = { sourcePreview: true, realOCR: true, unfinishedQuantity: true,
    jumpFocusedQuantity: true, allItemsComplete: true, realLocalSubmission: true, totalPaise: '40000' };
}
