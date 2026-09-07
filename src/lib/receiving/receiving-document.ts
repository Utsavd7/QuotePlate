import { calculateReceivingDetails, validateReceivingDetails, RECEIVING_JSON_BYTES, type ReceivingDetails, type ReceivingAwardItem, type ReceivingCalculatedDetails } from './receiving-details';
import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import { assertBoundedJson } from '@/lib/domain/postgres-json';
import { MAX_SIGNED_BIGINT, parseUnsignedFixed } from '@/lib/domain/validation';

export const RECEIVING_ISSUE_CODES = [
  'LATE',
  'MISSING_QUANTITY',
  'WRONG_ITEM',
  'QUALITY',
  'PRICE_DIFFERENCE',
  'OTHER',
] as const;

export type ReceivingIssueCode = (typeof RECEIVING_ISSUE_CODES)[number];
export type ReceivingOutcome = 'MATCHED' | 'ISSUES';

export type ReceivingSupplierCheckV1 = {
  supplierId: string;
  outcome: ReceivingOutcome;
  invoiceTotalPaise: string;
  issueCodes: ReceivingIssueCode[];
  note: string | null;
  checkedAt: string;
  details?: ReceivingDetails;
};

export type AwardReceivingV1 = {
  v: 1;
  suppliers: ReceivingSupplierCheckV1[];
};

export type ReceivingSummary = {
  checkedCount: number;
  totalCount: number;
  complete: boolean;
  problemCount: number;
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    deliveryDate: string;
    expectedTotalPaise: string;
    items?: ReceivingAwardItem[];
    check: (ReceivingSupplierCheckV1 & Partial<ReceivingCalculatedDetails> & {
      differencePaise: string;
      hasProblem: boolean;
    }) | null;
  }>;
};

export type ValidReceivingInput = Omit<ReceivingSupplierCheckV1, 'checkedAt'> & {
  expectedCheckedAt: string | null;
};

export class ReceivingValidationError extends Error {
  readonly code = 'INVALID_DELIVERY_CHECK';
  readonly status = 422;

  constructor() {
    super('Check the invoice total and delivery details.');
    this.name = 'ReceivingValidationError';
  }
}

export class ReceivingStorageCorruptionError extends Error {
  readonly code = 'RECEIVING_STORAGE_CORRUPTION';
  readonly status = 503;

  constructor() {
    super('Stored delivery checks are not valid.');
    this.name = 'ReceivingStorageCorruptionError';
  }
}

const INPUT_KEYS = new Set([
  'supplierId',
  'outcome',
  'invoiceTotalPaise',
  'issueCodes',
  'note',
  'expectedCheckedAt',
]);
const STORED_KEYS = new Set([
  'supplierId',
  'outcome',
  'invoiceTotalPaise',
  'issueCodes',
  'note',
  'checkedAt',
]);
const DOCUMENT_KEYS = new Set(['v', 'suppliers']);
const ISSUE_CODES = new Set<string>(RECEIVING_ISSUE_CODES);

function isExactRecord(value: unknown, keys: ReadonlySet<string>) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) return false;
  return ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor?.enumerable && 'value' in descriptor);
  });
}

function isDenseArray(value: unknown, maximum: number): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum
  ) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  return value.every((_item, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    return Boolean(descriptor?.enumerable && 'value' in descriptor);
  });
}

function validId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validNote(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 500 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function canonicalPaise(value: unknown, allowZero = false) {
  if (typeof value !== 'string' || value.length > 19) return null;
  try {
    return parseUnsignedFixed(value as never, {
      label: 'Invoice total',
      scale: 0,
      maximumScaled: MAX_SIGNED_BIGINT,
      allowZero,
    }).toString();
  } catch {
    return null;
  }
}

function validIssueCodes(value: unknown): value is ReceivingIssueCode[] {
  return isDenseArray(value, RECEIVING_ISSUE_CODES.length) &&
    new Set(value).size === value.length &&
    value.every((code) => typeof code === 'string' && ISSUE_CODES.has(code));
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function checkKeys(value: unknown, stored: boolean) {
  const keys = new Set(stored ? STORED_KEYS : INPUT_KEYS);
  if (value && typeof value === 'object' && Object.hasOwn(value, 'details')) keys.add('details');
  return isExactRecord(value, keys);
}

function parseCheck(
  value: unknown,
  stored: boolean,
): ReceivingSupplierCheckV1 | null {
  if (!checkKeys(value, stored)) return null;
  const record = value as Record<string, unknown>;
  const invoiceTotalPaise = canonicalPaise(record.invoiceTotalPaise, Object.hasOwn(record, 'details'));
  if (
    !validId(record.supplierId) ||
    (record.outcome !== 'MATCHED' && record.outcome !== 'ISSUES') ||
    !invoiceTotalPaise ||
    !validIssueCodes(record.issueCodes) ||
    !validNote(record.note) ||
    (record.outcome === 'MATCHED' && record.issueCodes.length !== 0) ||
    (record.outcome === 'ISSUES' && record.issueCodes.length === 0)
  ) return null;
  const checkedAt = stored ? record.checkedAt : '';
  if (stored && !validTimestamp(checkedAt)) return null;
  let details: ReceivingDetails | undefined;
  try { if (Object.hasOwn(record, 'details')) details = validateReceivingDetails(record.details); } catch { return null; }
  return {
    ...(details ? { details } : {}),
    supplierId: record.supplierId,
    outcome: record.outcome,
    invoiceTotalPaise,
    issueCodes: [...record.issueCodes],
    note: record.note,
    checkedAt: checkedAt as string,
  };
}

export function validateReceivingInput(value: unknown): ValidReceivingInput {
  if (!checkKeys(value, false)) throw new ReceivingValidationError();
  const record = value as Record<string, unknown>;
  const expectedCheckedAt = record.expectedCheckedAt;
  if (expectedCheckedAt !== null && !validTimestamp(expectedCheckedAt)) {
    throw new ReceivingValidationError();
  }
  const parsed = parseCheck({
    ...(Object.hasOwn(record, 'details') ? { details: record.details } : {}),
    supplierId: record.supplierId,
    outcome: record.outcome,
    invoiceTotalPaise: record.invoiceTotalPaise,
    issueCodes: record.issueCodes,
    note: record.note,
    expectedCheckedAt,
  }, false);
  if (!parsed) throw new ReceivingValidationError();
  const input: ValidReceivingInput = {
    ...(parsed.details ? { details: parsed.details } : {}),
    supplierId: parsed.supplierId,
    outcome: parsed.outcome,
    invoiceTotalPaise: parsed.invoiceTotalPaise,
    issueCodes: parsed.issueCodes,
    note: parsed.note,
    expectedCheckedAt,
  };
  try {
    assertBoundedJson(input, RECEIVING_JSON_BYTES, 'Delivery check');
  } catch {
    throw new ReceivingValidationError();
  }
  return input;
}

export function validateStoredReceiving(value: unknown): AwardReceivingV1 {
  if (value === null || value === undefined) return { v: 1, suppliers: [] };
  try {
    assertBoundedJson(value, RECEIVING_JSON_BYTES, 'Delivery checks');
  } catch {
    throw new ReceivingStorageCorruptionError();
  }
  if (!isExactRecord(value, DOCUMENT_KEYS)) {
    throw new ReceivingStorageCorruptionError();
  }
  const record = value as Record<string, unknown>;
  if (
    record.v !== 1 ||
    !isDenseArray(record.suppliers, DOCUMENT_LIMITS.awardReceiving.suppliers)
  ) throw new ReceivingStorageCorruptionError();
  const suppliers = record.suppliers.map((entry) => parseCheck(entry, true));
  if (
    suppliers.some((entry) => !entry) ||
    new Set(suppliers.map((entry) => entry!.supplierId)).size !== suppliers.length
  ) throw new ReceivingStorageCorruptionError();
  return { v: 1, suppliers: suppliers as ReceivingSupplierCheckV1[] };
}

export function buildReceivingSummary(input: {
  allocationLines: {
    v: 1;
    lines: Array<{ supplierId: string; totalPaise: string; requestItemId?: string; quantity?: string; unit?: string; unitRatePaise?: string; gstBasisPoints?: number }>;
  };
  supplierSnapshots: {
    v: 1;
    suppliers: Array<{
      supplierId: string;
      supplierName: string;
      freightPaise: string;
      deliveryDate: string;
      lines?: Array<{ requestItemId: string; itemKey?: string; itemName: string; taxInclusive: boolean }>;
    }>;
  };
  receiving: AwardReceivingV1;
}): ReceivingSummary {
  const checkBySupplier = new Map(
    input.receiving.suppliers.map((check) => [check.supplierId, check]),
  );
  const suppliers = input.supplierSnapshots.suppliers.map((supplier) => {
    let expectedTotal = BigInt(supplier.freightPaise);
    for (const line of input.allocationLines.lines) {
      if (line.supplierId === supplier.supplierId) {
        expectedTotal += BigInt(line.totalPaise);
      }
    }
    const items: ReceivingAwardItem[] = input.allocationLines.lines.filter(line => line.supplierId === supplier.supplierId && line.requestItemId && line.quantity && line.unitRatePaise && line.unit).map(line => ({
      requestItemId: line.requestItemId!, itemKey: supplier.lines?.find(i => i.requestItemId === line.requestItemId)?.itemKey ?? line.requestItemId!, itemName: supplier.lines?.find(i => i.requestItemId === line.requestItemId)?.itemName ?? line.requestItemId!,
      orderedQuantity: line.quantity!, unit: line.unit!, unitRatePaise: line.unitRatePaise!, gstBasisPoints: line.gstBasisPoints ?? 0,
      taxInclusive: supplier.lines?.find(i => i.requestItemId === line.requestItemId)?.taxInclusive ?? false,
    }));
    const itemFields = items.length ? { items } : {};
    const saved = checkBySupplier.get(supplier.supplierId);
    let calculated: ReceivingCalculatedDetails | undefined;
    try { if (saved?.details) calculated = calculateReceivingDetails(items, saved.details); } catch { throw new ReceivingStorageCorruptionError(); }
    if (!saved) {
      return {
        ...itemFields,
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        deliveryDate: supplier.deliveryDate,
        expectedTotalPaise: expectedTotal.toString(),
        check: null,
      };
    }
    const difference = BigInt(saved.invoiceTotalPaise) - expectedTotal;
    return {
      ...itemFields,
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
      deliveryDate: supplier.deliveryDate,
      expectedTotalPaise: expectedTotal.toString(),
      check: {
        ...saved,
        ...(calculated ?? {}),
        differencePaise: difference.toString(),
        hasProblem: saved.outcome === 'ISSUES' || difference !== BigInt(0) || Boolean(calculated && (!calculated.deliveryComplete || calculated.discrepancyPaise !== '0' || calculated.creditRemainingPaise !== '0')),
      },
    };
  });
  const checkedCount = suppliers.filter((supplier) => supplier.check).length;
  return {
    checkedCount,
    totalCount: suppliers.length,
    complete: suppliers.length > 0 && checkedCount === suppliers.length && suppliers.every(s => s.check?.deliveryComplete !== false),
    problemCount: suppliers.filter((supplier) => supplier.check?.hasProblem).length,
    suppliers,
  };
}
