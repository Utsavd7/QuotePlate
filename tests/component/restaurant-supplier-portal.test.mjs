// Isolated browser component tests: real React/CSS, mocked backend contract, no database.
// Run: node --test tests/component/restaurant-supplier-portal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const output = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {RestaurantSupplierPortal} from './src/components/supplier-portal/RestaurantSupplierPortal'; createRoot(document.getElementById('root')).render(<RestaurantSupplierPortal/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, outdir: '/tmp/restaurant-portal-test', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'link', setup(b) { b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `import React from 'react';export default function Link(props){return React.createElement('a',props)}`, loader: 'js', resolveDir: process.cwd() })); } }],
});
const js = output.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = output.outputFiles.find(f => f.path.endsWith('.css')).text;
const plan = { id: 'p1', version: 4, name: 'Private recipe', requestId: null, document: { serviceAt: '2099-10-08T10:00:00Z' }, readiness: { warnings: [], ingredients: ['Rice', 'Lentils'].map((name, i) => ({ itemKey: name.toLowerCase(), name, deficit: i ? '2' : '1.251', usableDeficit: '1', unit: 'KILOGRAM', blocked: false, specification: { v: 1, category: 'OTHER', description: 'Grade A' } })) } };

async function harness(run, { member = false, mobile = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => { console.error(error.message); });
    const mutations = [];
    let shares = []; let access = null; let conflict = false;
    await page.route('http://portal.test/**', async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      const method = request.method();
      let data;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><title>Collaboration test</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
      if (path === '/app.js') return route.fulfill({ contentType: 'application/javascript', body: js });
      if (path === '/app.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (method !== 'GET') mutations.push({ path, method, body: request.postDataJSON() });
      if (path === '/api/suppliers') data = { suppliers: [{ id: 's1', businessName: 'Farm One', isActive: true }, { id: 's2', businessName: 'Farm Two', isActive: true }] };
      else if (path === '/api/service-planning') data = { plans: [{ ...plan, serviceAt: plan.document.serviceAt }] };
      else if (path === '/api/service-planning/p1') data = plan;
      else if (path.endsWith('/demand')) {
        if (method === 'POST') {
          if (conflict) return route.fulfill({ status: 409, json: { detail: 'Plan changed. Review the saved version again.' } });
          shares = [{ id: 'share1', planId: 'p1', planVersion: 4, serviceAt: plan.document.serviceAt, sharedAt: '2026-09-07T10:00:00Z', stale: true, items: [{ itemKey: 'rice', name: 'Rice', quantity: '1.251', unit: 'KILOGRAM', specification: 'Grade A' }] }];
        } else shares = [];
        data = {};
      } else if (path.endsWith('/portal')) {
        if (method === 'POST') { access = { expiresAt: '2099-10-01T10:00:00Z', revokedAt: null }; data = { url: 'http://portal.test/supplier-portal#token=one-time-secret', expiresAt: access.expiresAt }; }
        else if (method === 'DELETE') { access = null; data = {}; }
        else data = { supplierName: path.includes('s1') ? 'Farm One' : 'Farm Two', canManage: !member, access, orders: [], forecasts: shares };
      } else return route.fulfill({ status: 404, json: {} });
      return route.fulfill({ json: data });
    });
    await page.goto('http://portal.test/');
    await page.getByLabel('Supplier', { exact: true }).selectOption('s1');
    await expect(page.getByRole('heading', { name: 'Farm One', exact: true })).toBeVisible();
    await run({ page, mutations, setConflict: () => { conflict = true; } });
  } finally { await browser.close(); }
}

test('owner explicitly shares exact selected keys, sees outdated estimate, withdraws and handles stale plan', async () => {
  await harness(async ({ page, mutations, setConflict }) => {
    await page.getByLabel('Saved service plan').selectOption('p1');
    await expect(page.getByRole('checkbox')).toHaveCount(2);
    const share = page.getByRole('button', { name: /Share .*selected ingredient/ });
    await expect(share).toBeDisabled();
    await page.getByRole('checkbox', { name: /Rice/ }).check();
    await share.click();
    await expect(page.getByText('Outdated estimate', { exact: true })).toBeVisible();
    assert.deepEqual(mutations[0].body, { planId: 'p1', expectedPlanVersion: 4, itemKeys: ['rice'] });
    await page.getByRole('button', { name: /Withdraw estimate/ }).click();
    await expect(page.getByText('No demand estimates shared with this supplier.')).toBeVisible();
    assert.deepEqual(mutations[1].body, { shareId: 'share1' });
    setConflict();
    await page.getByRole('checkbox', { name: /Rice/ }).check();
    await share.click();
    await expect(page.getByRole('alert')).toContainText('Plan changed');
    await expect(share).toBeDisabled();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});

test('fresh link is copyable once, rotation and revoke are explicit and supplier switches clear secrets', async () => {
  await harness(async ({ page, mutations }) => {
    await page.getByRole('button', { name: 'Create private link' }).click();
    await expect(page.getByLabel('New private link')).toHaveValue(/one-time-secret/);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedPortalLink = value; } } }));
    await page.getByRole('button', { name: 'Copy link', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Private link copied');
    assert.equal(await page.evaluate(() => window.copiedPortalLink), 'http://portal.test/supplier-portal#token=one-time-secret');
    await page.getByRole('button', { name: 'Dismiss link' }).click();
    await expect(page.getByLabel('New private link')).toHaveCount(0);
    await page.getByRole('button', { name: 'Replace private link' }).click();
    await expect(page.getByLabel('New private link')).toBeVisible();
    await page.getByRole('button', { name: 'Revoke access' }).click();
    await expect(page.getByLabel('New private link')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create private link' })).toBeEnabled();
    assert.equal(mutations.filter(m => m.method === 'DELETE').length, 1);
    await page.getByRole('button', { name: 'Create private link' }).click();
    await expect(page.getByLabel('New private link')).toBeVisible();
    await page.getByLabel('Supplier', { exact: true }).selectOption('s2');
    await expect(page.getByRole('heading', { name: 'Farm Two', exact: true })).toBeVisible();
    await expect(page.getByLabel('New private link')).toHaveCount(0);
    assert.ok(mutations.every(m => m.path.startsWith('/api/suppliers/s1/portal')));
  });
});

test('member has no mutation controls; mobile layout and accessibility remain usable', async () => {
  await harness(async ({ page, mutations }) => {
    await expect(page.getByText(/Only an owner/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Create private|Replace private|Revoke|Share .*selected|Withdraw/ })).toHaveCount(0);
    assert.equal(mutations.length, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.addScriptTag({ content: readFileSync('node_modules/axe-core/axe.min.js', 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run()).violations.filter(v => ['serious', 'critical'].includes(v.impact)));
    assert.deepEqual(violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) })), []);
  }, { member: true, mobile: true });
});

test('mobile owner reviews exact shortages without overflow and changing supplier clears the review', async () => {
  await harness(async ({ page }) => {
    await page.getByRole('button', { name: 'Create private link' }).click();
    await expect(page.getByLabel('New private link')).toBeVisible();
    await page.getByLabel('Saved service plan').selectOption('p1');
    await page.getByRole('checkbox', { name: /Rice/ }).check();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.addScriptTag({ content: readFileSync('node_modules/axe-core/axe.min.js', 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run()).violations.filter(v => ['serious', 'critical'].includes(v.impact)));
    assert.deepEqual(violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) })), []);
    await page.screenshot({ path: '/tmp/restaurant-supplier-portal-mobile.png', fullPage: true });
    await page.getByLabel('Supplier', { exact: true }).selectOption('s2');
    await expect(page.getByRole('heading', { name: 'Farm Two', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByLabel('Saved service plan')).toHaveValue('');
    await expect(page.getByRole('button', { name: /Share .*selected ingredient/ })).toBeDisabled();
  }, { mobile: true });
});
