import { buildReceivingSummary, validateReceivingInput, validateStoredReceiving } from '@/lib/receiving/receiving-document';

const details = {
  items: [{ requestItemId: 'tomato', receivedQuantity: '6', rejectedQuantity: '1', billedQuantity: '10', billedUnitRatePaise: '110' }],
  actualDeliveryDate: '2026-09-05', creditClaimedPaise: '600', creditReceivedPaise: '200', settlementNote: 'Balance pending',
};
const check = { supplierId: 'a', outcome: 'MATCHED', invoiceTotalPaise: '1100', issueCodes: [], note: null, details };
const summaryInput = {
  allocationLines: { v: 1 as const, lines: [{ supplierId: 'a', requestItemId: 'tomato', quantity: '10', unit: 'KILOGRAM', unitRatePaise: '100', gstBasisPoints: 0, totalPaise: '1000' }] },
  supplierSnapshots: { v: 1 as const, suppliers: [{ supplierId: 'a', supplierName: 'A', freightPaise: '0', deliveryDate: '2026-09-04', lines: [{ requestItemId: 'tomato', itemName: 'Tomato', taxInclusive: false }] }] },
};
it('round trips optional item checks without losing legacy checks', () => {
  expect(validateReceivingInput({ ...check, expectedCheckedAt: null })).toMatchObject({ details });
  const stored = { v: 1, suppliers: [{ ...check, checkedAt: '2026-09-05T10:00:00.000Z' }] };
  expect(validateStoredReceiving(stored)).toEqual(stored);
});
it('calculates cumulative accepted, pending, rejected, overbilling and credit balance exactly', () => {
  const receiving = validateStoredReceiving({ v: 1, suppliers: [{ ...check, checkedAt: '2026-09-05T10:00:00.000Z' }] });
  const summary = buildReceivingSummary({ ...summaryInput, receiving });
  expect(summary.complete).toBe(false);
  expect(summary.suppliers[0]).toMatchObject({ items: [{ orderedQuantity: '10' }], check: {
    deliveryComplete: false, discrepancyPaise: '600', creditRemainingPaise: '400',
    itemDetails: [{ acceptedQuantity: '5', pendingQuantity: '5', missingQuantity: '4', rejectedValuePaise: '100', missingValuePaise: '400', discrepancyPaise: '600' }],
  } });
});
it.each([
  { ...details, creditReceivedPaise: '601' }, { ...details, actualDeliveryDate: '2026-02-30' },
  { ...details, creditClaimedPaise: 600 }, { ...details, creditClaimedPaise: '9223372036854775808' },
  { ...details, items: [details.items[0], details.items[0]] },
  ...['1e2', '-1', '0.0001', '01', '9999999999999999', 6].map(receivedQuantity => ({ ...details, items: [{ ...details.items[0], receivedQuantity }] })),
  { ...details, items: [{ ...details.items[0], rejectedQuantity: '7' }] },
  { ...details, items: [{ ...details.items[0], orderedQuantity: '999' }] },
])('rejects invalid detail input', candidate => {
  expect(() => validateReceivingInput({ ...check, details: candidate, expectedCheckedAt: null })).toThrow();
});
it('uses only supplier split allocation for ordered quantity and rejects foreign item records', () => {
  const receiving = validateStoredReceiving({ v: 1, suppliers: [{ ...check, details: { ...details, items: [{ ...details.items[0], receivedQuantity: '3', rejectedQuantity: '0' }] }, checkedAt: '2026-09-05T10:00:00.000Z' }] });
  const summary = buildReceivingSummary({ ...summaryInput, allocationLines: { v: 1, lines: [{ ...summaryInput.allocationLines.lines[0], quantity: '4', totalPaise: '400' }] }, receiving });
  expect(summary.suppliers[0]).toMatchObject({ items: [{ orderedQuantity: '4' }], check: { itemDetails: [{ pendingQuantity: '1' }] } });
  receiving.suppliers[0]!.details!.items[0]!.requestItemId = 'foreign';
  expect(() => buildReceivingSummary({ ...summaryInput, receiving })).toThrow();
});
it('allows cumulative replacement deliveries to complete a previously rejected allocation', () => {
  const receiving = validateStoredReceiving({ v: 1, suppliers: [{ ...check, details: { ...details, items: [{ ...details.items[0], receivedQuantity: '11', rejectedQuantity: '1' }] }, checkedAt: '2026-09-05T10:00:00.000Z' }] });
  expect(buildReceivingSummary({ ...summaryInput, receiving }).suppliers[0].check).toMatchObject({ deliveryComplete: true, itemDetails: [{ pendingQuantity: '0', missingQuantity: '0', acceptedQuantity: '10' }] });
});
it.each([12, {}, '1e2', '9'.repeat(100)])('rejects non-exact invoice totals', invoiceTotalPaise => {
  expect(() => validateReceivingInput({ ...check, invoiceTotalPaise, expectedCheckedAt: null })).toThrow();
});
it('allows a zero invoice for a detailed partial delivery without weakening legacy validation', () => {
  expect(validateReceivingInput({ ...check, invoiceTotalPaise: '0', expectedCheckedAt: null })).toMatchObject({ invoiceTotalPaise: '0' });
});
it.each([{ inclusive: false, expected: '118' }, { inclusive: true, expected: '100' }])('uses accepted tax treatment for discrepancies: %j', ({ inclusive, expected }) => {
  const receiving = validateStoredReceiving({ v: 1, suppliers: [{ ...check, details: { ...details, items: [{ ...details.items[0], receivedQuantity: '1', rejectedQuantity: '0', billedQuantity: '2', billedUnitRatePaise: '100' }] }, checkedAt: '2026-09-05T10:00:00.000Z' }] });
  const summary = buildReceivingSummary({
    ...summaryInput,
    allocationLines: { v: 1, lines: [{ ...summaryInput.allocationLines.lines[0], quantity: '2', gstBasisPoints: 1800 }] },
    supplierSnapshots: { v: 1, suppliers: [{ ...summaryInput.supplierSnapshots.suppliers[0], lines: [{ requestItemId: 'tomato', itemName: 'Tomato', taxInclusive: inclusive }] }] },
    receiving,
  });
  expect(summary.suppliers[0].check?.discrepancyPaise).toBe(expected);
});
it('rejects billing multiplication overflow rather than rounding through floating point', () => {
  const receiving = validateStoredReceiving({ v: 1, suppliers: [{ ...check, details: { ...details, items: [{ ...details.items[0], billedQuantity: '10', billedUnitRatePaise: '9223372036854775807' }] }, checkedAt: '2026-09-05T10:00:00.000Z' }] });
  expect(() => buildReceivingSummary({ ...summaryInput, receiving })).toThrow();
});
it('rejects an overlarge item list and stored details with unrecognized fields', () => {
  expect(() => validateReceivingInput({ ...check, details: { ...details, items: Array.from({ length: 251 }, (_, i) => ({ ...details.items[0], requestItemId: `item-${i}` })) }, expectedCheckedAt: null })).toThrow();
  expect(() => validateStoredReceiving({ v: 1, suppliers: [{ ...check, details: { ...details, approvedCredit: true }, checkedAt: '2026-09-05T10:00:00.000Z' }] })).toThrow();
});
