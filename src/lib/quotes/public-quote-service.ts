import { Prisma } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import {
  type TenantTransactionHost,
  withTenant,
} from '@/lib/db/tenant-transaction';
import {
  type RequestItemsV1,
  RequestDocumentValidationError,
  type RequestSourcingV1,
  resolveItemSourcing,
  validateRequestDocuments,
} from '@/lib/procurement/request-document';
import { prisma } from '@/lib/prisma';
import {
  appendQuoteRevision,
  latestQuoteRevision,
  PUBLIC_QUOTE_MAX_ITEMS,
  PublicQuoteDocumentSizeError,
  PublicQuoteRevisionConflictError,
  PublicQuoteRevisionLimitError,
  PublicQuoteStorageCorruptionError,
  PublicQuoteValidationError,
  type QuoteRequestItem,
  validateQuoteRevisionsDocument,
} from '@/lib/quotes/quote-revisions';
import { matchingPreviousPrices, type PreviousQuotePrices } from '@/lib/quotes/previous-prices';
import { createPrismaPublicSupplierGrantRepository } from '@/lib/security/public-grant';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';
import { digestOpaqueToken } from '@/lib/security/tokens';

export {
  PUBLIC_QUOTE_MAX_ITEMS,
  PublicQuoteDocumentSizeError,
  PublicQuoteRevisionConflictError,
  PublicQuoteRevisionLimitError,
  PublicQuoteStorageCorruptionError,
  PublicQuoteValidationError,
};

export const PUBLIC_QUOTE_BODY_BYTES = 1_024 * 1_024;

export class PublicQuoteUnavailableError extends Error {
  readonly code = 'PUBLIC_QUOTE_UNAVAILABLE';
  readonly status = 410;

  constructor() {
    super('This supplier link is invalid or no longer available.');
    this.name = 'PublicQuoteUnavailableError';
  }
}

export class PublicQuoteSubmissionLimitError extends Error {
  readonly code = 'QUOTE_SUBMISSION_RATE_LIMIT';
  readonly status = 429;

  constructor(readonly retryAfterSeconds: number) {
    super('Wait before submitting another quote revision.');
    this.name = 'PublicQuoteSubmissionLimitError';
  }
}

type SupplierForEligibility = {
  id: string;
  applicationRequestId: string | null;
};

export function eligibleQuoteRequestItems(input: {
  requestId: string;
  items: RequestItemsV1;
  sourcing: RequestSourcingV1;
  supplier: SupplierForEligibility;
}): QuoteRequestItem[] {
  return input.items.items.flatMap((item) => {
    const selection = resolveItemSourcing(
      input.sourcing,
      item.sourcingOverride,
    );
    const explicitlyCurrent =
      selection.modes.includes('CURRENT') &&
      selection.currentSupplierIds.includes(input.supplier.id);
    const explicitlySelected =
      selection.modes.includes('SELECTED_NEW') &&
      selection.selectedNewSupplierIds.includes(input.supplier.id);
    const verifiedApplication =
      input.supplier.applicationRequestId === input.requestId &&
      selection.modes.includes('VERIFIED_NEW') &&
      selection.acceptVerifiedApplications;
    if (!explicitlyCurrent && !explicitlySelected && !verifiedApplication) {
      return [];
    }
    return [
      {
        id: item.id,
        itemKey: item.itemKey,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        specification: item.specification,
      },
    ];
  });
}

type ResolvedGrant = {
  tenantId: string;
  supplierRequestId: string;
  tokenDigest: string;
};

type LiveGrantRow = {
  supplierRequestId: string;
  requestId: string;
  supplierId: string;
  applicationRequestId: string | null;
  restaurantName: string;
  supplierName: string;
  title: string;
  deliveryDetails: Prisma.JsonValue;
  requestItems: Prisma.JsonValue;
  requestSourcing: Prisma.JsonValue;
  deliveryDate: Date;
  quoteDeadline: Date;
  commercialTerms: string | null;
  viewedAt: Date | null;
  quoteRevision: number;
  quoteRevisions: Prisma.JsonValue;
  databaseNow: Date;
};

function unavailable(): never {
  throw new PublicQuoteUnavailableError();
}

async function resolveGrant(
  token: unknown,
  client: TenantTransactionHost,
): Promise<ResolvedGrant> {
  if (typeof token !== 'string') unavailable();
  let tokenDigest: string;
  try {
    tokenDigest = digestOpaqueToken('supplier-request', token);
  } catch {
    unavailable();
  }
  const grant = await createPrismaPublicSupplierGrantRepository(client).resolve({
    tokenDigest,
  });
  if (!grant) unavailable();
  return { ...grant, tokenDigest };
}

async function lockedLiveGrantRow(
  transaction: Prisma.TransactionClient,
  input: ResolvedGrant,
) {
  const [row] = await transaction.$queryRaw<LiveGrantRow[]>(Prisma.sql`
    WITH locked_supplier_request AS MATERIALIZED (
      SELECT supplier_request.*
      FROM "SupplierRequest" AS supplier_request
      WHERE supplier_request."tenantId" = ${input.tenantId}
        AND supplier_request."id" = ${input.supplierRequestId}
        AND supplier_request."tokenDigest" = ${input.tokenDigest}
      FOR UPDATE OF supplier_request
    ),
    quote_clock AS MATERIALIZED (
      SELECT pg_catalog.clock_timestamp() AS "databaseNow"
      FROM locked_supplier_request
      LIMIT 1
    )
    SELECT
      supplier_request."id" AS "supplierRequestId",
      request."id" AS "requestId",
      supplier."id" AS "supplierId",
      supplier."applicationRequestId",
      tenant."name" AS "restaurantName",
      supplier."businessName" AS "supplierName",
      request."title",
      request."deliveryDetails",
      request."items" AS "requestItems",
      request."sourcing" AS "requestSourcing",
      request."deliveryDate",
      request."quoteDeadline",
      request."commercialTerms",
      supplier_request."viewedAt",
      supplier_request."quoteRevision",
      supplier_request."quoteRevisions",
      quote_clock."databaseNow"
    FROM locked_supplier_request AS supplier_request
    JOIN quote_clock ON true
    JOIN "ProcurementRequest" AS request
      ON request."tenantId" = supplier_request."tenantId"
     AND request."id" = supplier_request."requestId"
    JOIN "Supplier" AS supplier
      ON supplier."tenantId" = supplier_request."tenantId"
     AND supplier."id" = supplier_request."supplierId"
    JOIN "Tenant" AS tenant
      ON tenant."id" = supplier_request."tenantId"
    WHERE supplier_request."revokedAt" IS NULL
      AND supplier_request."expiresAt" > quote_clock."databaseNow"
      AND request."status"::TEXT = 'OPEN'
      AND request."quoteDeadline" > quote_clock."databaseNow"
      AND supplier."isActive" = true
      AND tenant."isActive" = true
  `);
  if (!row) unavailable();
  return row;
}

async function liveGrantRow(
  transaction: Prisma.TransactionClient,
  input: ResolvedGrant,
) {
  const [row] = await transaction.$queryRaw<LiveGrantRow[]>(Prisma.sql`
    WITH quote_clock AS MATERIALIZED (
      SELECT pg_catalog.clock_timestamp() AS "databaseNow"
    )
    SELECT
      supplier_request."id" AS "supplierRequestId",
      request."id" AS "requestId",
      supplier."id" AS "supplierId",
      supplier."applicationRequestId",
      tenant."name" AS "restaurantName",
      supplier."businessName" AS "supplierName",
      request."title",
      request."deliveryDetails",
      request."items" AS "requestItems",
      request."sourcing" AS "requestSourcing",
      request."deliveryDate",
      request."quoteDeadline",
      request."commercialTerms",
      supplier_request."viewedAt",
      supplier_request."quoteRevision",
      supplier_request."quoteRevisions",
      quote_clock."databaseNow"
    FROM quote_clock
    JOIN "SupplierRequest" AS supplier_request ON true
    JOIN "ProcurementRequest" AS request
      ON request."tenantId" = supplier_request."tenantId"
     AND request."id" = supplier_request."requestId"
    JOIN "Supplier" AS supplier
      ON supplier."tenantId" = supplier_request."tenantId"
     AND supplier."id" = supplier_request."supplierId"
    JOIN "Tenant" AS tenant
      ON tenant."id" = supplier_request."tenantId"
    WHERE supplier_request."tenantId" = ${input.tenantId}
      AND supplier_request."id" = ${input.supplierRequestId}
      AND supplier_request."tokenDigest" = ${input.tokenDigest}
      AND supplier_request."revokedAt" IS NULL
      AND supplier_request."expiresAt" > quote_clock."databaseNow"
      AND request."status"::TEXT = 'OPEN'
      AND request."quoteDeadline" > quote_clock."databaseNow"
      AND supplier."isActive" = true
      AND tenant."isActive" = true
  `);
  if (!row) unavailable();
  return row;
}

function liveDocuments(row: LiveGrantRow) {
  let documents: ReturnType<typeof validateRequestDocuments>;
  try {
    documents = validateRequestDocuments(row.requestItems, row.requestSourcing);
  } catch (error) {
    if (error instanceof RequestDocumentValidationError) {
      throw new PublicQuoteStorageCorruptionError();
    }
    throw error;
  }
  const items = eligibleQuoteRequestItems({
    requestId: row.requestId,
    items: documents.items,
    sourcing: documents.sourcing,
    supplier: {
      id: row.supplierId,
      applicationRequestId: row.applicationRequestId,
    },
  });
  if (items.length === 0) unavailable();
  const quoteRevisions = validateQuoteRevisionsDocument(
    row.quoteRevisions,
    items,
  );
  if (
    !Number.isSafeInteger(row.quoteRevision) ||
    row.quoteRevision < 0 ||
    row.quoteRevision !== quoteRevisions.revisions.length
  ) {
    throw new PublicQuoteStorageCorruptionError();
  }
  return { items, quoteRevisions };
}

function validDate(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PublicQuoteStorageCorruptionError();
  }
  return value;
}

function publicRequestDto(
  row: LiveGrantRow,
  items: QuoteRequestItem[],
  latestQuote: ReturnType<typeof latestQuoteRevision>,
) {
  return {
    restaurantName: row.restaurantName,
    supplierName: row.supplierName,
    title: row.title,
    deliveryDetails: row.deliveryDetails,
    deliveryDate: validDate(row.deliveryDate).toISOString().slice(0, 10),
    quoteDeadline: validDate(row.quoteDeadline).toISOString(),
    commercialTerms: row.commercialTerms,
    items: items.map((item) => ({
      id: item.id,
      itemKey: item.itemKey,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      specification: item.specification,
    })),
    latestQuote,
  };
}

// This lookup is reached only after resolving and checking the live private grant.
// Bound the work; a missed older match simply means entering prices manually.
async function previousPrices(
  transaction: Prisma.TransactionClient,
  resolved: ResolvedGrant,
  row: LiveGrantRow,
  currentItems: QuoteRequestItem[],
): Promise<PreviousQuotePrices | null> {
  if (row.quoteRevision !== 0) return null;
  const candidates = await transaction.supplierRequest.findMany({
    where: {
      tenantId: resolved.tenantId,
      supplierId: row.supplierId,
      requestId: { not: row.requestId },
      quoteRevision: { gt: 0 },
      request: { tenantId: resolved.tenantId },
      // Awards revoke old links automatically. Only the current grant grants access.
      OR: [
        { request: { status: 'AWARDED' } },
        { revokedAt: null, request: { status: 'OPEN' } },
      ],
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: {
      quoteRevision: true,
      quoteRevisions: true,
      request: { select: { id: true, items: true, sourcing: true } },
    },
  });
  let result: PreviousQuotePrices | null = null;
  for (const candidate of candidates) {
    try {
      const documents = validateRequestDocuments(candidate.request.items, candidate.request.sourcing);
      const historicalItems = eligibleQuoteRequestItems({
        requestId: candidate.request.id,
        ...documents,
        supplier: { id: row.supplierId, applicationRequestId: row.applicationRequestId },
      });
      const prices = matchingPreviousPrices(currentItems, historicalItems,
        candidate.quoteRevisions, candidate.quoteRevision);
      if (prices && new Date(prices.submittedAt) < validDate(row.databaseNow) &&
        (!result || prices.submittedAt > result.submittedAt)) result = prices;
    } catch (error) {
      // Invalid legacy history must neither leak data nor prevent a fresh quote.
      if (!(error instanceof RequestDocumentValidationError) &&
        !(error instanceof PublicQuoteStorageCorruptionError)) throw error;
    }
  }
  return result;
}

const QUOTE_ENVELOPE_KEYS = new Set([
  'expectedLatestRevision',
  'deliveryDate',
  'validUntil',
  'minimumOrder',
  'freightInr',
  'commercialTerms',
  'notes',
  'items',
]);

function quoteEnvelope(value: unknown) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new PublicQuoteValidationError({
      quote: ['Provide a plain supplier quote object.'],
    });
  }
  const record = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    const descriptor = typeof key === 'string'
      ? Object.getOwnPropertyDescriptor(record, key)
      : undefined;
    if (
      typeof key !== 'string' ||
      !QUOTE_ENVELOPE_KEYS.has(key) ||
      !descriptor?.enumerable ||
      !('value' in descriptor)
    ) {
      throw new PublicQuoteValidationError({
        quote: ['The quote contains an unsupported field.'],
      });
    }
  }
  if (
    !Number.isSafeInteger(record.expectedLatestRevision) ||
    Number(record.expectedLatestRevision) < 0 ||
    Number(record.expectedLatestRevision) > 2_147_483_647
  ) {
    throw new PublicQuoteValidationError({
      expectedLatestRevision: ['Expected revision must be a non-negative integer.'],
    });
  }
  return {
    expectedLatestRevision: Number(record.expectedLatestRevision),
    submission: {
      deliveryDate: record.deliveryDate,
      validUntil: record.validUntil,
      minimumOrder: record.minimumOrder,
      freightInr: record.freightInr,
      commercialTerms: record.commercialTerms,
      notes: record.notes,
      items: record.items,
    },
  };
}

export async function getPublicQuoteRequest(
  input: { token: unknown },
  client: TenantTransactionHost = prisma,
) {
  const resolved = await resolveGrant(input.token, client);
  return withTenant(
    resolved.tenantId,
    async (transaction) => {
      const row = await liveGrantRow(transaction, resolved);
      const documents = liveDocuments(row);
      return {
        ...publicRequestDto(row, documents.items, latestQuoteRevision(documents.quoteRevisions)),
        previousPrices: await previousPrices(transaction, resolved, row, documents.items),
      };
    },
    client,
  );
}

export async function submitPublicSupplierQuote(
  input: { token: unknown; quote: unknown },
  client: TenantTransactionHost = prisma,
) {
  const resolved = await resolveGrant(input.token, client);
  const submissionAttempt = await consumeDigestRateLimit(
    {
      scope: 'supplier-quote-submit',
      subjectDigest: resolved.tokenDigest,
      limit: 20,
      windowMs: 15 * 60 * 1_000,
      now: new Date(),
    },
    client,
  );
  if (!submissionAttempt.allowed) {
    throw new PublicQuoteSubmissionLimitError(
      submissionAttempt.retryAfterSeconds,
    );
  }
  return withTenant(
    resolved.tenantId,
    async (transaction) => {
      const row = await lockedLiveGrantRow(transaction, resolved);
      const documents = liveDocuments(row);
      const envelope = quoteEnvelope(input.quote);
      const quoteRevisions = appendQuoteRevision(
        documents.quoteRevisions,
        envelope.submission,
        {
          requestItems: documents.items,
          expectedLatestRevision: envelope.expectedLatestRevision,
          storedLatestRevision: row.quoteRevision,
          databaseNow: validDate(row.databaseNow),
        },
      );
      const latest = latestQuoteRevision(quoteRevisions);
      if (!latest) throw new PublicQuoteStorageCorruptionError();
      const updated = await transaction.supplierRequest.updateMany({
        where: {
          tenantId: resolved.tenantId,
          id: resolved.supplierRequestId,
          quoteRevision: row.quoteRevision,
        },
        data: {
          quoteRevision: latest.revision,
          quoteRevisions: quoteRevisions as unknown as Prisma.InputJsonValue,
          ...(!row.viewedAt ? { viewedAt: row.databaseNow } : {}),
        },
      });
      if (updated.count !== 1) throw new PublicQuoteRevisionConflictError();
      await writeAuditEvent(transaction, {
        tenantId: resolved.tenantId,
        action: 'quote.submitted',
        entityId: resolved.supplierRequestId,
        metadata: {
          revision: latest.revision,
          itemCount: documents.items.length,
        },
      });
      return latest;
    },
    client,
  );
}
