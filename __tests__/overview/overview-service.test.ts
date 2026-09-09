import { AuthorizationError } from '@/lib/auth/guards';
import { createOverviewOperations } from '@/lib/overview/overview-service';

function fakeTransaction() {
  return {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ waiting: BigInt(2), problems: BigInt(1) }])
      .mockResolvedValue([]),
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member-a' }),
    },
    supplier: {
      count: jest.fn().mockResolvedValue(8),
    },
    menu: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'DRAFT', _count: { _all: 2 } },
        { status: 'APPROVED', _count: { _all: 3 } },
      ]),
    },
    procurementRequest: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'DRAFT', _count: { _all: 1 } },
        { status: 'OPEN', _count: { _all: 2 } },
        { status: 'AWARDED', _count: { _all: 4 } },
      ]),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'request-soon',
          title: 'Fresh produce · Bandra',
          quoteDeadline: new Date('2026-08-29T06:30:00.000Z'),
          _count: { supplierRequests: 4 },
        },
        {
          id: 'request-next',
          title: 'Dairy · Week 36',
          quoteDeadline: new Date('2026-08-30T09:30:00.000Z'),
          _count: { supplierRequests: 3 },
        },
      ]),
    },
    supplierRequest: {
      count: jest.fn().mockResolvedValue(5),
      groupBy: jest.fn().mockResolvedValue([
        { requestId: 'request-soon', _count: { _all: 3 } },
        { requestId: 'request-next', _count: { _all: 2 } },
      ]),
    },
    award: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'award-a',
          requestId: 'request-awarded',
          totalPaise: BigInt(9_182_949),
          createdAt: new Date('2026-08-27T10:00:00.000Z'),
          request: { title: 'Vegetables · Week 35' },
        },
      ]),
    },
  };
}

function operationsFor(transaction: ReturnType<typeof fakeTransaction>) {
  const transact = jest.fn(async (_tenantId, callback) => callback(transaction as never));
  return {
    transact,
    operations: createOverviewOperations({
      transact,
      now: () => new Date('2026-08-28T06:00:00.000Z'),
    }),
  };
}

describe('overview service', () => {
  it('returns only factual, bounded work for the active tenant', async () => {
    const transaction = fakeTransaction();
    const { operations, transact } = operationsFor(transaction);

    const overview = await operations.load({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
    });

    expect(transact).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(transaction.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'member-a',
        tenantId: 'tenant-a',
        isActive: true,
        tenant: { isActive: true },
      },
      select: { id: true },
    });
    expect(transaction.supplier.count).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', isActive: true },
    });
    expect(transaction.menu.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { tenantId: 'tenant-a' },
      _count: { _all: true },
    });
    expect(transaction.procurementRequest.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: {
        tenantId: 'tenant-a',
        status: { in: ['DRAFT', 'OPEN', 'AWARDED'] },
      },
      _count: { _all: true },
    });
    expect(transaction.supplierRequest.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        request: { tenantId: 'tenant-a', status: 'OPEN' },
        quoteRevision: { gt: 0 },
      },
    });
    expect(transaction.procurementRequest.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', status: 'OPEN' },
      orderBy: [{ quoteDeadline: 'asc' }, { id: 'asc' }],
      take: 5,
      select: {
        id: true,
        title: true,
        quoteDeadline: true,
        _count: { select: { supplierRequests: true } },
      },
    });
    expect(transaction.award.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        requestId: true,
        totalPaise: true,
        createdAt: true,
        request: { select: { title: true } },
      },
    });
    expect(overview).toEqual({
      generatedAt: '2026-08-28T06:00:00.000Z',
      attention: { items: [], hasMore: false },
      counts: {
        activeSuppliers: 8,
        menus: { draft: 2, approved: 3 },
        requests: { draft: 1, open: 2, awarded: 4 },
        quotesReceivedForOpenRequests: 5,
      },
      deliveryAttention: { waiting: 2, problems: 1 },
      deadlines: [
        {
          requestId: 'request-soon',
          title: 'Fresh produce · Bandra',
          quoteDeadline: '2026-08-29T06:30:00.000Z',
          suppliersInvited: 4,
          quotesReceived: 3,
        },
        {
          requestId: 'request-next',
          title: 'Dairy · Week 36',
          quoteDeadline: '2026-08-30T09:30:00.000Z',
          suppliersInvited: 3,
          quotesReceived: 2,
        },
      ],
      recentAwards: [
        {
          awardId: 'award-a',
          requestId: 'request-awarded',
          title: 'Vegetables · Week 35',
          totalPaise: '9182949',
          awardedAt: '2026-08-27T10:00:00.000Z',
        },
      ],
    });
  });

  it('returns zeroes for missing status groups and skips response grouping without deadlines', async () => {
    const transaction = fakeTransaction();
    transaction.menu.groupBy.mockResolvedValue([]);
    transaction.procurementRequest.groupBy.mockResolvedValue([]);
    transaction.procurementRequest.findMany.mockResolvedValue([]);
    transaction.supplierRequest.groupBy.mockResolvedValue([]);
    transaction.award.findMany.mockResolvedValue([]);
    const { operations } = operationsFor(transaction);

    await expect(
      operations.load({ actor: { tenantId: 'tenant-a', userId: 'member-a' } }),
    ).resolves.toMatchObject({
      counts: {
        menus: { draft: 0, approved: 0 },
        requests: { draft: 0, open: 0, awarded: 0 },
      },
      deadlines: [],
      recentAwards: [],
      deliveryAttention: { waiting: 2, problems: 1 },
    });
    expect(transaction.supplierRequest.groupBy).not.toHaveBeenCalled();
  });

  it('denies invalid or inactive actors before reading restaurant data', async () => {
    const transaction = fakeTransaction();
    const { operations } = operationsFor(transaction);

    await expect(
      operations.load({ actor: { tenantId: ' tenant-a', userId: 'member-a' } }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(transaction.user.findFirst).not.toHaveBeenCalled();

    transaction.user.findFirst.mockResolvedValueOnce(null);
    await expect(
      operations.load({ actor: { tenantId: 'tenant-a', userId: 'member-a' } }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(transaction.supplier.count).not.toHaveBeenCalled();
  });
});
