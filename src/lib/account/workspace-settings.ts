import type { Prisma, PrismaClient, UserRole } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import {
  assertCanDeactivateUser,
  AuthorizationError,
  requireOwner,
} from '@/lib/auth/guards';
import { withTenant } from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';

const ACTOR_ID_LIMIT = 200;

export type WorkspaceSettingsActor = { tenantId: string; userId: string };

export type WorkspaceDetails = {
  name: string;
  addressLine: string;
  city: string;
  state: string;
  pin: string;
  phone: string;
  gstin: string | null;
};

export type WorkspaceSettingsData = {
  workspace: WorkspaceDetails & { timezone: string };
  currentUser: { id: string; name: string; email: string; role: UserRole };
  permissions: { canManageWorkspace: boolean; canManageMembers: boolean };
  members: Array<{
    id: string;
    name: string;
    email: string;
    role: UserRole;
    joinedAt: string;
    lastLoginAt: string | null;
    isCurrentUser: boolean;
  }>;
  pendingInvitations: Array<{
    id: string;
    email: string;
    role: UserRole;
    expiresAt: string;
    createdAt: string;
    invitedByName: string;
  }>;
};

type ValidationErrors = Record<string, string[]>;

export class WorkspaceSettingsValidationError extends Error {
  readonly status = 422;

  constructor(public readonly errors: ValidationErrors) {
    super('Check the highlighted restaurant details.');
    this.name = 'WorkspaceSettingsValidationError';
  }
}

type SettingsDependencies = {
  transact: <T>(
    tenantId: string,
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  now: () => Date;
  writeAudit: typeof writeAuditEvent;
  assertDeactivation: typeof assertCanDeactivateUser;
};

type SettingsClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>;

function validId(value: string) {
  return (
    value.length > 0 &&
    value.length <= ACTOR_ID_LIMIT &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function requireActor(actor: WorkspaceSettingsActor) {
  if (!validId(actor.tenantId) || !validId(actor.userId)) {
    throw new AuthorizationError();
  }
  return actor;
}

async function loadActor(
  transaction: Prisma.TransactionClient,
  actor: WorkspaceSettingsActor,
) {
  const current = await transaction.user.findFirst({
    where: {
      id: actor.userId,
      tenantId: actor.tenantId,
      accountState: 'ACTIVE',
      isActive: true,
      tenant: { isActive: true },
    },
    include: { tenant: true },
  });
  if (!current) throw new AuthorizationError();
  return current;
}

function oneLineText(
  input: Record<string, unknown>,
  field: string,
  label: string,
  max: number,
  errors: ValidationErrors,
) {
  const value = typeof input[field] === 'string' ? input[field].trim() : '';
  if (!value) errors[field] = [`${label} is required.`];
  else if (value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    errors[field] = [`${label} must be ${max} characters or fewer.`];
  }
  return value;
}

export function parseWorkspaceDetails(value: unknown): WorkspaceDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceSettingsValidationError({
      details: ['Restaurant details are required.'],
    });
  }
  const input = value as Record<string, unknown>;
  const errors: ValidationErrors = {};
  const name = oneLineText(input, 'name', 'Restaurant name', 200, errors);
  const addressLine = oneLineText(input, 'addressLine', 'Street address', 300, errors);
  const city = oneLineText(input, 'city', 'City', 100, errors);
  const state = oneLineText(input, 'state', 'State', 100, errors);
  const pin = typeof input.pin === 'string' ? input.pin.trim() : '';
  if (!/^\d{6}$/.test(pin)) errors.pin = ['Enter a 6-digit PIN.'];

  const rawPhone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const phoneWithoutPunctuation = rawPhone.replace(/[\s()\-.]/g, '');
  const phone = phoneWithoutPunctuation.startsWith('+91')
    ? phoneWithoutPunctuation.slice(3)
    : phoneWithoutPunctuation;
  if (!/^[6-9]\d{9}$/.test(phone)) {
    errors.phone = ['Enter a valid 10-digit Indian phone number.'];
  }

  const rawGstin = typeof input.gstin === 'string' ? input.gstin.trim().toUpperCase() : '';
  const gstin = rawGstin || null;
  if (
    gstin &&
    !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)
  ) {
    errors.gstin = ['Enter a valid 15-character GSTIN or leave it blank.'];
  }

  if (Object.keys(errors).length > 0) {
    throw new WorkspaceSettingsValidationError(errors);
  }
  return { name, addressLine, city, state, pin, phone, gstin };
}

const defaultDependencies: SettingsDependencies = {
  transact: (tenantId, callback) => withTenant(tenantId, callback, prisma),
  now: () => new Date(),
  writeAudit: writeAuditEvent,
  assertDeactivation: assertCanDeactivateUser,
};

export function createWorkspaceSettingsOperations(
  dependencies: SettingsDependencies = defaultDependencies,
) {
  return {
    async load(input: { actor: WorkspaceSettingsActor }): Promise<WorkspaceSettingsData> {
      const actor = requireActor(input.actor);
      return dependencies.transact(actor.tenantId, async (transaction) => {
        const current = await loadActor(transaction, actor);
        // Keep the actor check current, then fetch both visible lists in one
        // database round trip. The invitation predicate excludes expired/revoked
        // identities; no password, token digest or other credential is selected.
        const people = await transaction.user.findMany({
          where: {
            tenantId: actor.tenantId,
            OR: [
              { accountState: 'ACTIVE', isActive: true },
              {
                accountState: 'INVITED', isActive: false,
                invitationAcceptedAt: null, invitationRevokedAt: null,
                invitationExpiresAt: { gt: dependencies.now() },
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
        const members = people.filter(person => person.accountState === 'ACTIVE');
        const invitations = people.filter(person => person.accountState === 'INVITED')
          .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
            || right.id.localeCompare(left.id, 'en'));
        const canManage = current.role === 'OWNER';
        return {
          workspace: {
            name: current.tenant.name,
            addressLine: current.tenant.addressLine,
            city: current.tenant.city,
            state: current.tenant.state,
            pin: current.tenant.pin,
            phone: current.tenant.phone,
            gstin: current.tenant.gstin,
            timezone: current.tenant.timezone,
          },
          currentUser: {
            id: current.id,
            name: current.name,
            email: current.email,
            role: current.role,
          },
          permissions: {
            canManageWorkspace: canManage,
            canManageMembers: canManage,
          },
          members: members.map((member) => ({
            id: member.id,
            name: member.name,
            email: member.email,
            role: member.role,
            joinedAt: member.createdAt.toISOString(),
            lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
            isCurrentUser: member.id === current.id,
          })),
          pendingInvitations: invitations.map((invitation) => ({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.invitationExpiresAt!.toISOString(),
            createdAt: invitation.updatedAt.toISOString(),
            invitedByName: invitation.invitedBy!.name,
          })),
        };
      });
    },

    async update(input: {
      actor: WorkspaceSettingsActor;
      details: unknown;
    }) {
      const actor = requireActor(input.actor);
      return dependencies.transact(actor.tenantId, async (transaction) => {
        const current = await loadActor(transaction, actor);
        requireOwner(current, 'manage-settings');
        const details = parseWorkspaceDetails(input.details);
        const fields = [
          current.tenant.name !== details.name ? 'name' : null,
          current.tenant.addressLine !== details.addressLine ? 'addressLine' : null,
          current.tenant.city !== details.city ? 'city' : null,
          current.tenant.state !== details.state ? 'state' : null,
          current.tenant.pin !== details.pin ? 'pin' : null,
          current.tenant.phone !== details.phone ? 'phone' : null,
          current.tenant.gstin !== details.gstin ? 'gstin' : null,
        ].filter((field): field is string => field !== null);

        const tenant = await transaction.tenant.update({
          where: { id: actor.tenantId },
          data: {
            name: details.name,
            addressLine: details.addressLine,
            city: details.city,
            state: details.state,
            pin: details.pin,
            phone: details.phone,
            gstin: details.gstin,
          },
        });
        await dependencies.writeAudit(transaction, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'workspace.updated',
          entityId: actor.tenantId,
          metadata: { fields },
        });
        return {
          workspace: {
            name: tenant.name,
            addressLine: tenant.addressLine,
            city: tenant.city,
            state: tenant.state,
            pin: tenant.pin,
            phone: tenant.phone,
            gstin: tenant.gstin,
            timezone: tenant.timezone,
          },
        };
      });
    },

    async deactivate(input: {
      actor: WorkspaceSettingsActor;
      userId: unknown;
    }) {
      const actor = requireActor(input.actor);
      const targetUserId =
        typeof input.userId === 'string' ? input.userId.trim() : '';
      if (!validId(targetUserId) || targetUserId === actor.userId) {
        throw new AuthorizationError();
      }
      return dependencies.transact(actor.tenantId, async (transaction) => {
        const current = await loadActor(transaction, actor);
        requireOwner(current, 'manage-members');
        const target = await dependencies.assertDeactivation(
          transaction,
          current,
          targetUserId,
        );
        if (!target.isActive) throw new AuthorizationError();
        await transaction.user.update({
          where: { id: targetUserId },
          data: { accountState: 'DEACTIVATED', isActive: false },
        });
        await dependencies.writeAudit(transaction, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'member.deactivated',
          entityId: targetUserId,
          metadata: { previousRole: target.role },
        });
        return { userId: targetUserId };
      });
    },
  };
}

export function createPrismaWorkspaceSettingsOperations(client: SettingsClient) {
  return createWorkspaceSettingsOperations({
    ...defaultDependencies,
    transact: (tenantId, callback) => withTenant(tenantId, callback, client),
  });
}

const operations = createWorkspaceSettingsOperations();

export function getWorkspaceSettings(input: { actor: WorkspaceSettingsActor }) {
  return operations.load(input);
}

export function updateWorkspaceSettings(input: {
  actor: WorkspaceSettingsActor;
  details: unknown;
}) {
  return operations.update(input);
}

export function deactivateWorkspaceMember(input: {
  actor: WorkspaceSettingsActor;
  userId: unknown;
}) {
  return operations.deactivate(input);
}
