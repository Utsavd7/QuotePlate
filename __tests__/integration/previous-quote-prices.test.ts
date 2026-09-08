import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getPublicQuoteRequest, submitPublicSupplierQuote } from '@/lib/quotes/public-quote-service';
import { digestOpaqueToken } from '@/lib/security/tokens';
import { withMigratedPostgres } from './setup/postgres';

const deadline = new Date('2099-09-01T00:00:00Z');
const spec = { v: 1, category: 'VEGETABLES', qualityGrade: 'A' };
const item = (id: string, quantity = '10') => ({ id, itemKey: 'tomato', name: 'Tomato', quantity, unit: 'KILOGRAM', specification: spec, sourcingOverride: null });
const sourcing = (supplierId: string) => ({ v: 1, default: { v: 1, modes: ['CURRENT'], currentSupplierIds: [supplierId], selectedNewSupplierIds: [], acceptVerifiedApplications: false } });

test('real private grants isolate reusable prices by tenant and supplier and never write a revision on load', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      for (const tenantId of ['one', 'two']) {
        await admin.tenant.create({ data: { id: tenantId, name: tenantId, addressLine: '1 Road', city: 'Pune', state: 'Maharashtra', pin: '411001', phone: '9000000000', users: { create: { id: `${tenantId}-owner`, name: 'Owner', email: `${tenantId}@example.test`, role: 'OWNER' } } } });
        for (const suffix of ['a', 'b']) {
          await admin.supplier.create({ data: { id: `${tenantId}-${suffix}`, tenantId, businessName: 'Same business name', relationshipType: 'CURRENT', capabilities: { v: 1, categories: [], items: [] } } });
        }
      }
      async function createRequest(id: string, tenantId: string, supplierId: string, token: string, quantity = '10') {
        await admin.procurementRequest.create({ data: { id, tenantId, title: `Private ${id}`, status: 'OPEN', items: { v: 1, items: [item(id, quantity)] }, sourcing: sourcing(supplierId), deliveryDetails: {}, deliveryDate: deadline, quoteDeadline: deadline, createdByUserId: `${tenantId}-owner` } });
        await admin.supplierRequest.create({ data: { id: `${id}-grant`, tenantId, supplierId, requestId: id, tokenDigest: digestOpaqueToken('supplier-request', token), expiresAt: deadline, quoteRevisions: { v: 1, revisions: [] } } });
      }
      const password = randomBytes(24).toString('hex');
      await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
      const url = new URL(databaseUrl); url.username = 'autorfp_app'; url.password = password;
      app = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      const currentToken = 'C'.repeat(43);
      await createRequest('current', 'one', 'one-a', currentToken, '20');
      expect((await getPublicQuoteRequest({ token: currentToken }, app)).previousPrices).toBeNull();
      for (const [id, tenant, supplier, letter, rate] of [
        ['own', 'one', 'one-a', 'D', '42.75'],
        ['competitor', 'one', 'one-b', 'E', '987.65'],
        ['other-tenant', 'two', 'two-a', 'F', '876.54'],
      ]) {
        const token = letter!.repeat(43);
        await createRequest(id!, tenant!, supplier!, token);
        await submitPublicSupplierQuote({ token, quote: { expectedLatestRevision: 0, deliveryDate: '2099-09-01', validUntil: '2099-09-01', freightInr: '99', commercialTerms: 'Private old terms', items: [{ requestItemId: id, noQuote: false, availableQuantity: '3', unit: 'KILOGRAM', unitRateInr: rate, gstPercent: '5', taxInclusive: true }] } }, app);
      }
      // Awarding intentionally revokes the old link; its submitted prices remain history.
      await admin.procurementRequest.update({ where: { id: 'own' }, data: { status: 'AWARDED' } });
      await admin.supplierRequest.update({ where: { id: 'own-grant' }, data: { revokedAt: new Date() } });
      const view = await getPublicQuoteRequest({ token: currentToken }, app);
      expect(view.previousPrices).toEqual({ submittedAt: expect.any(String), items: [{ requestItemId: 'current', unitRatePaise: '4275', gstBasisPoints: 500, taxInclusive: true }] });
      expect(view.items[0]!.quantity).toBe('20');
      for (const secret of ['98765', '87654', 'Private old terms', 'competitor', 'other-tenant', 'tokenDigest', 'quoteRevisions']) expect(JSON.stringify(view)).not.toContain(secret);
      expect((await admin.supplierRequest.findUniqueOrThrow({ where: { id: 'current-grant' } })).quoteRevision).toBe(0);
      await admin.procurementRequest.update({ where: { id: 'current' }, data: { items: { v: 1, items: [{ ...item('current', '20'), specification: { ...spec, qualityGrade: 'B' } }] } } });
      expect((await getPublicQuoteRequest({ token: currentToken }, app)).previousPrices).toBeNull();
      await admin.procurementRequest.update({ where: { id: 'current' }, data: { items: { v: 1, items: [{ ...item('current', '20'), unit: 'GRAM' }] } } });
      expect((await getPublicQuoteRequest({ token: currentToken }, app)).previousPrices).toBeNull();
      await admin.supplierRequest.update({ where: { id: 'current-grant' }, data: { revokedAt: new Date() } });
      await expect(getPublicQuoteRequest({ token: currentToken }, app)).rejects.toMatchObject({ status: 410 });
      await expect(getPublicQuoteRequest({ token: 'Z'.repeat(43) }, app)).rejects.toMatchObject({ status: 410 });
    } finally { await app?.$disconnect(); await admin.$disconnect(); }
  });
}, 120_000);
