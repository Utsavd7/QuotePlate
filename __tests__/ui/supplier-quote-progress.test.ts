import { quoteItemProgress, reviewQuoteItems, QuoteReviewError } from '@/app/quote/quote-review';
import type { PublicQuoteRequestDto } from '@/app/quote/SupplierQuoteForm';

const items: PublicQuoteRequestDto['items'] = ['rice', 'milk', 'onion'].map(id => ({
  id, itemKey: id, name: id, quantity: '10', unit: 'KILOGRAM',
  specification: { v: 1, category: 'OTHER' },
}));

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const item of items) {
    data.set(`quantity:${item.id}`, '10');
    data.set(`rate:${item.id}`, '');
    data.set(`gst:${item.id}`, '0');
  }
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

test('counts unfinished items once and points to the first existing validation error', () => {
  const data = form({ 'quantity:rice': '11', 'rate:milk': '1.001' });
  const progress = quoteItemProgress(data, items);
  expect(progress.remaining).toBe(3);
  expect(progress.firstProblem).toBeInstanceOf(QuoteReviewError);
  expect(progress.firstProblem?.field).toBe('quantity:rice');
  expect(() => reviewQuoteItems(data, items)).toThrow(progress.firstProblem?.message);
});

test('accepts zero prices and skips explicitly unavailable items with missing fields', () => {
  const data = form({ 'rate:rice': '0', 'rate:milk': '15', 'noQuote:onion': 'on' });
  data.delete('quantity:onion');
  data.delete('gst:onion');
  expect(quoteItemProgress(data, items)).toEqual({ remaining: 0, firstProblem: null });
});

test('never changes manual values, invalid values, tax choices, or unavailable rows', () => {
  const data = form({ 'quantity:rice': '2.125', 'rate:rice': '0', 'gst:rice': '5',
    'inclusive:rice': 'on', 'rate:milk': '-2', 'gst:milk': 'bad',
    'substitution:rice': 'Different pack', 'noQuote:onion': 'on', 'rate:onion': '123' });
  const before = [...data.entries()];
  expect(quoteItemProgress(data, items)).toMatchObject({ remaining: 1, firstProblem: { field: 'rate:milk' } });
  expect([...data.entries()]).toEqual(before);
  data.set('rate:milk', '4');
  expect(quoteItemProgress(data, items).firstProblem?.field).toBe('gst:milk');
  data.set('gst:milk', '0');
  expect(quoteItemProgress(data, items).remaining).toBe(0);
  data.delete('noQuote:onion');
  data.set('rate:onion', '');
  expect(quoteItemProgress(data, items).remaining).toBe(1);
});

test('uses existing exact-total overflow checks and does not validate delivery early', () => {
  const data = form({ 'rate:rice': '92233720368547758.07', 'noQuote:milk': 'on', 'noQuote:onion': 'on', freightInr: 'invalid' });
  expect(quoteItemProgress(data, items)).toMatchObject({ remaining: 1, firstProblem: { field: 'rate:rice' } });
  data.set('rate:rice', '1');
  expect(quoteItemProgress(data, items)).toEqual({ remaining: 0, firstProblem: null });
});
