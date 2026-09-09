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
      isActive: true,
      tenant: { isActive: true },
    },
    select: { id: true },
  });
  if (!active) throw new AuthorizationError();
}

function groupedCount(
  groups: Array<{ status: string; _count: { _all: number } }>,
  status: string,
) {
  return groups.find((group) => group.status === status)?._count._all ?? 0;
}

function databaseCount(value: bigint | undefined) {
  const count = Number(value ?? BigInt(0));
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('Overview count is outside the supported range.');
  }
  return count;
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

        const [
          activeSuppliers,
          menuGroups,
          requestGroups,
          quotesReceivedForOpenRequests,
          deadlines,
          recentAwards,
          deliveryRows,
          attention,
        ] = await Promise.all([
          transaction.supplier.count({
            where: { tenantId: actor.tenantId, isActive: true },
          }),
          transaction.menu.groupBy({
            by: ['status'],
            where: { tenantId: actor.tenantId },
            _count: { _all: true },
          }),
          transaction.procurementRequest.groupBy({
            by: ['status'],
            where: {
              tenantId: actor.tenantId,
              status: { in: ['DRAFT', 'OPEN', 'AWARDED'] },
            },
            _count: { _all: true },
          }),
          transaction.supplierRequest.count({
            where: {
              tenantId: actor.tenantId,
              request: { tenantId: actor.tenantId, status: 'OPEN' },
              quoteRevision: { gt: 0 },
            },
          }),
          transaction.procurementRequest.findMany({
            where: { tenantId: actor.tenantId, status: 'OPEN' },
            orderBy: [{ quoteDeadline: 'asc' }, { id: 'asc' }],
            take: OVERVIEW_LIST_LIMIT,
            select: {
              id: true,
              title: true,
              quoteDeadline: true,
              _count: { select: { supplierRequests: true } },
            },
          }),
          transaction.award.findMany({
            where: { tenantId: actor.tenantId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: OVERVIEW_LIST_LIMIT,
            select: {
              id: true,
              requestId: true,
              totalPaise: true,
              createdAt: true,
              request: { select: { title: true } },
            },
          }),
          transaction.$queryRaw<Array<{ waiting: bigint; problems: bigint }>>(Prisma.sql`
            SELECT
              COALESCE(SUM(GREATEST(
                jsonb_array_length(award."supplierSnapshots"->'suppliers')
                - COALESCE(checks.checked, 0),
                0
              )), 0)::bigint AS "waiting",
              COALESCE(SUM(COALESCE(checks.problems, 0)), 0)::bigint AS "problems"
            FROM "Award" AS award
            LEFT JOIN LATERAL (
              SELECT
                COUNT(*)::integer AS "checked",
                COUNT(*) FILTER (WHERE entry->>'outcome' = 'ISSUES')::integer AS "problems"
              FROM jsonb_array_elements(
                COALESCE(award."receiving"->'suppliers', '[]'::jsonb)
              ) AS entry
            ) AS checks ON TRUE
            WHERE award."tenantId" = ${actor.tenantId}
          `),
          loadOverviewAttention(transaction, actor.tenantId, now),
        ]);

        const responseGroups = deadlines.length
          ? await transaction.supplierRequest.groupBy({
              by: ['requestId'],
              where: {
                tenantId: actor.tenantId,
                requestId: { in: deadlines.map(({ id }) => id) },
                quoteRevision: { gt: 0 },
              },
              _count: { _all: true },
            })
          : [];
        const responsesByRequest = new Map(
          responseGroups.map((group) => [group.requestId, group._count._all]),
        );

        return {
          generatedAt: now.toISOString(),
          attention,
          counts: {
            activeSuppliers,
            menus: {
              draft: groupedCount(menuGroups, 'DRAFT'),
              approved: groupedCount(menuGroups, 'APPROVED'),
            },
            requests: {
              draft: groupedCount(requestGroups, 'DRAFT'),
              open: groupedCount(requestGroups, 'OPEN'),
              awarded: groupedCount(requestGroups, 'AWARDED'),
            },
            quotesReceivedForOpenRequests,
          },
          deliveryAttention: {
            waiting: databaseCount(deliveryRows[0]?.waiting),
            problems: databaseCount(deliveryRows[0]?.problems),
          },
          deadlines: deadlines.map((request) => ({
            requestId: request.id,
            title: request.title,
            quoteDeadline: request.quoteDeadline.toISOString(),
            suppliersInvited: request._count.supplierRequests,
            quotesReceived: responsesByRequest.get(request.id) ?? 0,
          })),
          recentAwards: recentAwards.map((award) => ({
            awardId: award.id,
            requestId: award.requestId,
            title: award.request.title,
            totalPaise: award.totalPaise.toString(),
            awardedAt: award.createdAt.toISOString(),
          })),
        };
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
