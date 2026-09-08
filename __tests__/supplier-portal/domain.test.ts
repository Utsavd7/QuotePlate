import { parseAction, parseSubmission, fingerprint, parseDemand, selectDemand } from '@/lib/supplier-portal/domain';
const acknowledgement = { action: 'acknowledge', requestId: 'request', expectedVersion: 1, status: 'confirmed', note: '' };
test('public submissions require a bounded portal identity while legacy revisions remain valid', () => {
  expect(parseSubmission({ ...acknowledgement, portalId: 'portal-a' })).toEqual({ ...acknowledgement, portalId: 'portal-a' });
  for (const portalId of [undefined, null, '', ' ', 1, 'x'.repeat(201), '\u0000']) {
    expect(() => parseSubmission({ ...acknowledgement, portalId })).toThrow();
  }
  expect(() => parseSubmission(acknowledgement)).toThrow();
  expect(() => parseSubmission({ ...acknowledgement, portalId: 'portal-a', supplierId: 'other' })).toThrow();
  expect(parseAction(acknowledgement)).toEqual(acknowledgement);
});
test('requires exact bounded actions and positive versions', () => {
  expect(parseAction(acknowledgement)).toEqual(acknowledgement);
  for (const value of [{ ...acknowledgement, supplierId: 'other' }, { ...acknowledgement, expectedVersion: 0 }, { ...acknowledgement, note: 'x'.repeat(1001) }, { ...acknowledgement, note: '\u0000' }]) expect(() => parseAction(value)).toThrow();
});
test('fingerprint is stable across object key order but changes with receiving facts', () => {
  expect(fingerprint({ a: '1', b: { x: 2, y: 3 } })).toBe(fingerprint({ b: { y: 3, x: 2 }, a: '1' }));
  expect(fingerprint({ received: '2' })).not.toBe(fingerprint({ received: '3' }));
});
test('demand selection rejects duplicates, unknown keys, blocked or zero shortages and extra payload', () => {
  const input = { planId: 'p', expectedPlanVersion: 1, itemKeys: ['rice'] };
  expect(parseDemand(input)).toEqual(input);
  expect(() => parseDemand({ ...input, itemKeys: ['rice', 'rice'] })).toThrow();
  expect(() => parseDemand({ ...input, items: [] })).toThrow();
  const rows = [{ itemKey: 'rice', name: 'Rice', deficit: '6.25', unit: 'KILOGRAM', specification: { v: 1, category: 'OTHER' }, blocked: false, stock: '4', price: 123 }];
  expect(selectDemand(rows, ['rice'])).toEqual([{ itemKey: 'rice', name: 'Rice', quantity: '6.25', unit: 'KILOGRAM', specification: '' }]);
  expect(() => selectDemand(rows, ['missing'])).toThrow();
  expect(() => selectDemand([{ ...rows[0], blocked: true }], ['rice'])).toThrow();
  expect(() => selectDemand([{ ...rows[0], deficit: '0' }], ['rice'])).toThrow();
});

test('textarea notes accept line breaks and require an explanation for exceptions', () => {
 expect(parseAction({ ...acknowledgement, note: 'Line one\nLine two\tend\r\n', status: 'needs_change' }).note).toBe('Line one\nLine two\tend');
 expect(() => parseAction({ ...acknowledgement, status: 'needs_change', note: '  ' })).toThrow();
 const response = { action: 'delivery-response', requestId: 'r', expectedVersion: 1, fingerprint: 'a'.repeat(64), decision: 'dispute', note: '', evidenceReference: '' };
 expect(() => parseAction(response)).toThrow();
 expect(() => parseAction({ ...response, note: 'Mismatch', evidenceReference: 'INV\n1' })).toThrow();
 expect(parseAction({ ...response, note: 'Mismatch' }).note).toBe('Mismatch');
});
test('shares only specification text shown in the restaurant review', () => {
 const rows = [{ itemKey: 'rice', name: 'Rice', deficit: '2', unit: 'KILOGRAM', blocked: false, specification: { v: 1, category: 'OTHER', description: 'Long grain', preferredBrand: 'Brand', packSize: '5 kg', qualityGrade: 'A', notes: 'Sealed bag', referenceUrl: 'https://private.example', thumbnailWebpBase64: 'private-image', unknown: 'private-secret' } }];
 expect(selectDemand(rows, ['rice'])[0].specification).toBe('Long grain · Brand · 5 kg · A · Sealed bag');
});
test('rejects invalid PostgreSQL text and snapshots beyond the storage budget before persistence', () => {
 expect(() => parseAction({ ...acknowledgement, note: '\ud800' })).toThrow();
 const rows = Array.from({ length: 100 }, (_, i) => ({ itemKey: String(i), name: 'Rice', deficit: '1', unit: 'KILOGRAM', blocked: false, specification: { description: '米'.repeat(500), notes: '米'.repeat(1000) } }));
 expect(() => selectDemand(rows, rows.map(r => r.itemKey))).toThrow();
});
