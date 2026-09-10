import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { NearbySupplierResults } from '@/components/suppliers/NearbySupplierSearch';
import { nearbyPrefill, parseNearbyResults, type NearbyResult } from '@/lib/suppliers/nearby-types';
import { validateSupplierUpdateInput } from '@/lib/suppliers/supplier-schema';

const center = { id: '1', label: 'Mumbai, India', lat: 19.076, lon: 72.8777 };
const legacyResult: NearbyResult = {
  id: 'node/1', name: 'Fresh Foods', distanceKm: 0, phone: null, website: null,
  address: '', city: '', state: '', pin: '', category: 'produce', kind: 'Retail potential',
  sourceUrl: 'https://www.openstreetmap.org/node/1',
  mapUrl: 'https://www.openstreetmap.org/?mlat=19.076&mlon=72.8777#map=17/19.076/72.8777',
  verificationStatus: 'UNVERIFIED',
};

function parseLead(tags: Record<string, unknown>) {
  return parseNearbyResults({ elements: [{
    type: 'node', id: 1, lat: center.lat, lon: center.lon,
    tags: { name: 'Fresh Foods', shop: 'greengrocer', ...tags },
  }] }, center, 'produce', 2)[0];
}

const invalidEmails: [string, unknown][] = [
  ['missing', undefined], ['null', null], ['blank', '  '], ['number', 123],
  ['array', ['sales@example.org']], ['object', { email: 'sales@example.org' }],
  ['no at sign', 'sales.example.org'], ['no local part', '@example.org'],
  ['no domain suffix', 'sales@example'], ['extra at sign', 'sales@@example.org'],
  ['space inside', 'sa les@example.org'], ['consecutive domain dots', 'sales@example..org'],
  ['leading domain dot', 'sales@.example.org'], ['trailing domain dot', 'sales@example.org.'],
  ['leading local dot', '.sales@example.org'], ['trailing local dot', 'sales.@example.org'],
  ['consecutive local dots', 'sa..les@example.org'],
  ['invalid domain label', 'sales@-example.org'], ['domain underscore', 'sales@exam_ple.org'],
  ['mailto URL', 'mailto:sales@example.org'], ['display name', 'Sales <sales@example.org>'],
  ['angle brackets', '<sales@example.org>'], ['comment', 'sales(comment)@example.org'],
  ['comma-separated', 'sales@example.org,orders@example.org'],
  ['semicolon-separated', 'sales@example.org;orders@example.org'],
  ['space-separated', 'sales@example.org orders@example.org'],
  ['malformed shared domain list', 'sales,orders@example.org'],
  ['trailing separator', 'sales@example.org;'],
  ['too long', `${'a'.repeat(309)}@example.org`],
  ['valid prefix followed by oversized garbage', `sales@example.org${' '.repeat(320)}junk`],
  ...Array.from({ length: 33 }, (_, index): [string, unknown] => {
    const code = index === 32 ? 127 : index;
    return [`embedded control ${code}`, `sa${String.fromCharCode(code)}les@example.org`];
  }),
  ['leading newline', '\nsales@example.org'], ['trailing newline', 'sales@example.org\n'],
  ['leading tab', '\tsales@example.org'], ['trailing tab', 'sales@example.org\t'],
  ['CRLF injection', 'sales@example.org\r\nBcc: other@example.org'],
  ['C1 control', 'sa\u0085les@example.org'],
];

describe.each(['email', 'contact:email'])('public OSM %s', (tag) => {
  it.each(['sales@example.org', ' Orders+Mumbai@Fresh-Foods.CO.IN ', "o'hara@example.org"])(
    'accepts a single address and matches supplier normalization: %s', (value) => {
      const result = parseLead({ [tag]: value });
      expect(result).toMatchObject({ email: validateSupplierUpdateInput({ email: value }).email });
      expect(result.verificationStatus).toBe('UNVERIFIED');
      expect(result.sourceUrl).toBe(legacyResult.sourceUrl);
      expect(result.mapUrl).toBe(legacyResult.mapUrl);
    },
  );

  it.each(invalidEmails)('rejects %s without dropping the lead or repairing the address', (_label, value) => {
    const result = parseLead({ [tag]: value });
    expect(result).toMatchObject({ name: 'Fresh Foods', email: null, verificationStatus: 'UNVERIFIED' });
    expect(nearbyPrefill(result).email).toBe('');
  });

  it('passes the public address into the unsaved review form with source and caution intact', () => {
    const result = parseLead({ [tag]: 'orders@example.org', website: 'https://example.org' });
    expect(nearbyPrefill(result)).toEqual({
      businessName: 'Fresh Foods', email: 'orders@example.org', phone: '',
      addressLine: '', city: '', state: '', pin: '',
      notes: 'Unverified OpenStreetMap lead. Retail potential; Produce category match only. Confirm products, contact and delivery before saving. Source: https://www.openstreetmap.org/node/1 Website: https://example.org/',
    });
  });
});

it('prefers valid email and falls back to independently valid contact:email', () => {
  expect(parseLead({ email: 'sales@example.org', 'contact:email': 'orders@example.org' }))
    .toMatchObject({ email: 'sales@example.org' });
  for (const email of ['invalid', 'sales@example.org\n', '', null]) {
    expect(parseLead({ email, 'contact:email': 'orders@example.org' }))
      .toMatchObject({ email: 'orders@example.org' });
  }
  expect(parseLead({ email: 'sales@example.org', 'contact:email': 'invalid' }))
    .toMatchObject({ email: 'sales@example.org' });
});

it('does not infer email from a business name, website, phone or unrelated OSM tag', () => {
  const result = parseLead({
    name: 'orders@example.org', website: 'https://example.org', phone: '+91 9876543210',
    description: 'Email sales@example.org', 'operator:email': 'operator@example.org',
  });
  expect(result).toMatchObject({ email: null });
  expect(nearbyPrefill(result).email).toBe('');
});

it('preserves cached results and fixtures without an email field', () => {
  const cached: NearbyResult = JSON.parse(JSON.stringify(legacyResult));
  expect(cached).not.toHaveProperty('email');
  expect(nearbyPrefill(cached).email).toBe('');
  const html = renderToStaticMarkup(<NearbySupplierResults results={[cached]} onAddSupplier={() => {}} />);
  expect(html).toContain('Contact details not mapped');
  expect(html).not.toContain('Email:');
});

it('renders an email-only lead as plain text with source links and explicit review', () => {
  const result = { ...legacyResult, email: 'sales@example.org' };
  const root = parse(renderToStaticMarkup(<NearbySupplierResults results={[result]} onAddSupplier={() => {}} />));
  expect(root.querySelectorAll('p').map(p => p.textContent)).toContain('Email: sales@example.org');
  expect(root.textContent).not.toContain('Contact details not mapped');
  expect(root.textContent).toContain('Unverified');
  expect(root.querySelector('button')?.textContent).toContain('Review and add');
  expect(root.querySelectorAll('a').map(a => a.getAttribute('href')))
    .toEqual([legacyResult.mapUrl, legacyResult.sourceUrl]);
});

it.each(invalidEmails)('keeps %s out of rendered contact text and cached prefill', (_label, email) => {
  const result = { ...legacyResult, email } as NearbyResult;
  expect(nearbyPrefill(result).email).toBe('');
  const html = renderToStaticMarkup(<NearbySupplierResults results={[result]} onAddSupplier={() => {}} />);
  expect(html).not.toContain('Email:');
  expect(html).toContain('Contact details not mapped');
});

// This project uses Node-only component tests. Walk the synchronous result tree
// to exercise its real review callback without adding a browser dependency.
function reviewButton(node: ReactNode): (() => void) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) continue;
    if (child.type === 'button') return child.props.onClick;
    const found = reviewButton(child.props.children);
    if (found) return found;
  }
}

it.each(['email', 'contact:email'])('review action passes %s to the form only after a click', (tag) => {
  const onAddSupplier = jest.fn();
  const result = parseLead({ [tag]: 'orders@example.org' });
  const tree = NearbySupplierResults({ results: [result], onAddSupplier });
  expect(onAddSupplier).not.toHaveBeenCalled();
  const click = reviewButton(tree);
  expect(click).toBeDefined();
  click!();
  expect(onAddSupplier).toHaveBeenCalledTimes(1);
  expect(onAddSupplier).toHaveBeenCalledWith(expect.objectContaining({ email: 'orders@example.org' }));
  expect(onAddSupplier.mock.calls[0][0]).not.toHaveProperty('verificationStatus');
});
