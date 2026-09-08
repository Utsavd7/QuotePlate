import { calculateGst, multiplyPaise, parseInrToPaise } from '@/lib/domain/money';
import { assertMaximum, MAX_SIGNED_BIGINT, MAX_DECIMAL_18_3_SCALED, parseUnsignedFixed } from '@/lib/domain/validation';
import type { PublicQuoteRequestDto } from './SupplierQuoteForm';

export class QuoteReviewError extends Error {
  constructor(readonly field: string, message: string) { super(message); }
}

// Use the same exact-decimal helpers as quote submission; the server still
// validates access, dates, revisions and the complete submitted quote.
export function reviewQuote(form: FormData, request: PublicQuoteRequestDto) {
  let subtotal = BigInt(0);
  let gst = BigInt(0);
  const items = request.items.map((item) => {
    if (form.get(`noQuote:${item.id}`) === 'on') return { name: item.name, quantity: null, total: BigInt(0) };
    const value = (key: string) => String(form.get(`${key}:${item.id}`) ?? '');
    const quantity = value('quantity');
    try {
      const options = { label: 'Quantity', scale: 3, maximumScaled: MAX_DECIMAL_18_3_SCALED, allowZero: false };
      if (parseUnsignedFixed(quantity, options) > parseUnsignedFixed(item.quantity, options)) throw new Error();
    } catch { throw new QuoteReviewError(`quantity:${item.id}`, `${item.name}: enter a quantity above 0, up to ${item.quantity}, with at most 3 decimal places. Or select “Cannot supply this item”.`); }
    let rate: bigint;
    try { rate = parseInrToPaise(value('rate')); }
    catch { throw new QuoteReviewError(`rate:${item.id}`, `${item.name}: enter a price of 0 or more, with at most 2 decimal places.`); }
    let basisPoints: number;
    try { basisPoints = Number(parseUnsignedFixed(value('gst'), { label: 'GST', scale: 2, maximumScaled: BigInt(10_000), allowZero: true })); }
    catch { throw new QuoteReviewError(`gst:${item.id}`, `${item.name}: enter GST from 0 to 100, with at most 2 decimal places.`); }
    try {
      const line = calculateGst({ amountPaise: multiplyPaise(rate, quantity), gstBasisPoints: basisPoints, inclusive: form.get(`inclusive:${item.id}`) === 'on' });
      subtotal = assertMaximum(subtotal + line.netPaise, MAX_SIGNED_BIGINT, 'Subtotal');
      gst = assertMaximum(gst + line.gstPaise, MAX_SIGNED_BIGINT, 'GST');
      return { name: item.name, quantity: `${quantity} ${item.unit.toLowerCase().replaceAll('_', ' ')}`, total: line.grossPaise };
    } catch { throw new QuoteReviewError(`rate:${item.id}`, `${item.name}: this total is too large. Check the price and quantity.`); }
  });
  let freight: bigint;
  try { freight = parseInrToPaise(String(form.get('freightInr') ?? '')); }
  catch { throw new QuoteReviewError('freightInr', 'Enter a delivery charge of 0 or more, with at most 2 decimal places.'); }
  let total: bigint;
  try { total = assertMaximum(subtotal + gst + freight, MAX_SIGNED_BIGINT, 'Total'); }
  catch { throw new QuoteReviewError('freightInr', 'The quote total is too large. Check your prices, quantities and delivery charge.'); }
  return { items, subtotal, gst, freight, total, deliveryDate: String(form.get('deliveryDate')), validUntil: String(form.get('validUntil')), commercialTerms: String(form.get('commercialTerms') ?? ''), notes: String(form.get('notes') ?? '') };
}
