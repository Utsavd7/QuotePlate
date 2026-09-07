import { randomBytes } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { withTenant } from '@/lib/db/tenant-transaction';
import type { MenuDocumentV1 } from '@/lib/menu/menu-document';
import { getProcurementRequest } from '@/lib/procurement/request-service';
import type { PlanInput } from '@/lib/service-planning/planning';
import {
  createPlan,
  draftProcurement,
  getPlan,
  repeatPlan,
  updatePlan,
} from '@/lib/service-planning/service';

import { withMigratedPostgres } from './setup/postgres';

// Only inject the connection. Tenant context, runtime-role validation, real
// PostgreSQL transactions, all queries, audit writes and RLS remain intact.
let mockClient: PrismaClient | undefined;
jest.mock('@/lib/db/tenant-transaction', () => {
  const actual = jest.requireActual<typeof import('@/lib/db/tenant-transaction')>(
    '@/lib/db/tenant-transaction',
  );
  return {
    ...actual,
    withTenant: <T>(
      tenantId: string,
      callback: (transaction: Prisma.TransactionClient) => Promise<T>,
    ) => {
      if (!mockClient) throw new Error('Planning integration database is not configured.');
      return actual.withTenant(tenantId, callback, mockClient);
    },
  };
});

const actorA = { tenantId: 'planning-tenant-a', userId: 'planning-member-a' };
const actorB = { tenantId: 'planning-tenant-b', userId: 'planning-member-b' };

function recipe(quantity = '10'): MenuDocumentV1 {
  return {
    v: 1,
    source: { kind: 'MANUAL', canonicalUrl: null, permissionConfirmed: false },
    dishes: [{
      id: 'rice-dish',
      name: 'Rice service',
      position: 0,
      ingredients: [{
        id: 'rice-ingredient',
        itemKey: 'rice',
        name: 'Rice',
        quantity,
        unit: 'KILOGRAM',
        specification: { v: 1, category: 'OTHER' },
      }],
    }],
  };
}

async function seedTenant(admin: PrismaClient, actor: typeof actorA) {
  await admin.tenant.create({
    data: {
      id: actor.tenantId,
      name: `${actor.tenantId} Kitchen`,
      addressLine: '1 Market Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400001',
      phone: '9000000000',
      isActive: true,
      users: {
        create: {
          id: actor.userId,
          name: 'Planning member',
          email: `${actor.userId}@example.test`,
          role: 'MEMBER',
          accountState: 'ACTIVE',
          isActive: true,
        },
      },
    },
  });
  return admin.menu.create({
    data: {
      tenantId: actor.tenantId,
      name: 'Approved rice menu',
      status: 'APPROVED',
      version: 1,
      document: recipe() as unknown as Prisma.InputJsonValue,
      createdByUserId: actor.userId,
      approvedByUserId: actor.userId,
      approvedAt: new Date(),
    },
  });
}

async function provisionAppClient(admin: PrismaClient, databaseUrl: string) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  const app = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  await app.$connect();
  return app;
}

test('real planning persists versions, isolates tenants, preserves recipes, repeats safely and creates one exact procurement draft', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      const menuA = await seedTenant(admin, actorA);
      const menuB = await seedTenant(admin, actorB);
      app = await provisionAppClient(admin, databaseUrl);
      mockClient = app;

      const now = new Date();
      const future = (days: number) => new Date(now.getTime() + days * 86_400_000);
      const document: PlanInput = {
        name: 'Lunch planning',
        serviceAt: future(10).toISOString(),
        dishes: [{ dishId: 'rice-dish', batchServings: '10', portions: '9' }],
        inventory: [{
          itemKey: 'rice', unit: 'KILOGRAM', yieldPercent: '80', stock: '4', incoming: [],
        }],
      };
      const created = await createPlan(actorA, { menuId: menuA.id, document });
      expect(created.version).toBe(1);
      expect(created.readiness.ingredients[0]).toMatchObject({
        required: '9', available: '4', usableDeficit: '5', deficit: '6.25', blocked: false,
      });
      const persisted = await admin.servicePlan.findUniqueOrThrow({ where: { id: created.id } });
      expect(persisted.document).toEqual(document);
      expect(persisted.menuSnapshot).toEqual(recipe());
      expect(persisted.menuVersion).toBe(1);
      expect(await admin.servicePlanRevision.count({ where: { planId: created.id } })).toBe(1);

      const revisedDocument: PlanInput = {
        ...document,
        dishes: [{ dishId: 'rice-dish', batchServings: '10', portions: '10' }],
      };
      const updated = await updatePlan(actorA, created.id, {
        expectedVersion: 1, document: revisedDocument,
      });
      expect(updated.version).toBe(2);
      const reloaded = await getPlan(actorA, created.id);
      expect(reloaded.document).toEqual(revisedDocument);
      expect(reloaded.readiness.ingredients[0]).toMatchObject({
        required: '10', available: '4', usableDeficit: '6', deficit: '7.5', blocked: false,
      });
      expect(reloaded.readiness.ready).toBe(false);
      await expect(updatePlan(actorA, created.id, {
        expectedVersion: 1, document,
      })).rejects.toMatchObject({ status: 409 });
      expect(await admin.servicePlanRevision.count({ where: { planId: created.id } })).toBe(2);
      expect((await getPlan(actorA, created.id)).version).toBe(2);

      // Editing the original menu must never alter an already approved snapshot.
      await admin.menu.update({
        where: { id: menuA.id },
        data: { version: 2, document: recipe('100') as unknown as Prisma.InputJsonValue },
      });
      const snapshot = await getPlan(actorA, created.id);
      expect(snapshot.menuVersion).toBe(1);
      expect(snapshot.menuSnapshot).toEqual(recipe('10'));
      expect(snapshot.readiness.ingredients[0].deficit).toBe('7.5');

      // Check both service authorization and database RLS using the application
      // role. Admin is used only for fixtures and independent persistence checks.
      await expect(getPlan(actorB, created.id)).rejects.toMatchObject({ status: 404 });
      await expect(updatePlan(actorB, created.id, {
        expectedVersion: 2, document: revisedDocument,
      })).rejects.toMatchObject({ status: 404 });
      await expect(createPlan(actorA, {
        menuId: menuB.id, document: revisedDocument,
      })).rejects.toMatchObject({ status: 404 });
      expect(await app.servicePlan.findMany()).toEqual([]);
      expect(await app.servicePlanRevision.findMany()).toEqual([]);
      await withTenant(actorB.tenantId, async (transaction) => {
        expect(await transaction.servicePlan.findMany()).toEqual([]);
        expect(await transaction.servicePlanRevision.findMany()).toEqual([]);
        expect(await transaction.servicePlan.updateMany({
          where: { id: created.id }, data: { name: 'Cross-tenant overwrite' },
        })).toEqual({ count: 0 });
      });
      await expect(withTenant(actorB.tenantId, transaction =>
        transaction.servicePlanRevision.create({
          data: {
            tenantId: actorA.tenantId,
            planId: created.id,
            version: 99,
            document: revisedDocument as unknown as Prisma.InputJsonValue,
          },
        }),
      )).rejects.toThrow();
      await expect(withTenant(actorA.tenantId, transaction =>
        transaction.servicePlanRevision.updateMany({
          where: { planId: created.id }, data: { document: {} },
        }),
      )).rejects.toThrow();
      const policies = await admin.$queryRaw<Array<{
        relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean;
      }>>`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_catalog.pg_class
        WHERE oid IN ('public."ServicePlan"'::regclass, 'public."ServicePlanRevision"'::regclass)
        ORDER BY relname
      `;
      expect(policies).toEqual([
        { relname: 'ServicePlan', relrowsecurity: true, relforcerowsecurity: true },
        { relname: 'ServicePlanRevision', relrowsecurity: true, relforcerowsecurity: true },
      ]);

      // Two genuine transactions contend on the optimistic version claim. The
      // loser must roll back without creating a second request or revision.
      const procurement = {
        expectedVersion: 2,
        deliveryDate: future(9).toISOString().slice(0, 10),
        quoteDeadline: future(8).toISOString(),
        deliveryDetails: {
          addressLine: '1 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001',
        },
      };
      const conversions = await Promise.allSettled([
        draftProcurement(actorA, created.id, procurement, now),
        draftProcurement(actorA, created.id, procurement, now),
      ]);
      const winners = conversions.filter(result => result.status === 'fulfilled');
      const losers = conversions.filter(result => result.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      if (winners[0].status !== 'fulfilled' || losers[0].status !== 'rejected') {
        throw new Error('Expected one conversion winner and one conflict.');
      }
      expect(losers[0].reason).toMatchObject({ status: 409 });
      const conversion = winners[0].value;
      expect(conversion.reviewUrl).toBe(`/procurement/${conversion.requestId}`);
      expect(conversion.version).toBe(3);
      const requests = await admin.procurementRequest.findMany({
        where: { tenantId: actorA.tenantId },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        id: conversion.requestId,
        status: 'DRAFT',
        items: { v: 1, items: [expect.objectContaining({
          itemKey: 'rice', quantity: '7.5', unit: 'KILOGRAM',
          specification: { v: 1, category: 'OTHER' },
        })] },
      });
      const reviewable = await getProcurementRequest({
        actor: actorA, requestId: conversion.requestId,
      }, app);
      expect(reviewable.status).toBe('DRAFT');
      expect(reviewable.items.items).toHaveLength(1);
      expect(reviewable.items.items[0].quantity).toBe('7.5');
      await expect(getProcurementRequest({
        actor: actorB, requestId: conversion.requestId,
      }, app)).rejects.toMatchObject({ status: 404 });
      const frozen = await getPlan(actorA, created.id);
      expect(frozen.requestId).toBe(conversion.requestId);
      expect(frozen.version).toBe(3);
      await expect(draftProcurement(actorA, created.id, {
        ...procurement, expectedVersion: 3,
      }, now)).rejects.toMatchObject({ status: 409 });
      await expect(updatePlan(actorA, created.id, {
        expectedVersion: 3, document: revisedDocument,
      })).rejects.toMatchObject({ status: 409 });
      const revisions = await admin.servicePlanRevision.findMany({
        where: { planId: created.id }, orderBy: { version: 'asc' },
      });
      expect(revisions.map(revision => revision.version)).toEqual([1, 2, 3]);
      expect(revisions[0].document).toEqual(document);
      expect(revisions[1].document).toEqual(revisedDocument);

      const repeated = await repeatPlan(actorA, created.id, {
        expectedVersion: 3, serviceAt: future(11).toISOString(),
      });
      expect(repeated.id).not.toBe(created.id);
      expect(repeated.version).toBe(1);
      expect(repeated.requestId).toBeNull();
      expect(repeated.document.inventory).toEqual([]);
      expect(repeated.document.dishes).toEqual(revisedDocument.dishes);
      expect(repeated.menuSnapshot).toEqual(recipe('10'));
      expect(repeated.readiness.ready).toBe(false);
      expect(repeated.readiness.ingredients[0].blocked).toBe(true);
      expect(repeated.readiness.warnings.join(' ')).toMatch(/stock and yield are unknown/i);
      expect((await getPlan(actorA, repeated.id)).document.inventory).toEqual([]);
      await expect(draftProcurement(actorA, repeated.id, {
        ...procurement, expectedVersion: 1,
      }, now)).rejects.toMatchObject({ status: 422 });
      expect(await admin.procurementRequest.count({ where: { tenantId: actorA.tenantId } })).toBe(1);
      expect(await admin.servicePlanRevision.count({ where: { planId: repeated.id } })).toBe(1);
      const audit = await admin.auditEvent.findMany({
        where: { tenantId: actorA.tenantId, entityId: created.id }, orderBy: { createdAt: 'asc' },
      });
      expect(audit.map(event => event.action)).toEqual([
        'service_plan.created', 'service_plan.updated', 'service_plan.procurement_drafted',
      ]);
    } finally {
      mockClient = undefined;
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
