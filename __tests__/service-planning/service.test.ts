import { createPlan, updatePlan, getPlan, draftProcurement, repeatPlan } from '@/lib/service-planning/service';
import { withTenant } from '@/lib/db/tenant-transaction';
jest.mock('@/lib/db/tenant-transaction', () => ({
  withTenant: jest.fn()
}));
const actor = {
  tenantId: 'tenant-a',
  userId: 'u'
};
const document = {
  name: 'Lunch',
  serviceAt: '2026-09-10T07:00:00Z',
  dishes: [{
    dishId: 'd',
    batchServings: '10',
    portions: '10'
  }],
  inventory: [{
    itemKey: 'rice',
    unit: 'KILOGRAM',
    yieldPercent: '100',
    stock: '0',
    incoming: []
  }]
};
const menu = {
  v: 1,
  source: {
    kind: 'MANUAL',
    canonicalUrl: null,
    permissionConfirmed: false
  },
  dishes: [{
    id: 'd',
    name: 'Rice',
    position: 0,
    ingredients: [{
      id: 'i',
      itemKey: 'rice',
      name: 'Rice',
      quantity: '1',
      unit: 'KILOGRAM',
      specification: {
        v: 1,
        category: 'OTHER'
      }
    }]
  }]
};
const row = {
  name: 'Lunch',
  id: 'p',
  tenantId: 'tenant-a',
  version: 1,
  menuId: 'm',
  menuVersion: 2,
  menuSnapshot: menu,
  document,
  requestId: null
};
const tx = {
  user: {
    findFirst: jest.fn()
  },
  menu: {
    findFirst: jest.fn()
  },
  servicePlan: {
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn()
  },
  servicePlanRevision: {
    create: jest.fn()
  },
  supplier: {
    findMany: jest.fn()
  },
  procurementRequest: {
    create: jest.fn()
  },
  auditEvent: {
    create: jest.fn()
  }
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(withTenant).mockImplementation(async (_t, fn) => fn(tx as never));
  tx.user.findFirst.mockResolvedValue({
    id: 'u'
  });
  tx.menu.findFirst.mockResolvedValue({
    id: 'm',
    version: 2,
    document: menu
  });
  tx.servicePlan.create.mockResolvedValue(row);
  tx.servicePlan.findFirst.mockResolvedValue(row);
  tx.servicePlan.updateMany.mockResolvedValue({
    count: 1
  });
  tx.supplier.findMany.mockResolvedValue([]);
  tx.procurementRequest.create.mockResolvedValue({
    id: 'r'
  });
});
it('imports only approved tenant menus and writes immutable revision', async () => {
  await createPlan(actor, {
    menuId: 'm',
    document
  });
  expect(tx.menu.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      id: 'm',
      tenantId: 'tenant-a',
      status: 'APPROVED'
    }
  }));
  expect(tx.servicePlanRevision.create).toHaveBeenCalled();
});
it('rejects stale writes before a revision is inserted', async () => {
  tx.servicePlan.updateMany.mockResolvedValue({
    count: 0
  });
  await expect(updatePlan(actor, 'p', {
    expectedVersion: 1,
    document
  })).rejects.toMatchObject({
    status: 409
  });
  expect(tx.servicePlanRevision.create).not.toHaveBeenCalled();
});
it('does not disclose another tenant plan', async () => {
  tx.servicePlan.findFirst.mockResolvedValue(null);
  await expect(getPlan(actor, 'foreign')).rejects.toMatchObject({
    status: 404
  });
  expect(tx.servicePlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      id: 'foreign',
      tenantId: 'tenant-a'
    }
  }));
});
it('rejects inactive actors', async () => {
  tx.user.findFirst.mockResolvedValue(null);
  await expect(getPlan(actor, 'p')).rejects.toMatchObject({
    status: 403
  });
});
it('drafts only server deficits, then returns the existing request review URL', async () => {
  const result = await draftProcurement(actor, 'p', {
    expectedVersion: 1,
    deliveryDate: '2026-09-09',
    quoteDeadline: '2026-09-08T00:00:00Z',
    deliveryDetails: {
      addressLine: '1 Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400001'
    }
  }, new Date('2026-09-07T00:00:00Z'));
  expect(result.reviewUrl).toBe('/procurement/r');
  expect(tx.procurementRequest.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      items: {
        v: 1,
        items: [expect.objectContaining({
          quantity: '1',
          itemKey: 'rice'
        })]
      },
      status: 'DRAFT'
    })
  }));
});
it('does not create duplicate procurement drafts', async () => {
  tx.servicePlan.findFirst.mockResolvedValue({
    ...row,
    requestId: 'r'
  });
  await expect(draftProcurement(actor, 'p', {
    expectedVersion: 1
  })).rejects.toMatchObject({
    status: 409
  });
  expect(tx.procurementRequest.create).not.toHaveBeenCalled();
});
it('suggests only suppliers with matching saved ingredient capabilities', async () => {
  tx.supplier.findMany.mockResolvedValue([{
    id: 's1',
    businessName: 'Rice vendor',
    relationshipType: 'CURRENT',
    capabilities: {
      v: 1,
      categories: [],
      items: [{
        itemKey: 'rice',
        itemName: 'Rice',
        tier: 'PREFERRED',
        rank: 1
      }]
    }
  }, {
    id: 's2',
    businessName: 'Other vendor',
    relationshipType: 'CURRENT',
    capabilities: {
      v: 1,
      categories: [],
      items: [{
        itemKey: 'milk',
        itemName: 'Milk',
        tier: 'PREFERRED',
        rank: 1
      }]
    }
  }]);
  const result = await getPlan(actor, 'p');
  expect(result.supplierOptions.map(s => s.id)).toEqual(['s1']);
  expect(result.supplierOptions[0].evidence).toMatch(/unconfirmed/i);
});
it('requires active account state as well as active user and tenant', async () => {
  await getPlan(actor, 'p');
  expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      accountState: 'ACTIVE'
    })
  }));
});
it('rejects delivery after service and invalid sourcing dates without persisting a request', async () => {
  await expect(draftProcurement(actor, 'p', {
    expectedVersion: 1,
    deliveryDate: '2026-09-11',
    quoteDeadline: '2026-09-08T00:00:00Z',
    deliveryDetails: {
      addressLine: '1 Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pin: '400001'
    }
  }, new Date('2026-09-07T00:00:00Z'))).rejects.toMatchObject({
    status: 422
  });
  expect(tx.procurementRequest.create).not.toHaveBeenCalled();
});
it('blocks procurement with missing inventory instead of guessing stock and yield', async () => {
  tx.servicePlan.findFirst.mockResolvedValue({
    ...row,
    document: {
      ...document,
      inventory: []
    }
  });
  await expect(draftProcurement(actor, 'p', {
    expectedVersion: 1
  })).rejects.toMatchObject({
    status: 422
  });
  expect(tx.procurementRequest.create).not.toHaveBeenCalled();
});
it('repeats a daily plan without carrying forward stock, incoming or procurement links', async () => {
  await repeatPlan(actor, 'p', {
    expectedVersion: 1,
    serviceAt: '2026-09-11T07:00:00Z'
  });
  expect(tx.servicePlan.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      document: expect.objectContaining({
        inventory: [],
        serviceAt: '2026-09-11T07:00:00.000Z'
      }),
      menuVersion: 2
    })
  }));
  expect(tx.servicePlan.create.mock.calls[0][0].data).not.toHaveProperty('requestId');
});
