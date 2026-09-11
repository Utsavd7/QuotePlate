import { normalizeUnit, parseQuantityToMilli, type ProcurementUnit } from '@/lib/domain/quantity';
import { parseInrToPaise } from '@/lib/domain/money';
import { receivingNumber } from '@/lib/receiving/receiving-details';

export const INTAKE_TEXT_LIMIT = 12_000;
export const INTAKE_LINE_LIMIT = 100;
export const intakeUnits: ProcurementUnit[] = ['KILOGRAM', 'GRAM', 'LITRE', 'MILLILITRE', 'PIECE', 'PACK', 'CASE', 'CRATE'];
export type ShoppingFields = { name: string; quantity: string; unit: ProcurementUnit | '' };
export type IntakeRow = ShoppingFields & { source: string; rate: string; issues: string[] };
export type AwardedIntakeItem = { requestItemId: string; itemName: string; unit: string };

function lines(text: string) {
  if (text.length > INTAKE_TEXT_LIMIT) throw new Error('Use at most 12,000 characters at a time.');
  const result = text.split(/\r\n|[\n\r\u2028\u2029]/).map(line => line.trim()).filter(Boolean);
  if (result.length > INTAKE_LINE_LIMIT) throw new Error('Use at most 100 nonempty lines at a time.');
  return result;
}

// Deliberately narrow grammar: do not turn fractions, grouping separators,
// ranges, pack descriptions or a second item into an asserted quantity.
function shoppingLine(source: string): IntakeRow {
  const text = source.replace(/^[•*]\s+/, '').trim();
  const number = '(\\d+(?:\\.\\d+)?)';
  const after = new RegExp(`^([^\\d@;,/]+?)\\s+${number}\\s+([a-z]+)$`, 'i').exec(text);
  const before = new RegExp(`^${number}\\s+([a-z]+)\\s+([^\\d@;,/]+)$`, 'i').exec(text);
  const name = (after?.[1] ?? before?.[3] ?? '').trim();
  const rawUnit = after?.[3] ?? before?.[2];
  if (name && /[a-z]/i.test(name) && !/[-+:]$/.test(name) && !/\b(and|or)\b/i.test(name) && rawUnit) {
    try {
      const unit = normalizeUnit(rawUnit);
      return { name, quantity: after?.[2] ?? before![1], unit, rate: '', source, issues: [] };
    } catch { /* Preserve the complete uncertain line for manual correction. */ }
  }
  return { name: text, quantity: '', unit: '', rate: '', source, issues: ['Quantity, unit or item boundary is unclear. Correct this row before checking it.'] };
}

export function shoppingRowErrors(row: ShoppingFields): string[] {
  const errors: string[] = [];
  if (!row.name.trim() || new TextEncoder().encode(row.name.trim()).length > 160 || /[\u0000-\u001f\u007f]/.test(row.name)) errors.push('Enter an item name of at most 160 bytes.');
  if (!intakeUnits.includes(row.unit as ProcurementUnit)) errors.push('Choose the unit shown in the source.');
  try { parseQuantityToMilli(row.quantity); } catch { errors.push('Enter a positive quantity with at most three decimal places.'); }
  return errors;
}

export function parseShoppingList(text: string): IntakeRow[] {
  return lines(text).map(source => {
    const row = shoppingLine(source);
    return { ...row, issues: [...row.issues, ...shoppingRowErrors(row)] };
  });
}

export function invoiceRowErrors(row: ShoppingFields & { rate: string }): string[] {
  const errors = shoppingRowErrors({ ...row, quantity: '1' });
  try { receivingNumber(row.quantity); } catch { errors.push('Enter a billed quantity with at most three decimal places.'); }
  try { parseInrToPaise(row.rate); } catch { errors.push('Enter the billed unit rate in rupees with at most two decimal places.'); }
  return errors;
}

export function parseInvoice(text: string): IntakeRow[] {
  return lines(text).map(source => {
    const rate = /^(.*?)\s+(?:@|rate\s*:?|unit\s+rate\s*:?)\s*(?:₹|INR\s*|Rs\.?\s*)?(\d+(?:\.\d+)?)$/i.exec(source);
    const row = shoppingLine(rate?.[1] ?? source);
    row.source = source;
    row.rate = rate?.[2] ?? '';
    if (!rate) row.issues.push('No explicit unit rate found. Copy the unit rate from the invoice; totals and tax are not unit rates.');
    row.issues.push(...invoiceRowErrors(row));
    return row;
  });
}

export function invoiceMatch(row: ShoppingFields, awarded: readonly AwardedIntakeItem[]) {
  const key = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = awarded.filter(item => key(item.itemName) === key(row.name) && item.unit === row.unit);
  return matches.length === 1
    ? { item: matches[0], issues: [] as string[] }
    : { item: null, issues: [matches.length > 1 ? 'More than one awarded item has this name and unit. Enter billing manually in the receiving form.' : 'No exact awarded name and unit match. Correct the row using the invoice; units are never converted.'] };
}
