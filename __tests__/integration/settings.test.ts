import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { createPrismaWorkspaceSettingsOperations } from '@/lib/account/workspace-settings';
import { AuthorizationError } from '@/lib/auth/guards';

import { withMigratedPostgres } from './setup/postgres';

function appDatabaseUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = 'autorfp_app';
  url.password = password;
  return url.toString();
}

async function provisionAppClient(admin: PrismaClient, databaseUrl: string, onQuery?: (sql: string) => void) {
  const password = randomBytes(24).toString('hex');
  await admin.$executeRawUnsafe(`ALTER ROLE autorfp_app PASSWORD '${password}'`);
  const client = new PrismaClient({
    datasources: { db: { url: appDatabaseUrl(databaseUrl, password) } },
    log: [{ emit: 'event', level: 'query' }],
  });
  if (onQuery) client.$on('query', event => onQuery(event.query));
  await client.$connect();
  return client;
}

async function seedWorkspace(
  admin: PrismaClient,
  input: { tenantId: string; suffix: string },
) {
  const ownerId = `owner-${input.suffix}`;
  const memberId = `member-${input.suffix}`;
  await admin.tenant.create({
    data: {
      id: input.tenantId,
      name: `${input.suffix} Restaurant`,
      addressLine: `${input.suffix} Market Road`,
      city: input.suffix === 'a' ? 'Mumbai' : 'Private City',
      state: 'Maharashtra',
      pin: input.suffix === 'a' ? '400001' : '411999',
      phone: input.suffix === 'a' ? '9876543210' : '9123499999',
      users: {
        create: [
          {
            id: ownerId,
            name: `${input.suffix} Owner`,
            email: `${ownerId}@example.test`,
            role: 'OWNER',
          },
          {
            id: memberId,
            name: `${input.suffix} Member`,
            email: `${memberId}@example.test`,
            role: 'MEMBER',
          },
        ],
      },
    },
  });
  await admin.user.create({
    data: {
      id: `invitation-${input.suffix}`,
      tenantId: input.tenantId,
      name: `Invited ${input.suffix}`,
      email: `invite-${input.suffix}@example.test`,
      role: 'MEMBER',
      accountState: 'INVITED',
      isActive: false,
      invitationTokenDigest: input.suffix.repeat(64),
      invitationExpiresAt: new Date('2099-09-04T00:00:00.000Z'),
      invitedByUserId: ownerId,
    },
  });
  return { ownerId, memberId };
}

test('settings enforce active actors and tenant isolation for reads and owner mutations', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let app: PrismaClient | undefined;
    try {
      const a = await seedWorkspace(admin, { tenantId: 'tenant-a', suffix: 'a' });
      const b = await seedWorkspace(admin, { tenantId: 'tenant-b', suffix: 'b' });
      for (const [id, fields] of [
        ['expired', { invitationExpiresAt: new Date('2000-01-01') }],
        ['revoked', { invitationExpiresAt: new Date('2099-01-01'), invitationRevokedAt: new Date() }],
        ['accepted', { invitationExpiresAt: new Date('2099-01-01'), invitationAcceptedAt: new Date() }],
      ] as const) {
        await admin.user.create({ data: {
          id, tenantId: 'tenant-a', name: id, email: `${id}@example.test`,
          role: 'MEMBER', accountState: 'INVITED', isActive: false,
          invitedByUserId: a.ownerId, ...fields,
        } });
      }
      const userReads: string[] = [];
      app = await provisionAppClient(admin, databaseUrl, sql => {
        if (/^SELECT/i.test(sql) && sql.includes('"public"."User"')) userReads.push(sql);
      });
      const operations = createPrismaWorkspaceSettingsOperations(app);

      const ownerSettings = await operations.load({
        actor: { tenantId: 'tenant-a', userId: a.ownerId },
      });
      expect(userReads).toHaveLength(2); // Actor + combined people read, previously three.
      expect(ownerSettings.workspace).toMatchObject({
        name: 'a Restaurant',
        city: 'Mumbai',
      });
      expect(ownerSettings.members.map(({ id }) => id).sort()).toEqual([
        'member-a',
        'owner-a',
      ]);
      expect(ownerSettings.pendingInvitations).toEqual([
        expect.objectContaining({
          id: 'invitation-a',
          email: 'invite-a@example.test',
        }),
      ]);
      expect(JSON.stringify(ownerSettings)).not.toMatch(/tenant-b|Private City|invite-b|tokenDigest/i);

      await expect(operations.load({
        actor: { tenantId: 'tenant-a', userId: b.ownerId },
      })).rejects.toBeInstanceOf(AuthorizationError);

      const memberSettings = await operations.load({
        actor: { tenantId: 'tenant-a', userId: a.memberId },
      });
      expect(memberSettings.permissions).toEqual({
        canManageWorkspace: false,
        canManageMembers: false,
      });
      await expect(operations.update({
        actor: { tenantId: 'tenant-a', userId: a.memberId },
        details: {
          name: 'Not allowed',
          addressLine: '1 Changed Road', city: 'Mumbai', state: 'Maharashtra',
          pin: '400001', phone: '9876543210', gstin: null,
        },
      })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(operations.deactivate({
        actor: { tenantId: 'tenant-a', userId: a.memberId },
        userId: a.ownerId,
      })).rejects.toBeInstanceOf(AuthorizationError);

      await operations.update({
        actor: { tenantId: 'tenant-a', userId: a.ownerId },
        details: {
          name: 'Monsoon Table',
          addressLine: '44 Linking Road', city: 'Mumbai', state: 'Maharashtra',
          pin: '400050', phone: '+91 91234 56789', gstin: '27AAPFU0939F1ZV',
        },
      });
      await operations.deactivate({
        actor: { tenantId: 'tenant-a', userId: a.ownerId },
        userId: a.memberId,
      });

      expect(await admin.tenant.findUnique({ where: { id: 'tenant-a' } }))
        .toMatchObject({
          name: 'Monsoon Table', addressLine: '44 Linking Road', pin: '400050',
          phone: '9123456789', gstin: '27AAPFU0939F1ZV',
        });
      expect(await admin.user.findUnique({ where: { id: a.ownerId } }))
        .toMatchObject({ email: 'owner-a@example.test', isActive: true });
      expect(await admin.user.findUnique({ where: { id: a.memberId } }))
        .toMatchObject({ isActive: false });
      expect(await admin.auditEvent.findMany({
        where: { tenantId: 'tenant-a' },
        orderBy: { createdAt: 'asc' },
      })).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'workspace.updated', entityId: 'tenant-a' }),
        expect.objectContaining({ action: 'member.deactivated', entityId: 'member-a' }),
      ]));

      expect(await admin.tenant.findUnique({ where: { id: 'tenant-b' } }))
        .toMatchObject({ name: 'b Restaurant', city: 'Private City', gstin: null });
      expect(await admin.user.findUnique({ where: { id: b.memberId } }))
        .toMatchObject({ isActive: true });
    } finally {
      await app?.$disconnect();
      await admin.$disconnect();
    }
  });
});
