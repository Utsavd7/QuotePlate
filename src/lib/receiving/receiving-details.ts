import { calculateGst } from '@/lib/domain/money';
import { assertMaximum, divideHalfUp, formatScaledDecimal, MAX_DECIMAL_18_3_SCALED, MAX_SIGNED_BIGINT, parseUnsignedFixed } from '@/lib/domain/validation';

export const RECEIVING_JSON_BYTES = 1024 * 1024;
export type ReceivingItem = { requestItemId: string; receivedQuantity: string; rejectedQuantity: string; billedQuantity: string | null; billedUnitRatePaise: string | null };
export type ReceivingDetails = { items: ReceivingItem[]; actualDeliveryDate: string | null; creditClaimedPaise: string; creditReceivedPaise: string; settlementNote: string | null };
export type ReceivingAwardItem = { requestItemId: string; itemKey: string; itemName: string; unit: string; orderedQuantity: string; unitRatePaise: string; gstBasisPoints: number; taxInclusive: boolean };
export type ReceivingItemDetail = ReceivingAwardItem & ReceivingItem & { acceptedQuantity: string; pendingQuantity: string; missingQuantity: string; missingValuePaise: string; rejectedValuePaise: string; discrepancyPaise: string };
export type ReceivingCalculatedDetails = { itemDetails: ReceivingItemDetail[]; deliveryComplete: boolean; discrepancyPaise: string; creditRemainingPaise: string };

function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length || !Reflect.ownKeys(value).every(k => typeof k === 'string' && keys.includes(k) && Object.getOwnPropertyDescriptor(value, k)?.enumerable && 'value' in Object.getOwnPropertyDescriptor(value, k)!)) throw new RangeError('Invalid receiving details');
}
export function receivingNumber(value: unknown, scale = 3): bigint {
  if (typeof value !== 'string' || value.length > 24) throw new RangeError('Enter exact bounded decimal values');
  return parseUnsignedFixed(value, { label: 'Receiving value', scale, maximumScaled: scale === 0 ? MAX_SIGNED_BIGINT : MAX_DECIMAL_18_3_SCALED, allowZero: true });
}
export function validateReceivingDetails(value: unknown): ReceivingDetails {
  exact(value, ['items', 'actualDeliveryDate', 'creditClaimedPaise', 'creditReceivedPaise', 'settlementNote']);
  const items = value.items;
  if (!Array.isArray(items) || Object.getPrototypeOf(items) !== Array.prototype || !items.length || items.length > 250 || Reflect.ownKeys(items).length !== items.length + 1) throw new RangeError('Invalid items');
  for (let index = 0; index < items.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(items, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new RangeError('Invalid item');
  }
  const parsed = items.map(item => {
    exact(item, ['requestItemId', 'receivedQuantity', 'rejectedQuantity', 'billedQuantity', 'billedUnitRatePaise']);
    if (typeof item.requestItemId !== 'string' || !item.requestItemId.length || item.requestItemId.length > 200 || item.requestItemId.trim() !== item.requestItemId || /[\u0000-\u001f\u007f]/.test(item.requestItemId)) throw new RangeError('Invalid item');
    const received = receivingNumber(item.receivedQuantity), rejected = receivingNumber(item.rejectedQuantity);
    if (rejected > received) throw new RangeError('Rejected quantity cannot exceed received quantity');
    if ((item.billedQuantity === null) !== (item.billedUnitRatePaise === null)) throw new RangeError('Enter both billed quantity and rate');
    if (item.billedQuantity !== null) { receivingNumber(item.billedQuantity); receivingNumber(item.billedUnitRatePaise, 0); }
    return { ...item, receivedQuantity: formatScaledDecimal(received, 3), rejectedQuantity: formatScaledDecimal(rejected, 3) } as ReceivingItem;
  });
  if (new Set(parsed.map(i => i.requestItemId)).size !== parsed.length) throw new RangeError('Duplicate item');
  const claimed = receivingNumber(value.creditClaimedPaise, 0), received = receivingNumber(value.creditReceivedPaise, 0);
  if (received > claimed) throw new RangeError('Credit received cannot exceed claimed');
  const date = value.actualDeliveryDate;
  if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new RangeError('Invalid actual delivery date');
  const note = value.settlementNote;
  if (note !== null && (typeof note !== 'string' || !note.length || note.length > 500 || note.trim() !== note || /[\u0000-\u001f\u007f]/.test(note))) throw new RangeError('Invalid settlement note');
  return { items: parsed, actualDeliveryDate: date as string | null, creditClaimedPaise: claimed.toString(), creditReceivedPaise: received.toString(), settlementNote: note as string | null };
}

export function calculateReceivingDetails(items: ReceivingAwardItem[], details: ReceivingDetails): ReceivingCalculatedDetails {
  if (items.length !== details.items.length) throw new RangeError('Record every awarded item');
  const byId = new Map(details.items.map(i => [i.requestItemId, i]));
  let discrepancy = BigInt(0);
  const itemDetails = items.map(award => {
    const item = byId.get(award.requestItemId);
    if (!item) throw new RangeError('Item is not awarded to this supplier');
    const ordered = receivingNumber(award.orderedQuantity), received = receivingNumber(item.receivedQuantity), rejected = receivingNumber(item.rejectedQuantity);
    const accepted = received - rejected;
    if (accepted > ordered) throw new RangeError('Accepted quantity exceeds the supplier allocation');
    const missing = ordered > received ? ordered - received : BigInt(0), pending = ordered - accepted;
    const gross = (quantity: bigint, rate: string) => calculateGst({ amountPaise: assertMaximum(divideHalfUp(quantity * receivingNumber(rate, 0), BigInt(1000)), MAX_SIGNED_BIGINT, 'Item value'), gstBasisPoints: award.gstBasisPoints, inclusive: award.taxInclusive }).grossPaise;
    const billed = item.billedQuantity === null ? gross(ordered, award.unitRatePaise) : gross(receivingNumber(item.billedQuantity), item.billedUnitRatePaise!);
    const difference = billed - gross(accepted, award.unitRatePaise);
    const amount = difference > BigInt(0) ? difference : BigInt(0);
    discrepancy = assertMaximum(discrepancy + amount, MAX_SIGNED_BIGINT, 'Discrepancy total');
    return { ...award, ...item, acceptedQuantity: formatScaledDecimal(accepted, 3), pendingQuantity: formatScaledDecimal(pending, 3), missingQuantity: formatScaledDecimal(missing, 3), missingValuePaise: gross(missing, award.unitRatePaise).toString(), rejectedValuePaise: gross(rejected, award.unitRatePaise).toString(), discrepancyPaise: amount.toString() };
  });
  return { itemDetails, deliveryComplete: itemDetails.every(i => i.pendingQuantity === '0'), discrepancyPaise: discrepancy.toString(), creditRemainingPaise: (receivingNumber(details.creditClaimedPaise, 0) - receivingNumber(details.creditReceivedPaise, 0)).toString() };
}
