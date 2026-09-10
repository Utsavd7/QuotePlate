import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { withMigratedPostgres } from './setup/postgres';
import { createPortalOperations } from '@/lib/supplier-portal/service';
import { createPortalHttp } from '@/lib/supplier-portal/http';
import { tradingProfileIsStale } from '@/lib/trading-profile/types';

test('supplier business confirmation projects only own defaults, preserves legacy terms, and remains bound to its grant and revision', async () => {
 await withMigratedPostgres(async url => {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  const appUrl = new URL(url); appUrl.username = 'autorfp_app'; appUrl.password = randomBytes(24).toString('hex');
  let app: PrismaClient | undefined;
  try {
   await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${appUrl.password}'`);
   app = new PrismaClient({ datasources: { db: { url: appUrl.toString() } } });
   const actor = { tenantId: 'business-tenant', userId: 'business-owner' };
   for (const tenantId of [actor.tenantId, 'other-business-tenant']) {
    await admin.tenant.create({ data: { id: tenantId, name: `Kitchen ${tenantId}`, addressLine: 'Private restaurant address', city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000' } });
    await admin.user.create({ data: { id: tenantId === actor.tenantId ? actor.userId : 'other-business-owner', tenantId, name: 'Owner', email: `${tenantId}@example.test`, role: 'OWNER' } });
   }
   const addressBook = {
    contactName: 'Address book contact', phone: '+919876543210', whatsappNumber: null, email: 'address-book@example.test',
    capabilities: { v: 1, categories: [{ category: 'VEGETABLES', tier: 'PREFERRED', rank: 1 }], items: [{ itemKey: 'secret-item', itemName: 'Private supplier preference', tier: 'BACKUP', rank: 1 }] },
   };
   await admin.supplier.create({ data: { id: 'business-own', tenantId: actor.tenantId, businessName: 'Own business', ...addressBook, notes: 'Private restaurant notes', gstin: '27ABCDE1234F1Z5', verificationStatus: 'VERIFIED', verifiedAt: new Date('2026-09-01T00:00:00.000Z'), verifiedByUserId: actor.userId } });
   await admin.supplier.create({ data: { id: 'business-peer', tenantId: actor.tenantId, businessName: 'Peer business', contactName: 'Secret peer contact', email: 'private-peer@example.test', capabilities: { v: 1, categories: [{ category: 'SEAFOOD', tier: 'BACKUP', rank: 1 }], items: [] } } });
   await admin.supplier.create({ data: { id: 'business-empty', tenantId: actor.tenantId, businessName: 'Empty business', capabilities: { v: 1, categories: [], items: [] } } });
   await admin.supplier.create({ data: { id: 'business-other', tenantId: 'other-business-tenant', businessName: 'Other tenant business', contactName: 'Secret other tenant contact', email: 'private-tenant@example.test', capabilities: { v: 1, categories: [], items: [] } } });
   const ops = createPortalOperations(app);
   const tokenFor = async (supplierId: string, owner = actor) => new URLSearchParams(new URL((await ops.rotate(owner, supplierId, 'https://example.test')).url).hash.slice(1)).get('token')!;
   const token = await tokenFor('business-own');
   const peerToken = await tokenFor('business-peer');
   const otherToken = await tokenFor('business-other', { tenantId: 'other-business-tenant', userId: 'other-business-owner' });
   const initial = await ops.publicView(token);
   const defaults = { contactName: addressBook.contactName, phone: addressBook.phone, whatsappNumber: null, email: addressBook.email, categories: ['VEGETABLES'] };
   expect(initial).toEqual({ portalId: expect.any(String), restaurantName: `Kitchen ${actor.tenantId}`, supplierName: 'Own business', expiresAt: expect.any(String), tradingProfile: null, businessDetails: defaults, orders: [], forecasts: [] });
   expect(JSON.stringify(initial)).not.toMatch(/Private|private-peer|private-tenant|secret-item|PREFERRED|BACKUP|rank|gstin|verificationStatus|verifiedByUserId|capabilities|tokenDigest/);
   expect(await ops.publicView(await tokenFor('business-empty'))).toMatchObject({ businessDetails: { contactName: null, phone: null, whatsappNumber: null, email: null, categories: [] } });

   const terms = { wholesale: 'yes', servedPins: ['400001'], minimumOrderInr: '2500.00', orderCutoffIst: '18:30', leadTimeDays: 1, note: 'Call for availability' };
   const legacy = { ...terms, revision: 1, updatedAt: '2026-09-01T00:00:00.000Z' };
   await admin.supplier.update({ where: { id: 'business-own' }, data: { tradingProfile: legacy } });
   expect(await ops.publicView(token)).toMatchObject({ tradingProfile: legacy, businessDetails: defaults });
   const supplierBefore = await admin.supplier.findUniqueOrThrow({ where: { id: 'business-own' } });
   const businessDetails = { contactName: '  Confirmed supplier  ', phone: null, whatsappNumber: '98765 43211', email: ' CONFIRMED@EXAMPLE.TEST ', categories: ['FRUITS', 'DAIRY'] };
   const normalized = { ...businessDetails, contactName: 'Confirmed supplier', whatsappNumber: '+919876543211', email: 'confirmed@example.test' };
   const body = { action: 'trading-profile', portalId: initial.portalId, expectedRevision: 1, profile: { ...terms, businessDetails } };
   const http = createPortalHttp({ operations: ops, limit: async () => ({ allowed: true, retryAfterSeconds: 0 }), account: async () => null });
   const post = (raw: string, payload: unknown = body) => http.public(new Request('https://example.test/api/public/supplier-portal', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', cookie: `supplier_portal=${raw}` }, body: JSON.stringify(payload) }));
   const auditCount = () => admin.auditEvent.count({ where: { action: 'portal.trading-profile-updated' } });
   expect((await post(peerToken)).status).toBe(409);
   expect((await post(otherToken)).status).toBe(409);
   expect((await post('x'.repeat(43))).status).toBe(410);
   expect((await post(token, { ...body, portalId: undefined })).status).toBe(422);
   expect((await post(token, { ...body, profile: { ...terms, businessDetails: { ...businessDetails, categories: [] } } })).status).toBe(422);
   for (const email of ['mailto:supplier@example.com', 'first,last@example.com', 'supplier@bad_domain.com']) {
    expect((await post(token, { ...body, profile: { ...terms, businessDetails: { ...businessDetails, phone: null, whatsappNumber: null, email } } })).status).toBe(422);
   }
   expect(await auditCount()).toBe(0);
   const race = await Promise.all([post(token), post(token)]);
   expect(race.map(r => r.status).sort()).toEqual([200, 409]);
   expect(await auditCount()).toBe(1);
   const confirmedView = await ops.publicView(token);
   expect(confirmedView).toMatchObject({ businessDetails: defaults, tradingProfile: { ...terms, businessDetails: normalized, revision: 2 } });
   expect(confirmedView.tradingProfile).toHaveProperty('businessDetailsConfirmedAt', confirmedView.tradingProfile!.updatedAt);
   expect((await ops.restaurantView(actor, 'business-own')).tradingProfile).toEqual(confirmedView.tradingProfile);
   expect(JSON.stringify(confirmedView)).not.toMatch(/private-peer|private-tenant|Secret|Private|verificationStatus|verifiedByUserId/);
   expect((await ops.publicView(peerToken)).tradingProfile).toBeNull();
   expect((await ops.publicView(otherToken)).tradingProfile).toBeNull();
   const supplierAfter = await admin.supplier.findUniqueOrThrow({ where: { id: 'business-own' } });
   const { tradingProfile: beforeProfile, updatedAt: beforeUpdatedAt, ...beforeFields } = supplierBefore;
   const { tradingProfile: afterProfile, updatedAt: afterUpdatedAt, ...afterFields } = supplierAfter;
   expect(afterFields).toEqual(beforeFields);
   expect(beforeProfile).toEqual(legacy);
   expect(afterProfile).toEqual(confirmedView.tradingProfile);
   expect(afterUpdatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdatedAt.getTime());
   expect(await admin.auditEvent.findMany({ where: { action: 'portal.trading-profile-updated' }, select: { tenantId: true, entityId: true, metadata: true } })).toEqual([{ tenantId: actor.tenantId, entityId: 'business-own', metadata: { revision: 2 } }]);

   // A pre-confirmation client can still edit delivery terms without erasing confirmation.
   const legacyResponse = await post(token, { ...body, expectedRevision: 2, profile: { ...terms, note: 'Updated by an older client' } });
   expect(legacyResponse.status).toBe(200);
   const latestView = await ops.publicView(token);
   expect(latestView.tradingProfile).toMatchObject({ businessDetails: normalized, revision: 3, note: 'Updated by an older client' });
   expect(latestView.tradingProfile).toHaveProperty('businessDetailsConfirmedAt', confirmedView.tradingProfile!.updatedAt);
   const freshBody = { ...body, expectedRevision: 3 };
   for (const invalidate of ['supplier', 'tenant', 'expiry'] as const) {
    if (invalidate === 'supplier') await admin.supplier.update({ where: { id: 'business-own' }, data: { isActive: false } });
    if (invalidate === 'tenant') await admin.tenant.update({ where: { id: actor.tenantId }, data: { isActive: false } });
    if (invalidate === 'expiry') await admin.supplierPortal.update({ where: { id: initial.portalId }, data: { expiresAt: new Date(0) } });
    expect((await post(token, freshBody)).status).toBe(410);
    if (invalidate === 'supplier') await admin.supplier.update({ where: { id: 'business-own' }, data: { isActive: true } });
    if (invalidate === 'tenant') await admin.tenant.update({ where: { id: actor.tenantId }, data: { isActive: true } });
   }
   const freshToken = await tokenFor('business-own');
   expect((await post(token, freshBody)).status).toBe(410);
   await ops.revoke(actor, 'business-own');
   expect((await post(freshToken, freshBody)).status).toBe(410);
   expect(await auditCount()).toBe(2);
   expect((await admin.supplier.findUniqueOrThrow({ where: { id: 'business-own' } })).tradingProfile).toEqual(latestView.tradingProfile);
  } finally { await app?.$disconnect(); await admin.$disconnect(); }
 });
});

test('terms-only saves preserve contact freshness for legacy and timestamped confirmations until explicit reconfirmation', async () => {
 await withMigratedPostgres(async url => {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  const appUrl = new URL(url); appUrl.username = 'autorfp_app'; appUrl.password = randomBytes(24).toString('hex');
  let app: PrismaClient | undefined;
  try {
   await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${appUrl.password}'`);
   app = new PrismaClient({ datasources: { db: { url: appUrl.toString() } } });
   const actor = { tenantId: 'confirmation-date-tenant', userId: 'confirmation-date-owner' };
   await admin.tenant.create({ data: { id: actor.tenantId, name: 'Kitchen', addressLine: '1 Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000' } });
   await admin.user.create({ data: { id: actor.userId, tenantId: actor.tenantId, name: 'Owner', email: 'confirmation-date@example.test', role: 'OWNER' } });
   const ops = createPortalOperations(app);
   const terms = { wholesale: 'yes', servedPins: ['400001'], minimumOrderInr: '2500.00', orderCutoffIst: '18:30', leadTimeDays: 1, note: 'Old terms' };
   const businessDetails = { contactName: null, phone: '+919876543210', whatsappNumber: null, email: null, categories: ['VEGETABLES'] };
   const oldConfirmation = '2026-01-01T00:00:00.000Z';
   for (const hasTimestamp of [false, true]) {
    const id = hasTimestamp ? 'timestamped-confirmation' : 'legacy-confirmation';
    const old = { ...terms, businessDetails, revision: 1, updatedAt: hasTimestamp ? '2026-08-01T00:00:00.000Z' : oldConfirmation,
     ...(hasTimestamp ? { businessDetailsConfirmedAt: oldConfirmation } : {}),
    };
    await admin.supplier.create({ data: { id, tenantId: actor.tenantId, businessName: id, capabilities: { v: 1, categories: [], items: [] }, tradingProfile: old } });
    const link = await ops.rotate(actor, id, 'https://example.test');
    const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get('token')!;
    const initial = await ops.publicView(token);
    expect(initial.tradingProfile).toEqual(old);
    for (const revision of [1, 2]) {
     const saved = await ops.act(token, { action: 'trading-profile', portalId: initial.portalId, expectedRevision: revision, profile: { ...terms, note: `Terms revision ${revision + 1}` } });
     expect(saved.tradingProfile).toMatchObject({ businessDetails, businessDetailsConfirmedAt: oldConfirmation, revision: revision + 1 });
     expect(Date.parse(saved.tradingProfile!.updatedAt)).toBeGreaterThan(Date.parse(old.updatedAt));
     expect(tradingProfileIsStale(saved.tradingProfile!)).toBe(true);
    }
    const confirmed = await ops.act(token, { action: 'trading-profile', portalId: initial.portalId, expectedRevision: 3, profile: { ...terms, businessDetails } });
    expect(confirmed.tradingProfile).toMatchObject({ businessDetails, revision: 4 });
    expect(confirmed.tradingProfile).toHaveProperty('businessDetailsConfirmedAt', confirmed.tradingProfile!.updatedAt);
    expect(tradingProfileIsStale(confirmed.tradingProfile!)).toBe(false);
    await expect(ops.act(token, { action: 'trading-profile', portalId: initial.portalId, expectedRevision: 4, profile: { ...terms, businessDetails, businessDetailsConfirmedAt: oldConfirmation } })).rejects.toMatchObject({ status: 422 });
    expect((await admin.supplier.findUniqueOrThrow({ where: { id } })).tradingProfile).toEqual(confirmed.tradingProfile);
   }
  } finally { await app?.$disconnect(); await admin.$disconnect(); }
 });
});
