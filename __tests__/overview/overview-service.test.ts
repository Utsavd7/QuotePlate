import { AuthorizationError } from '@/lib/auth/guards';
import { createOverviewOperations } from '@/lib/overview/overview-service';

function summaryRow() {
  return {
    activeSuppliers: BigInt(8), draftMenus: BigInt(2), approvedMenus: BigInt(3),
    draftRequests: BigInt(1), openRequests: BigInt(2), awardedRequests: BigInt(4),
    quotesReceived: BigInt(5), waiting: BigInt(2), problems: BigInt(1),
    deadlines: [
      { requestId: 'request-soon', title: 'Fresh produce · Bandra',
        quoteDeadline: '2026-08-29T06:30:00.000Z', suppliersInvited: '4', quotesReceived: '3' },
      { requestId: 'request-next', title: 'Dairy · Week 36',
        quoteDeadline: '2026-08-30T09:30:00.000Z', suppliersInvited: '3', quotesReceived: '2' },
    ],
    recentAwards: [{ awardId: 'award-a', requestId: 'request-awarded',
      title: 'Vegetables · Week 35', totalPaise: '9182949', awardedAt: '2026-08-27T10:00:00.000Z' }],
  };
}

function fakeTransaction(summary = summaryRow()) {
  return {
    $queryRaw: jest.fn().mockResolvedValueOnce([summary]).mockResolvedValue([]),
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'member-a' }) },
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
    // The regression was too many serialized database round trips in a 5s transaction.
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.user.findFirst.mock.invocationCallOrder[0])
      .toBeLessThan(transaction.$queryRaw.mock.invocationCallOrder[0]);
    const summaryQuery = transaction.$queryRaw.mock.calls[0][0];
    expect(summaryQuery.values).toContain('tenant-a');
    expect(summaryQuery.text).not.toContain('tenant-a');
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

  it('returns zeroes and empty lists for an empty workspace', async () => {
    const transaction = fakeTransaction({
      activeSuppliers: BigInt(0), draftMenus: BigInt(0), approvedMenus: BigInt(0),
      draftRequests: BigInt(0), openRequests: BigInt(0), awardedRequests: BigInt(0),
      quotesReceived: BigInt(0), waiting: BigInt(0), problems: BigInt(0),
      deadlines: [], recentAwards: [],
    });
    const { operations } = operationsFor(transaction);
    await expect(operations.load({ actor: { tenantId: 'tenant-a', userId: 'member-a' } }))
      .resolves.toMatchObject({
        counts: { activeSuppliers: 0, menus: { draft: 0, approved: 0 },
          requests: { draft: 0, open: 0, awarded: 0 }, quotesReceivedForOpenRequests: 0 },
        deadlines: [], recentAwards: [], deliveryAttention: { waiting: 0, problems: 0 },
      });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('preserves paise beyond JavaScript integer precision and remains JSON serializable', async () => {
    const summary = summaryRow();
    summary.recentAwards[0].totalPaise = '9007199254740993';
    const { operations } = operationsFor(fakeTransaction(summary));
    const overview = await operations.load({ actor: { tenantId: 'tenant-a', userId: 'member-a' } });
    expect(overview.recentAwards[0].totalPaise).toBe('9007199254740993');
    expect(JSON.parse(JSON.stringify(overview))).toEqual(overview);
  });

  it.each(['top-level', 'nested'] as const)('rejects unsafe %s counts instead of rounding them', async location => {
    const summary = summaryRow();
    if (location === 'top-level') summary.activeSuppliers = BigInt('9007199254740993');
    else summary.deadlines[0].suppliersInvited = '9007199254740993';
    const { operations } = operationsFor(fakeTransaction(summary));
    await expect(operations.load({ actor: { tenantId: 'tenant-a', userId: 'member-a' } }))
      .rejects.toThrow('Overview count is outside the supported range.');
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
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });
});
