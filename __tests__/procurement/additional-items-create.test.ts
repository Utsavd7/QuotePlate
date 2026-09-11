import { Prisma } from '@prisma/client';
import { withTenant } from '@/lib/db/tenant-transaction';
import { createProcurementRequestDraft, ProcurementRequestNotFoundError } from '@/lib/procurement/request-service';
import { AuthorizationError } from '@/lib/auth/guards';

jest.mock('@/lib/db/tenant-transaction', () => ({ withTenant: jest.fn() }));
const actor = { tenantId: 'tenant-a', userId: 'member-a' };
const item = { id: 'list-a', itemKey: 'tomatoes', name: 'Tomatoes', quantity: '10', unit: 'KILOGRAM', specification: { v: 1, category: 'OTHER' }, sourcingOverride: null };
const draft = {
  title: 'Checked list', additionalItems: { v: 1, items: [item] },
  defaultSourcing: { v: 1, modes: ['VERIFIED_NEW'], currentSupplierIds: [], selectedNewSupplierIds: [], acceptVerifiedApplications: true }, sourcingOverrides: {},
  deliveryDetails: { addressLine: '12 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
  deliveryDate: '2027-01-10', quoteDeadline: '2027-01-09T10:00:00.000Z',
};
const options = { now: () => new Date('2027-01-08T09:00:00Z') };

function database() {
  let stored: Record<string, unknown>;
  const tx = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: actor.userId }) },
    menu: { findFirst: jest.fn().mockResolvedValue(null) },
    supplierRequest: { createMany: jest.fn() },
    procurementRequest: {
      create: jest.fn().mockImplementation(async ({ data }) => { stored = { ...data, id: 'request-a' }; return { id: 'request-a' }; }),
      findFirst: jest.fn().mockImplementation(async () => stored),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  jest.mocked(withTenant).mockImplementation(async (_tenant, callback) => callback(tx as unknown as Prisma.TransactionClient));
  return tx;
}

beforeEach(() => jest.clearAllMocks());

it('creates a private list-only draft after the active tenant member check, without a menu lookup', async () => {
  const tx = database();
  const result = await createProcurementRequestDraft({ actor, draft }, undefined, options);
  expect(withTenant).toHaveBeenCalledWith(actor.tenantId, expect.any(Function), expect.anything());
  expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { tenantId: actor.tenantId, id: actor.userId, isActive: true, accountState: 'ACTIVE', tenant: { isActive: true } }, select: { id: true } });
  expect(tx.menu.findFirst).not.toHaveBeenCalled();
  expect(result).toMatchObject({ tenantId: actor.tenantId, createdByUserId: actor.userId, status: 'DRAFT', menuId: null, items: { v: 1, items: [item] } });
  expect(tx.supplierRequest.createMany).not.toHaveBeenCalled();
});

it('requires active membership even for a list-only draft', async () => {
  const tx = database(); tx.user.findFirst.mockResolvedValue(null);
  await expect(createProcurementRequestDraft({ actor, draft }, undefined, options)).rejects.toThrow(AuthorizationError);
  expect(tx.procurementRequest.create).not.toHaveBeenCalled();
});

it('still requires an approved menu in this tenant whenever a menu ID is supplied', async () => {
  const tx = database();
  await expect(createProcurementRequestDraft({ actor, draft: { ...draft, menuId: 'private-menu', selectedItemIds: [] } }, undefined, options)).rejects.toThrow(ProcurementRequestNotFoundError);
  expect(tx.menu.findFirst).toHaveBeenCalledWith({ where: { tenantId: actor.tenantId, id: 'private-menu', status: 'APPROVED' }, select: { document: true } });
  expect(tx.procurementRequest.create).not.toHaveBeenCalled();
});

it('preserves approved menu facts and appends checked rows in a single draft create', async () => {
  const tx = database();
  const ingredient = { id: 'menu-row', itemKey: item.itemKey, name: item.name, quantity: '3', unit: item.unit, specification: item.specification };
  tx.menu.findFirst.mockResolvedValue({ document: { v: 1, source: { kind: 'MANUAL', canonicalUrl: null, permissionConfirmed: false }, dishes: [{ id: 'dish-a', name: 'Lunch', position: 0, ingredients: [ingredient] }] } });
  const result = await createProcurementRequestDraft({ actor, draft: { ...draft, menuId: 'menu-a', selectedItemIds: ['menu-row'] } }, undefined, options);
  expect(result.items.items).toMatchObject([{ id: 'menu-row', quantity: '3' }, { id: 'list-a', quantity: '10' }]);
  expect(tx.procurementRequest.create).toHaveBeenCalledTimes(1);
});

it('does not allow another tenant’s supplier in additional-row sourcing', async () => {
  const tx = database();
  const override = { v: 1, modes: ['CURRENT'], currentSupplierIds: ['foreign-supplier'], selectedNewSupplierIds: [], acceptVerifiedApplications: false };
  await expect(createProcurementRequestDraft({ actor, draft: { ...draft, additionalItems: { v: 1, items: [{ ...item, sourcingOverride: override }] } } }, undefined, options)).rejects.toThrow(ProcurementRequestNotFoundError);
  expect(tx.$queryRaw).toHaveBeenCalled();
  expect(tx.procurementRequest.create).not.toHaveBeenCalled();
});
