// Real component interactions with isolated contact fixtures; no database or live providers.
// Run: node --test tests/component/supplier-contact-review.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const output = await build({
  stdin: { contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WebsiteContactReview} from './src/components/suppliers/SupplierWebsiteContacts';
    import {ExistingSupplierContacts} from './src/components/suppliers/ExistingSupplierContacts';
    import {NearbySupplierResults} from './src/components/suppliers/NearbySupplierSearch';
    import {fillReviewedWebsiteContacts} from './src/lib/suppliers/website-types';
    const saved = [{businessName:'Saved branch',phone:'+919876543210',email:'ORDERS@supplier.com'}];
    const contact = {kind:'phone',value:'98765 43210',sourceUrl:'https://supplier.com/contact',checkedAt:'2026-09-11T00:00:00.000Z'};
    function App() {
      const [draft,setDraft] = useState({phone:'',email:'',notes:'Keep existing notes'});
      const [lead,setLead] = useState(null);
      return <>
        <WebsiteContactReview result={{status:'found',contacts:[contact],checkedAt:contact.checkedAt}}
          {...draft} existingContacts={saved} onReview={contact=>setDraft(current=>fillReviewedWebsiteContacts(current,[contact]))}/>
        <output aria-label="Draft">{JSON.stringify(draft)}</output>
        <ExistingSupplierContacts existingContacts={saved} onImported={async()=>{}}/>
        <NearbySupplierResults existingContacts={saved} onAddSupplier={setLead} results={[{
          id:'node/1',name:'Another branch',phone:'98765 43210',email:null,website:null,distanceKm:1,
          address:'',city:'',state:'',pin:'',category:'produce',kind:'Retail potential',verificationStatus:'UNVERIFIED',
          sourceUrl:'https://www.openstreetmap.org/node/1',mapUrl:'https://www.openstreetmap.org/node/1'
        }]}/>
        <output aria-label="Lead draft">{JSON.stringify(lead)}</output>
      </>;
    }
    createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, outdir: '/tmp/supplier-contact-review-test', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'next-link', setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `import React from 'react';export default function Link(props){return React.createElement('a',props)}`, loader: 'js', resolveDir: process.cwd() }));
  } }],
});
const js = output.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = output.outputFiles.find(file => file.path.endsWith('.css')).text;

async function harness(run) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const unexpected = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url === 'http://contact.test/') return route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
      if (url === 'http://contact.test/app.js') return route.fulfill({ contentType: 'application/javascript', body: js });
      if (url === 'http://contact.test/app.css') return route.fulfill({ contentType: 'text/css', body: css });
      unexpected.push(url);
      return route.abort();
    });
    await page.goto('http://contact.test/');
    await run(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, [], 'Review actions must not call a provider or save automatically');
  } finally { await browser.close(); }
}

test('source and saved-match review fills only the chosen empty field without extra steps or requests', async () => {
  await harness(async page => {
    const review = page.getByRole('region', { name: 'Review published website contacts' });
    await expect(review).toContainText('Same phone saved for Saved branch');
    await expect(review).toContainText('currently loaded');
    await expect(review.getByRole('link', { name: 'Published source' })).toHaveAttribute('href', 'https://supplier.com/contact');
    await expect(review.locator('time')).toHaveAttribute('datetime', '2026-09-11T00:00:00.000Z');
    await expect(review.getByRole('checkbox')).toHaveCount(0);
    await review.getByRole('button', { name: 'Use this phone' }).click();
    await expect(page.getByLabel('Draft', { exact: true })).toHaveText(JSON.stringify({ phone: '98765 43210', email: '', notes: 'Keep existing notes' }));
    await expect(review.getByRole('button', { name: 'Use this phone' })).toBeDisabled();
  });
});

test('pasted-list matches update as contacts change and permit review of a distinct business', async () => {
  await harness(async page => {
    await page.getByText('Add existing contacts', { exact: false }).click();
    await page.getByLabel('Supplier contact list').fill('Another branch,98765 43210');
    await page.getByRole('button', { name: 'Review contacts', exact: true }).click();
    await expect(page.getByRole('table')).toContainText('Contact already saved: Saved branch (phone)');
    await expect(page.getByRole('button', { name: 'Add 1 supplier', exact: true })).toBeEnabled();
    await page.getByRole('textbox', { name: 'Phone, row 1', exact: true }).fill('9988776655');
    await expect(page.getByRole('table')).not.toContainText('Contact already saved');
  });
});

test('nearby shared-contact lead remains unverified and opens only an unsaved sourced draft', async () => {
  await harness(async page => {
    const lead = page.getByRole('article');
    await expect(lead).toContainText('Contact already saved: Saved branch (phone)');
    await expect(lead).toContainText('Unverified');
    await lead.getByRole('button', { name: 'Review and add Another branch' }).click();
    const draft = JSON.parse(await page.getByLabel('Lead draft').textContent());
    assert.equal(draft.businessName, 'Another branch');
    assert.equal(draft.phone, '98765 43210');
    assert.match(draft.notes, /Unverified OpenStreetMap lead/);
    assert.match(draft.notes, /Source: https:\/\/www.openstreetmap.org\/node\/1/);
  });
});
