import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  getFactualInsights,
  listProcurementHistory,
} from '@/lib/reporting/reporting-service';

import { withMigratedPostgres } from './setup/postgres';
import { createPrismaWorkspaceSettingsOperations } from '@/lib/account/workspace-settings';
import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import {
  awardDocuments,
  emptyCapabilities,
  quoteRevisions,
  requestItems,
  requestSourcing,
} from './setup/compact-reporting-fixtures';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

async function provisionAppClient(admin: PrismaClient, databaseUrl: string) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
  const client = new PrismaClient({ datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } } });
  await client.$connect();
  return client;
}

async function seedHistory(admin: PrismaClient, suffix: string) {
  const tenantId = `tenant-${suffix}`;
  const userId = `user-${suffix}`;
  await admin.tenant.create({
    data: {
      id: tenantId,
      name: `${suffix} Kitchen`,
      addressLine: '1 Market Road',
      city: suffix === 'a' ? 'Mumbai' : 'Private City',
      state: 'Maharashtra',
      pin: suffix === 'a' ? '400001' : '499999',
      phone: '9000000000',
      users: { create: { id: userId, name: `${suffix} Buyer`, email: `${suffix}@example.test`, role: 'MEMBER' } },
    },
  });
  const supplier = await admin.supplier.create({
    data: {
      id: `supplier-${suffix}`,
      tenantId,
      businessName: `${suffix} Fresh Foods`,
      capabilities: emptyCapabilities,
    },
  });
  const items = requestItems({ name: 'Produce' });
  const request = await admin.procurementRequest.create({
    data: {
      id: `request-${suffix}`, tenantId, title: `${suffix} Produce`, status: 'OPEN',
      deliveryDetails: { addressLine: '1 Market Road' },
      deliveryDate: new Date('2026-09-05T00:00:00.000Z'),
      quoteDeadline: new Date('2026-09-03T08:00:00.000Z'),
      items,
      sourcing: requestSourcing(supplier.id),
      openedAt: new Date('2026-08-28T08:00:00.000Z'),
      createdAt: new Date('2026-08-28T07:00:00.000Z'),
      createdByUserId: userId,
    },
  });
  const grant = await admin.supplierRequest.create({
    data: {
      id: `grant-${suffix}`, tenantId, requestId: request.id, supplierId: supplier.id,
      tokenDigest: randomBytes(32).toString('hex'),
      createdAt: new Date('2026-08-28T08:00:00.000Z'),
      expiresAt: new Date('2026-09-03T08:00:00.000Z'),
      quoteRevision: suffix === 'a' ? 2 : 1,
      quoteRevisions: quoteRevisions({ count: suffix === 'a' ? 2 : 1 }),
    },
  });
  const quoteCount = suffix === 'a' ? 2 : 1;
  if (suffix === 'a') {
    await admin.procurementRequest.update({
      where: { id: request.id },
      data: {
        status: 'AWARDED',
        awardedAt: new Date('2026-08-28T11:00:00.000Z'),
      },
    });
    await admin.award.create({
      data: {
        id: 'award-a',
        tenantId,
        requestId: request.id,
        ...awardDocuments({
          supplierId: supplier.id,
          supplierRequestId: grant.id,
          supplierName: supplier.businessName,
          totalPaise: '84502',
          requestTitle: request.title,
        }),
        totalPaise: 84_502,
        awardedByUserId: userId,
        createdAt: new Date('2026-08-28T11:00:00.000Z'),
      },
    });
    await admin.procurementRequest.create({
      data: {
        id: 'draft-a', tenantId, title: 'Unissued private draft', status: 'DRAFT',
        deliveryDetails: { addressLine: '1 Market Road' },
        deliveryDate: new Date('2026-09-06T00:00:00.000Z'),
        quoteDeadline: new Date('2026-09-04T08:00:00.000Z'),
        items,
        sourcing: requestSourcing(supplier.id),
        openedAt: null,
        createdAt: new Date('2026-08-28T12:00:00.000Z'),
        createdByUserId: userId,
      },
    });
  }
  await admin.auditEvent.createMany({ data: [
    {
      id: `audit-${suffix}-opened`, tenantId, actorUserId: userId,
      action: 'request.opened', entityType: 'ProcurementRequest', entityId: request.id,
      metadata: { itemCount: 1, supplierCount: 1 },
      createdAt: new Date('2026-08-28T08:00:00.000Z'),
    },
    {
      id: `audit-${suffix}-quote`, tenantId, actorUserId: null,
      action: 'quote.submitted', entityType: 'SupplierQuote', entityId: `quote-${suffix}-${quoteCount}`,
      metadata: { revision: quoteCount, itemCount: 1 },
      createdAt: new Date('2026-08-28T10:00:00.000Z'),
    },
  ] });
  return { tenantId, userId };
}

test('history exposes bounded quote revisions and allow-listed activity through tenant RLS', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      const a = await seedHistory(admin, 'a');
      await seedHistory(admin, 'private-b');
      app = await provisionAppClient(admin, databaseUrl);

      const history = await listProcurementHistory({
        actor: { tenantId: a.tenantId, userId: a.userId },
        limit: 25,
      }, app);
      const insights = await getFactualInsights({
        actor: { tenantId: a.tenantId, userId: a.userId },
      }, app);

      expect(history.requests).toEqual([
        expect.objectContaining({
          id: 'request-a', respondingSupplierCount: 1, quoteRevisionCount: 2,
          award: expect.objectContaining({ supplierCount: 1 }),
        }),
      ]);
      expect(history.recentQuoteRevisions).toHaveLength(2);
      expect(history.recentQuoteRevisions[0]).toMatchObject({
        requestId: 'request-a', supplierName: 'a Fresh Foods', revision: 2,
      });
      expect(history.recentActivity).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Supplier sent quote version 2', actorName: 'Supplier' }),
        expect.objectContaining({ label: 'Request sent to suppliers', actorName: 'a Buyer' }),
      ]));
      expect(JSON.stringify(history)).not.toMatch(
        /private-b|Private City|Unissued private draft|private-snapshot@example\.test|9999999999|supplierSnapshots/,
      );
      expect(history.recentActivity.every((event) => !Object.hasOwn(event, 'metadata'))).toBe(true);
      expect(insights.summary).toMatchObject({
        requestSampleSize: 1,
        supplierRequestsSent: 1,
        supplierResponses: 1,
        awardedRequestCount: 1,
        totalAwardedPaise: '84502',
      });
      expect(insights.capped).toBe(false);
      expect(JSON.stringify(insights)).not.toMatch(/private-b|Private City/);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});


test('joined workspace reads preserve results and reduce database round trips', async () => {
  await withMigratedPostgres(async databaseUrl => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const password = randomBytes(24).toString('hex');
    await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
    const url = appDatabaseUrl(databaseUrl, password);
    const separate = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    const joined = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    // Compare the old relation strategy using the same generated client and
    // services. Only this test client opts out of database joins.
    separate.$use(async (params, next) => {
      if (params.action === 'findFirst' || params.action === 'findMany') {
        params.args = { ...params.args, relationLoadStrategy: 'query' };
      }
      return next(params);
    });
    let separateCalls = 0;
    let joinedCalls = 0;
    // Compare business reads only. Transaction-control log events can arrive
    // after a preceding operation resolves and must not leak into the next
    // sample; BEGIN/COMMIT and tenant setup are identical for both strategies.
    const businessRead = (sql: string) => /^SELECT/i.test(sql) && sql.includes('"public".');
    separate.$on('query', event => { if (businessRead(event.query)) separateCalls++; });
    joined.$on('query', event => { if (businessRead(event.query)) joinedCalls++; });
    try {
      const actor = await seedHistory(admin, 'a');
      const otherActor = await seedHistory(admin, 'b');
      await assertRuntimeDatabaseRole(separate);
      await assertRuntimeDatabaseRole(joined);
      separateCalls = 0; joinedCalls = 0;
      const before = await listProcurementHistory({ actor }, separate);
      const after = await listProcurementHistory({ actor }, joined);
      expect(after).toEqual(before);
      expect(joinedCalls).toBeLessThan(separateCalls);
      expect(JSON.stringify(after)).not.toContain('Private City');
      separateCalls = 0; joinedCalls = 0;
      const previousSettings = await createPrismaWorkspaceSettingsOperations(separate).load({ actor });
      const joinedSettings = await createPrismaWorkspaceSettingsOperations(joined).load({ actor });
      expect(joinedSettings).toEqual(previousSettings);
      expect(separateCalls).toBe(3); // Actor, its tenant, and the people list.
      expect(joinedCalls).toBe(2); // Actor with its tenant, and the people list.
      await expect(listProcurementHistory({ actor: { ...actor, userId: otherActor.userId } }, joined))
        .rejects.toMatchObject({ code: 'FORBIDDEN' });
      await admin.user.update({ where: { id: actor.userId }, data: { accountState: 'DEACTIVATED', isActive: false } });
      await expect(listProcurementHistory({ actor }, joined)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await separate.$disconnect(); await joined.$disconnect(); await admin.$disconnect();
    }
  });
});
