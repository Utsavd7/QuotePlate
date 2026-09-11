import { AuthorizationError } from '@/lib/auth/guards';
import {
  createWorkspaceSettingsOperations,
  WorkspaceSettingsValidationError,
} from '@/lib/account/workspace-settings';

const tenant = {
  id: 'tenant-a',
  name: 'Monsoon Table',
  addressLine: '12 Hill Road',
  city: 'Mumbai',
  state: 'Maharashtra',
  pin: '400050',
  phone: '9876543210',
  timezone: 'Asia/Kolkata',
  gstin: '27AAPFU0939F1ZV',
  isActive: true,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-08-20T00:00:00.000Z'),
};

const owner = {
  id: 'owner-a',
  tenantId: 'tenant-a',
  name: 'Ananya Mehta',
  email: 'ananya@monsoontable.in',
  role: 'OWNER' as const,
  accountState: 'ACTIVE' as const,
  isActive: true,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  lastLoginAt: new Date('2026-08-28T08:15:00.000Z'),
  tenant,
};

function fakeTransaction() {
  const members = [
    {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: owner.role,
      accountState: 'ACTIVE',
      createdAt: owner.createdAt,
      lastLoginAt: owner.lastLoginAt,
    },
    {
      id: 'member-a',
      name: 'Ravi Kumar',
      email: 'ravi@monsoontable.in',
      role: 'MEMBER',
      accountState: 'ACTIVE',
      createdAt: new Date('2026-03-04T00:00:00.000Z'),
      lastLoginAt: null,
    },
  ];
  const pendingInvitations = [
    {
      id: 'invited-user-a',
      accountState: 'INVITED',
      email: 'chef@monsoontable.in',
      role: 'MEMBER',
      invitationExpiresAt: new Date('2026-09-04T12:00:00.000Z'),
      updatedAt: new Date('2026-08-28T12:00:00.000Z'),
      invitedBy: { name: 'Ananya Mehta' },
    },
  ];

  return {
    user: {
      findFirst: jest.fn().mockResolvedValue(owner),
      findMany: jest.fn().mockImplementation(
        ({ where }: { where: { accountState?: string; OR?: unknown[] } }) =>
          Promise.resolve(
            where.OR ? [...members, ...pendingInvitations] : where.accountState === 'INVITED' ? pendingInvitations : members,
          ),
      ),
      update: jest.fn().mockResolvedValue({ ...owner, email: 'ops@monsoontable.in' }),
    },
    tenant: {
      update: jest.fn().mockResolvedValue({ ...tenant, phone: '9123456789' }),
    },
    $queryRaw: jest.fn(),
  };
}

function operationsFor(transaction: ReturnType<typeof fakeTransaction>) {
  const transact = jest.fn(async (_tenantId, callback) => callback(transaction as never));
  return {
    transact,
    operations: createWorkspaceSettingsOperations({
      transact,
      now: () => new Date('2026-08-28T12:30:00.000Z'),
      writeAudit: jest.fn(),
      assertDeactivation: jest.fn(),
    }),
  };
}

describe('workspace settings service', () => {
  it('reads active members and live invitations in one list query after authorizing the actor', async () => {
    const transaction = fakeTransaction();
    const { operations } = operationsFor(transaction);
    const result = await operations.load({ actor: { tenantId: 'tenant-a', userId: 'owner-a' } });
    expect(transaction.user.findMany).toHaveBeenCalledTimes(1);
    expect(result.members).toHaveLength(2);
    expect(result.pendingInvitations).toHaveLength(1);
  });

  it('returns only safe current-tenant settings, members, and live invitations', async () => {
    const transaction = fakeTransaction();
    const { operations, transact } = operationsFor(transaction);

    const result = await operations.load({
      actor: { tenantId: 'tenant-a', userId: 'owner-a' },
    });

    expect(transact).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(transaction.user.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        OR: [
          { accountState: 'ACTIVE', isActive: true },
          {
            accountState: 'INVITED', isActive: false,
            invitationAcceptedAt: null, invitationRevokedAt: null,
            invitationExpiresAt: { gt: new Date('2026-08-28T12:30:00.000Z') },
          },
        ],
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true, name: true, email: true, role: true, accountState: true,
        createdAt: true, lastLoginAt: true, invitationExpiresAt: true,
        updatedAt: true, invitedBy: { select: { name: true } },
      },
    });
    expect(result).toEqual({
      workspace: {
        name: 'Monsoon Table',
        addressLine: '12 Hill Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin: '400050',
        phone: '9876543210',
        gstin: '27AAPFU0939F1ZV',
        timezone: 'Asia/Kolkata',
      },
      currentUser: {
        id: 'owner-a',
        name: 'Ananya Mehta',
        email: 'ananya@monsoontable.in',
        role: 'OWNER',
      },
      permissions: { canManageWorkspace: true, canManageMembers: true },
      members: [
        {
          id: 'owner-a',
          name: 'Ananya Mehta',
          email: 'ananya@monsoontable.in',
          role: 'OWNER',
          joinedAt: '2026-01-02T00:00:00.000Z',
          lastLoginAt: '2026-08-28T08:15:00.000Z',
          isCurrentUser: true,
        },
        {
          id: 'member-a',
          name: 'Ravi Kumar',
          email: 'ravi@monsoontable.in',
          role: 'MEMBER',
          joinedAt: '2026-03-04T00:00:00.000Z',
          lastLoginAt: null,
          isCurrentUser: false,
        },
      ],
      pendingInvitations: [
        {
          id: 'invited-user-a',
          email: 'chef@monsoontable.in',
          role: 'MEMBER',
          expiresAt: '2026-09-04T12:00:00.000Z',
          createdAt: '2026-08-28T12:00:00.000Z',
          invitedByName: 'Ananya Mehta',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/tenantId|tokenDigest|passwordHash/i);
  });

  it('lets an active member read settings but denies every owner mutation', async () => {
    const transaction = fakeTransaction();
    transaction.user.findFirst.mockResolvedValue({ ...owner, role: 'MEMBER' });
    const { operations } = operationsFor(transaction);

    await expect(operations.load({ actor: { tenantId: 'tenant-a', userId: 'owner-a' } }))
      .resolves.toMatchObject({ permissions: { canManageWorkspace: false, canManageMembers: false } });
    await expect(operations.update({
      actor: { tenantId: 'tenant-a', userId: 'owner-a' },
      details: {
        name: 'Monsoon Table',
        addressLine: '12 Hill Road', city: 'Mumbai', state: 'Maharashtra',
        pin: '400050', phone: '9123456789', gstin: null,
      },
    })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(operations.deactivate({
      actor: { tenantId: 'tenant-a', userId: 'owner-a' },
      userId: 'member-a',
    })).rejects.toBeInstanceOf(AuthorizationError);
    expect(transaction.tenant.update).not.toHaveBeenCalled();
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it('validates and normalizes bounded Indian restaurant details before updating', async () => {
    const transaction = fakeTransaction();
    const { operations } = operationsFor(transaction);

    const updated = await operations.update({
      actor: { tenantId: 'tenant-a', userId: 'owner-a' },
      details: {
        name: '  Monsoon Table Bandra  ',
        addressLine: ' 44 Linking Road ',
        city: ' Mumbai ', state: ' Maharashtra ', pin: '400050',
        phone: '+91 91234 56789', gstin: ' 27aapfu0939f1zv ',
      },
    });

    expect(transaction.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-a' },
      data: {
        name: 'Monsoon Table Bandra', addressLine: '44 Linking Road', city: 'Mumbai',
        state: 'Maharashtra', pin: '400050', phone: '9123456789',
        gstin: '27AAPFU0939F1ZV',
      },
    });
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(updated.workspace).toMatchObject({
      name: 'Monsoon Table', phone: '9123456789',
    });

    await expect(operations.update({
      actor: { tenantId: 'tenant-a', userId: 'owner-a' },
      details: {
        name: 'X'.repeat(201), addressLine: '', city: '',
        state: '', pin: '40A001', phone: '123', gstin: 'not-a-gstin',
      },
    })).rejects.toBeInstanceOf(WorkspaceSettingsValidationError);
  });

  it('rejects an invalid or cross-tenant actor before reading workspace records', async () => {
    const transaction = fakeTransaction();
    const { operations } = operationsFor(transaction);

    await expect(operations.load({ actor: { tenantId: ' tenant-a', userId: 'owner-a' } }))
      .rejects.toBeInstanceOf(AuthorizationError);
    transaction.user.findFirst.mockResolvedValueOnce(null);
    await expect(operations.load({ actor: { tenantId: 'tenant-a', userId: 'owner-b' } }))
      .rejects.toBeInstanceOf(AuthorizationError);
    expect(transaction.user.findMany).not.toHaveBeenCalled();
  });
});
