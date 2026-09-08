import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { withMigratedPostgres } from './setup/postgres';
import { createPortalOperations } from '@/lib/supplier-portal/service';
import { createPortalHttp } from '@/lib/supplier-portal/http';
import { checkRuntimeDatabase } from '@/lib/health/readiness';
import { withTenant } from '@/lib/db/tenant-transaction';

test('profile API preserves identity, races, isolation, revocation, active restaurant and DB bounds', async () => {
 await withMigratedPostgres(async url => {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  const appUrl = new URL(url); appUrl.username = 'autorfp_app'; appUrl.password = randomBytes(24).toString('hex');
  let app: PrismaClient | undefined;
  try {
   await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${appUrl.password}'`);
   app = new PrismaClient({ datasources: { db: { url: appUrl.toString() } } });
   const actor = { tenantId: 'trading-tenant', userId: 'trading-owner' };
   await admin.tenant.create({ data: { id: actor.tenantId, name: 'Kitchen', addressLine: '1 Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000' } });
   await admin.user.create({ data: { id: actor.userId, tenantId: actor.tenantId, name: 'Owner', email: 'trading@example.test', role: 'OWNER' } });
   await admin.supplier.createMany({ data: ['one', 'two'].map(id => ({ id, tenantId: actor.tenantId, businessName: id, capabilities: { v: 1, categories: [], items: [] } })) });
   const ops = createPortalOperations(app);
   const tokenFor = async (id: string) => new URLSearchParams(new URL((await ops.rotate(actor, id, 'https://example.test')).url).hash.slice(1)).get('token')!;
   const token = await tokenFor('one'); const other = await tokenFor('two');
   const initial = await ops.publicView(token);
   expect(initial.tradingProfile).toBeNull();
   const body = { action: 'trading-profile', portalId: initial.portalId, expectedRevision: 0, profile: { wholesale: 'yes', servedPins: ['400001'], minimumOrderInr: '2500.00', orderCutoffIst: '18:30', leadTimeDays: 1, note: 'Call for availability' } };
   const http = createPortalHttp({ operations: ops, limit: async () => ({ allowed: true, retryAfterSeconds: 0 }), account: async () => null });
   const post = (cookieToken: string, payload = body) => http.public(new Request('https://example.test/api/public/supplier-portal', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', cookie: `supplier_portal=${cookieToken}` }, body: JSON.stringify(payload) }));
   expect((await post(other)).status).toBe(409);
   expect((await post('x'.repeat(43))).status).toBe(410);
   const race = await Promise.all([post(token), post(token)]);
   expect(race.map(r => r.status).sort()).toEqual([200, 409]);
   const saved = (await ops.publicView(token)).tradingProfile!;
   expect(saved).toMatchObject({ ...body.profile, revision: 1 });
   expect(Math.abs(Date.now() - Date.parse(saved.updatedAt))).toBeLessThan(10000);
   expect((await ops.restaurantView(actor, 'one')).tradingProfile).toEqual(saved);
   expect((await ops.publicView(other)).tradingProfile).toBeNull();
   expect(await withTenant('another-tenant', tx => tx.supplier.findMany(), app)).toEqual([]);
   expect((await post(token, { ...body, expectedRevision: 1, profile: { ...body.profile, note: 'x'.repeat(17000) } })).status).toBe(413);
   await expect(admin.supplier.update({ where: { id: 'one' }, data: { tradingProfile: { note: 'x'.repeat(8192) } } })).rejects.toThrow();
   await expect(checkRuntimeDatabase(app)).resolves.toBeUndefined();
   await admin.tenant.update({ where: { id: actor.tenantId }, data: { isActive: false } });
   expect((await post(token)).status).toBe(410);
   await admin.tenant.update({ where: { id: actor.tenantId }, data: { isActive: true } });
   await ops.revoke(actor, 'one');
   expect((await post(token)).status).toBe(410);
   expect((await admin.supplier.findUniqueOrThrow({ where: { id: 'one' } })).tradingProfile).toEqual(saved);
   await admin.$executeRawUnsafe('ALTER TABLE "Supplier" DROP CONSTRAINT "Supplier_tradingProfile_size_check"');
   await expect(checkRuntimeDatabase(app)).rejects.toThrow(/migration/);
  } finally { await app?.$disconnect(); await admin.$disconnect(); }
 });
});
