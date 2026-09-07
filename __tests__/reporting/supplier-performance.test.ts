import { buildSupplierPerformance, type SupplierObservation } from '@/lib/reporting/supplier-performance';

const observation = (changes: Partial<SupplierObservation> = {}): SupplierObservation => ({
  awardId: 'award-a', requestId: 'request-a', supplierId: 'supplier-a', supplierName: 'Farm A',
  promisedDate: '2026-09-07', checkedAt: '2026-09-07T12:00:00.000Z',
  actualDeliveryDate: '2026-09-07', issueCodes: [], invoiceDifferencePaise: '0',
  creditClaimedPaise: '0', creditReceivedPaise: '0', complete: true,
  lines: [{ itemKey: 'tomato', itemName: 'Tomato', unit: 'KILOGRAM', orderedQuantity: '10', receivedQuantity: '10', rejectedQuantity: '0' }],
  ...changes,
});

describe('supplier performance from measured outcomes', () => {
  it('does not call an unchecked award or an undated receipt on time', () => {
    const [result] = buildSupplierPerformance([
      observation({ checkedAt: null, actualDeliveryDate: null, lines: [] }),
      observation({ awardId: 'b', actualDeliveryDate: null, lines: [] }),
    ]);
    expect(result).toMatchObject({ awardedDeliveries: 2, checkedDeliveries: 1, datedDeliveries: 0, onTimePercent: null, evidence: 'LIMITED' });
  });

  it('tracks claimed money separately from settled credits and preserves missing quantities', () => {
    const [result] = buildSupplierPerformance([observation({
      issueCodes: ['QUALITY'], creditClaimedPaise: '5000', creditReceivedPaise: '2000', complete: false,
      lines: [{ itemKey: 'tomato', itemName: 'Tomato', unit: 'KILOGRAM', orderedQuantity: '10', receivedQuantity: '8', rejectedQuantity: '2' }],
    })]);
    expect(result).toMatchObject({ creditClaimedPaise: '5000', creditReceivedPaise: '2000', creditOutstandingPaise: '3000', problemDeliveries: 1, partialDeliveries: 1 });
    expect(result.items[0]).toMatchObject({ acceptedQuantity: '6', fulfillmentPercent: '60', rejectionPercent: '25', observations: 1 });
  });

  it('normalizes mass but never adds kilograms to litres or arbitrary packs', () => {
    const [result] = buildSupplierPerformance([
      observation(),
      observation({ awardId: 'b', lines: [{ itemKey: 'tomato', itemName: 'Tomato', unit: 'GRAM', orderedQuantity: '1000', receivedQuantity: '500', rejectedQuantity: '0' }] }),
      observation({ awardId: 'c', lines: [{ itemKey: 'tomato', itemName: 'Tomato', unit: 'PACK', orderedQuantity: '2', receivedQuantity: '1', rejectedQuantity: '0' }] }),
    ]);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ unit: 'KILOGRAM', orderedQuantity: '11', acceptedQuantity: '10.5', fulfillmentPercent: '95.5' }),
      expect.objectContaining({ unit: 'PACK', orderedQuantity: '2', acceptedQuantity: '1' }),
    ]));
  });

  it('requires at least three dated completed receipts before a reliability recommendation', () => {
    const [result] = buildSupplierPerformance([observation(), observation({ awardId: 'b' }), observation({ awardId: 'c', actualDeliveryDate: '2026-09-08', issueCodes: ['LATE'] })]);
    expect(result).toMatchObject({ evidence: 'ESTABLISHED', onTimePercent: '66.7', datedDeliveries: 3, onTimeDeliveries: 2 });
  });

  it('excludes invalid calendar dates without crashing or inventing reliability', () => {
    const [result] = buildSupplierPerformance([observation({ actualDeliveryDate: '2026-99-99' }), observation({ awardId: 'b', actualDeliveryDate: '2026-02-30' })]);
    expect(result).toMatchObject({ datedDeliveries: 0, onTimePercent: null });
  });

  it('does not double count repeated snapshots of the same supplier award', () => {
    const [result] = buildSupplierPerformance([observation(), observation()]);
    expect(result.awardedDeliveries).toBe(1);
  });

  it('rejects impossible measured quantities and excess credits instead of publishing false metrics', () => {
    expect(() => buildSupplierPerformance([observation({ creditClaimedPaise: '1', creditReceivedPaise: '2' })])).toThrow();
    expect(() => buildSupplierPerformance([observation({ lines: [{ itemKey: 'tomato', itemName: 'Tomato', unit: 'KILOGRAM', orderedQuantity: '10', receivedQuantity: '2', rejectedQuantity: '3' }] })])).toThrow();
  });
});
