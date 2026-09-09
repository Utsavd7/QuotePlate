import { Prisma, type PrismaClient } from '@prisma/client';

import { AuthorizationError } from '@/lib/auth/guards';
import { withTenant } from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';
import { loadOverviewAttention, type OverviewAttention } from './overview-attention';

const OVERVIEW_LIST_LIMIT = 5;
const ACTOR_ID_BYTES = 200;

export type OverviewActor = { tenantId: string; userId: string };

export type OverviewData = {
  generatedAt: string;
  attention: OverviewAttention;
  counts: {
    activeSuppliers: number;
    menus: { draft: number; approved: number };
    requests: { draft: number; open: number; awarded: number };
    quotesReceivedForOpenRequests: number;
  };
  deliveryAttention: { waiting: number; problems: number };
  deadlines: Array<{
    requestId: string;
    title: string;
    quoteDeadline: string;
    suppliersInvited: number;
    quotesReceived: number;
  }>;
  recentAwards: Array<{
    awardId: string;
    requestId: string;
    title: string;
    totalPaise: string;
    awardedAt: string;
  }>;
};

type OverviewDependencies = {
  transact: <T>(
    tenantId: string,
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  now: () => Date;
};

type OverviewClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>;

function validActorId(value: string) {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= ACTOR_ID_BYTES &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function requireValidActor(actor: OverviewActor) {
  if (!validActorId(actor.tenantId) || !validActorId(actor.userId)) {
    throw new AuthorizationError();
  }
  return actor;
}

async function requireActiveActor(
  transaction: Prisma.TransactionClient,
  actor: OverviewActor,
) {
  const active = await transaction.user.findFirst({
    where: {
      id: actor.userId,
      tenantId: actor.tenantId,
      accountState: 'ACTIVE',
      isActive: true,
      tenant: { isActive: true },
    },
    select: { id: true },
  });
  if (!active) throw new AuthorizationError();
}

type OverviewSummaryRow = {
  activeSuppliers: bigint;
  draftMenus: bigint;
  approvedMenus: bigint;
  draftRequests: bigint;
  openRequests: bigint;
  awardedRequests: bigint;
  quotesReceived: bigint;
  waiting: bigint;
  problems: bigint;
  deadlines: Array<Omit<OverviewData['deadlines'][number], 'suppliersInvited' | 'quotesReceived'> & {
    suppliersInvited: string;
    quotesReceived: string;
  }>;
  recentAwards: OverviewData['recentAwards'];
};

function databaseCount(value: bigint | string) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('Overview count is outside the supported range.');
  }
  return count;
}

/** Keep summary reads in one round trip on the interactive transaction connection. */
async function loadOverviewSummary(transaction: Prisma.TransactionClient, tenantId: string) {
  const [summary] = await transaction.$queryRaw<OverviewSummaryRow[]>(Prisma.sql`
    WITH tenant_requests AS (
      SELECT "id", "title", "status", "quoteDeadline"
      FROM "ProcurementRequest" WHERE "tenantId" = ${tenantId}
    ), response_counts AS (
      SELECT response."requestId", COUNT(*) AS invited,
        COUNT(*) FILTER (WHERE response."quoteRevision" > 0) AS replied
      FROM "SupplierRequest" response
      JOIN tenant_requests request ON request."id" = response."requestId" AND request."status" = 'OPEN'
      WHERE response."tenantId" = ${tenantId}
      GROUP BY response."requestId"
    ), tenant_awards AS (
      SELECT "id", "requestId", "totalPaise", "createdAt", "supplierSnapshots", "receiving"
      FROM "Award" WHERE "tenantId" = ${tenantId}
    ), deadline_list AS (
      SELECT "id", "title", "quoteDeadline" FROM tenant_requests
      WHERE "status" = 'OPEN' ORDER BY "quoteDeadline", "id" LIMIT ${OVERVIEW_LIST_LIMIT}
    ), award_list AS (
      SELECT "id", "requestId", "totalPaise", "createdAt" FROM tenant_awards
      ORDER BY "createdAt" DESC, "id" DESC LIMIT ${OVERVIEW_LIST_LIMIT}
    )
    SELECT
      (SELECT COUNT(*) FROM "Supplier" WHERE "tenantId" = ${tenantId} AND "isActive") AS "activeSuppliers",
      menus.*, requests.*,
      (SELECT COALESCE(SUM(replied), 0)::bigint FROM response_counts) AS "quotesReceived",
      delivery.*,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'requestId', request."id", 'title', request."title",
        'quoteDeadline', to_char(request."quoteDeadline", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'suppliersInvited', COALESCE(response.invited, 0)::text,
        'quotesReceived', COALESCE(response.replied, 0)::text
      ) ORDER BY request."quoteDeadline", request."id"), '[]'::jsonb)
       FROM deadline_list request LEFT JOIN response_counts response ON response."requestId" = request."id"
      ) AS deadlines,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'awardId', award."id", 'requestId', award."requestId", 'title', request."title",
        'totalPaise', award."totalPaise"::text,
        'awardedAt', to_char(award."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY award."createdAt" DESC, award."id" DESC), '[]'::jsonb)
       FROM award_list award JOIN tenant_requests request ON request."id" = award."requestId"
      ) AS "recentAwards"
    FROM (
      SELECT COUNT(*) FILTER (WHERE "status" = 'DRAFT') AS "draftMenus",
        COUNT(*) FILTER (WHERE "status" = 'APPROVED') AS "approvedMenus"
      FROM "Menu" WHERE "tenantId" = ${tenantId}
    ) menus
    CROSS JOIN (
      SELECT COUNT(*) FILTER (WHERE "status" = 'DRAFT') AS "draftRequests",
        COUNT(*) FILTER (WHERE "status" = 'OPEN') AS "openRequests",
        COUNT(*) FILTER (WHERE "status" = 'AWARDED') AS "awardedRequests"
      FROM tenant_requests
    ) requests
    CROSS JOIN (
      SELECT COALESCE(SUM(GREATEST(
        jsonb_array_length(award."supplierSnapshots"->'suppliers') - COALESCE(checks.checked, 0), 0
      )), 0)::bigint AS waiting,
        COALESCE(SUM(COALESCE(checks.problems, 0)), 0)::bigint AS problems
      FROM tenant_awards award
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS checked,
          COUNT(*) FILTER (WHERE entry->>'outcome' = 'ISSUES') AS problems
        FROM jsonb_array_elements(COALESCE(award."receiving"->'suppliers', '[]'::jsonb)) entry
      ) checks ON TRUE
    ) delivery
  `);
  if (!summary) throw new TypeError('Overview summary is unavailable.');
  // Prisma stores these TIMESTAMP(3) values in UTC. SQL formats them explicitly;
  // paise and nested counts travel as text to avoid JSON number precision loss.
  return {
    counts: {
      activeSuppliers: databaseCount(summary.activeSuppliers),
      menus: { draft: databaseCount(summary.draftMenus), approved: databaseCount(summary.approvedMenus) },
      requests: {
        draft: databaseCount(summary.draftRequests), open: databaseCount(summary.openRequests),
        awarded: databaseCount(summary.awardedRequests),
      },
      quotesReceivedForOpenRequests: databaseCount(summary.quotesReceived),
    },
    deliveryAttention: { waiting: databaseCount(summary.waiting), problems: databaseCount(summary.problems) },
    deadlines: summary.deadlines.map(request => ({
      ...request, suppliersInvited: databaseCount(request.suppliersInvited),
      quotesReceived: databaseCount(request.quotesReceived),
    })),
    recentAwards: summary.recentAwards,
  };
}

const defaultDependencies: OverviewDependencies = {
  transact: (tenantId, callback) => withTenant(tenantId, callback, prisma),
  now: () => new Date(),
};

export function createOverviewOperations(
  dependencies: OverviewDependencies = defaultDependencies,
) {
  return {
    async load(input: { actor: OverviewActor }): Promise<OverviewData> {
      const actor = requireValidActor(input.actor);
      return dependencies.transact(actor.tenantId, async (transaction) => {
        await requireActiveActor(transaction, actor);
        const now = dependencies.now();

        const [summary, attention] = await Promise.all([
          loadOverviewSummary(transaction, actor.tenantId),
          loadOverviewAttention(transaction, actor.tenantId, now),
        ]);
        return { generatedAt: now.toISOString(), attention, ...summary };
      });
    },
  };
}

export function createPrismaOverviewOperations(client: OverviewClient) {
  return createOverviewOperations({
    transact: (tenantId, callback) => withTenant(tenantId, callback, client),
    now: () => new Date(),
  });
}

const overviewOperations = createOverviewOperations();

export function getOverview(input: { actor: OverviewActor }) {
  return overviewOperations.load(input);
}
