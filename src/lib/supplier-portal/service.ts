import { businessDetailsConfirmationDate, parseTradingProfileSubmission, readTradingProfile } from '@/lib/trading-profile/domain';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withTenant } from '@/lib/db/tenant-transaction';
import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { createOpaqueToken, digestOpaqueToken } from '@/lib/security/tokens';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';
import { writeAuditEvent } from '@/lib/audit/write-event';
import { validateAwardDocuments } from '@/lib/awards/award-document';
import { buildReceivingSummary, validateStoredReceiving } from '@/lib/receiving/receiving-document';
import { validateRequestItems } from '@/lib/procurement/request-document';
import { validateMenuDocument } from '@/lib/menu/menu-document';
import { computePlan, validatePlanInput } from '@/lib/service-planning/planning';
import { validateSupplierCapabilities } from '@/lib/suppliers/supplier-capabilities';
import { bounded, exact, fingerprint, parseAction, parseDemand, parseSubmission, PortalError, selectDemand, text } from './domain';
import type { PortalAction, PortalForecast, PortalOrder, RestaurantPortalView, SupplierPortalView } from './types';

export type Actor = { tenantId: string; userId: string };
type Tx = Prisma.TransactionClient;
type Revision = PortalAction & { at: string };
type Grant = { tenantId: string; portalId: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const PORTAL_ORDER_LIMIT = 30;
export const PORTAL_FORECAST_LIMIT = 30;
export const PORTAL_REVISION_LIMIT = 50;
const unavailable = () => new PortalError('This supplier portal is invalid or no longer available.', 410);

async function lockScope(tx: Tx, tenantId: string, supplierId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Supplier" WHERE "tenantId" = ${tenantId} AND "id" = ${supplierId} FOR UPDATE`;
  const supplier = await tx.supplier.findFirst({ where: { tenantId, id: supplierId, isActive: true, tenant: { isActive: true } }, select: { id: true, businessName: true, tradingProfile: true, tenant: { select: { name: true } } } });
  if (!supplier) throw new PortalError('Active supplier not found.', 404);
  return supplier;
}
async function authorize(tx: Tx, actor: Actor, mutation: boolean) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "tenantId" = ${actor.tenantId} AND "id" = ${actor.userId} FOR SHARE`;
  const user = await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: actor.userId, isActive: true, accountState: 'ACTIVE', tenant: { isActive: true } }, select: { role: true } });
  if (!user || (mutation && user.role !== 'OWNER')) throw new PortalError('Owner permission is required for changes.', 403);
  return user.role === 'OWNER';
}
async function databaseNow(tx: Tx) {
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return clock.now;
}
async function recheck(tx: Tx, grant: Grant, tokenDigest: string) {
  const [live] = await tx.$queryRaw<{ id: string }[]>`SELECT p."id" FROM "SupplierPortal" p
    JOIN "Supplier" s ON s."tenantId" = p."tenantId" AND s."id" = p."supplierId"
    JOIN "Tenant" t ON t."id" = p."tenantId"
    WHERE p."tenantId" = ${grant.tenantId} AND p."id" = ${grant.portalId} AND p."tokenDigest" = ${tokenDigest}
    AND p."revokedAt" IS NULL AND p."expiresAt" > clock_timestamp() AND s."isActive" AND t."isActive"`;
  if (!live) throw unavailable();
}
function revisions(value: unknown): Revision[] {
  if (!Array.isArray(value) || value.length > PORTAL_REVISION_LIMIT) throw new PortalError('Stored collaboration is invalid.', 503);
  return value.map(entry => {
    try {
      const { at, ...action } = entry;
      if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new Error();
      return { ...parseAction(action), at };
    } catch { throw new PortalError('Stored collaboration is invalid.', 503); }
  });
}

async function orders(tx: Tx, tenantId: string, supplierId: string, now: Date): Promise<PortalOrder[]> {
  const invitations = await tx.supplierRequest.findMany({
    where: { tenantId, supplierId, request: { status: { not: 'DRAFT' } } },
    orderBy: [{ request: { createdAt: 'desc' } }, { id: 'desc' }], take: PORTAL_ORDER_LIMIT,
    select: { requestId: true, quoteRevision: true, request: { select: { id: true, title: true, status: true, deliveryDate: true, quoteDeadline: true, items: true, award: true } } },
  });
  const collaborations = await tx.supplierCollaboration.findMany({ where: { tenantId, supplierId, requestId: { in: invitations.map(i => i.requestId) } }, take: PORTAL_ORDER_LIMIT });
  return invitations.map(invitation => {
    const r = invitation.request;
    const saved = collaborations.find(c => c.requestId === r.id);
    const history = saved ? revisions(saved.revisions) : [];
    const ack = history.findLast(h => h.action === 'acknowledge');
    const response = history.findLast(h => h.action === 'delivery-response');
    let items: PortalOrder['items'] = [];
    let delivery: PortalOrder['delivery'] = null;
    let selected = false;
    let deliveryDate = r.deliveryDate.toISOString().slice(0, 10);
    if (r.award) {
      const documents = validateAwardDocuments(r.award);
      const allocations = documents.allocationLines.lines.filter(l => l.supplierId === supplierId);
      const snapshot = documents.supplierSnapshots.suppliers.find(s => s.supplierId === supplierId);
      selected = allocations.length > 0;
      items = allocations.map(l => ({ itemId: l.requestItemId, name: snapshot?.lines.find(i => i.requestItemId === l.requestItemId)?.itemName ?? l.requestItemId, quantity: l.quantity, unit: l.unit, unitPricePaise: l.unitRatePaise }));
      if (selected) {
        deliveryDate = snapshot!.deliveryDate;
        const receiving = validateStoredReceiving(r.award.receiving);
        // Filter before deriving both the fingerprint and the public projection.
        const ownReceiving = { v: 1 as const, suppliers: receiving.suppliers.filter(s => s.supplierId === supplierId) };
        const ownDocuments = { allocationLines: { v: 1 as const, lines: allocations }, supplierSnapshots: { v: 1 as const, suppliers: snapshot ? [snapshot] : [] } };
        const summary = buildReceivingSummary({ ...ownDocuments, receiving: ownReceiving }).suppliers[0];
        const check = summary?.check;
        if (check) delivery = {
          fingerprint: fingerprint({ awardId: r.award.id, allocations, check: ownReceiving.suppliers[0] }), checkedAt: check.checkedAt, status: check.outcome,
          invoiceTotalPaise: check.invoiceTotalPaise, expectedTotalPaise: summary.expectedTotalPaise, issueCodes: [...check.issueCodes], actualDeliveryDate: check.details?.actualDeliveryDate ?? null, settlementNote: check.details?.settlementNote ?? null,
          lines: (check.itemDetails ?? []).map(l => ({ itemId: l.requestItemId, name: l.itemName, ordered: l.orderedQuantity, received: l.receivedQuantity, rejected: l.rejectedQuantity, accepted: l.acceptedQuantity, outstanding: l.pendingQuantity, unit: l.unit, billedQuantity: l.billedQuantity, billedUnitRatePaise: l.billedUnitRatePaise })),
          credit: { claimedPaise: check.details?.creditClaimedPaise ?? '0', receivedPaise: check.details?.creditReceivedPaise ?? '0', outstandingPaise: check.creditRemainingPaise ?? '0' }, notes: check.note ?? '',
        };
      }
    }
    const status: PortalOrder['status'] = selected ? 'selected' : r.status !== 'OPEN' || r.quoteDeadline <= now ? 'closed' : invitation.quoteRevision > 0 ? 'pending' : 'awaiting_quote';
    if (status === 'pending' || status === 'awaiting_quote') items = validateRequestItems(r.items).items.map(i => ({ itemId: i.id, name: i.name, quantity: i.quantity, unit: i.unit }));
    return { requestId: r.id, title: r.title, deliveryDate, status, version: saved?.version ?? 1, items, delivery,
      acknowledgement: ack?.action === 'acknowledge' ? { status: ack.status, note: ack.note, at: ack.at } : null,
      response: response?.action === 'delivery-response' ? { decision: response.decision, note: response.note, evidenceReference: response.evidenceReference, at: response.at, fingerprint: response.fingerprint } : null,
      responseIsCurrent: Boolean(response?.action === 'delivery-response' && delivery && response.fingerprint === delivery.fingerprint),
    };
  });
}
async function forecasts(tx: Tx, tenantId: string, supplierId: string): Promise<PortalForecast[]> {
  const shares = await tx.supplierDemandShare.findMany({ where: { tenantId, supplierId, withdrawnAt: null, serviceAt: { gt: await databaseNow(tx) }, plan: { requestId: null } }, include: { plan: { select: { version: true } } }, orderBy: [{ sharedAt: 'desc' }, { id: 'desc' }], take: PORTAL_FORECAST_LIMIT });
  return shares.map(s => ({ id: s.id, planId: s.planId, planVersion: s.planVersion, serviceAt: s.serviceAt.toISOString(), sharedAt: s.sharedAt.toISOString(), stale: s.plan.version !== s.planVersion, items: (s.items as unknown as PortalForecast['items']).map(i => ({ itemKey: i.itemKey, name: i.name, quantity: i.quantity, unit: i.unit, specification: i.specification })) }));
}

export function createPortalOperations(client: PrismaClient = prisma) {
  async function restaurant<T>(actor: Actor, supplierId: string, mutation: boolean, run: (tx: Tx, supplier: Awaited<ReturnType<typeof lockScope>>, canManage: boolean) => Promise<T>) {
    text(supplierId);
    return withTenant(actor.tenantId, async tx => {
      const supplier = await lockScope(tx, actor.tenantId, supplierId);
      const canManage = await authorize(tx, actor, mutation);
      return run(tx, supplier, canManage);
    }, client);
  }
  async function access<T>(raw: unknown, run: (tx: Tx, grant: Grant, supplierId: string, expiresAt: Date, now: Date) => Promise<T>) {
    let digest: string;
    try { if (typeof raw !== 'string') throw new Error(); digest = digestOpaqueToken('supplier-portal', raw); } catch { throw unavailable(); }
    await assertRuntimeDatabaseRole(client);
    const [grant] = await client.$queryRaw<Grant[]>`SELECT "tenantId", "portalId" FROM autorfp_private.autorfp_supplier_portal_by_digest(${digest})`;
    if (!grant) throw unavailable();
    const limit = await consumeDigestRateLimit({ scope: 'supplier-portal-grant', subjectDigest: fingerprint(grant.portalId), limit: 120, windowMs: 900000, now: new Date() }, client);
    if (!limit.allowed) throw new PortalError('Too many portal requests. Try again later.', 429);
    return withTenant(grant.tenantId, async tx => {
      const initial = await tx.supplierPortal.findFirst({ where: { tenantId: grant.tenantId, id: grant.portalId }, select: { supplierId: true } });
      if (!initial) throw unavailable();
      try { await lockScope(tx, grant.tenantId, initial.supplierId); } catch { throw unavailable(); }
      await tx.$queryRaw`SELECT "id" FROM "SupplierPortal" WHERE "tenantId" = ${grant.tenantId} AND "id" = ${grant.portalId} FOR UPDATE`;
      await recheck(tx, grant, digest);
      const portal = await tx.supplierPortal.findUniqueOrThrow({ where: { id: grant.portalId } });
      const result = await run(tx, grant, initial.supplierId, portal.expiresAt, await databaseNow(tx));
      // Expiry can pass while waiting for an order/award/plan lock or computing.
      await recheck(tx, grant, digest);
      return result;
    }, client);
  }
  async function snapshot(tx: Tx, grant: Grant, supplierId: string, expiresAt: Date, now: Date): Promise<SupplierPortalView> {
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId, tenantId: grant.tenantId }, select: { businessName: true, contactName: true, phone: true, whatsappNumber: true, email: true, capabilities: true, tradingProfile: true, tenant: { select: { name: true } } } });
    // Initial address-book defaults can be incomplete; saved declarations are validated separately.
    const businessDetails = {
      contactName: supplier.contactName, phone: supplier.phone, whatsappNumber: supplier.whatsappNumber, email: supplier.email,
      categories: validateSupplierCapabilities(supplier.capabilities).categories.map(({ category }) => category),
    };
    return { businessDetails, tradingProfile: readTradingProfile(supplier.tradingProfile), portalId: grant.portalId, restaurantName: supplier.tenant.name, supplierName: supplier.businessName, expiresAt: expiresAt.toISOString(), orders: await orders(tx, grant.tenantId, supplierId, now), forecasts: await forecasts(tx, grant.tenantId, supplierId) };
  }
  return {
    async restaurantView(actor: Actor, supplierId: string): Promise<RestaurantPortalView> {
      return restaurant(actor, supplierId, false, async (tx, supplier, canManage) => {
        const portal = await tx.supplierPortal.findUnique({ where: { tenantId_supplierId: { tenantId: actor.tenantId, supplierId } } });
        return { tradingProfile: readTradingProfile(supplier.tradingProfile), supplierName: supplier.businessName, canManage, access: portal ? { expiresAt: portal.expiresAt.toISOString(), revokedAt: portal.revokedAt?.toISOString() ?? null } : null, orders: await orders(tx, actor.tenantId, supplierId, await databaseNow(tx)), forecasts: await forecasts(tx, actor.tenantId, supplierId) };
      });
    },
    async rotate(actor: Actor, supplierId: string, origin: string) {
      return restaurant(actor, supplierId, true, async tx => {
        const token = createOpaqueToken('supplier-portal');
        const expiresAt = new Date((await databaseNow(tx)).getTime() + 30 * 86400000);
        const portal = await tx.supplierPortal.upsert({ where: { tenantId_supplierId: { tenantId: actor.tenantId, supplierId } }, create: { tenantId: actor.tenantId, supplierId, tokenDigest: token.digest, expiresAt }, update: { tokenDigest: token.digest, expiresAt, revokedAt: null } });
        await writeAuditEvent(tx, { ...actor, actorUserId: actor.userId, action: 'portal.rotated', entityId: portal.id, metadata: { supplierId } });
        return { url: `${new URL(origin).origin}/supplier-portal#token=${token.raw}`, expiresAt: expiresAt.toISOString() };
      });
    },
    async revoke(actor: Actor, supplierId: string) {
      return restaurant(actor, supplierId, true, async tx => {
        const portal = await tx.supplierPortal.findUnique({ where: { tenantId_supplierId: { tenantId: actor.tenantId, supplierId } } });
        if (portal) {
          await tx.supplierPortal.update({ where: { id: portal.id }, data: { revokedAt: await databaseNow(tx) } });
          await writeAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, action: 'portal.revoked', entityId: portal.id, metadata: { supplierId } });
        }
        return {};
      });
    },
    exchange(raw: unknown) { return access(raw, async (_tx, _grant, _supplier, expiresAt) => ({ expiresAt: expiresAt.toISOString() })); },
    publicView(raw: unknown) { return access(raw, snapshot); },
    async act(raw: unknown, value: unknown) {
      if ((value as { action?: unknown } | null)?.action === 'trading-profile') {
        const input = parseTradingProfileSubmission(value);
        return access(raw, async (tx, grant, supplierId, expiresAt, now) => {
          if (input.portalId !== grant.portalId) throw new PortalError('Supplier workspace changed. Reload before responding.', 409);
          const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { tradingProfile: true } });
          const current = readTradingProfile(supplier.tradingProfile);
          if ((current?.revision ?? 0) !== input.expectedRevision) throw new PortalError('Trading profile changed. Reload before saving.', 409);
          // Terms-only saves preserve confirmation freshness, including legacy timestamp fallback.
          const confirmedAt = input.profile.businessDetails ? now.toISOString() : current ? businessDetailsConfirmationDate(current) : null;
          const profile = {
            ...(current?.businessDetails ? { businessDetails: current.businessDetails } : {}),
            ...input.profile, revision: input.expectedRevision + 1, updatedAt: now.toISOString(),
            ...(confirmedAt ? { businessDetailsConfirmedAt: confirmedAt } : {}),
          };
          bounded(profile, 8192);
          await tx.supplier.update({ where: { id: supplierId }, data: { tradingProfile: json(profile) } });
          await writeAuditEvent(tx, { tenantId: grant.tenantId, action: 'portal.trading-profile-updated', entityId: supplierId, metadata: { revision: profile.revision } });
          return snapshot(tx, grant, supplierId, expiresAt, now);
        });
      }
      const { portalId, ...action } = parseSubmission(value);
      return access(raw, async (tx, grant, supplierId, expiresAt) => {
        // Cookies are shared across tabs. Bind the displayed form to the locked grant
        // before accessing an order or writing collaboration/audit records.
        if (portalId !== grant.portalId) throw new PortalError('Supplier workspace changed. Reload before responding.', 409);
        await tx.$queryRaw`SELECT "id" FROM "ProcurementRequest" WHERE "tenantId" = ${grant.tenantId} AND "id" = ${action.requestId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "Award" WHERE "tenantId" = ${grant.tenantId} AND "requestId" = ${action.requestId} FOR UPDATE`;
        const now = await databaseNow(tx);
        const order = (await orders(tx, grant.tenantId, supplierId, now)).find(o => o.requestId === action.requestId);
        if (!order) throw new PortalError('Order not found in current portal.', 404);
        if (order.status !== 'selected') throw new PortalError('Only your selected allocations can be acknowledged or discussed.', 409);
        if (order.version !== action.expectedVersion) throw new PortalError('Response changed. Reload before saving.', 409);
        if (action.action === 'delivery-response' && (!order.delivery || order.delivery.fingerprint !== action.fingerprint)) throw new PortalError('Delivery check changed. Review the current check.', 409);
        const where = { tenantId_supplierId_requestId: { tenantId: grant.tenantId, supplierId, requestId: action.requestId } };
        const current = await tx.supplierCollaboration.findUnique({ where });
        const history = current ? revisions(current.revisions) : [];
        if (history.length >= PORTAL_REVISION_LIMIT) throw new PortalError('The response history limit has been reached. Contact the restaurant.', 409);
        history.push({ ...action, at: now.toISOString() });
        bounded(history, 131072, 409);
        const saved = await tx.supplierCollaboration.upsert({ where, create: { ...where.tenantId_supplierId_requestId, version: 2, revisions: json(history) }, update: { version: { increment: 1 }, revisions: json(history) } });
        await writeAuditEvent(tx, { tenantId: grant.tenantId, action: 'portal.responded', entityId: saved.id, metadata: { supplierId, requestId: action.requestId, version: saved.version, action: action.action } });
        return snapshot(tx, grant, supplierId, expiresAt, now);
      });
    },
    share(actor: Actor, supplierId: string, value: unknown) {
      const input = parseDemand(value);
      return restaurant(actor, supplierId, true, async tx => {
        await tx.$queryRaw`SELECT "id" FROM "ServicePlan" WHERE "tenantId" = ${actor.tenantId} AND "id" = ${input.planId} FOR UPDATE`;
        const plan = await tx.servicePlan.findFirst({ where: { tenantId: actor.tenantId, id: input.planId } });
        if (!plan) throw new PortalError('Plan not found.', 404);
        if (plan.version !== input.expectedPlanVersion || plan.requestId || plan.serviceAt <= await databaseNow(tx)) throw new PortalError('Plan changed, was converted, or its service time has passed. Reload before sharing.', 409);
        const items = selectDemand(computePlan(validateMenuDocument(plan.menuSnapshot), validatePlanInput(plan.document)).ingredients, input.itemKeys);
        const sharedAt = await databaseNow(tx);
        const share = await tx.supplierDemandShare.upsert({ where: { tenantId_supplierId_planId: { tenantId: actor.tenantId, supplierId, planId: plan.id } }, create: { tenantId: actor.tenantId, supplierId, planId: plan.id, planVersion: plan.version, serviceAt: plan.serviceAt, items: json(items), sharedAt }, update: { planVersion: plan.version, serviceAt: plan.serviceAt, items: json(items), withdrawnAt: null, sharedAt } });
        await writeAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, action: 'portal.demand-shared', entityId: share.id, metadata: { supplierId, planId: plan.id, version: plan.version, itemCount: items.length } });
        return { id: share.id };
      });
    },
    withdraw(actor: Actor, supplierId: string, value: unknown) {
      const shareId = text(exact(value, ['shareId']).shareId);
      return restaurant(actor, supplierId, true, async tx => {
        const changed = await tx.supplierDemandShare.updateMany({ where: { tenantId: actor.tenantId, supplierId, id: shareId }, data: { withdrawnAt: await databaseNow(tx) } });
        if (!changed.count) throw new PortalError('Shared estimate not found.', 404);
        await writeAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, action: 'portal.demand-withdrawn', entityId: shareId, metadata: { supplierId } });
        return {};
      });
    },
  };
}
