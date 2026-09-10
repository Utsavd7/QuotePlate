import { parseInrToPaise } from '../domain/money';
import { normalizeUnit, type ProcurementUnit } from '../domain/quantity';

export const MAX_PRICE_LIST_TEXT_LENGTH = 12_000;
export const MAX_PRICE_LIST_LINES = 100;

export type PriceListItem = { id: string; name: string; unit: ProcurementUnit };
export type PriceListSuggestion = {
  id: string;
  sourceText: string;
  name: string;
  rateInr: string;
  unit: ProcurementUnit | null;
  requestItemId: string | null;
};

// These rows describe a document, quantity, or commercial terms, not a unit rate.
const NON_PRICE_WORDS = /\b(?:price|prices|rate|rates|mrp|total|subtotal|gst|tax|vat|qty|quantity|discount|inclusive|exclusive|phone|mobile|contact|whatsapp|tel|telephone|date|dated|updated|invoice|account|ifsc|hsn|sku|code|pin|pincode)\b/i;
const PRICE = /^((?:₹|INR|Rs\.?)\s*)?(\d[\d,.]*)(?:\s*(?:\/|per\s+)\s*([a-z]+)|\s+([a-z]+))?$/i;
const INDIAN_GROUPED_AMOUNT = /^(?:[1-9]\d{0,2},\d{3}|[1-9]\d?(?:,\d{2})+,\d{3})(?:\.\d{1,2})?$/;

function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

function unitLikeSuffix(value: string): boolean {
  try { normalizeUnit(value); return true; } catch {
    return /^(?:box(?:es)?|bags?|sacks?|dozens?|bottles?|bundles?|cartons?|packets?|pkts?|gm|ltr|tons?|tonnes?|quintals?)$/i.test(value);
  }
}

// null means an ordinary row; true means subsequent amounts cannot be treated
// as unit prices until another explicit, simple price header appears.
function ambiguousHeader(sourceText: string): boolean | null {
  const key = nameKey(sourceText);
  if (/\d/.test(sourceText) || !/^(?:items?|ingredients?|products?|name|description|particulars)\b/.test(key) ||
    !/\b(?:price|rate|qty|quantity|gst|tax|vat|total|amount|discount)\b/.test(key)) return null;
  return !/^(?:items?|ingredients?|products?|name|description|particulars) (?:(?:unit|uom) )?(?:price|rate)(?: (?:inr|rs))?(?: (?:unit|uom))?$/.test(key);
}

function splitRow(sourceText: string): { name: string; price: string; unit?: string } | null {
  if (/[|\t]/.test(sourceText)) {
    const cells = sourceText.split(/[|\t]/).map((cell) => cell.trim());
    if (cells.some((cell) => !cell)) return null;
    if (cells.length === 2) return { name: cells[0], price: cells[1] };
    if (cells.length === 3) {
      return /\d/.test(cells[1])
        ? { name: cells[0], price: cells[1], unit: cells[2] }
        : { name: cells[0], price: cells[2], unit: cells[1] };
    }
    return null;
  }
  const match = /^(.+?)\s+((?:(?:₹|INR|Rs\.?)\s*)?[+\-−]?(?:\d|\.\d).*)$/i.exec(sourceText);
  if (!match) return null;
  const markedUnit = /^(.*?)\s*(?:\(([^()]+)\)|\s+per\s+(\S+))$/i.exec(match[1]);
  if (markedUnit) return { name: markedUnit[1], price: match[2], unit: markedUnit[2] ?? markedUnit[3] };
  const suffix = /^(.+?)\s+(\S+)$/.exec(match[1]);
  if (suffix && unitLikeSuffix(suffix[2])) return { name: suffix[1], price: match[2], unit: suffix[2] };
  return { name: match[1], price: match[2] };
}

function readRow(sourceText: string): Omit<PriceListSuggestion, 'id' | 'requestItemId'> | null {
  // A second numeric token might be a quantity, tax, range, phone, or another rate.
  if (NON_PRICE_WORDS.test(sourceText) || (sourceText.match(/\d[\d,.]*/g) ?? []).length !== 1) return null;
  const row = splitRow(sourceText);
  if (!row) return null;
  const name = row.name.replace(/:\s*$/, '').trim();
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’(),&-]*$/u.test(name) || /-\s*$/.test(name)) return null;
  const price = PRICE.exec(row.price);
  if (!price) return null;
  const explicitUnit = price[3] ?? price[4];
  // Even repeated unit columns are ambiguous: do not choose one.
  if (row.unit && explicitUnit) return null;
  let unit: ProcurementUnit | null = null;
  try {
    if (row.unit || explicitUnit) unit = normalizeUnit(row.unit ?? explicitUnit);
  } catch {
    return null;
  }
  const amount = price[2];
  if (amount.includes(',') && !INDIAN_GROUPED_AMOUNT.test(amount)) return null;
  // Unqualified long integers are commonly telephone numbers or compact dates.
  if (!price[1] && !unit && /^\d{7,12}$/.test(amount)) return null;
  const rateInr = amount.replace(/,/g, '');
  // Bound bigint work before delegating decimal syntax and the money limit.
  if (rateInr.length > 20) return null;
  try {
    parseInrToPaise(rateInr);
  } catch {
    return null;
  }
  return { sourceText, name, rateInr, unit };
}

/**
 * Extract review candidates only; no rates or units are inferred or converted.
 * Missing units stay null. Exact names may link to one request item; mismatches
 * and duplicates stay unresolved. Over-limit input is rejected as a whole so
 * truncation can never hide a duplicate row or turn part of an amount into a price.
 */
export function parsePriceList(
  text: string,
  items: readonly PriceListItem[],
): { suggestions: PriceListSuggestion[]; unresolved: string[] } {
  if (text.length > MAX_PRICE_LIST_TEXT_LENGTH) {
    return { suggestions: [], unresolved: ['Use at most 12,000 characters; split the price list into smaller parts.'] };
  }
  const lines = text.split(/\r\n|[\n\r\u2028\u2029]/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_PRICE_LIST_LINES) {
    return { suggestions: [], unresolved: ['Use at most 100 nonempty lines; split the price list into smaller parts.'] };
  }
  const itemsByName = new Map<string, PriceListItem[]>();
  for (const item of items) {
    const key = nameKey(item.name);
    const matches = itemsByName.get(key);
    if (matches) matches.push(item);
    else itemsByName.set(key, [item]);
  }
  let ambiguousColumns = false;
  const rows = lines.map((sourceText) => {
    ambiguousColumns = ambiguousHeader(sourceText) ?? ambiguousColumns;
    const parsed = ambiguousColumns ? null : readRow(sourceText);
    // Include recognizable names from invalid rows in duplicate detection too.
    const rawName = parsed?.name ?? splitRow(sourceText)?.name ?? sourceText.split(/[|\t]/)[0];
    return { sourceText, parsed, key: nameKey(rawName) };
  });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);

  const suggestions: PriceListSuggestion[] = [];
  const unresolved: string[] = [];
  for (const [index, row] of rows.entries()) {
    const matches = itemsByName.get(row.key) ?? [];
    const match = matches[0];
    if (!row.parsed || counts.get(row.key)! > 1 || matches.length > 1 ||
      (match && row.parsed.unit !== null && match.unit !== row.parsed.unit)) {
      unresolved.push(row.sourceText);
      continue;
    }
    suggestions.push({ ...row.parsed, id: `price-list-${index + 1}`, requestItemId: match?.id ?? null });
  }
  return { suggestions, unresolved };
}
