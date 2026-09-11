import { Prisma } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  type TenantTransactionHost,
  withTenant,
} from '@/lib/db/tenant-transaction';
import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import { validateMenuDocument } from '@/lib/menu/menu-document';
import { prisma } from '@/lib/prisma';
import {
  collectExplicitSupplierIds,
  type ExplicitRequestSupplier,
  type RequestItemsV1,
  type RequestSourcingV1,
  RequestDocumentValidationError,
  requestAcceptsVerifiedApplications,
  resolveItemSourcing,
  type SourcingSelectionV1,
  validateExplicitRequestSuppliers,
  validateRequestDocuments,
  validateRequestItems,
  validateRequestSourcing,
} from '@/lib/procurement/request-document';
import {
  createOpaqueToken,
  digestOpaqueToken,
  type TokenPurpose,
} from '@/lib/security/tokens';
import {
  SupplierValidationError,
  validateSupplierLifecycleState,
} from '@/lib/suppliers/supplier-schema';

export const PROCUREMENT_REQUEST_BODY_BYTES =
  DOCUMENT_LIMITS.requestItems.jsonBytes +
  DOCUMENT_LIMITS.requestSourcing.jsonBytes +
  64 * 1_024;

export const PROCUREMENT_REQUEST_LIMITS = {
  idBytes: 200,
  titleBytes: 160,
  addressBytes: 400,
  placeBytes: 120,
  instructionsBytes: 1_000,
  termsBytes: 2_000,
  suppliers: DOCUMENT_LIMITS.selectedSuppliers,
  ingredients: DOCUMENT_LIMITS.requestItems.items,
  listPage: 50,
} as const;

type ValidationErrors = Record<string, string[]>;

export class ProcurementRequestValidationError extends Error {
  readonly code = 'INVALID_PROCUREMENT_REQUEST';
  readonly status = 422;

  constructor(readonly errors: ValidationErrors) {
    super('The procurement request contains invalid or unbounded fields.');
    this.name = 'ProcurementRequestValidationError';
  }
}

export class ProcurementRequestNotFoundError extends Error {
  readonly code = 'PROCUREMENT_REQUEST_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Procurement request not found.');
    this.name = 'ProcurementRequestNotFoundError';
  }
}

export class ProcurementRequestConflictError extends Error {
  readonly code = 'PROCUREMENT_REQUEST_CONFLICT';
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ProcurementRequestConflictError';
  }
}

type DeliveryDetails = {
  addressLine: string;
  city: string;
  state: string;
  pin: string;
  instructions?: string;
};

export type ValidProcurementRequestDraft = {
  title: string;
  menuId: string | null;
  selectedItemIds: string[];
  additionalItems?: RequestItemsV1;
  defaultSourcing: SourcingSelectionV1;
  sourcingOverrides: Record<string, SourcingSelectionV1>;
  deliveryDetails: DeliveryDetails;
  deliveryDate: Date;
  quoteDeadline: Date;
  commercialTerms: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function addError(errors: ValidationErrors, path: string, message: string) {
  (errors[path] ??= []).push(message);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  errors: ValidationErrors,
  path = '',
) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      addError(errors, path ? `${path}.${String(key)}` : String(key), 'This field is not allowed.');
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      addError(errors, path ? `${path}.${key}` : key, 'This field must be an enumerable data property.');
    }
  }
}

function boundedText(
  value: unknown,
  path: string,
  maximumBytes: number,
  errors: ValidationErrors,
  options: { nullable?: boolean } = {},
): string | null {
  if (options.nullable && (value === null || value === undefined || value === '')) {
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    addError(errors, path, 'This field is required.');
    return '';
  }
  const normalized = value.trim();
  if (byteLength(normalized) > maximumBytes) {
    addError(errors, path, `This field must not exceed ${maximumBytes} bytes.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    addError(errors, path, 'This field contains unsupported control characters.');
  }
  return normalized;
}

function boundedId(value: unknown, path: string, errors: ValidationErrors) {
  return boundedText(value, path, PROCUREMENT_REQUEST_LIMITS.idBytes, errors) ?? '';
}

function uniqueIds(
  value: unknown,
  path: string,
  maximum: number,
  errors: ValidationErrors,
) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    addError(errors, path, `Select between 1 and ${maximum} entries.`);
    return [];
  }
  const ids = value.map((item, index) => boundedId(item, `${path}.${index}`, errors));
  if (new Set(ids).size !== ids.length) {
    addError(errors, path, 'Duplicate entries are not allowed.');
  }
  return ids;
}

function parseDeliveryDetails(value: unknown, errors: ValidationErrors) {
  if (!isRecord(value)) {
    addError(errors, 'deliveryDetails', 'Delivery details are required.');
    return { addressLine: '', city: '', state: '', pin: '' };
  }
  rejectUnknownKeys(
    value,
    ['addressLine', 'city', 'state', 'pin', 'instructions'],
    errors,
    'deliveryDetails',
  );
  const addressLine = boundedText(
    value.addressLine,
    'deliveryDetails.addressLine',
    PROCUREMENT_REQUEST_LIMITS.addressBytes,
    errors,
  ) ?? '';
  const city = boundedText(
    value.city,
    'deliveryDetails.city',
    PROCUREMENT_REQUEST_LIMITS.placeBytes,
    errors,
  ) ?? '';
  const state = boundedText(
    value.state,
    'deliveryDetails.state',
    PROCUREMENT_REQUEST_LIMITS.placeBytes,
    errors,
  ) ?? '';
  const pin = boundedText(value.pin, 'deliveryDetails.pin', 6, errors) ?? '';
  if (pin && !/^[1-9][0-9]{5}$/.test(pin)) {
    addError(errors, 'deliveryDetails.pin', 'Enter a valid six-digit Indian PIN.');
  }
  const instructions = boundedText(
    value.instructions,
    'deliveryDetails.instructions',
    PROCUREMENT_REQUEST_LIMITS.instructionsBytes,
    errors,
    { nullable: true },
  );
  return {
    addressLine,
    city,
    state,
    pin,
    ...(instructions ? { instructions } : {}),
  };
}

function parseDeliveryDate(value: unknown, errors: ValidationErrors) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    addError(errors, 'deliveryDate', 'Use a valid India delivery date in YYYY-MM-DD format.');
    return new Date(Number.NaN);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    addError(errors, 'deliveryDate', 'Use a valid India delivery date in YYYY-MM-DD format.');
  }
  return date;
}

function parseQuoteDeadline(value: unknown, now: Date, errors: ValidationErrors) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    addError(errors, 'quoteDeadline', 'Use an ISO timestamp with an explicit timezone.');
    return new Date(Number.NaN);
  }
  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) {
    addError(errors, 'quoteDeadline', 'Use a valid quote deadline.');
  } else if (deadline.getTime() <= now.getTime()) {
    addError(errors, 'quoteDeadline', 'Quote deadline must be in the future.');
  }
  return deadline;
}

function validateDeadlineBeforeIndiaDelivery(
  deadline: Date,
  deliveryDate: Date,
  errors: ValidationErrors,
) {
  if (Number.isNaN(deadline.getTime()) || Number.isNaN(deliveryDate.getTime())) return;
  const indiaDeliveryStart = deliveryDate.getTime() - 330 * 60 * 1_000;
  if (deadline.getTime() >= indiaDeliveryStart) {
    addError(errors, 'quoteDeadline', 'Quote deadline must be before the India delivery date.');
  }
}

function throwIfInvalid(errors: ValidationErrors) {
  if (Object.keys(errors).length > 0) {
    throw new ProcurementRequestValidationError(errors);
  }
}

function parseSourcingSelection(
  value: unknown,
  path: string,
  errors: ValidationErrors,
) {
  try {
    return validateRequestSourcing({ v: 1, default: value }).default;
  } catch (error) {
    if (!(error instanceof RequestDocumentValidationError)) throw error;
    addError(errors, path, error.message);
    return {
      v: 1,
      modes: ['VERIFIED_NEW'],
      currentSupplierIds: [],
      selectedNewSupplierIds: [],
      acceptVerifiedApplications: true,
    } satisfies SourcingSelectionV1;
  }
}

function parseSourcingOverrides(
  value: unknown,
  selectedItemIds: string[],
  errors: ValidationErrors,
) {
  if (!isRecord(value)) {
    addError(errors, 'sourcingOverrides', 'Provide sourcing overrides keyed by selected item ID.');
    return {};
  }
  const selected = new Set(selectedItemIds);
  const result: Record<string, SourcingSelectionV1> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !selected.has(key)) {
      addError(errors, `sourcingOverrides.${String(key)}`, 'Only selected item IDs may have sourcing overrides.');
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      addError(errors, `sourcingOverrides.${key}`, 'This override must be an enumerable data property.');
      continue;
    }
    result[key] = parseSourcingSelection(
      descriptor.value,
      `sourcingOverrides.${key}`,
      errors,
    );
  }
  return result;
}

export function validateProcurementRequestDraftInput(
  input: unknown,
  now = new Date(),
): ValidProcurementRequestDraft {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({
      request: ['Provide a procurement request object.'],
    });
  }
  rejectUnknownKeys(
    input,
    [
      'title',
      'menuId',
      'selectedItemIds',
      'additionalItems',
      'defaultSourcing',
      'sourcingOverrides',
      'deliveryDetails',
      'deliveryDate',
      'quoteDeadline',
      'commercialTerms',
    ],
    errors,
  );
  const title = boundedText(
    input.title,
    'title',
    PROCUREMENT_REQUEST_LIMITS.titleBytes,
    errors,
  ) ?? '';
  const menuId = input.menuId === undefined || input.menuId === null
    ? null : boundedId(input.menuId, 'menuId', errors);
  let additionalItems: RequestItemsV1 | undefined;
  if (Object.hasOwn(input, 'additionalItems')) {
    try { additionalItems = validateRequestItems(input.additionalItems); }
    catch (error) {
      if (!(error instanceof RequestDocumentValidationError)) throw error;
      addError(errors, 'additionalItems', error.message);
    }
  }
  const rawSelected = input.selectedItemIds ?? (menuId === null ? [] : undefined);
  const selectedItemIds = Array.isArray(rawSelected) && rawSelected.length === 0
    ? [] : uniqueIds(
    rawSelected,
    'selectedItemIds',
    DOCUMENT_LIMITS.requestItems.items,
    errors,
  );
  if (menuId === null && selectedItemIds.length) addError(errors, 'menuId', 'Choose an approved menu for the selected menu items.');
  const combinedIds = [...selectedItemIds, ...(additionalItems?.items.map(item => item.id) ?? [])];
  if (!combinedIds.length || combinedIds.length > DOCUMENT_LIMITS.requestItems.items) addError(errors, 'additionalItems', `Choose between 1 and ${DOCUMENT_LIMITS.requestItems.items} total items.`);
  if (new Set(combinedIds).size !== combinedIds.length) addError(errors, 'additionalItems', 'Menu and additional item IDs must be unique.');
  const defaultSourcing = parseSourcingSelection(
    input.defaultSourcing,
    'defaultSourcing',
    errors,
  );
  const sourcingOverrides = parseSourcingOverrides(
    input.sourcingOverrides,
    selectedItemIds,
    errors,
  );
  const deliveryDetails = parseDeliveryDetails(input.deliveryDetails, errors);
  const deliveryDate = parseDeliveryDate(input.deliveryDate, errors);
  const quoteDeadline = parseQuoteDeadline(input.quoteDeadline, now, errors);
  validateDeadlineBeforeIndiaDelivery(quoteDeadline, deliveryDate, errors);
  const commercialTerms = boundedText(
    input.commercialTerms,
    'commercialTerms',
    PROCUREMENT_REQUEST_LIMITS.termsBytes,
    errors,
    { nullable: true },
  );
  throwIfInvalid(errors);
  return {
    title,
    menuId,
    selectedItemIds,
    ...(additionalItems ? { additionalItems } : {}),
    defaultSourcing,
    sourcingOverrides,
    deliveryDetails,
    deliveryDate,
    quoteDeadline,
    commercialTerms,
  };
}

export type ValidDraftPatch = Partial<{
  title: string;
  items: RequestItemsV1;
  sourcing: RequestSourcingV1;
  deliveryDetails: DeliveryDetails;
  deliveryDate: Date;
  quoteDeadline: Date;
  commercialTerms: string | null;
}>;

export function validateDraftPatchInput(input: unknown, now = new Date()): ValidDraftPatch {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({ patch: ['Provide an update object.'] });
  }
  const allowed = [
    'title',
    'items',
    'sourcing',
    'deliveryDetails',
    'deliveryDate',
    'quoteDeadline',
    'commercialTerms',
  ];
  rejectUnknownKeys(input, allowed, errors);
  if (Object.keys(input).length === 0) addError(errors, 'patch', 'Provide at least one change.');
  const patch: ValidDraftPatch = {};
  if (Object.hasOwn(input, 'title')) {
    patch.title = boundedText(
      input.title,
      'title',
      PROCUREMENT_REQUEST_LIMITS.titleBytes,
      errors,
    ) ?? '';
  }
  if (Object.hasOwn(input, 'items')) {
    try {
      patch.items = validateRequestItems(input.items);
    } catch (error) {
      if (!(error instanceof RequestDocumentValidationError)) throw error;
      addError(errors, 'items', error.message);
    }
  }
  if (Object.hasOwn(input, 'sourcing')) {
    try {
      patch.sourcing = validateRequestSourcing(input.sourcing);
    } catch (error) {
      if (!(error instanceof RequestDocumentValidationError)) throw error;
      addError(errors, 'sourcing', error.message);
    }
  }
  if (Object.hasOwn(input, 'deliveryDetails')) {
    patch.deliveryDetails = parseDeliveryDetails(input.deliveryDetails, errors);
  }
  if (Object.hasOwn(input, 'deliveryDate')) {
    patch.deliveryDate = parseDeliveryDate(input.deliveryDate, errors);
  }
  if (Object.hasOwn(input, 'quoteDeadline')) {
    patch.quoteDeadline = parseQuoteDeadline(input.quoteDeadline, now, errors);
  }
  if (Object.hasOwn(input, 'commercialTerms')) {
    patch.commercialTerms = boundedText(
      input.commercialTerms,
      'commercialTerms',
      PROCUREMENT_REQUEST_LIMITS.termsBytes,
      errors,
      { nullable: true },
    );
  }
  if (patch.deliveryDate && patch.quoteDeadline) {
    validateDeadlineBeforeIndiaDelivery(patch.quoteDeadline, patch.deliveryDate, errors);
  }
  throwIfInvalid(errors);
  return patch;
}

export function validateExpectedVersion(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    throw new ProcurementRequestValidationError({
      expectedVersion: ['Expected version must be a positive integer.'],
    });
  }
  return Number(value);
}

export function validateOpenRequestInput(input: unknown) {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({
      request: ['Provide an open request object.'],
    });
  }
  rejectUnknownKeys(input, ['expectedVersion'], errors);
  let expectedVersion = 0;
  try {
    expectedVersion = validateExpectedVersion(input.expectedVersion);
  } catch (error) {
    if (error instanceof ProcurementRequestValidationError) {
      Object.assign(errors, error.errors);
    } else throw error;
  }
  throwIfInvalid(errors);
  return { expectedVersion };
}

export function validateLinkActionInput(input: unknown) {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({ action: ['Provide a link action.'] });
  }
  rejectUnknownKeys(input, ['action', 'supplierRequestId', 'expectedVersion'], errors);
  const action = input.action === 'rotate' || input.action === 'revoke' ? input.action : null;
  if (!action) addError(errors, 'action', 'Choose rotate or revoke.');
  const supplierRequestId = boundedId(input.supplierRequestId, 'supplierRequestId', errors);
  let expectedVersion = 0;
  try {
    expectedVersion = validateExpectedVersion(input.expectedVersion);
  } catch (error) {
    if (error instanceof ProcurementRequestValidationError) {
      Object.assign(errors, error.errors);
    } else throw error;
  }
  throwIfInvalid(errors);
  return { action: action!, supplierRequestId, expectedVersion };
}

export function validateRepeatRequestInput(input: unknown, now = new Date()) {
  const errors: ValidationErrors = {};
  if (!isRecord(input)) {
    throw new ProcurementRequestValidationError({ request: ['Provide repeat request details.'] });
  }
  rejectUnknownKeys(
    input,
    ['expectedSourceVersion', 'title', 'deliveryDate', 'quoteDeadline'],
    errors,
  );
  let expectedSourceVersion = 0;
  try {
    expectedSourceVersion = validateExpectedVersion(input.expectedSourceVersion);
  } catch (error) {
    if (error instanceof ProcurementRequestValidationError) Object.assign(errors, error.errors);
    else throw error;
  }
  const title = boundedText(input.title, 'title', PROCUREMENT_REQUEST_LIMITS.titleBytes, errors) ?? '';
  const deliveryDate = parseDeliveryDate(input.deliveryDate, errors);
  const quoteDeadline = parseQuoteDeadline(input.quoteDeadline, now, errors);
  validateDeadlineBeforeIndiaDelivery(quoteDeadline, deliveryDate, errors);
  throwIfInvalid(errors);
  return { expectedSourceVersion, title, deliveryDate, quoteDeadline };
}

type RequestCursor = { createdAt: Date; id: string };

export function encodeRequestCursor(cursor: RequestCursor) {
  return Buffer.from(
    JSON.stringify([cursor.createdAt.toISOString(), cursor.id]),
    'utf8',
  ).toString('base64url');
}

export function decodeRequestCursor(value: string): RequestCursor {
  const errors: ValidationErrors = {};
  try {
    if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) throw new Error();
    const parsed: unknown = JSON.parse(decoded);
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error();
    const createdAt = new Date(parsed[0] as string);
    const id = boundedId(parsed[1], 'cursor', errors);
    if (Number.isNaN(createdAt.getTime()) || errors.cursor) throw new Error();
    return { createdAt, id };
  } catch {
    throw new ProcurementRequestValidationError({ cursor: ['Cursor is invalid.'] });
  }
}

type RequestActor = { tenantId: string; userId: string };
export type IssuedToken = { raw: string; digest: string };

export type RequestServiceOptions = {
  now?: () => Date;
  transactionClock?: (transaction: Prisma.TransactionClient) => Promise<Date>;
  tokenFactory?: () => IssuedToken;
  applicationTokenFactory?: () => IssuedToken;
  shareBaseUrl?: string;
};

const MAX_LINK_LIFETIME_MS = 14 * 24 * 60 * 60 * 1_000;
export const EMPTY_QUOTE_REVISIONS = { v: 1, revisions: [] } as const;

const safeSupplierRequestSelect = {
  id: true,
  tenantId: true,
  requestId: true,
  supplierId: true,
  expiresAt: true,
  revokedAt: true,
  viewedAt: true,
  quoteRevision: true,
  createdAt: true,
  updatedAt: true,
  supplier: {
    select: {
      id: true,
      businessName: true,
      contactName: true,
      phone: true,
      whatsappNumber: true,
      email: true,
      relationshipType: true,
      verificationStatus: true,
      isActive: true,
    },
  },
} satisfies Prisma.SupplierRequestSelect;

const safeRequestDetailSelect = {
  id: true,
  tenantId: true,
  title: true,
  status: true,
  version: true,
  menuId: true,
  sourceRequestId: true,
  items: true,
  sourcing: true,
  deliveryDetails: true,
  deliveryDate: true,
  quoteDeadline: true,
  commercialTerms: true,
  applicationExpiresAt: true,
  applicationRevokedAt: true,
  openedAt: true,
  awardedAt: true,
  cancelledAt: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  supplierRequests: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: safeSupplierRequestSelect,
  },
} satisfies Prisma.ProcurementRequestSelect;

async function postgresTransactionClock(transaction: Prisma.TransactionClient) {
  const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  if (!clock || !(clock.now instanceof Date) || Number.isNaN(clock.now.getTime())) {
    throw new TypeError('PostgreSQL returned an invalid transaction clock.');
  }
  return clock.now;
}

function optionsWithDefaults(options: RequestServiceOptions | undefined) {
  return {
    now: options?.now ?? (() => new Date()),
    transactionClock: options?.transactionClock ?? postgresTransactionClock,
    tokenFactory: options?.tokenFactory ?? (() => createOpaqueToken('supplier-request')),
    applicationTokenFactory:
      options?.applicationTokenFactory ?? (() => createOpaqueToken('supplier-application')),
    shareBaseUrl: options?.shareBaseUrl,
  };
}

async function transactionTime(
  transaction: Prisma.TransactionClient,
  clock: (transaction: Prisma.TransactionClient) => Promise<Date>,
) {
  const current = await clock(transaction);
  if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
    throw new TypeError('The transaction clock returned an invalid timestamp.');
  }
  return new Date(current.getTime());
}

function validateActor(actor: RequestActor): RequestActor {
  const errors: ValidationErrors = {};
  const tenantId = boundedId(actor?.tenantId, 'tenantId', errors);
  const userId = boundedId(actor?.userId, 'userId', errors);
  if (Object.keys(errors).length > 0) throw new AuthorizationError();
  return { tenantId, userId };
}

function validateRequestId(value: unknown) {
  const errors: ValidationErrors = {};
  const id = boundedId(value, 'requestId', errors);
  throwIfInvalid(errors);
  return id;
}

async function requireActiveActor(
  transaction: Prisma.TransactionClient,
  actor: RequestActor,
) {
  const user = await transaction.user.findFirst({
    where: {
      tenantId: actor.tenantId,
      id: actor.userId,
      isActive: true,
      accountState: 'ACTIVE',
      tenant: { isActive: true },
    },
    select: { id: true },
  });
  if (!user) throw new AuthorizationError();
}

export function issueToken(purpose: TokenPurpose, factory: () => IssuedToken) {
  const token = factory();
  if (
    !token ||
    typeof token.raw !== 'string' ||
    typeof token.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token.digest) ||
    digestOpaqueToken(purpose, token.raw) !== token.digest
  ) {
    throw new TypeError('The public link token generator returned invalid output.');
  }
  return token;
}

export function linkExpiry(now: Date, quoteDeadline: Date) {
  return new Date(Math.min(quoteDeadline.getTime(), now.getTime() + MAX_LINK_LIFETIME_MS));
}

export function shareBaseUrl(configured: string | undefined) {
  const candidate = configured ?? process.env.NEXTAUTH_URL ??
    (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000');
  if (!candidate) {
    throw new ProcurementRequestConflictError(
      'Configure the application URL before issuing public links.',
    );
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ProcurementRequestConflictError(
      'Configure a valid application URL before issuing public links.',
    );
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.username || url.password || url.search || url.hash || (!local && url.protocol !== 'https:')) {
    throw new ProcurementRequestConflictError(
      'Configure a secure application URL before issuing public links.',
    );
  }
  return url.origin;
}

export function fragmentShareUrl(
  baseUrl: string,
  pathname: string,
  rawToken: string,
) {
  const url = new URL(pathname, `${baseUrl}/`);
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
}

type LockedRequest = {
  id: string;
  status: 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';
  version: number;
  menuId: string | null;
  items: Prisma.JsonValue;
  sourcing: Prisma.JsonValue;
  deliveryDetails: Prisma.JsonValue;
  deliveryDate: Date;
  quoteDeadline: Date;
  commercialTerms: string | null;
};

async function lockRequest(
  transaction: Prisma.TransactionClient,
  actor: RequestActor,
  requestId: string,
) {
  const [locked] = await transaction.$queryRaw<LockedRequest[]>`
    SELECT "id", "status", "version", "menuId", "items", "sourcing",
           "deliveryDetails", "deliveryDate", "quoteDeadline", "commercialTerms"
    FROM "ProcurementRequest"
    WHERE "tenantId" = ${actor.tenantId}
      AND "id" = ${requestId}
    FOR UPDATE
  `;
  if (!locked) throw new ProcurementRequestNotFoundError();
  return locked;
}

function repeatDeliveryDetails(input: unknown) {
  const errors: ValidationErrors = {};
  const details = parseDeliveryDetails(input, errors);
  if (Object.keys(errors).length > 0) {
    throw new ProcurementRequestConflictError(
      'The completed request has invalid delivery details and cannot be run again.',
    );
  }
  return details;
}

function repeatCommercialTerms(input: string | null) {
  if (input === null) return null;
  const errors: ValidationErrors = {};
  const terms = boundedText(
    input,
    'commercialTerms',
    PROCUREMENT_REQUEST_LIMITS.termsBytes,
    errors,
    { nullable: true },
  );
  if (Object.keys(errors).length > 0) {
    throw new ProcurementRequestConflictError(
      'The completed request has invalid commercial terms and cannot be run again.',
    );
  }
  return terms;
}

function filterRepeatSelection(
  selection: SourcingSelectionV1,
  eligibleRelationships: ReadonlyMap<string, 'CURRENT' | 'SELECTED_NEW'>,
): SourcingSelectionV1 {
  return {
    ...selection,
    currentSupplierIds: selection.currentSupplierIds.filter(
      (id) => eligibleRelationships.get(id) === 'CURRENT',
    ),
    selectedNewSupplierIds: selection.selectedNewSupplierIds.filter(
      (id) => eligibleRelationships.get(id) === 'SELECTED_NEW',
    ),
  };
}

async function repeatRequestDocuments(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  itemsInput: unknown,
  sourcingInput: unknown,
) {
  let source: ReturnType<typeof validateRequestDocuments>;
  try {
    source = validateRequestDocuments(itemsInput, sourcingInput);
  } catch (error) {
    if (!(error instanceof RequestDocumentValidationError)) throw error;
    throw new ProcurementRequestConflictError(
      'The completed request has invalid item or sourcing details and cannot be run again.',
    );
  }
  const explicitIds = collectExplicitSupplierIds(source.items, source.sourcing);
  const supplierRows = explicitIds.length === 0
    ? []
    : await transaction.$queryRaw<ExplicitRequestSupplier[]>`
        SELECT "id", "relationshipType", "verificationStatus", "applicationRequestId",
               "verifiedAt", "verifiedByUserId", "isActive"
        FROM "Supplier"
        WHERE "tenantId" = ${tenantId}
          AND "id" IN (${Prisma.join(explicitIds)})
        ORDER BY "id"
        FOR UPDATE
      `;
  const eligible = supplierRows.filter((supplier) => {
    try {
      validateSupplierLifecycleState({
        relationshipType: supplier.relationshipType,
        verificationStatus: supplier.verificationStatus,
        applicationRequestId: supplier.applicationRequestId,
        verifiedAt: supplier.verifiedAt,
        verifiedByUserId: supplier.verifiedByUserId,
        isActive: supplier.isActive,
      });
      return supplier.isActive && supplier.verificationStatus === 'VERIFIED' &&
        (supplier.relationshipType === 'CURRENT' ||
          supplier.relationshipType === 'SELECTED_NEW');
    } catch (error) {
      if (error instanceof SupplierValidationError) return false;
      throw error;
    }
  });
  const eligibleRelationships = new Map(
    eligible.map(({ id, relationshipType }) => [
      id,
      relationshipType as 'CURRENT' | 'SELECTED_NEW',
    ]),
  );
  const items = {
    v: 1,
    items: source.items.items.map((item) => ({
      ...item,
      sourcingOverride: item.sourcingOverride === null
        ? null
        : filterRepeatSelection(item.sourcingOverride, eligibleRelationships),
    })),
  } satisfies RequestItemsV1;
  const sourcing = {
    v: 1,
    default: filterRepeatSelection(source.sourcing.default, eligibleRelationships),
  } satisfies RequestSourcingV1;
  try {
    const documents = validateRequestDocuments(items, sourcing);
    const retained = eligible.filter(({ id }) =>
      documents.explicitSupplierIds.includes(id),
    );
    validateExplicitRequestSuppliers(documents.items, documents.sourcing, retained);
    return { ...documents, suppliers: retained };
  } catch (error) {
    if (!(error instanceof RequestDocumentValidationError)) throw error;
    throw new ProcurementRequestConflictError(
      'Choose another verified supplier before running this completed request again.',
    );
  }
}

function assertVersionAndStatus(
  request: LockedRequest,
  expectedVersion: number,
  status: LockedRequest['status'],
) {
  if (request.version !== expectedVersion) {
    throw new ProcurementRequestConflictError(
      'This request changed. Refresh it before trying again.',
    );
  }
  if (request.status !== status) {
    throw new ProcurementRequestConflictError(
      status === 'DRAFT'
        ? 'Only a draft request can be changed or opened.'
        : 'Supplier links can only be changed while a request is open.',
    );
  }
}

function requestDocuments(items: unknown, sourcing: unknown) {
  try {
    return validateRequestDocuments(items, sourcing);
  } catch (error) {
    if (!(error instanceof RequestDocumentValidationError)) throw error;
    throw new ProcurementRequestValidationError({ documents: [error.message] });
  }
}

function jsonDocument(value: object) {
  return value as unknown as Prisma.InputJsonValue;
}

async function requestDetails(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
) {
  const request = await transaction.procurementRequest.findFirst({
    where: { tenantId, id: requestId },
    select: safeRequestDetailSelect,
  });
  if (!request) throw new ProcurementRequestNotFoundError();
  const documents = requestDocuments(request.items, request.sourcing);
  return {
    ...request,
    items: documents.items,
    sourcing: documents.sourcing,
    effectiveSourcing: documents.items.items.map((item) => ({
      itemId: item.id,
      selection: resolveItemSourcing(documents.sourcing, item.sourcingOverride),
    })),
  };
}

async function eligibleSuppliers(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  items: RequestItemsV1,
  sourcing: RequestSourcingV1,
) {
  const supplierIds = collectExplicitSupplierIds(items, sourcing);
  if (supplierIds.length === 0) return [];
  const suppliers = await transaction.$queryRaw<ExplicitRequestSupplier[]>`
    SELECT "id", "relationshipType", "verificationStatus", "applicationRequestId",
           "verifiedAt", "verifiedByUserId", "isActive"
    FROM "Supplier"
    WHERE "tenantId" = ${tenantId}
      AND "id" IN (${Prisma.join(supplierIds)})
    ORDER BY "id"
    FOR UPDATE
  `;
  if (suppliers.length !== supplierIds.length) throw new ProcurementRequestNotFoundError();
  try {
    validateExplicitRequestSuppliers(items, sourcing, suppliers);
  } catch (error) {
    if (!(error instanceof RequestDocumentValidationError)) throw error;
    throw new ProcurementRequestConflictError(
      'Only active verified suppliers in the selected relationship can receive this request.',
    );
  }
  return suppliers;
}

async function lockedSupplierRequests(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
) {
  return transaction.$queryRaw<Array<{ id: string; supplierId: string }>>`
    SELECT "id", "supplierId"
    FROM "SupplierRequest"
    WHERE "tenantId" = ${tenantId}
      AND "requestId" = ${requestId}
    ORDER BY "id"
    FOR UPDATE
  `;
}

async function replaceSupplierRequestTokens(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    requestId: string;
    expiresAt: Date;
    grants: Array<{ id: string; tokenDigest: string }>;
  },
) {
  if (input.grants.length === 0) return;
  const rows = input.grants.map(({ id, tokenDigest }) =>
    Prisma.sql`(${id}, ${tokenDigest})`,
  );
  const updated = await transaction.$executeRaw`
    UPDATE "SupplierRequest" AS target
    SET "tokenDigest" = issued."tokenDigest"::CHAR(64),
        "expiresAt" = ${input.expiresAt},
        "revokedAt" = NULL,
        "viewedAt" = NULL,
        "updatedAt" = clock_timestamp()
    FROM (VALUES ${Prisma.join(rows)}) AS issued("id", "tokenDigest")
    WHERE target."tenantId" = ${input.tenantId}
      AND target."requestId" = ${input.requestId}
      AND target."id" = issued."id"
  `;
  if (updated !== input.grants.length) throw new ProcurementRequestNotFoundError();
}

async function writeSupplierLinkCreatedAuditEvents(
  transaction: Prisma.TransactionClient,
  actor: RequestActor,
  supplierRequestIds: string[],
) {
  if (supplierRequestIds.length === 0) return;
  await transaction.auditEvent.createMany({
    data: supplierRequestIds.map((entityId) => ({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'supplier-link.created',
      entityType: 'SupplierRequest',
      entityId,
    })),
  });
}

type RequestListRow = {
  id: string;
  tenantId: string;
  title: string;
  status: 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';
  version: number;
  menuId: string | null;
  sourceRequestId: string | null;
  deliveryDate: Date;
  quoteDeadline: Date;
  openedAt: Date | null;
  awardedAt: Date | null;
  cancelledAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
  supplierCount: number;
};

export async function listProcurementRequests(
  input: { actor: RequestActor; cursor?: string; limit?: number },
  client: TenantTransactionHost = prisma,
) {
  const actor = validateActor(input.actor);
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > PROCUREMENT_REQUEST_LIMITS.listPage) {
    throw new ProcurementRequestValidationError({
      limit: [`Limit must be between 1 and ${PROCUREMENT_REQUEST_LIMITS.listPage}.`],
    });
  }
  const cursor = input.cursor ? decodeRequestCursor(input.cursor) : undefined;
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActiveActor(transaction, actor);
    const cursorPredicate = cursor
      ? Prisma.sql`AND (request."createdAt" < ${cursor.createdAt}
          OR (request."createdAt" = ${cursor.createdAt} AND request."id" < ${cursor.id}))`
      : Prisma.empty;
    const requests = await transaction.$queryRaw<RequestListRow[]>(Prisma.sql`
      SELECT request."id", request."tenantId", request."title", request."status",
             request."version", request."menuId", request."sourceRequestId",
             request."deliveryDate", request."quoteDeadline", request."openedAt", request."awardedAt",
             request."cancelledAt", request."createdByUserId", request."createdAt",
             request."updatedAt",
             CASE
               WHEN pg_catalog.jsonb_typeof(request."items" -> 'items') = 'array'
               THEN pg_catalog.jsonb_array_length(request."items" -> 'items')
               ELSE 0
             END::INTEGER AS "itemCount",
             (
               SELECT pg_catalog.count(*)::INTEGER
               FROM "SupplierRequest" AS supplier_request
               WHERE supplier_request."tenantId" = request."tenantId"
                 AND supplier_request."requestId" = request."id"
             ) AS "supplierCount"
      FROM "ProcurementRequest" AS request
      WHERE request."tenantId" = ${actor.tenantId}
      ${cursorPredicate}
      ORDER BY request."createdAt" DESC, request."id" DESC
      LIMIT ${limit + 1}
    `);
    const hasMore = requests.length > limit;
    if (hasMore) requests.pop();
    const last = requests.at(-1);
    return {
      requests,
      nextCursor: hasMore && last
        ? encodeRequestCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    };
  }, client);
}

function snapshotSelectedMenuItems(
  documentInput: unknown,
  selectedItemIds: string[],
  overrides: Record<string, SourcingSelectionV1>,
) {
  let document;
  try {
    document = validateMenuDocument(documentInput);
  } catch {
    throw new ProcurementRequestConflictError(
      'The approved menu is not safe to use for a procurement request.',
    );
  }
  const selected = new Set(selectedItemIds);
  const menuItems = document.dishes.flatMap(({ ingredients }) => ingredients)
    .filter(({ id }) => selected.has(id));
  if (menuItems.length !== selectedItemIds.length) throw new ProcurementRequestNotFoundError();
  return {
    v: 1,
    items: menuItems.map((menuItem) => ({
      id: menuItem.id,
      itemKey: menuItem.itemKey,
      name: menuItem.name,
      quantity: menuItem.quantity,
      unit: menuItem.unit,
      specification: menuItem.specification,
      sourcingOverride: Object.hasOwn(overrides, menuItem.id)
        ? overrides[menuItem.id]!
        : null,
    })),
  } satisfies RequestItemsV1;
}

function placeholderGrant(
  supplierId: string,
  now: Date,
  quoteDeadline: Date,
  tokenFactory: () => IssuedToken,
) {
  return {
    supplierId,
    token: issueToken('supplier-request', tokenFactory),
    expiresAt: linkExpiry(now, quoteDeadline),
  };
}

export async function createProcurementRequestDraft(
  input: { actor: RequestActor; draft: unknown },
  client: TenantTransactionHost = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const serviceOptions = optionsWithDefaults(options);
  const now = serviceOptions.now();
  const draft = validateProcurementRequestDraftInput(input.draft, now);
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActiveActor(transaction, actor);
    let items: RequestItemsV1 = { v: 1, items: [] };
    if (draft.menuId !== null) {
      const menu = await transaction.menu.findFirst({
        where: { tenantId: actor.tenantId, id: draft.menuId, status: 'APPROVED' },
        select: { document: true },
      });
      if (!menu) throw new ProcurementRequestNotFoundError();
      items = snapshotSelectedMenuItems(menu.document, draft.selectedItemIds, draft.sourcingOverrides);
    }
    items.items.push(...(draft.additionalItems?.items ?? []));
    const sourcing = { v: 1, default: draft.defaultSourcing } satisfies RequestSourcingV1;
    const documents = requestDocuments(items, sourcing);
    const suppliers = await eligibleSuppliers(
      transaction,
      actor.tenantId,
      documents.items,
      documents.sourcing,
    );
    const grants = suppliers.map(({ id }) => placeholderGrant(
      id,
      now,
      draft.quoteDeadline,
      serviceOptions.tokenFactory,
    ));
    const created = await transaction.procurementRequest.create({
      data: {
        tenantId: actor.tenantId,
        title: draft.title,
        status: 'DRAFT',
        version: 1,
        menuId: draft.menuId,
        items: jsonDocument(documents.items),
        sourcing: jsonDocument(documents.sourcing),
        deliveryDetails: jsonDocument(draft.deliveryDetails),
        deliveryDate: draft.deliveryDate,
        quoteDeadline: draft.quoteDeadline,
        commercialTerms: draft.commercialTerms,
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });
    if (grants.length > 0) {
      await transaction.supplierRequest.createMany({
        data: grants.map(({ supplierId, token, expiresAt }) => ({
          tenantId: actor.tenantId,
          requestId: created.id,
          supplierId,
          tokenDigest: token.digest,
          expiresAt,
          quoteRevision: 0,
          quoteRevisions: jsonDocument(EMPTY_QUOTE_REVISIONS),
        })),
      });
    }
    return requestDetails(transaction, actor.tenantId, created.id);
  }, client);
}

export async function getProcurementRequest(
  input: { actor: RequestActor; requestId: string },
  client: TenantTransactionHost = prisma,
) {
  const actor = validateActor(input.actor);
  const requestId = validateRequestId(input.requestId);
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActiveActor(transaction, actor);
    return requestDetails(transaction, actor.tenantId, requestId);
  }, client);
}

export async function updateProcurementRequestDraft(
  input: {
    actor: RequestActor;
    requestId: string;
    expectedVersion: unknown;
    patch: unknown;
  },
  client: TenantTransactionHost = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const requestId = validateRequestId(input.requestId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);
  const serviceOptions = optionsWithDefaults(options);
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActiveActor(transaction, actor);
    const locked = await lockRequest(transaction, actor, requestId);
    assertVersionAndStatus(locked, expectedVersion, 'DRAFT');
    const grants = await lockedSupplierRequests(transaction, actor.tenantId, requestId);
    const now = await transactionTime(transaction, serviceOptions.transactionClock);
    const patch = validateDraftPatchInput(input.patch, now);
    const deliveryDate = patch.deliveryDate ?? locked.deliveryDate;
    const quoteDeadline = patch.quoteDeadline ?? locked.quoteDeadline;
    const timelineErrors: ValidationErrors = {};
    if (quoteDeadline.getTime() <= now.getTime()) {
      addError(timelineErrors, 'quoteDeadline', 'Quote deadline must be in the future.');
    }
    validateDeadlineBeforeIndiaDelivery(quoteDeadline, deliveryDate, timelineErrors);
    throwIfInvalid(timelineErrors);
    const documents = requestDocuments(
      patch.items ?? locked.items,
      patch.sourcing ?? locked.sourcing,
    );
    const suppliers = await eligibleSuppliers(
      transaction,
      actor.tenantId,
      documents.items,
      documents.sourcing,
    );
    const requiredIds = new Set(suppliers.map(({ id }) => id));
    const existingBySupplier = new Map(grants.map((grant) => [grant.supplierId, grant]));
    const removedIds = grants.filter(({ supplierId }) => !requiredIds.has(supplierId))
      .map(({ id }) => id);
    if (removedIds.length > 0) {
      await transaction.supplierRequest.deleteMany({
        where: { tenantId: actor.tenantId, requestId, id: { in: removedIds } },
      });
    }
    const additions = suppliers.filter(({ id }) => !existingBySupplier.has(id))
      .map(({ id }) => placeholderGrant(id, now, quoteDeadline, serviceOptions.tokenFactory));
    if (additions.length > 0) {
      await transaction.supplierRequest.createMany({
        data: additions.map(({ supplierId, token, expiresAt }) => ({
          tenantId: actor.tenantId,
          requestId,
          supplierId,
          tokenDigest: token.digest,
          expiresAt,
          quoteRevision: 0,
          quoteRevisions: jsonDocument(EMPTY_QUOTE_REVISIONS),
        })),
      });
    }
    await transaction.supplierRequest.updateMany({
      where: { tenantId: actor.tenantId, requestId },
      data: { expiresAt: linkExpiry(now, quoteDeadline) },
    });
    await transaction.procurementRequest.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: requestId } },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        items: jsonDocument(documents.items),
        sourcing: jsonDocument(documents.sourcing),
        ...(patch.deliveryDetails !== undefined
          ? { deliveryDetails: jsonDocument(patch.deliveryDetails) }
          : {}),
        ...(patch.deliveryDate !== undefined ? { deliveryDate: patch.deliveryDate } : {}),
        ...(patch.quoteDeadline !== undefined ? { quoteDeadline: patch.quoteDeadline } : {}),
        ...(patch.commercialTerms !== undefined ? { commercialTerms: patch.commercialTerms } : {}),
        applicationTokenDigest: null,
        applicationExpiresAt: null,
        applicationRevokedAt: null,
        version: { increment: 1 },
      },
    });
    return requestDetails(transaction, actor.tenantId, requestId);
  }, client);
}

export async function openProcurementRequest(
  input: { actor: RequestActor; requestId: string; expectedVersion: unknown },
  client: TenantTransactionHost = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const requestId = validateRequestId(input.requestId);
  const expectedVersion = validateExpectedVersion(input.expectedVersion);
  const serviceOptions = optionsWithDefaults(options);
  const baseUrl = shareBaseUrl(serviceOptions.shareBaseUrl);
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActiveActor(transaction, actor);
    const locked = await lockRequest(transaction, actor, requestId);
    assertVersionAndStatus(locked, expectedVersion, 'DRAFT');
    const documents = requestDocuments(locked.items, locked.sourcing);
    const supplierRequests = await lockedSupplierRequests(
      transaction,
      actor.tenantId,
      requestId,
    );
    await eligibleSuppliers(
      transaction,
      actor.tenantId,
      documents.items,
      documents.sourcing,
    );
    const explicitIds = collectExplicitSupplierIds(documents.items, documents.sourcing);
    if (
      supplierRequests.length !== explicitIds.length ||
      supplierRequests.some(({ supplierId }) => !explicitIds.includes(supplierId))
    ) {
      throw new ProcurementRequestConflictError(
        'Refresh the draft supplier selection before opening this request.',
      );
    }
    const now = await transactionTime(transaction, serviceOptions.transactionClock);
    if (locked.quoteDeadline.getTime() <= now.getTime()) {
      throw new ProcurementRequestConflictError(
        'Set a future quote deadline before opening this request.',
      );
    }
    const expiresAt = linkExpiry(now, locked.quoteDeadline);
    const issued = supplierRequests.map((supplierRequest) => ({
      supplierRequest,
      token: issueToken('supplier-request', serviceOptions.tokenFactory),
    }));
    const applicationsEnabled = requestAcceptsVerifiedApplications(
      documents.items,
      documents.sourcing,
    );
    const applicationToken = applicationsEnabled
      ? issueToken('supplier-application', serviceOptions.applicationTokenFactory)
      : null;
    await replaceSupplierRequestTokens(transaction, {
      tenantId: actor.tenantId,
      requestId,
      expiresAt,
      grants: issued.map(({ supplierRequest, token }) => ({
        id: supplierRequest.id,
        tokenDigest: token.digest,
      })),
    });
    await transaction.procurementRequest.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: requestId } },
      data: {
        status: 'OPEN',
        openedAt: now,
        applicationTokenDigest: applicationToken?.digest ?? null,
        applicationExpiresAt: applicationToken ? expiresAt : null,
        applicationRevokedAt: null,
        version: { increment: 1 },
      },
    });
    await writeAuditEvent(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'request.opened',
      entityId: requestId,
      metadata: {
        itemCount: documents.items.items.length,
        supplierCount: supplierRequests.length,
      },
    });
    await writeSupplierLinkCreatedAuditEvents(
      transaction,
      actor,
      issued.map(({ supplierRequest }) => supplierRequest.id),
    );
    const request = await requestDetails(transaction, actor.tenantId, requestId);
    return {
      request,
      links: issued.map(({ supplierRequest, token }) => {
        const safe = request.supplierRequests.find(({ id }) => id === supplierRequest.id);
        if (!safe) throw new ProcurementRequestNotFoundError();
        return {
          supplierRequestId: supplierRequest.id,
          supplierId: supplierRequest.supplierId,
          businessName: safe.supplier.businessName,
          url: fragmentShareUrl(baseUrl, '/quote', token.raw),
          expiresAt: expiresAt.toISOString(),
        };
      }),
      ...(applicationToken
        ? {
            applicationLink: {
              url: fragmentShareUrl(baseUrl, '/supplier-application', applicationToken.raw),
              expiresAt: expiresAt.toISOString(),
            },
          }
        : {}),
    };
  }, client);
}

export async function changeSupplierRequestLink(
  input: {
    actor: RequestActor;
    requestId: string;
    supplierRequestId: unknown;
    expectedVersion: unknown;
    action: unknown;
  },
  client: TenantTransactionHost = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const requestId = validateRequestId(input.requestId);
  const action = validateLinkActionInput({
    action: input.action,
    supplierRequestId: input.supplierRequestId,
    expectedVersion: input.expectedVersion,
  });
  const serviceOptions = optionsWithDefaults(options);
  const baseUrl = action.action === 'rotate'
    ? shareBaseUrl(serviceOptions.shareBaseUrl)
    : undefined;
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActiveActor(transaction, actor);
    const locked = await lockRequest(transaction, actor, requestId);
    assertVersionAndStatus(locked, action.expectedVersion, 'OPEN');
    const [lockedGrant] = await transaction.$queryRaw<Array<{ id: string; supplierId: string }>>`
      SELECT "id", "supplierId"
      FROM "SupplierRequest"
      WHERE "tenantId" = ${actor.tenantId}
        AND "requestId" = ${requestId}
        AND "id" = ${action.supplierRequestId}
      FOR UPDATE
    `;
    if (!lockedGrant) throw new ProcurementRequestNotFoundError();
    let rawLink: { url: string; expiresAt: string } | undefined;
    if (action.action === 'revoke') {
      const current = await transaction.supplierRequest.findFirst({
        where: { tenantId: actor.tenantId, requestId, id: lockedGrant.id },
        select: { revokedAt: true },
      });
      if (!current) throw new ProcurementRequestNotFoundError();
      if (current.revokedAt) {
        throw new ProcurementRequestConflictError('This supplier link is already revoked.');
      }
      const now = await transactionTime(transaction, serviceOptions.transactionClock);
      await transaction.supplierRequest.update({
        where: { tenantId_id: { tenantId: actor.tenantId, id: lockedGrant.id } },
        data: { revokedAt: now },
      });
      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'supplier-link.revoked',
        entityId: lockedGrant.id,
      });
    } else {
      const documents = requestDocuments(locked.items, locked.sourcing);
      const eligible = await eligibleSuppliers(
        transaction,
        actor.tenantId,
        documents.items,
        documents.sourcing,
      );
      if (!eligible.some(({ id }) => id === lockedGrant.supplierId)) {
        throw new ProcurementRequestConflictError(
          'This supplier is no longer eligible for a new link.',
        );
      }
      const now = await transactionTime(transaction, serviceOptions.transactionClock);
      if (locked.quoteDeadline.getTime() <= now.getTime()) {
        throw new ProcurementRequestConflictError(
          'The quote deadline has passed; this link cannot be rotated.',
        );
      }
      const token = issueToken('supplier-request', serviceOptions.tokenFactory);
      const expiresAt = linkExpiry(now, locked.quoteDeadline);
      await transaction.supplierRequest.update({
        where: { tenantId_id: { tenantId: actor.tenantId, id: lockedGrant.id } },
        data: {
          tokenDigest: token.digest,
          expiresAt,
          revokedAt: null,
          viewedAt: null,
        },
      });
      await writeAuditEvent(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'supplier-link.created',
        entityId: lockedGrant.id,
      });
      rawLink = {
        url: fragmentShareUrl(baseUrl!, '/quote', token.raw),
        expiresAt: expiresAt.toISOString(),
      };
    }
    await transaction.procurementRequest.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: requestId } },
      data: { version: { increment: 1 } },
    });
    const request = await requestDetails(transaction, actor.tenantId, requestId);
    const supplierRequest = request.supplierRequests.find(({ id }) => id === lockedGrant.id);
    if (!supplierRequest) throw new ProcurementRequestNotFoundError();
    return { request, supplierRequest, ...(rawLink ? { link: rawLink } : {}) };
  }, client);
}

export async function repeatProcurementRequest(
  input: { actor: RequestActor; sourceRequestId: string; repeat: unknown },
  client: TenantTransactionHost = prisma,
  options?: RequestServiceOptions,
) {
  const actor = validateActor(input.actor);
  const sourceRequestId = validateRequestId(input.sourceRequestId);
  const serviceOptions = optionsWithDefaults(options);
  const repeat = validateRepeatRequestInput(input.repeat, serviceOptions.now());
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActiveActor(transaction, actor);
    const locked = await lockRequest(transaction, actor, sourceRequestId);
    if (locked.version !== repeat.expectedSourceVersion) {
      throw new ProcurementRequestConflictError(
        'This request changed. Refresh it before running it again.',
      );
    }
    if (locked.status !== 'AWARDED') {
      throw new ProcurementRequestConflictError('Only a completed award can be run again.');
    }
    const documents = await repeatRequestDocuments(
      transaction,
      actor.tenantId,
      locked.items,
      locked.sourcing,
    );
    const deliveryDetails = repeatDeliveryDetails(locked.deliveryDetails);
    const commercialTerms = repeatCommercialTerms(locked.commercialTerms);
    const now = await transactionTime(transaction, serviceOptions.transactionClock);
    if (repeat.quoteDeadline.getTime() <= now.getTime()) {
      throw new ProcurementRequestConflictError(
        'Set a future quote deadline before running this request again.',
      );
    }
    const grants = documents.suppliers.map(({ id }) => placeholderGrant(
      id,
      now,
      repeat.quoteDeadline,
      serviceOptions.tokenFactory,
    ));
    const created = await transaction.procurementRequest.create({
      data: {
        tenantId: actor.tenantId,
        title: repeat.title,
        status: 'DRAFT',
        version: 1,
        menuId: locked.menuId,
        sourceRequestId,
        items: jsonDocument(documents.items),
        sourcing: jsonDocument(documents.sourcing),
        deliveryDetails: jsonDocument(deliveryDetails),
        deliveryDate: repeat.deliveryDate,
        quoteDeadline: repeat.quoteDeadline,
        commercialTerms,
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });
    if (grants.length > 0) {
      await transaction.supplierRequest.createMany({
        data: grants.map(({ supplierId, token, expiresAt }) => ({
          tenantId: actor.tenantId,
          requestId: created.id,
          supplierId,
          tokenDigest: token.digest,
          expiresAt,
          quoteRevision: 0,
          quoteRevisions: jsonDocument(EMPTY_QUOTE_REVISIONS),
        })),
      });
    }
    await writeAuditEvent(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'request.repeated',
      entityId: created.id,
      metadata: { sourceRequestId },
    });
    return requestDetails(transaction, actor.tenantId, created.id);
  }, client);
}
