import { Prisma } from '@prisma/client';

import { validateAwardDocuments } from '@/lib/awards/award-document';
import { AuthorizationError } from '@/lib/auth/guards';
import { normalizeQuoteQuantityMilli, normalizeQuoteUnitRatePaise } from '@/lib/comparison/compare-quotes';
import { type TenantTransactionHost, withTenant } from '@/lib/db/tenant-transaction';
import type { ProcurementUnit } from '@/lib/domain/quantity';
import { formatScaledDecimal, MAX_DECIMAL_18_3_SCALED, parseUnsignedFixed } from '@/lib/domain/validation';
import { prisma } from '@/lib/prisma';
import { validateRequestItems } from '@/lib/procurement/request-document';
import { buildReceivingSummary, validateStoredReceiving } from '@/lib/receiving/receiving-document';
import {
  validateQuoteRevisionsDocument,
  validateStoredQuoteRevision,
} from '@/lib/quotes/quote-revisions';
import {
  buildHistoryGuidance,
  type ItemHistoryGuidance,
} from '@/lib/reporting/history-guidance';

export const REPORTING_LIMITS = {
  historyPage: 50,
  insightRequests: 50,
  insightSupplierRequests: 250,
  recentHistoryRecords: 25,
  cursorBytes: 1_024,
} as const;

export class ReportingValidationError extends Error {
  readonly code = 'INVALID_REPORTING_REQUEST';
  readonly status = 422;

  constructor(readonly errors: Record<string, string[]>) {
    super('The reporting request contains invalid or unbounded fields.');
    this.name = 'ReportingValidationError';
  }
}

type ReportingActor = { tenantId: string; userId: string };

type InsightRequest = {
  items: Array<{
    id: string;
    itemKey: string;
    name: string;
    quantity: string;
    unit: ProcurementUnit;
  }>;
  supplierRequests: Array<{
    supplierName: string;
    latestQuote: null | {
      id: string;
      items: Array<{
        requestItemId: string;
        noQuote: boolean;
        availableQuantity: string | null;
        unit: ProcurementUnit | null;
        unitRatePaise: string | null;
      }>;
    };
  }>;
};

type InsightSupplierRequestRow = {
  id: string;
  requestId: string;
  businessName: string;
  quoteRevision: number;
  latestQuote: unknown;
};

function percentage(numerator: number, denominator: number) {
  if (denominator === 0) return null;
  const tenths = Math.round((numerator * 1_000) / denominator);
  return formatScaledDecimal(BigInt(tenths), 1);
}

function variancePercent(minimum: bigint, maximum: bigint) {
  if (minimum <= BigInt(0) || maximum < minimum) return null;
  const hundredths = ((maximum - minimum) * BigInt(10_000) + minimum / BigInt(2)) / minimum;
  return formatScaledDecimal(hundredths, 2);
}

export function buildFactualInsights(input: {
  requests: InsightRequest[];
  awardedRequestCount: number;
  totalAwardedPaise: string;
  capped: boolean;
  generatedAt: Date;
  historyGuidance?: ItemHistoryGuidance[];
}) {
  let supplierRequestsSent = 0;
  let supplierResponses = 0;
  let quoteLinesExpected = 0;
  let quoteLinesFullyCovered = 0;
  const ranges = new Map<string, {
    itemName: string;
    unit: ProcurementUnit;
    quotes: Map<string, { rate: bigint; supplierName: string }>;
  }>();

  for (const request of input.requests) {
    supplierRequestsSent += request.supplierRequests.length;
    for (const supplierRequest of request.supplierRequests) {
      const quote = supplierRequest.latestQuote;
      if (!quote) continue;
      supplierResponses += 1;
      const quoteItems = new Map(quote.items.map((item) => [item.requestItemId, item]));
      for (const requestItem of request.items) {
        quoteLinesExpected += 1;
        const quoted = quoteItems.get(requestItem.id);
        if (
          !quoted || quoted.noQuote || quoted.availableQuantity === null ||
          quoted.unit === null || quoted.unitRatePaise === null
        ) continue;
        let available: bigint | null = null;
        let rate: bigint | null = null;
        try {
          available = normalizeQuoteQuantityMilli(
            quoted.availableQuantity,
            quoted.unit,
            requestItem.unit,
          );
          rate = normalizeQuoteUnitRatePaise(
            BigInt(quoted.unitRatePaise),
            quoted.unit,
            requestItem.unit,
          );
        } catch {
          available = null;
          rate = null;
        }
        if (available === null || rate === null) continue;
        const requested = parseUnsignedFixed(requestItem.quantity, {
          label: 'Requested quantity', scale: 3,
          maximumScaled: MAX_DECIMAL_18_3_SCALED, allowZero: false,
        });
        if (available >= requested) quoteLinesFullyCovered += 1;
        const normalizedName = requestItem.name.trim().toLocaleLowerCase('en-IN');
        const key = `${normalizedName}\u0000${requestItem.unit}`;
        const range = ranges.get(key) ?? {
          itemName: requestItem.name.trim(),
          unit: requestItem.unit,
          quotes: new Map(),
        };
        range.quotes.set(quote.id, { rate, supplierName: supplierRequest.supplierName });
        ranges.set(key, range);
      }
    }
  }

  const priceRanges = [...ranges.values()].flatMap((range) => {
    const quotes = [...range.quotes.values()];
    if (quotes.length < 2) return [];
    quotes.sort((left, right) => left.rate < right.rate ? -1 : left.rate > right.rate ? 1 : left.supplierName.localeCompare(right.supplierName, 'en-IN'));
    const minimum = quotes[0];
    const maximum = quotes.at(-1)!;
    return [{
      itemName: range.itemName,
      unit: range.unit,
      quoteCount: quotes.length,
      minimumUnitRatePaise: minimum.rate.toString(),
      maximumUnitRatePaise: maximum.rate.toString(),
      minimumSupplierName: minimum.supplierName,
      maximumSupplierName: maximum.supplierName,
      observedVariancePercent: variancePercent(minimum.rate, maximum.rate),
    }];
  }).sort((left, right) =>
    right.quoteCount - left.quoteCount ||
    left.itemName.localeCompare(right.itemName, 'en-IN') ||
    left.unit.localeCompare(right.unit),
  ).slice(0, 20);

  return {
    generatedAt: input.generatedAt.toISOString(),
    capped: input.capped,
    summary: {
      requestSampleSize: input.requests.length,
      supplierRequestsSent,
      supplierResponses,
      responseRatePercent: percentage(supplierResponses, supplierRequestsSent),
      quoteLinesExpected,
      quoteLinesFullyCovered,
      quotedLineCoveragePercent: percentage(quoteLinesFullyCovered, quoteLinesExpected),
      awardedRequestCount: input.awardedRequestCount,
      totalAwardedPaise: input.totalAwardedPaise,
    },
    historyGuidance: input.historyGuidance ?? [],
    priceRanges,
    notes: [
      `Response and coverage use the latest submitted quote from up to ${REPORTING_LIMITS.insightRequests} recent open or awarded requests.`,
      'Observed ranges compare submitted quotes; they are not savings claims or automatic recommendations.',
    ],
  };
}

function validId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

const historyActivityLabels = {
  'member.invited': () => 'Team invitation created',
  'member.invitation-revoked': () => 'Team invitation cancelled',
  'member.joined': () => 'Team member joined',
  'member.deactivated': () => 'Team member deactivated',
  'workspace.updated': () => 'Restaurant details updated',
  'menu.approved': () => 'Menu approved',
  'supplier.created': () => 'Supplier added',
  'request.opened': () => 'Request sent to suppliers',
  'supplier-link.created': () => 'Supplier quote link created',
  'supplier-link.revoked': () => 'Supplier quote link closed',
  'quote.submitted': (metadata: unknown) => {
    const revision = metadata && typeof metadata === 'object' && 'revision' in metadata
      ? (metadata as { revision?: unknown }).revision
      : null;
    return Number.isSafeInteger(revision) && Number(revision) > 0
      ? `Supplier sent quote version ${revision}`
      : 'Supplier sent a quote';
  },
  'request.awarded': () => 'Award recorded',
  'delivery.checked': () => 'Delivery checked',
  'service_plan.created': () => 'Daily service plan created',
  'service_plan.updated': () => 'Daily service plan updated',
  'service_plan.procurement_drafted': () => 'Ingredient shortages copied into a procurement draft',
  'request.cancelled': () => 'Request cancelled',
  'request.repeated': () => 'Request copied into a new draft',
  'audit.export': () => 'Procurement record downloaded',
} as const;

type HistoryAuditRecord = {
  id: string;
  action: string;
  createdAt: Date;
  actor: { name: string } | null;
  metadata: unknown;
};

export function buildHistoryActivity(records: HistoryAuditRecord[]) {
  return records.flatMap((record) => {
    const label = historyActivityLabels[record.action as keyof typeof historyActivityLabels];
    if (!label) return [];
    return [{
      id: record.id,
      label: label(record.metadata),
      actorName: record.actor?.name.trim() || (record.action === 'quote.submitted' ? 'Supplier' : 'System'),
      createdAt: record.createdAt.toISOString(),
    }];
  });
}

function validateActor(actor: ReportingActor) {
  if (!validId(actor?.tenantId) || !validId(actor?.userId)) throw new AuthorizationError();
  return actor;
}

async function requireActor(transaction: Parameters<Parameters<typeof withTenant>[1]>[0], actor: ReportingActor) {
  const user = await transaction.user.findFirst({
    where: { id: actor.userId, tenantId: actor.tenantId, accountState: 'ACTIVE', isActive: true, tenant: { isActive: true } },
    select: { id: true },
  });
  if (!user) throw new AuthorizationError();
}

export async function getFactualInsights(
  input: { actor: ReportingActor },
  client: TenantTransactionHost = prisma,
) {
  const actor = validateActor(input.actor);
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActor(transaction, actor);
    const [requests, awardTotals, historicalAwards, clock] = await Promise.all([
      transaction.procurementRequest.findMany({
        where: { tenantId: actor.tenantId, status: { in: ['OPEN', 'AWARDED'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: REPORTING_LIMITS.insightRequests + 1,
        select: {
          id: true,
          items: true,
        },
      }),
      transaction.award.aggregate({
        where: { tenantId: actor.tenantId },
        _count: { _all: true },
        _sum: { totalPaise: true },
      }),
      transaction.award.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: REPORTING_LIMITS.insightRequests,
        select: {
          id: true,
          createdAt: true,
          allocationLines: true,
          supplierSnapshots: true,
          deliverySnapshot: true,
          totalPaise: true,
        },
      }),
      transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`,
    ]);
    const requestSampleCapped = requests.length > REPORTING_LIMITS.insightRequests;
    if (requestSampleCapped) requests.pop();
    const requestIds = requests.map(({ id }) => id);
    const supplierRequestRows = requestIds.length === 0
      ? []
      : await transaction.$queryRaw<InsightSupplierRequestRow[]>(Prisma.sql`
          SELECT supplier_request."id",
                 supplier_request."requestId",
                 supplier."businessName",
                 supplier_request."quoteRevision",
                 supplier_request."quoteRevisions"->'revisions'->-1 AS "latestQuote"
          FROM "SupplierRequest" AS supplier_request
          INNER JOIN "Supplier" AS supplier
            ON supplier."tenantId" = supplier_request."tenantId"
           AND supplier."id" = supplier_request."supplierId"
          WHERE supplier_request."tenantId" = ${actor.tenantId}
            AND supplier_request."requestId" IN (${Prisma.join(requestIds)})
          ORDER BY supplier_request."requestId", supplier."businessName", supplier_request."id"
          LIMIT ${REPORTING_LIMITS.insightSupplierRequests + 1}
        `);
    const supplierSampleCapped = supplierRequestRows.length > REPORTING_LIMITS.insightSupplierRequests;
    if (supplierSampleCapped) supplierRequestRows.pop();
    const supplierRequestsByRequest = new Map<string, InsightSupplierRequestRow[]>();
    for (const row of supplierRequestRows) {
      const values = supplierRequestsByRequest.get(row.requestId) ?? [];
      values.push(row);
      supplierRequestsByRequest.set(row.requestId, values);
    }
    const generatedAt = clock[0]?.now;
    if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) {
      throw new TypeError('PostgreSQL reporting clock is unavailable.');
    }
    const parsedRequests = requests.map((request) => {
      const items = validateRequestItems(request.items).items;
      return {
        items: items.map((item) => ({
          id: item.id,
          itemKey: item.itemKey,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
        })),
        supplierRequests: (supplierRequestsByRequest.get(request.id) ?? []).map((supplierRequest) => {
          const quote = supplierRequest.quoteRevision > 0
            ? validateStoredQuoteRevision(
                supplierRequest.latestQuote,
                supplierRequest.quoteRevision,
                items,
              )
            : null;
          return {
            supplierName: supplierRequest.businessName,
            latestQuote: quote ? {
              id: `${supplierRequest.id}:${quote.revision}`,
              items: quote.items.map((item) => ({
                requestItemId: item.requestItemId,
                noQuote: item.noQuote,
                availableQuantity: item.availableQuantity,
                unit: item.unit,
                unitRatePaise: item.unitRatePaise,
              })),
            } : null,
          };
        }),
      };
    });
    const parsedAwards = historicalAwards.map((award) => ({
      id: award.id,
      createdAt: award.createdAt,
      ...validateAwardDocuments(award),
    }));
    return buildFactualInsights({
      requests: parsedRequests,
      awardedRequestCount: awardTotals._count._all,
      totalAwardedPaise: awardTotals._sum.totalPaise?.toString() ?? '0',
      capped: requestSampleCapped || supplierSampleCapped,
      generatedAt,
      historyGuidance: buildHistoryGuidance({
        items: parsedRequests.flatMap(({ items }) => items.map((item) => ({
          itemKey: item.itemKey,
          itemName: item.name,
          quantity: item.quantity,
          unit: item.unit,
        }))),
        awards: parsedAwards,
      }),
    });
  }, client);
}

type HistoryCursor = { snapshot: Date; createdAt: Date; id: string };

export function encodeHistoryCursor(cursor: HistoryCursor) {
  return Buffer.from(JSON.stringify({
    v: 1,
    snapshot: cursor.snapshot.toISOString(),
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  }), 'utf8').toString('base64url');
}

export function decodeHistoryCursor(value: string): HistoryCursor {
  if (!value || Buffer.byteLength(value, 'utf8') > REPORTING_LIMITS.cursorBytes) {
    throw new ReportingValidationError({ cursor: ['History cursor is invalid.'] });
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    const snapshot = new Date(String(parsed.snapshot ?? ''));
    const createdAt = new Date(String(parsed.createdAt ?? ''));
    if (
      parsed.v !== 1 || !validId(parsed.id) ||
      Number.isNaN(snapshot.getTime()) || Number.isNaN(createdAt.getTime()) ||
      createdAt.getTime() > snapshot.getTime()
    ) throw new Error('invalid');
    return { snapshot, createdAt, id: String(parsed.id) };
  } catch {
    throw new ReportingValidationError({ cursor: ['History cursor is invalid.'] });
  }
}

export async function listProcurementHistory(
  input: { actor: ReportingActor; cursor?: string; limit?: number },
  client: TenantTransactionHost = prisma,
) {
  const actor = validateActor(input.actor);
  const limit = input.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > REPORTING_LIMITS.historyPage) {
    throw new ReportingValidationError({ limit: [`Limit must be between 1 and ${REPORTING_LIMITS.historyPage}.`] });
  }
  const decoded = input.cursor ? decodeHistoryCursor(input.cursor) : null;
  return withTenant(actor.tenantId, async (transaction) => {
    await requireActor(transaction, actor);
    const clock = decoded ? null : await transaction.$queryRaw<Array<{ now: Date }>>`SELECT transaction_timestamp() AS "now"`;
    const snapshot = decoded?.snapshot ?? clock?.[0]?.now;
    if (!(snapshot instanceof Date) || Number.isNaN(snapshot.getTime())) throw new TypeError('PostgreSQL history clock is unavailable.');
    const [requests, quoteRevisions, auditRecords] = await Promise.all([
      transaction.procurementRequest.findMany({
      where: {
        tenantId: actor.tenantId,
        openedAt: { not: null },
        createdAt: { lte: snapshot },
        ...(decoded ? { OR: [
          { createdAt: { lt: decoded.createdAt } },
          { createdAt: decoded.createdAt, id: { lt: decoded.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, title: true, status: true, version: true,
        deliveryDate: true, quoteDeadline: true, createdAt: true, openedAt: true, awardedAt: true,
        items: true,
        _count: { select: { supplierRequests: true } },
        award: {
          select: {
            id: true,
            totalPaise: true,
            createdAt: true,
            allocationLines: true,
            supplierSnapshots: true,
            deliverySnapshot: true,
            receiving: true,
          },
        },
      },
      }),
      decoded ? Promise.resolve([]) : transaction.supplierRequest.findMany({
        where: {
          tenantId: actor.tenantId,
          quoteRevision: { gt: 0 },
          updatedAt: { lte: snapshot },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: REPORTING_LIMITS.recentHistoryRecords,
        select: {
          id: true,
          quoteRevisions: true,
          request: { select: { id: true, title: true, items: true } },
          supplier: { select: { businessName: true } },
        },
      }),
      decoded ? Promise.resolve([]) : transaction.auditEvent.findMany({
        where: {
          tenantId: actor.tenantId,
          createdAt: { lte: snapshot },
          action: { in: Object.keys(historyActivityLabels) },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: REPORTING_LIMITS.recentHistoryRecords,
        select: {
          id: true,
          action: true,
          metadata: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      }),
    ]);
    const hasMore = requests.length > limit;
    if (hasMore) requests.pop();
    const requestIds = requests.map(({ id }) => id);
    const responseCounts = requestIds.length === 0
      ? []
      : await transaction.supplierRequest.groupBy({
          by: ['requestId'],
          where: {
            tenantId: actor.tenantId,
            requestId: { in: requestIds },
            quoteRevision: { gt: 0 },
          },
          _count: { _all: true },
          _sum: { quoteRevision: true },
          orderBy: { requestId: 'asc' },
          take: REPORTING_LIMITS.historyPage,
        });
    const responseCountsByRequest = new Map(responseCounts.map((entry) => [
      entry.requestId,
      {
        respondingSupplierCount: entry._count._all,
        quoteRevisionCount: entry._sum.quoteRevision ?? 0,
      },
    ]));
    const last = requests.at(-1);
    return {
      requests: requests.map(({ items, award, ...request }) => {
        const requestItems = validateRequestItems(items).items;
        const awardDocuments = award ? validateAwardDocuments(award) : null;
        const receiving = award && awardDocuments ? buildReceivingSummary({
          allocationLines: awardDocuments.allocationLines,
          supplierSnapshots: awardDocuments.supplierSnapshots,
          receiving: validateStoredReceiving(award.receiving),
        }) : null;
        const counts = responseCountsByRequest.get(request.id) ?? {
          respondingSupplierCount: 0,
          quoteRevisionCount: 0,
        };
        return {
          ...request,
          _count: {
            items: requestItems.length,
            supplierRequests: request._count.supplierRequests,
          },
          ...counts,
          award: award && awardDocuments ? {
            id: award.id,
            totalPaise: award.totalPaise.toString(),
            createdAt: award.createdAt,
            supplierCount: awardDocuments.supplierSnapshots.suppliers.length,
            receiving: receiving ? {
              checkedCount: receiving.checkedCount,
              totalCount: receiving.totalCount,
              complete: receiving.complete,
              problemCount: receiving.problemCount,
            } : null,
          } : null,
        };
      }),
      nextCursor: hasMore && last ? encodeHistoryCursor({ snapshot, createdAt: last.createdAt, id: last.id }) : null,
      recentQuoteRevisions: quoteRevisions.flatMap((supplierRequest) => {
        const requestItems = validateRequestItems(supplierRequest.request.items).items;
        const revisions = validateQuoteRevisionsDocument(
          supplierRequest.quoteRevisions,
          requestItems,
        ).revisions;
        return revisions.map((quote) => ({
          id: `${supplierRequest.id}:${quote.revision}`,
          requestId: supplierRequest.request.id,
          requestTitle: supplierRequest.request.title,
          supplierName: supplierRequest.supplier.businessName,
          revision: quote.revision,
          submittedAt: quote.submittedAt,
          totalPaise: quote.totalPaise,
        }));
      }).sort((left, right) =>
        right.submittedAt.localeCompare(left.submittedAt) ||
        right.id.localeCompare(left.id, 'en-IN'),
      ).slice(0, REPORTING_LIMITS.recentHistoryRecords),
      recentActivity: buildHistoryActivity(auditRecords),
    };
  }, client);
}
