import { AuthorizationError } from '@/lib/auth/guards';
import {
  createReceivingOperations,
  ReceivingNotFoundError,
  ReceivingSupplierError,
} from '@/lib/receiving/receiving-service';

function awardRecord() {
  return {
    id: 'award-a',
    requestId: 'request-a',
    allocationLines: {
      v: 1,
      lines: [{
        requestItemId: 'tomato', supplierRequestId: 'grant-a', supplierId: 'supplier-a',
        quoteRevision: 1, quantity: '10', unit: 'KILOGRAM', unitRatePaise: '10000',
        gstBasisPoints: 0, subtotalPaise: '100000', gstPaise: '0', totalPaise: '100000',
      }],
    },
    supplierSnapshots: {
      v: 1,
      suppliers: [{
        supplierId: 'supplier-a', supplierRequestId: 'grant-a', quoteRevision: 1,
        supplierName: 'Shakti Vegetables', contactName: null, phone: '9000000001',
        whatsappNumber: null, email: null, addressLine: null, city: null, state: null,
        pin: null, gstin: null, submittedAt: '2026-09-01T09:00:00.000Z',
        deliveryDate: '2026-09-04', validUntil: '2026-09-03', minimumOrder: null,
        freightPaise: '5000', commercialTerms: null, notes: null,
        subtotalPaise: '100000', gstPaise: '0', totalPaise: '105000',
        lines: [{
          requestItemId: 'tomato', itemKey: 'tomato', itemName: 'Tomato',
          requestedQuantity: '10', requestedUnit: 'KILOGRAM',
          requestedSpecification: {
            v: 1, category: 'VEGETABLES', description: null, preferredBrand: null,
            packSize: null, qualityGrade: null, notes: null, referenceUrl: null,
          },
          taxInclusive: false, suppliedBrand: null, suppliedPackSize: null,
          suppliedQualityGrade: null, substitution: null,
        }],
      }],
    },
    deliverySnapshot: {
      v: 1, requestTitle: 'Weekly vegetables', requestedDeliveryDate: '2026-09-04',
      deliveryDetails: {
        addressLine: '1 Market Road', city: 'Mumbai', state: 'Maharashtra',
        pin: '400001', instructions: null,
      },
      commercialTerms: null,
      buyer: {
        name: 'Sample Kitchen', addressLine: '1 Market Road', city: 'Mumbai',
        state: 'Maharashtra', pin: '400001', phone: '9000000000', gstin: null,
      },
    },
    totalPaise: BigInt(105000),
    receiving: null,
  };
}

function fakeTransaction() {
  return {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'member-a' }) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'award-a' }]),
    award: {
      findFirst: jest.fn().mockResolvedValue(awardRecord()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-a' }) },
  };
}

function operationsFor(transaction: ReturnType<typeof fakeTransaction>) {
  const transact = jest.fn(async (_tenantId, callback) => callback(transaction as never));
  return {
    operations: createReceivingOperations({
      transact,
      now: () => new Date('2026-09-04T10:20:30.000Z'),
    }),
    transact,
  };
}

const input = {
  actor: { tenantId: 'tenant-a', userId: 'member-a' },
  awardId: 'award-a',
  check: {
    supplierId: 'supplier-a', outcome: 'MATCHED', invoiceTotalPaise: '105000',
    issueCodes: [], note: null, expectedCheckedAt: null,
  },
} as const;

describe('receiving service', () => {
  it('lets an active restaurant member record a supplier delivery and invoice check', async () => {
    const transaction = fakeTransaction();
    const { operations, transact } = operationsFor(transaction);

    await expect(operations.record(input)).resolves.toEqual({
      supplierId: 'supplier-a', outcome: 'MATCHED', invoiceTotalPaise: '105000',
      expectedTotalPaise: '105000', differencePaise: '0', issueCodes: [], note: null,
      checkedAt: '2026-09-04T10:20:30.000Z', hasProblem: false,
    });

    expect(transact).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.award.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', id: 'award-a' },
      data: {
        receiving: {
          v: 1,
          suppliers: [{
            supplierId: 'supplier-a', outcome: 'MATCHED', invoiceTotalPaise: '105000',
            issueCodes: [], note: null, checkedAt: '2026-09-04T10:20:30.000Z',
          }],
        },
      },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a', actorUserId: 'member-a', action: 'delivery.checked',
        entityType: 'Award', entityId: 'award-a',
      }),
    });
  });

  it('replaces the same supplier check and flags invoice differences as problems', async () => {
    const transaction = fakeTransaction();
    transaction.award.findFirst.mockResolvedValue({
      ...awardRecord(),
      receiving: {
        v: 1,
        suppliers: [{
          supplierId: 'supplier-a', outcome: 'MATCHED', invoiceTotalPaise: '105000',
          issueCodes: [], note: null, checkedAt: '2026-09-04T09:00:00.000Z',
        }],
      },
    });
    const { operations } = operationsFor(transaction);

    const result = await operations.record({
      ...input,
      check: {
        supplierId: 'supplier-a', outcome: 'ISSUES', invoiceTotalPaise: '108000',
        issueCodes: ['PRICE_DIFFERENCE'], note: 'Invoice is ₹30 higher.',
        expectedCheckedAt: '2026-09-04T09:00:00.000Z',
      },
    });

    expect(result).toMatchObject({
      expectedTotalPaise: '105000', differencePaise: '3000', hasProblem: true,
    });
    expect(transaction.award.updateMany.mock.calls[0]![0].data.receiving.suppliers).toHaveLength(1);
  });

  it('rejects an update made from a stale delivery check', async () => {
    const transaction = fakeTransaction();
    transaction.award.findFirst.mockResolvedValue({
      ...awardRecord(),
      receiving: {
        v: 1,
        suppliers: [{
          supplierId: 'supplier-a', outcome: 'MATCHED', invoiceTotalPaise: '105000',
          issueCodes: [], note: null, checkedAt: '2026-09-04T09:05:00.000Z',
        }],
      },
    });
    const { operations } = operationsFor(transaction);

    await expect(operations.record({
      ...input,
      check: {
        ...input.check,
        expectedCheckedAt: '2026-09-04T09:00:00.000Z',
      },
    })).rejects.toMatchObject({
      code: 'DELIVERY_CHECK_CHANGED',
      status: 409,
    });
    expect(transaction.award.updateMany).not.toHaveBeenCalled();
  });

  it('records an invoice mismatch as a price problem even when delivery matched', async () => {
    const transaction = fakeTransaction();
    const { operations } = operationsFor(transaction);

    await expect(operations.record({
      ...input,
      check: { ...input.check, invoiceTotalPaise: '108000' },
    })).resolves.toMatchObject({
      outcome: 'ISSUES',
      issueCodes: ['PRICE_DIFFERENCE'],
      expectedTotalPaise: '105000',
      differencePaise: '3000',
      hasProblem: true,
    });

    expect(transaction.award.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        receiving: {
          v: 1,
          suppliers: [expect.objectContaining({
            supplierId: 'supplier-a',
            outcome: 'ISSUES',
            issueCodes: ['PRICE_DIFFERENCE'],
          })],
        },
      },
    }));
  });

  it('denies inactive actors, other tenants, missing awards, and suppliers outside the award', async () => {
    const inactive = fakeTransaction();
    inactive.user.findFirst.mockResolvedValue(null);
    await expect(operationsFor(inactive).operations.record(input)).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    const missing = fakeTransaction();
    missing.$queryRaw.mockResolvedValue([]);
    await expect(operationsFor(missing).operations.record(input)).rejects.toBeInstanceOf(
      ReceivingNotFoundError,
    );

    const outsider = fakeTransaction();
    await expect(operationsFor(outsider).operations.record({
      ...input,
      check: { ...input.check, supplierId: 'supplier-other' },
    })).rejects.toBeInstanceOf(ReceivingSupplierError);
    expect(outsider.award.updateMany).not.toHaveBeenCalled();
  });
});

const itemDetails = {
  items: [{ requestItemId: 'tomato', receivedQuantity: '6', rejectedQuantity: '1', billedQuantity: '10', billedUnitRatePaise: '10000' }],
  actualDeliveryDate: '2026-09-05', creditClaimedPaise: '50000', creditReceivedPaise: '20000', settlementNote: 'Credit pending',
};
it('records partial item receipts and credit without changing accepted snapshots', async () => {
  const transaction = fakeTransaction();
  const result = await operationsFor(transaction).operations.record({ ...input, check: { ...input.check, details: itemDetails } });
  expect(result).toMatchObject({ hasProblem: true, deliveryComplete: false, creditRemainingPaise: '30000', discrepancyPaise: '50000', details: itemDetails });
  expect(Object.keys(transaction.award.updateMany.mock.calls[0][0].data)).toEqual(['receiving']);
});
it.each(['foreign', 'excess', 'missing'])('rejects %s item allocations before writing', async candidate => {
  const transaction = fakeTransaction();
  const items = candidate === 'missing' ? [] : [{ ...itemDetails.items[0], ...(candidate === 'foreign' ? { requestItemId: 'foreign' } : { receivedQuantity: '12' }) }];
  await expect(operationsFor(transaction).operations.record({ ...input, check: { ...input.check, details: { ...itemDetails, items } } })).rejects.toMatchObject({ status: 422 });
  expect(transaction.award.updateMany).not.toHaveBeenCalled();
});
it('advances same-millisecond concurrency tokens and prevents legacy downgrade', async () => {
  const transaction = fakeTransaction();
  transaction.award.findFirst.mockResolvedValue({ ...awardRecord(), receiving: { v: 1, suppliers: [{ ...input.check, expectedCheckedAt: undefined, checkedAt: '2026-09-04T10:20:30.000Z', details: itemDetails }] } });
  const stored = transaction.award.findFirst.getMockImplementation();
  // Use a JSON round trip to model persisted JSON (no undefined properties).
  transaction.award.findFirst.mockResolvedValue(JSON.parse(JSON.stringify(await stored!(), (_k, v) => typeof v === 'bigint' ? v.toString() : v)));
  const check = { ...input.check, expectedCheckedAt: '2026-09-04T10:20:30.000Z' };
  await expect(operationsFor(transaction).operations.record({ ...input, check })).rejects.toMatchObject({ status: 409 });
  const result = await operationsFor(transaction).operations.record({ ...input, check: { ...check, details: itemDetails } });
  expect(result.checkedAt).toBe('2026-09-04T10:20:30.001Z');
});
