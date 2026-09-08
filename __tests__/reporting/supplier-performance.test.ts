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

describe('actionable buying evidence', () => {
  const billed = { billedQuantity: '10', billedUnitRatePaise: '4000', gstBasisPoints: 0, taxInclusive: false };
  it('keeps missing billed inputs out of the cost denominator and credits separate', () => {
    const [result] = buildSupplierPerformance([
      observation({ lines: [{ ...observation().lines[0], ...billed, receivedQuantity: '9' }], creditClaimedPaise: '4000', creditReceivedPaise: '2000', complete: false }),
      observation({ awardId: 'b' }),
    ]);
    expect(result.items[0]).toMatchObject({ acceptedQuantity: '19', costAcceptedQuantity: '9', billedCostPerAcceptedUnitPaise: '4444', costedChecks: 1, partialCostChecks: 1 });
    expect(result.followUps).toEqual([expect.objectContaining({ awardId: 'award-a', creditOutstandingPaise: '2000', reasons: ['Items still outstanding', 'Credit still owed'] })]);
  });
  it('normalizes cost denominators without mixing units or specifications', () => {
    const [result] = buildSupplierPerformance([
      observation({ lines: [{ ...observation().lines[0], ...billed }] }),
      observation({ awardId: 'b', lines: [{ ...observation().lines[0], ...billed, unit: 'GRAM', orderedQuantity: '1000', receivedQuantity: '1000', billedQuantity: '1000', billedUnitRatePaise: '4' }] }),
      observation({ awardId: 'c', lines: [{ ...observation().lines[0], ...billed, specificationKey: 'organic', billedUnitRatePaise: '5000' }] }),
    ]);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ specificationKey: '', costAcceptedQuantity: '11', billedCostPerAcceptedUnitPaise: '4000', costedChecks: 2 }),
      expect.objectContaining({ specificationKey: 'organic', billedCostPerAcceptedUnitPaise: '5000', costedChecks: 1 }),
    ]));
  });
  it('does not remove unchecked orders or count superseded credit balances', () => {
    const [result] = buildSupplierPerformance([
      observation({ awardId: 'unchecked', checkedAt: null, lines: [] }),
      observation({ creditClaimedPaise: '500', creditReceivedPaise: '0' }),
      observation({ checkedAt: '2026-09-08T12:00:00.000Z', creditClaimedPaise: '500', creditReceivedPaise: '500' }),
    ]);
    expect(result.creditOutstandingPaise).toBe('0');
    expect(result.followUps).toEqual([expect.objectContaining({ awardId: 'unchecked', reasons: ['Delivery not checked'] })]);
  });
});

it('keeps invoice-only legacy checks visible until delivery quantities are recorded', () => {
  const [result] = buildSupplierPerformance([observation({ lines: [], complete: true })]);
  expect(result.followUps).toEqual([expect.objectContaining({ reasons: ['Delivery quantities not recorded'] })]);
  expect(result.items).toEqual([]);
});
