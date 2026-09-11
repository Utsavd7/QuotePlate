import { renderToStaticMarkup } from 'react-dom/server';
import { NearbySupplierSearch, NearbySupplierResults } from '@/components/suppliers/NearbySupplierSearch';
import { SupplierDiscovery } from '@/components/suppliers/SupplierDiscovery';
import type { NearbyResult } from '@/lib/suppliers/nearby-types';
import { parse } from 'node-html-parser';
it('prioritizes in-app results with explicit area resolution and secondary web search', () => {
  const html = renderToStaticMarkup(<SupplierDiscovery onAddSupplier={() => {}} />);
  expect(html.indexOf('Find suppliers in your area')).toBeLessThan(html.indexOf('Search other websites'));
  expect(html).toContain('Find my area');
  expect(html).toContain('Packaging');
  expect(html).toContain('10 km');
  expect(html).toContain('Photon');
});
it('makes no provider requests during render and provides honest scope', () => {
  const html = renderToStaticMarkup(<NearbySupplierSearch onAddSupplier={() => {}} />);
  expect(html).toContain('Category matches');
  expect(html).toContain('No automatic messages');
});
it('renders real results and explicit unverified review with missing contact details', () => {
  const item: NearbyResult = { id: 'node/1', name: 'Fresh Foods', distanceKm: 1.2, phone: null, website: null, address: '', city: '', state: '', pin: '', category: 'produce', kind: 'Retail potential', sourceUrl: 'https://www.openstreetmap.org/node/1', mapUrl: 'https://www.openstreetmap.org/node/1', verificationStatus: 'UNVERIFIED' };
  const html = renderToStaticMarkup(<NearbySupplierResults results={[item]} onAddSupplier={() => {}} />);
  expect(html).toContain('Fresh Foods'); expect(html).toContain('1.2 km');
  expect(html).toContain('Contact details not mapped'); expect(html).toContain('Unverified');
  expect(html).toContain('Review and add'); expect(html).not.toContain('tel:');
});

it('warns about a normalized saved contact match while keeping shared-contact businesses reviewable', () => {
  const item: NearbyResult = { id: 'node/1', name: 'New branch', distanceKm: 1, phone: '98765 43210', website: null, address: '', city: '', state: '', pin: '', category: 'produce', kind: 'Retail potential', sourceUrl: 'https://www.openstreetmap.org/node/1', mapUrl: 'https://www.openstreetmap.org/node/1', verificationStatus: 'UNVERIFIED' };
  const props = { results: [item], onAddSupplier: jest.fn(), existingContacts: [{ businessName: 'Saved branch', phone: '+919876543210' }] };
  const root = parse(renderToStaticMarkup(<NearbySupplierResults {...props} />));
  expect(root.text).toContain('Saved branch');
  expect(root.text).toContain('shared contact');
  expect(root.text).toContain('currently loaded');
  expect(root.text).toContain('Unverified');
  expect(root.querySelector('button')?.hasAttribute('disabled')).toBe(false);
});
