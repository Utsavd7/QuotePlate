import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { withTenant } from '@/lib/db/tenant-transaction';
import { createReceivingOperations } from '@/lib/receiving/receiving-service';
import { createSupplierPerformanceOperations } from '@/lib/reporting/supplier-performance-service';
import { withMigratedPostgres } from './setup/postgres';
import { awardDocuments, emptyCapabilities, requestItems, requestSourcing } from './setup/compact-reporting-fixtures';

test('persists partial receipts and settled credits, preserving tenant isolation and stale edit protection', async () => {
  await withMigratedPostgres(async databaseUrl => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      for (const suffix of ['a', 'b']) {
        await admin.tenant.create({ data: {
          id: `tenant-${suffix}`, name: `Kitchen ${suffix}`, addressLine: '1 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9000000000',
          users: { create: { id: `user-${suffix}`, name: 'Buyer', email: `${suffix}@example.test`, role: 'OWNER', accountState: 'ACTIVE' } },
        } });
        await admin.supplier.create({ data: { id: `supplier-${suffix}`, tenantId: `tenant-${suffix}`, businessName: `Supplier ${suffix}`, capabilities: emptyCapabilities } });
        await admin.procurementRequest.create({ data: {
          id: `request-${suffix}`, tenantId: `tenant-${suffix}`, title: 'Produce', status: 'AWARDED',
          deliveryDetails: { addressLine: '1 Market Road' }, deliveryDate: new Date('2026-09-05'), quoteDeadline: new Date('2026-09-03'),
          items: requestItems(), sourcing: requestSourcing(`supplier-${suffix}`), createdByUserId: `user-${suffix}`,
          createdAt: new Date('2026-08-28T07:00:00Z'), openedAt: new Date('2026-08-28T08:00:00Z'), awardedAt: new Date('2026-08-28T10:00:00Z'),
        } });
        await admin.award.create({ data: {
          id: `award-${suffix}`, tenantId: `tenant-${suffix}`, requestId: `request-${suffix}`, awardedByUserId: `user-${suffix}`, totalPaise: 10000,
          ...awardDocuments({ supplierId: `supplier-${suffix}`, supplierRequestId: `grant-${suffix}`, supplierName: `Supplier ${suffix}`, totalPaise: '10000', requestTitle: 'Produce' }),
        } });
      }
      const password = randomBytes(24).toString('hex');
      await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
      const url = new URL(databaseUrl);
      url.username = 'autorfp_app'; url.password = password;
      app = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      const client = app;
      const dependencies = {
        transact: <T>(tenantId: string, callback: Parameters<typeof withTenant<T>>[1]) => withTenant(tenantId, callback, client),
        now: () => new Date('2026-09-07T12:00:00Z'),
      };
      const receiving = createReceivingOperations(dependencies);
      const reports = createSupplierPerformanceOperations(dependencies);
      const actor = { tenantId: 'tenant-a', userId: 'user-a' };
      const check = {
        supplierId: 'supplier-a', outcome: 'MATCHED', invoiceTotalPaise: '10000', issueCodes: [], note: null, expectedCheckedAt: null,
        details: { items: [{ requestItemId: 'item-1', receivedQuantity: '0.8', rejectedQuantity: '0.2', billedQuantity: '1', billedUnitRatePaise: '10000' }], actualDeliveryDate: '2026-09-05', creditClaimedPaise: '4000', creditReceivedPaise: '1000', settlementNote: 'Supplier credit note CN-1' },
      };
      const first = await receiving.record({ actor, awardId: 'award-a', check });
      expect(first).toMatchObject({ deliveryComplete: false, creditRemainingPaise: '3000', discrepancyPaise: '4000' });
      const report = await reports.read({ actor });
      expect(report.suppliers).toHaveLength(1);
      expect(report.suppliers[0]).toMatchObject({ supplierId: 'supplier-a', datedDeliveries: 0, partialDeliveries: 1, creditOutstandingPaise: '3000' });
      expect(report.suppliers[0].items[0]).toMatchObject({ acceptedQuantity: '0.6', fulfillmentPercent: '60', rejectionPercent: '25' });
      await expect(receiving.record({ actor, awardId: 'award-a', check })).rejects.toMatchObject({ status: 409 });
      await expect(receiving.record({ actor, awardId: 'award-b', check })).rejects.toMatchObject({ status: 404 });
      await expect(reports.read({ actor: { tenantId: 'tenant-b', userId: 'user-a' } })).rejects.toThrow();
      await receiving.record({ actor, awardId: 'award-a', check: { ...check, expectedCheckedAt: first.checkedAt, details: { ...check.details, creditReceivedPaise: '4000' } } });
      expect((await reports.read({ actor })).suppliers[0]).toMatchObject({ awardedDeliveries: 1, checkedDeliveries: 1, creditOutstandingPaise: '0' });
      const unchanged = await admin.award.findUniqueOrThrow({ where: { id: 'award-a' } });
      expect(unchanged.totalPaise).toBe(BigInt(10000));
    } finally {
      await app?.$disconnect(); await admin.$disconnect();
    }
  });
});
