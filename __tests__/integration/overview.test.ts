import { randomBytes } from 'node:crypto';

import { PrismaClient, type Prisma } from '@prisma/client';

import { AuthorizationError } from '@/lib/auth/guards';
import { validateAwardDocuments } from '@/lib/awards/award-document';
import { withTenant } from '@/lib/db/tenant-transaction';
import { loadOverviewAttention } from '@/lib/overview/overview-attention';
import { createPrismaOverviewOperations } from '@/lib/overview/overview-service';
import { validateStoredReceiving } from '@/lib/receiving/receiving-document';

import { withMigratedPostgres } from './setup/postgres';
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
  const client = new PrismaClient({
    datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
  });
  await client.$connect();
  return client;
}

async function seedTenant(
  admin: PrismaClient,
  tenantId: string,
  userId: string,
  email: string,
) {
  await admin.tenant.create({
    data: {
      id: tenantId,
      name: `${tenantId} Kitchen`,
      addressLine: '1 Market Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400001',
      phone: '9000000000',
      users: {
        create: {
          id: userId,
          name: `${userId} Name`,
          email,
          role: 'MEMBER',
        },
      },
    },
  });
}

async function seedTenantWork(
  admin: PrismaClient,
  input: { tenantId: string; userId: string; suffix: string; privateNoise?: boolean },
) {
  const supplier = await admin.supplier.create({
    data: {
      id: `supplier-${input.suffix}`,
      tenantId: input.tenantId,
      businessName: `${input.suffix} Produce`,
      capabilities: emptyCapabilities,
    },
  });
  await admin.supplier.create({
    data: {
      id: `supplier-inactive-${input.suffix}`,
      tenantId: input.tenantId,
      businessName: `${input.suffix} Inactive`,
      isActive: false,
      capabilities: emptyCapabilities,
    },
  });
  await admin.menu.createMany({
    data: [
      {
        id: `menu-draft-${input.suffix}`,
        tenantId: input.tenantId,
        name: `${input.suffix} draft menu`,
        status: 'DRAFT',
        document: { v: 1 },
        createdByUserId: input.userId,
      },
      {
        id: `menu-approved-${input.suffix}`,
        tenantId: input.tenantId,
        name: `${input.suffix} approved menu`,
        status: 'APPROVED',
        document: { v: 1 },
        approvedAt: new Date('2026-08-20T08:00:00.000Z'),
        approvedByUserId: input.userId,
        createdByUserId: input.userId,
      },
    ],
  });
  const items = requestItems({ name: 'Produce' });
  const sourcing = requestSourcing(supplier.id);
  await admin.procurementRequest.create({
    data: {
      id: `request-draft-${input.suffix}`,
      tenantId: input.tenantId,
      title: `${input.suffix} draft request`,
      status: 'DRAFT',
      deliveryDetails: { addressLine: '1 Market Road' },
      deliveryDate: new Date('2099-09-04T00:00:00.000Z'),
      quoteDeadline: new Date('2099-09-02T08:00:00.000Z'),
      items,
      sourcing,
      createdAt: new Date('2026-08-28T06:00:00.000Z'),
      createdByUserId: input.userId,
    },
  });
  await admin.procurementRequest.create({
    data: {
      id: `request-open-${input.suffix}`,
      tenantId: input.tenantId,
      title: `${input.suffix} open request`,
      status: 'OPEN',
      deliveryDetails: { addressLine: '1 Market Road' },
      deliveryDate: new Date('2099-09-03T00:00:00.000Z'),
      quoteDeadline: new Date('2099-09-01T08:00:00.000Z'),
      items,
      sourcing,
      openedAt: new Date('2026-08-28T08:00:00.000Z'),
      createdAt: new Date('2026-08-28T07:00:00.000Z'),
      createdByUserId: input.userId,
      supplierRequests: {
        create: {
          id: `grant-${input.suffix}`,
          tenant: { connect: { id: input.tenantId } },
          supplier: {
            connect: {
              tenantId_id: { tenantId: input.tenantId, id: supplier.id },
            },
          },
          tokenDigest: input.suffix.padEnd(64, input.privateNoise ? 'b' : 'a').slice(0, 64),
          expiresAt: new Date('2099-09-01T08:00:00.000Z'),
          quoteRevision: 1,
          quoteRevisions: quoteRevisions({ count: 1 }),
        },
      },
    },
  });
  const awarded = await admin.procurementRequest.create({
    data: {
      id: `request-awarded-${input.suffix}`,
      tenantId: input.tenantId,
      title: `${input.suffix} awarded request`,
      status: 'AWARDED',
      deliveryDetails: { addressLine: '1 Market Road' },
      deliveryDate: new Date('2026-08-31T00:00:00.000Z'),
      quoteDeadline: new Date('2026-08-29T08:00:00.000Z'),
      items,
      sourcing,
      awardedAt: new Date('2026-08-28T10:00:00.000Z'),
      createdAt: new Date('2026-08-28T08:00:00.000Z'),
      createdByUserId: input.userId,
    },
  });
  await admin.award.create({
    data: {
      id: `award-${input.suffix}`,
      tenantId: input.tenantId,
      requestId: awarded.id,
      ...awardDocuments({
        supplierId: supplier.id,
        supplierRequestId: `award-grant-${input.suffix}`,
        supplierName: supplier.businessName,
        totalPaise: input.privateNoise ? '99999999' : '9182949',
        requestTitle: awarded.title,
      }),
      totalPaise: input.privateNoise ? 99_999_999 : 9_182_949,
      awardedByUserId: input.userId,
      createdAt: new Date('2026-08-28T10:00:00.000Z'),
    },
  });
}

const attentionNow = new Date('2026-09-09T18:29:59.000Z'); // 23:59:59 in India.

function receiptDetails(received: string, rejected = '0', claimed = '0', credited = '0') {
  return {
    items: [{ requestItemId: 'item-1', receivedQuantity: received, rejectedQuantity: rejected,
      billedQuantity: '1', billedUnitRatePaise: '10000' }],
    actualDeliveryDate: '2026-09-09', creditClaimedPaise: claimed,
    creditReceivedPaise: credited, settlementNote: null,
  };
}

async function seedAttentionRequest(admin: PrismaClient, input: {
  id: string;
  tenantId: string;
  status: 'DRAFT' | 'OPEN' | 'AWARDED';
  deadline?: Date;
  replies?: number[];
  deliveries?: Array<{
    date: string;
    details?: Prisma.InputJsonObject;
    issueCodes?: string[];
    invoiceTotalPaise?: string;
    awardedTotalPaise?: string;
    freightPaise?: string;
  }>;
}) {
  const { id, tenantId, status } = input;
  const supplierId = `supplier-${tenantId}`;
  await admin.supplier.upsert({
    where: { id: supplierId }, update: {},
    create: { id: supplierId, tenantId, businessName: 'Produce supplier', capabilities: emptyCapabilities },
  });
  await admin.procurementRequest.create({ data: {
    id, tenantId, title: id, status, createdByUserId: `user-${tenantId}`,
    deliveryDetails: { addressLine: '1 Market Road' },
    deliveryDate: new Date(status === 'AWARDED' ? '2026-09-09T00:00:00.000Z' : '2026-09-11T00:00:00.000Z'),
    quoteDeadline: input.deadline ?? attentionNow,
    createdAt: new Date((input.deadline ?? attentionNow).getTime() - 86_400_000),
    items: requestItems({ quantity: String(input.deliveries?.length ?? 1) }),
    sourcing: requestSourcing(supplierId),
  } });
  for (const [index, revision] of (input.replies ?? []).entries()) {
    const respondingSupplier = await admin.supplier.create({ data: {
      id: `${id}-respondent-${index}`, tenantId,
      businessName: `Respondent ${index}`, capabilities: emptyCapabilities,
    } });
    await admin.supplierRequest.create({ data: {
      tenantId, requestId: id, supplierId: respondingSupplier.id,
      tokenDigest: randomBytes(32).toString('hex'),
      expiresAt: input.deadline ?? attentionNow,
      quoteRevision: revision, quoteRevisions: quoteRevisions({ count: revision }),
    } });
  }
  if (status !== 'AWARDED') return;
  const documents = (input.deliveries ?? []).map((delivery, index) => {
    const documents = awardDocuments({
      supplierId: `${id}-delivery-${index}`, supplierRequestId: `${id}-grant-${index}`,
      supplierName: `Delivery supplier ${index}`,
      totalPaise: delivery.awardedTotalPaise ?? '10000', requestTitle: id,
    });
    documents.supplierSnapshots.suppliers[0].deliveryDate = delivery.date;
    documents.supplierSnapshots.suppliers[0].freightPaise = delivery.freightPaise ?? '0';
    documents.supplierSnapshots.suppliers[0].totalPaise = (
      BigInt(delivery.awardedTotalPaise ?? '10000') + BigInt(delivery.freightPaise ?? '0')
    ).toString();
    documents.supplierSnapshots.suppliers[0].lines[0].requestedQuantity = String(input.deliveries!.length);
    documents.deliverySnapshot.requestedDeliveryDate = '2026-09-09';
    return documents;
  });
  const checks = (input.deliveries ?? []).flatMap((delivery, index) =>
    delivery.details || delivery.issueCodes ? [{
      supplierId: `${id}-delivery-${index}`, outcome: 'ISSUES',
      invoiceTotalPaise: delivery.invoiceTotalPaise ?? '10000',
      issueCodes: delivery.issueCodes ?? ['MISSING_QUANTITY'], note: 'Delivery reviewed',
      checkedAt: '2026-09-09T12:00:00.000Z',
      ...(delivery.details ? { details: delivery.details } : {}),
    }] : []);
  const awardData = {
    id: `award-${id}`, tenantId, requestId: id, awardedByUserId: `user-${tenantId}`,
    totalPaise: documents.reduce((sum, doc) => sum
      + BigInt(doc.allocationLines.lines[0].totalPaise)
      + BigInt(doc.supplierSnapshots.suppliers[0].freightPaise), BigInt(0)),
    deliverySnapshot: documents[0].deliverySnapshot,
    allocationLines: { v: 1, lines: documents.flatMap(doc => doc.allocationLines.lines) },
    supplierSnapshots: { v: 1, suppliers: documents.flatMap(doc => doc.supplierSnapshots.suppliers) },
    ...(checks.length ? { receiving: { v: 1, suppliers: checks } } : {}),
  };
  validateAwardDocuments(awardData);
  validateStoredReceiving(awardData.receiving);
  await admin.award.create({ data: awardData });
}

async function assertAttentionQueue(admin: PrismaClient, app: PrismaClient) {
  for (const tenantId of ['attention', 'bounded', 'billing']) {
    await seedTenant(admin, tenantId, `user-${tenantId}`, `${tenantId}@example.test`);
  }
  const read = (tenantId: string, now = attentionNow) =>
    withTenant(tenantId, tx => loadOverviewAttention(tx, tenantId, now), app);
  expect(await read('attention')).toEqual({ items: [], hasMore: false });

  // Supplier's promised date controls when an unchecked delivery becomes work,
  // even when the original requested date is earlier. Midnight is India time.
  await seedAttentionRequest(admin, {
    id: 'future-delivery', tenantId: 'attention', status: 'AWARDED',
    deliveries: [{ date: '2026-09-10' }],
  });
  expect(await read('attention')).toEqual({ items: [], hasMore: false });
  expect((await read('attention', new Date('2026-09-09T18:30:00.000Z'))).items)
    .toEqual([expect.objectContaining({ requestId: 'future-delivery', pendingDeliveries: 1 })]);

  const deliveryCases = [
    { id: 'completed-historical-issues', deliveries: [
      { date: '2026-09-09', details: receiptDetails('1', '0', '4000', '4000') },
    ] },
    { id: 'partial-quantity', deliveries: [
      { date: '2026-09-09', details: receiptDetails('0.4') },
    ] },
    { id: 'unpaid-credit', deliveries: [
      { date: '2026-09-09', details: receiptDetails('1', '0', '4000', '1000') },
    ] },
    { id: 'split-quantity-and-credit', deliveries: [
      { date: '2026-09-09', details: receiptDetails('1', '0.2', '2000', '800') },
      { date: '2026-09-09', details: receiptDetails('0.4', '0', '3000', '700') },
    ] },
    { id: 'legacy-issues', deliveries: [{ date: '2026-09-09', issueCodes: ['MISSING_QUANTITY'] }] },
    { id: 'due-unchecked', deliveries: [{ date: '2026-09-09' }] },
  ];
  for (const entry of deliveryCases) {
    await seedAttentionRequest(admin, { ...entry, tenantId: 'attention', status: 'AWARDED' });
  }
  const deliveryQueue = await read('attention');
  expect(deliveryQueue.hasMore).toBe(false);
  expect(deliveryQueue.items).toEqual([
    ['due-unchecked', 1, '0'], ['legacy-issues', 1, '0'],
    ['partial-quantity', 1, '0'], ['split-quantity-and-credit', 2, '3500'],
    ['unpaid-credit', 0, '3000'],
  ].map(([requestId, pendingDeliveries, creditRemainingPaise]) => ({
    requestId, title: requestId, kind: 'delivery', replies: 0,
    pendingDeliveries, creditRemainingPaise, dueAt: '2026-09-09T00:00:00.000Z',
  })));

  // More than one revision still counts as one supplier reply; invitations do not.
  const tomorrow = new Date('2026-09-10T12:00:00.000Z');
  for (const entry of [
    { id: 'waiting-for-replies', deadline: tomorrow, replies: [0] },
    { id: 'expired-no-replies', deadline: attentionNow, replies: [0] },
    { id: 'compare-before-deadline', deadline: tomorrow, replies: [3, 1, 0] },
    { id: 'compare-after-deadline', deadline: attentionNow, replies: [1] },
  ]) {
    await seedAttentionRequest(admin, { ...entry, tenantId: 'attention', status: 'OPEN' });
  }
  const fullQueue = await read('attention');
  expect(fullQueue.hasMore).toBe(false); // Exactly eight actionable purchases.
  expect(fullQueue.items.slice(0, 5)).toEqual(deliveryQueue.items);
  expect(fullQueue.items.slice(5)).toEqual([
    ['compare-after-deadline', 'compare', 1, attentionNow.toISOString()],
    ['expired-no-replies', 'expired', 0, attentionNow.toISOString()],
    ['compare-before-deadline', 'compare', 2, tomorrow.toISOString()],
  ].map(([requestId, kind, replies, dueAt]) => ({
    requestId, title: requestId, kind, replies, dueAt,
    pendingDeliveries: 0, creditRemainingPaise: '0',
  })));

  // Insert ties in reverse order so the database cannot rely on insertion order.
  for (let index = 8; index >= 0; index--) {
    await seedAttentionRequest(admin, {
      id: `bounded-draft-${index}`, tenantId: 'bounded', status: 'DRAFT',
      deadline: new Date('2020-01-01T00:00:00.000Z'),
    });
  }
  const expectedIds = Array.from({ length: 8 }, (_, index) => `bounded-draft-${index}`);
  const bounded = await read('bounded');
  expect(bounded.hasMore).toBe(true);
  expect(bounded.items.map(item => item.requestId)).toEqual(expectedIds);
  expect(bounded.items.every(item => item.kind === 'draft')).toBe(true);
  expect(await read('bounded')).toEqual(bounded);
  await admin.procurementRequest.delete({ where: { id: 'bounded-draft-8' } });
  expect(await read('bounded')).toEqual({ items: bounded.items, hasMore: false });

  // A draft with an older deadline still follows deliveries and replies.
  await seedAttentionRequest(admin, {
    id: 'old-draft', tenantId: 'attention', status: 'DRAFT',
    deadline: new Date('2020-01-01T00:00:00.000Z'),
  });
  expect(await read('attention')).toEqual({ items: fullQueue.items, hasMore: true });

  // Full quantity does not resolve an unclaimed invoice overcharge. Actual
  // allocation totals, freight and credits received determine the balance.
  for (const entry of [
    { id: 'unclaimed-overcharge', details: receiptDetails('1'), invoiceTotalPaise: '44000' },
    { id: 'legacy-overcharge', issueCodes: ['PRICE_DIFFERENCE'], invoiceTotalPaise: '44000' },
    { id: 'settled-overcharge', details: receiptDetails('1', '0', '4000', '4000'), invoiceTotalPaise: '44000' },
    { id: 'freight-not-overcharge', details: receiptDetails('1'), invoiceTotalPaise: '44000', freightPaise: '4000' },
    { id: 'historical-late', issueCodes: ['LATE'], invoiceTotalPaise: '40000' },
    { id: 'historical-other', issueCodes: ['OTHER'], invoiceTotalPaise: '40000' },
    { id: 'historical-price', issueCodes: ['PRICE_DIFFERENCE'], invoiceTotalPaise: '40000' },
    { id: 'legacy-missing', issueCodes: ['MISSING_QUANTITY'], invoiceTotalPaise: '40000' },
    { id: 'legacy-quality', issueCodes: ['QUALITY'], invoiceTotalPaise: '40000' },
    { id: 'legacy-wrong-item', issueCodes: ['WRONG_ITEM'], invoiceTotalPaise: '40000' },
  ]) {
    const { id, ...delivery } = entry;
    await seedAttentionRequest(admin, {
      id, tenantId: 'billing', status: 'AWARDED',
      deliveries: [{ date: '2026-09-09', awardedTotalPaise: '40000', ...delivery }],
    });
  }
  expect(await read('billing')).toEqual({ hasMore: false, items: [
    'legacy-missing', 'legacy-overcharge', 'legacy-quality', 'legacy-wrong-item', 'unclaimed-overcharge',
  ].map(requestId => ({
    requestId, title: requestId, kind: 'delivery', pendingDeliveries: 1,
    replies: 0, creditRemainingPaise: '0', dueAt: '2026-09-09T00:00:00.000Z',
  })) });

  // Exercise both explicit SQL scoping (admin bypasses RLS) and forced app RLS.
  expect(await admin.$transaction(tx => loadOverviewAttention(tx, 'bounded', attentionNow)))
    .toEqual({ items: bounded.items, hasMore: false });
  expect(await withTenant('attention', tx => loadOverviewAttention(tx, 'bounded', attentionNow), app))
    .toEqual({ items: [], hasMore: false });
}

async function assertSummaryQuery(admin: PrismaClient, app: PrismaClient) {
  const operations = createPrismaOverviewOperations(app);
  for (const tenantId of ['summary-empty', 'summary']) {
    await seedTenant(admin, tenantId, `user-${tenantId}`, `${tenantId}@example.test`);
  }
  const empty = await operations.load({ actor: { tenantId: 'summary-empty', userId: 'user-summary-empty' } });
  expect(empty).toMatchObject({
    counts: { activeSuppliers: 0, menus: { draft: 0, approved: 0 },
      requests: { draft: 0, open: 0, awarded: 0 }, quotesReceivedForOpenRequests: 0 },
    deadlines: [], recentAwards: [], deliveryAttention: { waiting: 0, problems: 0 },
    attention: { items: [], hasMore: false },
  });
  // More records than each five-row list, deliberately inserted in reverse order.
  for (let index = 6; index >= 0; index--) {
    await seedAttentionRequest(admin, {
      id: `summary-awarded-${index}`, tenantId: 'summary', status: 'AWARDED',
      deliveries: [{ date: '2026-09-09',
        awardedTotalPaise: index === 6 ? '9007199254740993' : '10000',
        ...(index === 0 ? {} : { details: receiptDetails('1') }),
      }],
    });
    await admin.award.update({ where: { id: `award-summary-awarded-${index}` }, data: {
      createdAt: new Date('2026-09-08T08:15:30.123Z'),
    } });
  }
  for (let index = 5; index >= 0; index--) {
    await seedAttentionRequest(admin, {
      id: `summary-open-${index}`, tenantId: 'summary', status: 'OPEN',
      deadline: new Date('2026-09-10T12:34:56.789Z'), replies: index === 0 ? [3, 0] : [1],
    });
  }
  await seedAttentionRequest(admin, { id: 'summary-draft', tenantId: 'summary', status: 'DRAFT' });
  const summary = await operations.load({ actor: { tenantId: 'summary', userId: 'user-summary' } });
  expect(summary.counts).toEqual({
    activeSuppliers: 8, menus: { draft: 0, approved: 0 },
    requests: { draft: 1, open: 6, awarded: 7 }, quotesReceivedForOpenRequests: 6,
  });
  // Historical ISSUES still count in this legacy field even when attention is resolved.
  expect(summary.deliveryAttention).toEqual({ waiting: 1, problems: 6 });
  expect(summary.deadlines).toEqual(Array.from({ length: 5 }, (_, index) => ({
    requestId: `summary-open-${index}`, title: `summary-open-${index}`,
    quoteDeadline: '2026-09-10T12:34:56.789Z', suppliersInvited: index === 0 ? 2 : 1, quotesReceived: 1,
  })));
  expect(summary.recentAwards).toEqual(Array.from({ length: 5 }, (_, index) => ({
    awardId: `award-summary-awarded-${6 - index}`, requestId: `summary-awarded-${6 - index}`,
    title: `summary-awarded-${6 - index}`, totalPaise: index === 0 ? '9007199254740993' : '10000',
    awardedAt: '2026-09-08T08:15:30.123Z',
  })));
  expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
}

test('overview reads tenant-scoped facts and a bounded queue of unresolved work through Postgres RLS', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      await seedTenant(admin, 'tenant-a', 'member-a', 'a@example.test');
      await seedTenant(admin, 'tenant-b', 'member-b', 'b@example.test');
      await seedTenantWork(admin, { tenantId: 'tenant-a', userId: 'member-a', suffix: 'a' });
      await seedTenantWork(admin, {
        tenantId: 'tenant-b',
        userId: 'member-b',
        suffix: 'private-b',
        privateNoise: true,
      });
      app = await provisionAppClient(admin, databaseUrl);
      const operations = createPrismaOverviewOperations(app);

      const overview = await operations.load({
        actor: { tenantId: 'tenant-a', userId: 'member-a' },
      });

      expect(overview.counts).toEqual({
        activeSuppliers: 1,
        menus: { draft: 1, approved: 1 },
        requests: { draft: 1, open: 1, awarded: 1 },
        quotesReceivedForOpenRequests: 1,
      });
      expect(overview.deliveryAttention).toEqual({ waiting: 1, problems: 0 });
      expect(overview.deadlines).toEqual([
        expect.objectContaining({
          requestId: 'request-open-a',
          title: 'a open request',
          suppliersInvited: 1,
          quotesReceived: 1,
        }),
      ]);
      expect(overview.recentAwards).toEqual([
        expect.objectContaining({
          requestId: 'request-awarded-a',
          title: 'a awarded request',
          totalPaise: '9182949',
        }),
      ]);
      expect(JSON.stringify(overview)).not.toContain('private-b');
      expect(JSON.stringify(overview)).not.toContain('99999999');

      await expect(
        operations.load({ actor: { tenantId: 'tenant-a', userId: 'member-b' } }),
      ).rejects.toBeInstanceOf(AuthorizationError);

      await assertAttentionQueue(admin, app);
      await assertSummaryQuery(admin, app);
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
