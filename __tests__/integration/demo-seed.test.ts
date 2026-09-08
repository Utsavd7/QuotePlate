import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { seedDemoRestaurant } from '../../scripts/demo/seed-demo';
import { DEMO_OWNER_EMAIL, DEMO_OWNER_ID, DEMO_TENANT_ID } from '@/lib/demo/identity';
import { verifyPassword } from '@/lib/password';
import { parseWorkspaceDetails } from '@/lib/account/workspace-settings';
import { validateMenuDocument } from '@/lib/menu/menu-document';
import { validateRequestDocuments } from '@/lib/procurement/request-document';
import { validateQuoteRevisionsDocument } from '@/lib/quotes/quote-revisions';
import { validateAwardDocuments } from '@/lib/awards/award-document';
import { buildReceivingSummary, validateStoredReceiving } from '@/lib/receiving/receiving-document';
import { validatePlanInput, computePlan } from '@/lib/service-planning/planning';
import { validateSupplierCapabilities } from '@/lib/suppliers/supplier-capabilities';
import { validateSupplierLifecycleState } from '@/lib/suppliers/supplier-schema';
import { readTradingProfile } from '@/lib/trading-profile/domain';
import { getQuoteComparison } from '@/lib/comparison/compare-quotes';
import { createSupplierPerformanceOperations } from '@/lib/reporting/supplier-performance-service';
import { withTenant } from '@/lib/db/tenant-transaction';
import { demoRestaurant } from '../../test-support/demo-restaurant-data';
import { withMigratedPostgres } from './setup/postgres';

const now = new Date('2028-02-28T04:30:00.000Z');
const password = () => randomBytes(24).toString('base64url');
const actor = { tenantId: DEMO_TENANT_ID, userId: DEMO_OWNER_ID };

async function snapshot(client: PrismaClient) {
  return {
    tenants: await client.tenant.findMany({ orderBy: { id: 'asc' } }),
    users: await client.user.findMany({ orderBy: { id: 'asc' } }),
    menus: await client.menu.findMany({ orderBy: { id: 'asc' } }),
    suppliers: await client.supplier.findMany({ orderBy: { id: 'asc' } }),
    requests: await client.procurementRequest.findMany({ orderBy: { id: 'asc' } }),
    quotes: await client.supplierRequest.findMany({ orderBy: { id: 'asc' } }),
    awards: await client.award.findMany({ orderBy: { id: 'asc' } }),
    plans: await client.servicePlan.findMany({ orderBy: { id: 'asc' } }),
    revisions: await client.servicePlanRevision.findMany({ orderBy: { id: 'asc' } }),
    audits: await client.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  };
}

async function otherTenant(client: PrismaClient, email = 'untouched@other.example', userId = 'other-owner') {
  return client.tenant.create({ data: {
    id: 'other-tenant', name: 'Unrelated restaurant', addressLine: 'Fictional fixture', city: 'Pune', state: 'Maharashtra', pin: '411038', phone: 'Not provided',
    users: { create: { id: userId, name: 'Other owner', email, role: 'OWNER' } },
  } });
}

test('seeds usable restaurant documents, isolates the owner, and preserves edits on repeat', async () => {
  await withMigratedPostgres(async databaseUrl => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      await otherTenant(admin);
      const before = await snapshot(admin);
      const secret = password();
      const result = await seedDemoRestaurant(admin, secret, now);
      expect(result).toMatchObject({ tenantId: DEMO_TENANT_ID, email: DEMO_OWNER_EMAIL, counts: { suppliers: 8, requests: 10, awards: 7, servicePlans: 2 } });
      expect(Object.keys(result).sort()).toEqual(['counts', 'email', 'tenantId']);
      const owner = await admin.user.findUniqueOrThrow({ where: { id: DEMO_OWNER_ID } });
      expect(owner).toMatchObject({ tenantId: DEMO_TENANT_ID, role: 'OWNER', accountState: 'ACTIVE', isActive: true, tutorialCompletedAt: now });
      expect(await verifyPassword(secret, owner.passwordHash)).toBe(true);
      expect(owner.passwordHash).toMatch(/^\$argon2id\$/);
      const workspace = await admin.tenant.findUniqueOrThrow({ where: { id: DEMO_TENANT_ID } });
      expect(workspace.name).toBe('DEMO · Monsoon Table');
      expect(parseWorkspaceDetails({ ...workspace, name: 'DEMO · Edited restaurant' })).toMatchObject({
        name: 'DEMO · Edited restaurant', phone: '9000000000',
      });
      const menu = await admin.menu.findFirstOrThrow({ where: { tenantId: DEMO_TENANT_ID, status: 'APPROVED' } });
      expect(validateMenuDocument(menu.document).dishes).toHaveLength(12);
      for (const supplier of await admin.supplier.findMany({ where: { tenantId: DEMO_TENANT_ID } })) {
        expect(supplier.email).toMatch(/@[^@]+\.example$/);
        expect(supplier.phone).toBeNull();
        expect(supplier.whatsappNumber).toBeNull();
        expect(supplier.verificationStatus).toBe('VERIFIED');
        expect(() => validateSupplierLifecycleState({
          relationshipType: supplier.relationshipType, verificationStatus: supplier.verificationStatus,
          applicationRequestId: supplier.applicationRequestId, verifiedAt: supplier.verifiedAt,
          verifiedByUserId: supplier.verifiedByUserId, isActive: supplier.isActive,
        })).not.toThrow();
        expect(validateSupplierCapabilities(supplier.capabilities).categories.length).toBeGreaterThan(0);
        expect(readTradingProfile(supplier.tradingProfile)?.wholesale).toBe('yes');
      }
      const requests = await admin.procurementRequest.findMany({ where: { tenantId: DEMO_TENANT_ID }, include: { supplierRequests: true } });
      expect(new Set(requests.map(request => request.status))).toEqual(new Set(['DRAFT', 'OPEN', 'AWARDED']));
      for (const request of requests) {
        const documents = validateRequestDocuments(request.items, request.sourcing);
        for (const grant of request.supplierRequests) {
          expect(validateQuoteRevisionsDocument(grant.quoteRevisions, documents.items.items).revisions).toHaveLength(grant.quoteRevision);
          expect(grant.tokenDigest).toMatch(/^[a-f0-9]{64}$/);
        }
        if (request.status === 'OPEN' || request.status === 'DRAFT') expect(request.quoteDeadline.getTime()).toBeGreaterThan(now.getTime());
      }
      const awards = await admin.award.findMany({ where: { tenantId: DEMO_TENANT_ID } });
      expect(awards.reduce((total, award) => total + award.totalPaise, BigInt(0)).toString()).toBe(demoRestaurant.finance.awardedPaise);
      const summaries = awards.map(award => buildReceivingSummary({ ...validateAwardDocuments(award), receiving: validateStoredReceiving(award.receiving) }));
      expect(summaries.some(summary => summary.suppliers.length === 2)).toBe(true);
      expect(summaries.flatMap(summary => summary.suppliers).some(supplier => supplier.check?.deliveryComplete === true)).toBe(true);
      expect(summaries.flatMap(summary => summary.suppliers).some(supplier => supplier.check?.deliveryComplete === false)).toBe(true);
      const creditOutstanding = summaries.flatMap(summary => summary.suppliers).reduce((total, supplier) => total + BigInt(supplier.check?.creditRemainingPaise ?? '0'), BigInt(0));
      expect(creditOutstanding.toString()).toBe(demoRestaurant.finance.creditOutstandingPaise);
      const plans = await admin.servicePlan.findMany({ where: { tenantId: DEMO_TENANT_ID }, include: { revisions: true } });
      expect(plans).toHaveLength(2);
      for (const plan of plans) {
        const input = validatePlanInput(plan.document);
        expect(new Date(input.serviceAt).getTime()).toBeGreaterThan(now.getTime());
        expect(computePlan(validateMenuDocument(plan.menuSnapshot), input).ingredients.length).toBeGreaterThan(0);
        expect(plan.revisions).toHaveLength(1);
        expect(plan.revisions[0].document).toEqual(plan.document);
      }
      // Use the real application role and existing service operations, including forced RLS.
      const appPassword = randomBytes(24).toString('hex');
      await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${appPassword}'`);
      const url = new URL(databaseUrl); url.username = 'autorfp_app'; url.password = appPassword;
      app = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      const appClient = app;
      const reports = createSupplierPerformanceOperations({ transact: (tenantId, callback) => withTenant(tenantId, callback, appClient), now: () => now });
      const report = await reports.read({ actor });
      expect(report.awardSampleSize).toBe(7);
      expect(report.suppliers.reduce((total, supplier) => total + BigInt(supplier.creditOutstandingPaise), BigInt(0))).toBe(creditOutstanding);
      for (const request of requests.filter(request => request.status !== 'DRAFT')) await expect(getQuoteComparison({ actor, requestId: request.id }, app)).resolves.toBeDefined();
      await expect(reports.read({ actor: { ...actor, tenantId: 'other-tenant' } })).rejects.toThrow();
      expect(await withTenant(DEMO_TENANT_ID, tx => tx.user.findUnique({ where: { id: 'other-owner' } }), app)).toBeNull();
      await expect(seedDemoRestaurant(app, secret, now)).resolves.toEqual(result);

      await admin.menu.update({ where: { id: menu.id }, data: { name: 'Edited menu retained' } });
      await admin.tenant.update({ where: { id: DEMO_TENANT_ID }, data: { name: 'Edited demo restaurant retained' } });
      const edited = await snapshot(admin);
      await expect(seedDemoRestaurant(admin, secret, new Date(now.getTime() + 86400000))).resolves.toEqual(result);
      expect(await snapshot(admin)).toEqual(edited);
      await expect(seedDemoRestaurant(admin, password(), now)).rejects.toThrow(/identity|password|match/i);
      expect(await snapshot(admin)).toEqual(edited);
      expect(await admin.tenant.findUnique({ where: { id: 'other-tenant' } })).toEqual(before.tenants[0]);
      expect(await admin.user.findUnique({ where: { id: 'other-owner' } })).toEqual(before.users[0]);
    } finally { await app?.$disconnect(); await admin.$disconnect(); }
  });
});

test('invalid passwords and conflicting owner identities write nothing', async () => {
  await withMigratedPostgres(async databaseUrl => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const empty = await snapshot(admin);
      for (const invalid of ['', 'short', '123456789012345', ' '.repeat(16)]) {
        await expect(seedDemoRestaurant(admin, invalid, now)).rejects.toThrow(/password/i);
        expect(await snapshot(admin)).toEqual(empty);
      }
      await expect(seedDemoRestaurant(admin, password(), new Date('invalid'))).rejects.toThrow(/date|time/i);
      expect(await snapshot(admin)).toEqual(empty);
      await otherTenant(admin, DEMO_OWNER_EMAIL);
      const collision = await snapshot(admin);
      await expect(seedDemoRestaurant(admin, password(), now)).rejects.toThrow(/identity|already|match/i);
      expect(await snapshot(admin)).toEqual(collision);
      await admin.user.update({ where: { id: 'other-owner' }, data: { email: 'renamed@other.example', id: DEMO_OWNER_ID } });
      const idCollision = await snapshot(admin);
      await expect(seedDemoRestaurant(admin, password(), now)).rejects.toThrow(/identity|already|match/i);
      expect(await snapshot(admin)).toEqual(idCollision);
    } finally { await admin.$disconnect(); }
  });
});

test('a late creation conflict rolls back every demo row without touching the conflicting tenant', async () => {
  await withMigratedPostgres(async databaseUrl => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await otherTenant(admin);
      // The audit is the last seed write, after users, recipes, quotes, awards and plans.
      await admin.auditEvent.create({ data: {
        id: `${DEMO_TENANT_ID}:seed-v1`, tenantId: 'other-tenant', actorUserId: 'other-owner',
        action: 'test.collision', entityType: 'Tenant', entityId: 'other-tenant', metadata: { retain: true },
      } });
      const before = await snapshot(admin);
      await expect(seedDemoRestaurant(admin, password(), now)).rejects.toMatchObject({ code: 'P2002' });
      expect(await snapshot(admin)).toEqual(before);
      expect(await admin.tenant.findUnique({ where: { id: DEMO_TENANT_ID } })).toBeNull();
      expect(await admin.user.findUnique({ where: { id: DEMO_OWNER_ID } })).toBeNull();
    } finally { await admin.$disconnect(); }
  });
});

async function restrictedClient(admin: PrismaClient, databaseUrl: string) {
  const secret = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${secret}'`);
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app'; url.password = secret;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

test('restricted app role creates a fresh demo and preserves edits with forced tenant isolation', async () => {
  await withMigratedPostgres(async databaseUrl => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      await otherTenant(admin);
      const before = await snapshot(admin);
      app = await restrictedClient(admin, databaseUrl);
      const secret = password();
      const seeded = await seedDemoRestaurant(app, secret, now);
      expect(seeded).toMatchObject({ tenantId: DEMO_TENANT_ID, email: DEMO_OWNER_EMAIL,
        counts: { users: 1, menus: 1, suppliers: 8, requests: 10, supplierRequests: 18, awards: 7, servicePlans: 2 } });
      const owner = await withTenant(DEMO_TENANT_ID, tx => tx.user.findUniqueOrThrow({ where: { id: DEMO_OWNER_ID } }), app);
      expect(owner).toMatchObject({ tenantId: DEMO_TENANT_ID, role: 'OWNER', accountState: 'ACTIVE' });
      expect(await verifyPassword(secret, owner.passwordHash)).toBe(true);
      expect(await withTenant(DEMO_TENANT_ID, tx => tx.user.findUnique({ where: { id: 'other-owner' } }), app)).toBeNull();
      expect(await withTenant('other-tenant', tx => tx.user.findUnique({ where: { id: DEMO_OWNER_ID } }), app)).toBeNull();
      await expect(withTenant(DEMO_TENANT_ID, tx => tx.tenant.update({ where: { id: 'other-tenant' }, data: { name: 'Must not change' } }), app)).rejects.toThrow();
      // A local tenant context must not escape the seed transaction.
      expect(await app.tenant.findMany()).toEqual([]);
      await withTenant(DEMO_TENANT_ID, tx => tx.menu.updateMany({ where: { tenantId: DEMO_TENANT_ID }, data: { name: 'App-role edited recipe book' } }), app);
      const edited = await snapshot(admin);
      await expect(seedDemoRestaurant(app, secret, new Date(now.getTime() + 86400000))).resolves.toEqual(seeded);
      expect(await snapshot(admin)).toEqual(edited);
      await expect(seedDemoRestaurant(app, password(), now)).rejects.toThrow(/identity|password|match/i);
      expect(await snapshot(admin)).toEqual(edited);
      expect(await admin.tenant.findUnique({ where: { id: 'other-tenant' } })).toEqual(before.tenants[0]);
      expect(await admin.user.findUnique({ where: { id: 'other-owner' } })).toEqual(before.users[0]);
      const appClient = app;
      const report = await createSupplierPerformanceOperations({ transact: (tenantId, callback) => withTenant(tenantId, callback, appClient), now: () => now }).read({ actor });
      expect(report.awardSampleSize).toBe(7);
    } finally { await app?.$disconnect(); await admin.$disconnect(); }
  });
});

test('app-role hidden cross-tenant conflicts roll back early and final writes without changing any tenant', async () => {
  await withMigratedPostgres(async databaseUrl => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      await otherTenant(admin, DEMO_OWNER_EMAIL);
      app = await restrictedClient(admin, databaseUrl);
      const before = await snapshot(admin);
      // RLS hides this email from the seeder; the global unique constraint must fail closed.
      await expect(seedDemoRestaurant(app, password(), now)).rejects.toThrow();
      expect(await snapshot(admin)).toEqual(before);
      expect(await admin.tenant.findUnique({ where: { id: DEMO_TENANT_ID } })).toBeNull();
      await admin.user.update({ where: { id: 'other-owner' }, data: { email: 'renamed@other.example' } });
      await admin.auditEvent.create({ data: {
        id: `${DEMO_TENANT_ID}:seed-v1`, tenantId: 'other-tenant', actorUserId: 'other-owner',
        action: 'test.collision', entityType: 'Tenant', entityId: 'other-tenant', metadata: { retain: true },
      } });
      const lateConflict = await snapshot(admin);
      await expect(seedDemoRestaurant(app, password(), now)).rejects.toThrow();
      expect(await snapshot(admin)).toEqual(lateConflict);
      expect(await admin.tenant.findUnique({ where: { id: DEMO_TENANT_ID } })).toBeNull();
      expect(await admin.user.findUnique({ where: { id: DEMO_OWNER_ID } })).toBeNull();
    } finally { await app?.$disconnect(); await admin.$disconnect(); }
  });
});
