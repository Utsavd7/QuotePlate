import { matchingPreviousPrices } from '@/lib/quotes/previous-prices';
import { appendQuoteRevision, type QuoteRequestItem } from '@/lib/quotes/quote-revisions';

const old: QuoteRequestItem = { id: 'old', itemKey: 'tomato', name: 'Tomato', quantity: '10', unit: 'KILOGRAM', specification: { v: 1, category: 'VEGETABLES', qualityGrade: 'A' } };
const current = { ...old, id: 'current', quantity: '20' };
function history(line: object = {}) {
  return appendQuoteRevision({ v: 1, revisions: [] }, {
    deliveryDate: '2026-09-01', validUntil: '2026-09-01', freightInr: '99', commercialTerms: 'Old private terms',
    items: [{ requestItemId: 'old', noQuote: false, availableQuantity: '3', unit: 'KILOGRAM', unitRateInr: '42.75', gstPercent: '5', taxInclusive: true, ...line }],
  }, { requestItems: [old], expectedLatestRevision: 0, storedLatestRevision: 0, databaseNow: new Date('2026-08-31T00:00:00Z') });
}
test('returns only matched current IDs and exact price/GST values with submission date', () => {
  const result = matchingPreviousPrices([current], [old], history(), 1);
  expect(result).toEqual({ submittedAt: '2026-08-31T00:00:00.000Z', items: [{ requestItemId: 'current', unitRatePaise: '4275', gstBasisPoints: 500, taxInclusive: true }] });
  expect(current.quantity).toBe('20');
});
test.each([
  { itemKey: 'other' }, { unit: 'GRAM' },
  { specification: { ...old.specification, qualityGrade: 'B' } },
  { specification: { ...old.specification, packSize: '1 kg' } },
])('rejects changed item key, unit or specification: %j', (change) => {
  expect(matchingPreviousPrices([{ ...current, ...change } as QuoteRequestItem], [old], history(), 1)).toBeNull();
});
test('compares all specification fields without relying on property order', () => {
  expect(matchingPreviousPrices([{ ...current, specification: { qualityGrade: 'A', category: 'VEGETABLES', v: 1 } }], [old], history(), 1)).not.toBeNull();
});
test.each([{ noQuote: true }, { substitution: 'Different tomatoes' }, { suppliedBrand: 'Alternative brand' }, { suppliedPackSize: 'Other pack' }, { suppliedQualityGrade: 'B' }])('omits unavailable or qualified offers %j', (line) => {
  expect(matchingPreviousPrices([current], [old], history(line), 1)).toBeNull();
});
test('no history and inconsistent revision counts do not provide prices', () => {
  expect(matchingPreviousPrices([current], [old], { v: 1, revisions: [] }, 0)).toBeNull();
  expect(() => matchingPreviousPrices([current], [old], history(), 2)).toThrow();
});
