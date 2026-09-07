import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { withMigratedPostgres } from './setup/postgres';
import { awardDocuments, requestItems, requestSourcing } from './setup/compact-reporting-fixtures';
import { createPortalOperations } from '@/lib/supplier-portal/service';
import { digestOpaqueToken } from '@/lib/security/tokens';
import { withTenant } from '@/lib/db/tenant-transaction';
import { checkRuntimeDatabase } from '@/lib/health/readiness';

const actor = { tenantId: 'portal-tenant', userId: 'portal-owner' };
test('real runtime portal enforces scope, own allocations, versions, history, forecast lifecycle and revocation', async () => {
 await withMigratedPostgres(async url => {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  const appUrl = new URL(url); appUrl.username = 'autorfp_app'; appUrl.password = randomBytes(24).toString('hex');
  let app: PrismaClient | undefined;
  try {
   await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${appUrl.password}'`);
   app = new PrismaClient({ datasources: { db: { url: appUrl.toString() } } });
   const ops = createPortalOperations(app);
   await admin.tenant.create({ data: { id: actor.tenantId, name: 'Kitchen', addressLine: '1 Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000' } });
   await admin.user.createMany({ data: [{ id: actor.userId, tenantId: actor.tenantId, name: 'Owner', email: 'portal-owner@example.test', role: 'OWNER' }, { id: 'portal-member', tenantId: actor.tenantId, name: 'Member', email: 'portal-member@example.test', role: 'MEMBER' }] });
   await admin.supplier.createMany({ data: ['own', 'competitor'].map(id => ({ id, tenantId: actor.tenantId, businessName: id, capabilities: { v: 1, categories: [], items: [] } })) });
   const request = await admin.procurementRequest.create({ data: { id: 'portal-request', tenantId: actor.tenantId, title: 'Order', status: 'AWARDED', version: 3, items: requestItems(), sourcing: requestSourcing('own'), deliveryDetails: {}, deliveryDate: new Date(Date.now() + 3 * 86400000), quoteDeadline: new Date(Date.now() + 86400000), createdByUserId: actor.userId } });
   await admin.supplierRequest.create({ data: { id: 'portal-invite', tenantId: actor.tenantId, supplierId: 'own', requestId: request.id, tokenDigest: 'a'.repeat(64), expiresAt: new Date(Date.now() + 86400000), quoteRevisions: { v: 1, revisions: [] } } });
   const docs = awardDocuments({ supplierId: 'own', supplierRequestId: 'portal-invite', supplierName: 'own', totalPaise: '100', requestTitle: 'Order' });
   const competitor = awardDocuments({ supplierId: 'competitor', supplierRequestId: 'competitor-invite', supplierName: 'Secret competitor', totalPaise: '999999', requestTitle: 'Order' });
   competitor.allocationLines.lines[0].requestItemId = 'competitor-item';
   competitor.supplierSnapshots.suppliers[0].lines[0].requestItemId = 'competitor-item';
   competitor.supplierSnapshots.suppliers[0].lines[0].itemName = 'Competitor-only item';
   docs.allocationLines.lines.push(...competitor.allocationLines.lines);
   docs.supplierSnapshots.suppliers.push(...competitor.supplierSnapshots.suppliers);
   const award = await admin.award.create({ data: { ...docs, tenantId: actor.tenantId, requestId: request.id, totalPaise: BigInt(1000099), awardedByUserId: actor.userId } });
   await expect(ops.rotate({ ...actor, userId: 'portal-member' }, 'own', 'https://example.test')).rejects.toMatchObject({ status: 403 });
   const link = await ops.rotate(actor, 'own', 'https://example.test');
   const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get('token')!;
   let view = await ops.publicView(token);
   expect(view.orders).toHaveLength(1);
   expect(view.orders[0]).toMatchObject({ status: 'selected', version: 1, deliveryDate: '2026-09-05', items: [{ quantity: '1', unitPricePaise: '100' }] });
   expect(view.orders[0].items).toHaveLength(1);
   expect(JSON.stringify(view)).not.toMatch(/competitor|Competitor|999999|1000099|rationale|tokenDigest|supplierSnapshots|quoteRevisions/);
   // An invited supplier awarded nothing cannot see award items or confirm it.
   await admin.supplier.create({ data: { id: 'unselected', tenantId: actor.tenantId, businessName: 'Unselected', capabilities: { v: 1, categories: [], items: [] } } });
   await admin.supplierRequest.create({ data: { tenantId: actor.tenantId, supplierId: 'unselected', requestId: request.id, tokenDigest: 'b'.repeat(64), expiresAt: new Date(Date.now() + 86400000), quoteRevisions: { v: 1, revisions: [] } } });
   const unselectedLink = await ops.rotate(actor, 'unselected', 'https://example.test');
   const unselectedToken = new URLSearchParams(new URL(unselectedLink.url).hash.slice(1)).get('token')!;
   expect((await ops.publicView(unselectedToken)).orders[0]).toMatchObject({ status: 'closed', items: [], delivery: null });
   await expect(ops.act(unselectedToken, { action: 'acknowledge', requestId: request.id, expectedVersion: 1, status: 'confirmed', note: '' })).rejects.toMatchObject({ status: 409 });
   const action = { action: 'acknowledge', requestId: request.id, expectedVersion: 1, status: 'confirmed', note: '' };
   const race = await Promise.allSettled([ops.act(token, action), ops.act(token, action)]);
   expect(race.filter(r => r.status === 'fulfilled')).toHaveLength(1);
   expect(race.filter(r => r.status === 'rejected')).toHaveLength(1);
   await expect(ops.act(token, { ...action, requestId: 'other' })).rejects.toMatchObject({ status: 404 });
   const receiving = { v: 1, suppliers: [{ supplierId: 'own', outcome: 'MATCHED', invoiceTotalPaise: '100', issueCodes: [], note: null, checkedAt: '2026-09-07T12:00:00.000Z' }] };
   await admin.award.update({ where: { id: award.id }, data: { receiving } });
   view = await ops.publicView(token);
   expect(view.orders[0].delivery).toMatchObject({ invoiceTotalPaise: '100', expectedTotalPaise: '100', issueCodes: [], actualDeliveryDate: null });
   const fp = view.orders[0].delivery!.fingerprint;
   view = await ops.act(token, { action: 'delivery-response', requestId: request.id, expectedVersion: 2, fingerprint: fp, decision: 'agree', note: '', evidenceReference: 'INV-123' });
   expect(view.orders[0].responseIsCurrent).toBe(true);
   await admin.award.update({ where: { id: award.id }, data: { receiving: { ...receiving, suppliers: [{ ...receiving.suppliers[0], checkedAt: '2026-09-07T12:01:00.000Z' }] } } });
   view = await ops.publicView(token);
   expect(view.orders[0].responseIsCurrent).toBe(false);
   await expect(ops.act(token, { action: 'delivery-response', requestId: request.id, expectedVersion: 3, fingerprint: fp, decision: 'agree', note: '', evidenceReference: '' })).rejects.toMatchObject({ status: 409 });
   expect((await admin.supplierCollaboration.findFirstOrThrow()).revisions).toHaveLength(2);
   const menuSnapshot = { v: 1, source: { kind: 'MANUAL', canonicalUrl: null, permissionConfirmed: false }, dishes: [{ id: 'dish', name: 'Secret recipe', position: 0, ingredients: [{ id: 'rice', itemKey: 'rice', name: 'Rice', quantity: '10', unit: 'KILOGRAM', specification: { v: 1, category: 'OTHER' } }] }] };
   const menu = await admin.menu.create({ data: { tenantId: actor.tenantId, name: 'Secret menu', document: menuSnapshot } });
   const plan = await admin.servicePlan.create({ data: { tenantId: actor.tenantId, menuId: menu.id, menuVersion: 1, menuSnapshot, name: 'Secret plan', serviceAt: new Date(Date.now() + 86400000), createdByUserId: actor.userId, document: { name: 'Secret plan', serviceAt: new Date(Date.now() + 86400000).toISOString(), dishes: [{ dishId: 'dish', batchServings: '10', portions: '9' }], inventory: [{ itemKey: 'rice', unit: 'KILOGRAM', yieldPercent: '80', stock: '4', incoming: [] }] } } });
   await ops.share(actor, 'own', { planId: plan.id, expectedPlanVersion: 1, itemKeys: ['rice'] });
   view = await ops.publicView(token);
   expect(view.forecasts[0].items[0].quantity).toBe('6.25');
   expect(JSON.stringify(view.forecasts)).not.toMatch(/Secret|stock|portions|inventory|prices/);
   await admin.servicePlan.update({ where: { id: plan.id }, data: { version: 2 } });
   expect((await ops.publicView(token)).forecasts[0].stale).toBe(true);
   await expect(ops.share(actor, 'own', { planId: plan.id, expectedPlanVersion: 1, itemKeys: ['rice'] })).rejects.toMatchObject({ status: 409 });
   await ops.withdraw(actor, 'own', { shareId: view.forecasts[0].id });
   expect((await ops.publicView(token)).forecasts).toEqual([]);
   await admin.servicePlan.update({ where: { id: plan.id }, data: { serviceAt: new Date(0) } });
   await expect(ops.share(actor, 'own', { planId: plan.id, expectedPlanVersion: 2, itemKeys: ['rice'] })).rejects.toMatchObject({ status: 409 });
   await admin.servicePlan.update({ where: { id: plan.id }, data: { serviceAt: new Date(Date.now() + 86400000) } });
   await ops.share(actor, 'own', { planId: plan.id, expectedPlanVersion: 2, itemKeys: ['rice'] });
   await admin.servicePlan.update({ where: { id: plan.id }, data: { requestId: request.id } });
   expect((await ops.publicView(token)).forecasts).toEqual([]);
   expect((await ops.restaurantView({ ...actor, userId: 'portal-member' }, 'own')).canManage).toBe(false);
   expect(await app.supplierPortal.findMany()).toEqual([]);
   expect(await app.supplierCollaboration.findMany()).toEqual([]);
   expect(await app.supplierDemandShare.findMany()).toEqual([]);
   // A past service snapshot is hidden even if the saved plan is still unconverted.
   await admin.supplierDemandShare.updateMany({ data: { serviceAt: new Date(0) } });
   expect((await ops.publicView(token)).forecasts).toEqual([]);
   // A portal token does not extend the independent quote grant.
   expect(await app.$queryRaw`SELECT * FROM autorfp_private.autorfp_supplier_grant_by_digest(${digestOpaqueToken('supplier-request', token)})`).toEqual([]);
   // Revision limits preserve the existing history instead of dropping old facts.
   const collaboration = await admin.supplierCollaboration.findFirstOrThrow();
   const history = Array.from({ length: 50 }, (_, i) => ({ ...action, expectedVersion: i + 1, at: '2026-09-07T12:00:00.000Z' }));
   await admin.supplierCollaboration.update({ where: { id: collaboration.id }, data: { version: 51, revisions: history } });
   await expect(ops.act(token, { ...action, expectedVersion: 51 })).rejects.toMatchObject({ status: 409 });
   expect((await admin.supplierCollaboration.findUniqueOrThrow({ where: { id: collaboration.id } })).revisions).toEqual(history);
   // Latest invited orders are bounded; drafts and uninvited requests stay private.
   await admin.procurementRequest.createMany({ data: Array.from({ length: 36 }, (_, i) => ({ id: 'latest-' + i, tenantId: actor.tenantId, title: 'Latest ' + i, status: i === 35 ? 'DRAFT' as const : i === 34 ? 'CANCELLED' as const : 'OPEN' as const, items: requestItems(), sourcing: requestSourcing('own'), deliveryDetails: {}, deliveryDate: new Date(Date.now() + 3 * 86400000), quoteDeadline: new Date(Date.now() + 86400000), createdByUserId: actor.userId, createdAt: new Date(Date.now() + i * 1000) })) });
   await admin.supplierRequest.createMany({ data: Array.from({ length: 36 }, (_, i) => ({ tenantId: actor.tenantId, supplierId: 'own', requestId: 'latest-' + i, tokenDigest: String(i + 10).padStart(64, '0'), expiresAt: new Date(Date.now() + 86400000), quoteRevision: i === 33 ? 1 : 0, quoteRevisions: i === 33 ? { v: 1, revisions: [{ revision: 1 }] } : { v: 1, revisions: [] } })) });
   const latest = await ops.publicView(token);
   expect(latest.orders).toHaveLength(30);
   expect(latest.orders[0]).toMatchObject({ requestId: 'latest-34', status: 'closed', items: [] });
   expect(latest.orders[1].status).toBe('pending');
   expect(latest.orders[2].status).toBe('awaiting_quote');
   expect(latest.orders.some(o => o.requestId === 'latest-35' || o.requestId === request.id)).toBe(false);
   await checkRuntimeDatabase(app);
   const rotated = await ops.rotate(actor, 'own', 'https://example.test');
   await expect(ops.publicView(token)).rejects.toMatchObject({ status: 410 });
   await ops.revoke(actor, 'own');
   await expect(ops.publicView(new URLSearchParams(new URL(rotated.url).hash.slice(1)).get('token')!)).rejects.toMatchObject({ status: 410 });
  } finally { await app?.$disconnect(); await admin.$disconnect(); }
 });
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
test('runtime denies cross-tenant references, expired/inactive grants and grants invalidated during lock waits', async () => {
 await withMigratedPostgres(async url => {
  const admin = new PrismaClient({ datasources: { db: { url } } });
  const appUrl = new URL(url); appUrl.username = 'autorfp_app'; appUrl.password = randomBytes(24).toString('hex');
  let app: PrismaClient | undefined;
  try {
   await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${appUrl.password}'`);
   app = new PrismaClient({ datasources: { db: { url: appUrl.toString() } } });
   const ops = createPortalOperations(app);
   for (const tenantId of ['a', 'b']) {
    await admin.tenant.create({ data: { id: tenantId, name: 'Kitchen ' + tenantId, addressLine: '1 Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000' } });
    await admin.user.create({ data: { id: 'owner-' + tenantId, tenantId, role: 'OWNER', name: 'Owner', email: tenantId + '@example.test' } });
    await admin.supplier.create({ data: { id: 'supplier-' + tenantId, tenantId, businessName: tenantId, capabilities: { v: 1, categories: [], items: [] } } });
   }
   const owner = { tenantId: 'a', userId: 'owner-a' };
   const link = await ops.rotate(owner, 'supplier-a', 'https://example.test');
   const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get('token')!;
   await expect(ops.restaurantView(owner, 'supplier-b')).rejects.toMatchObject({ status: 404 });
   await expect(ops.rotate(owner, 'supplier-b', 'https://example.test')).rejects.toMatchObject({ status: 404 });
   await expect(ops.share(owner, 'supplier-a', { planId: 'other-plan', expectedPlanVersion: 1, itemKeys: ['rice'] })).rejects.toMatchObject({ status: 404 });
   await expect(ops.withdraw(owner, 'supplier-a', { shareId: 'other-share' })).rejects.toMatchObject({ status: 404 });
   await expect(admin.supplierPortal.create({ data: { tenantId: 'a', supplierId: 'supplier-b', tokenDigest: 'c'.repeat(64), expiresAt: new Date(Date.now() + 86400000) } })).rejects.toThrow();
   await withTenant('b', async tx => {
    expect(await tx.supplierPortal.findMany()).toEqual([]);
    expect(await tx.supplierPortal.updateMany({ where: { supplierId: 'supplier-a' }, data: { revokedAt: new Date() } })).toEqual({ count: 0 });
   }, app);
   await expect(ops.publicView('malformed')).rejects.toMatchObject({ status: 410 });
   // A quote-purpose token is never usable as a portal grant.
   await expect(ops.publicView('q'.repeat(43))).rejects.toMatchObject({ status: 410 });
   await admin.supplier.update({ where: { id: 'supplier-a' }, data: { isActive: false } });
   await expect(ops.publicView(token)).rejects.toMatchObject({ status: 410 });
   await admin.supplier.update({ where: { id: 'supplier-a' }, data: { isActive: true } });
   await admin.tenant.update({ where: { id: 'a' }, data: { isActive: false } });
   await expect(ops.publicView(token)).rejects.toMatchObject({ status: 410 });
   await admin.tenant.update({ where: { id: 'a' }, data: { isActive: true } });
   await admin.supplierPortal.updateMany({ where: { tenantId: 'a' }, data: { expiresAt: new Date(0) } });
   await expect(ops.publicView(token)).rejects.toMatchObject({ status: 410 });
   for (const invalidate of ['revoke', 'expire'] as const) {
    const fresh = await ops.rotate(owner, 'supplier-a', 'https://example.test');
    const freshToken = new URLSearchParams(new URL(fresh.url).hash.slice(1)).get('token')!;
    const locked = deferred(), release = deferred();
    const holder = admin.$transaction(async tx => {
     await tx.$queryRaw`SELECT "id" FROM "SupplierPortal" WHERE "tenantId" = 'a' FOR UPDATE`;
     locked.resolve();
     await release.promise;
     await tx.supplierPortal.updateMany({ where: { tenantId: 'a' }, data: invalidate === 'revoke' ? { revokedAt: new Date() } : { expiresAt: new Date(0) } });
    }, { timeout: 10000 });
    await locked.promise;
    const pending = ops.publicView(freshToken).then(value => ({ value, error: null }), error => ({ value: null, error }));
    try {
     let waiting = false;
     for (let i = 0; i < 100; i++) {
      const rows = await admin.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename = 'autorfp_app' AND wait_event_type = 'Lock' AND query LIKE '%SupplierPortal%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(r => setTimeout(r, 10));
     }
     expect(waiting).toBe(true);
    } finally { release.resolve(); }
    await holder;
    expect((await pending).error).toMatchObject({ status: 410 });
   }
  } finally { await app?.$disconnect(); await admin.$disconnect(); }
 });
});
