import { AuthorizationError } from '@/lib/auth/guards';
import { createSupplierPerformanceOperations } from '@/lib/reporting/supplier-performance-service';

describe('supplier outcome report access', () => {
  const actor = { tenantId: 'tenant-a', userId: 'user-a' };
  function setup(active = true) {
    const transaction = {
      user: { findFirst: jest.fn().mockResolvedValue(active ? { id: actor.userId } : null) },
      award: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const transact = jest.fn(async (_tenantId, callback) => callback(transaction as never));
    return { transaction, transact, operations: createSupplierPerformanceOperations({ transact, now: () => new Date('2026-09-07T12:00:00Z') }) };
  }
  it('rejects inactive accounts before retrieving purchase evidence', async () => {
    const { operations, transaction } = setup(false);
    await expect(operations.read({ actor })).rejects.toBeInstanceOf(AuthorizationError);
    expect(transaction.award.findMany).not.toHaveBeenCalled();
  });
  it('uses tenant isolation and a bounded deterministic sample without invented data', async () => {
    const { operations, transaction, transact } = setup();
    const result = await operations.read({ actor });
    expect(transact).toHaveBeenCalledWith(actor.tenantId, expect.any(Function));
    expect(transaction.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: actor.tenantId, id: actor.userId, accountState: 'ACTIVE' }) }));
    expect(transaction.award.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: actor.tenantId }, take: 101, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
    expect(result).toMatchObject({ suppliers: [], capped: false, awardSampleSize: 0 });
  });
});
