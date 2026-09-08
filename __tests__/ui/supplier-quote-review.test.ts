import { reviewQuote, QuoteReviewError } from '@/app/quote/quote-review';
import type { PublicQuoteRequestDto } from '@/app/quote/SupplierQuoteForm';

const request: PublicQuoteRequestDto = {
  restaurantName: 'Restaurant', supplierName: 'Supplier', title: 'Prices',
  deliveryDetails: {}, deliveryDate: '2026-09-12', quoteDeadline: '2026-09-11T10:00:00Z',
  commercialTerms: null, latestQuote: null,
  items: [{ id: 'a', itemKey: 'a', name: 'Rice', quantity: '10', unit: 'KILOGRAM', specification: { v: 1, category: 'GRAINS_PULSES' } }],
};
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ 'quantity:a': '2.5', 'rate:a': '100', 'gst:a': '18', freightInr: '20', deliveryDate: '2026-09-12', validUntil: '2026-09-13', ...values }).forEach(([key, value]) => data.set(key, value));
  return data;
}
it('reviews partial availability, added GST and delivery using exact paise', () => {
  const result = reviewQuote(form(), request);
  expect(result).toMatchObject({ subtotal: BigInt(25000), gst: BigInt(4500), freight: BigInt(2000), total: BigInt(31500) });
  expect(result.items[0].quantity).toBe('2.5 kilogram');
});
it('does not add GST twice when the price includes it', () => {
  expect(reviewQuote(form({ 'inclusive:a': 'on', 'rate:a': '118' }), request)).toMatchObject({ subtotal: BigInt(25000), gst: BigInt(4500), total: BigInt(31500) });
});
it('keeps the domain rounding for fractional quantities', () => {
  expect(reviewQuote(form({ 'quantity:a': '0.125', 'rate:a': '10.01', 'gst:a': '5', freightInr: '0' }), request)).toMatchObject({ subtotal: BigInt(125), gst: BigInt(6), total: BigInt(131) });
});
it('excludes unavailable items, while keeping delivery in the total', () => {
  const result = reviewQuote(form({ 'noQuote:a': 'on', 'rate:a': '', 'gst:a': '' }), request);
  expect(result.total).toBe(BigInt(2000));
  expect(result.items[0].quantity).toBeNull();
});
it.each([
  ['quantity:a', '11'], ['quantity:a', '0'], ['quantity:a', '1.0001'],
  ['rate:a', '-1'], ['rate:a', '1.001'], ['gst:a', '101'], ['freightInr', 'abc'],
])('identifies the field to fix for %s=%s', (field, value) => {
  try { reviewQuote(form({ [field]: value }), request); throw new Error('Expected invalid input'); }
  catch (error) { expect(error).toBeInstanceOf(QuoteReviewError); expect((error as QuoteReviewError).field).toBe(field); }
});
it('rejects an overflowing combined total without floating point conversion', () => {
  expect(() => reviewQuote(form({ freightInr: '92233720368547758.07' }), request)).toThrow('The quote total is too large');
});
