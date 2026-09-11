import { randomUUID } from 'crypto';

import { Prisma, type PrismaClient, type UserRole } from '@prisma/client';

import type { GoogleOnboarding } from '@/lib/auth/oauth-start';
import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { withTenant } from '@/lib/db/tenant-transaction';
import { prisma } from '@/lib/prisma';

export type GoogleIdentityUser = {
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  userIsActive: boolean;
  tenantIsActive: boolean;
};

export type GoogleIdentityRepository = {
  findIdentity(googleSubject: string): Promise<GoogleIdentityUser | null>;
  findUserByEmail(email: string): Promise<GoogleIdentityUser | null>;
  createOwnerIdentity(
    input: GoogleOnboarding & { googleSubject: string },
  ): Promise<GoogleIdentityUser>;
  touchLogin(tenantId: string, userId: string): Promise<void>;
};

type GoogleIdentityErrorCode =
  | 'INVALID_GOOGLE_IDENTITY'
  | 'GOOGLE_EMAIL_UNVERIFIED'
  | 'GOOGLE_EMAIL_MISMATCH'
  | 'GOOGLE_ACCOUNT_NOT_REGISTERED'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'ACCOUNT_INACTIVE'
  | 'GOOGLE_UNAVAILABLE';

export class GoogleIdentityError extends Error {
  constructor(
    public readonly code: GoogleIdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleIdentityError';
  }
}

type GoogleAccount = {
  provider?: string | null;
  providerAccountId?: string | null;
};

type GoogleProfile = {
  sub?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  name?: string | null;
};

function active(user: GoogleIdentityUser) {
  if (!user.userIsActive || !user.tenantIsActive) {
    throw new GoogleIdentityError(
      'ACCOUNT_INACTIVE',
      'This account is not active.',
    );
  }
  return user;
}

function uniqueConflict(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002',
  );
}

function canonicalProviderAccountId(
  value: string | null | undefined,
): value is string {
  return Boolean(
    typeof value === 'string' &&
      value.length > 0 &&
      value === value.trim() &&
      Buffer.byteLength(value, 'utf8') <= 512 &&
      !/[\u0000-\u001f\u007f]/.test(value),
  );
}

export async function resolveGoogleIdentity(
  input: {
    account: GoogleAccount;
    profile: GoogleProfile;
    onboarding: GoogleOnboarding | null;
  },
  repository: GoogleIdentityRepository = prismaGoogleIdentityRepository,
) {
  const provider = input.account.provider;
  const providerAccountId = input.account.providerAccountId;
  const email = input.profile.email?.trim().toLowerCase();

  if (
    provider !== 'google' ||
    !canonicalProviderAccountId(providerAccountId) ||
    input.profile.sub !== providerAccountId
  ) {
    throw new GoogleIdentityError(
      'INVALID_GOOGLE_IDENTITY',
      'Google did not return a valid account identity.',
    );
  }
  if (input.profile.email_verified !== true || !email) {
    throw new GoogleIdentityError(
      'GOOGLE_EMAIL_UNVERIFIED',
      'Use a Google account with a verified email address.',
    );
  }

  if (input.onboarding && input.onboarding.email !== email) {
    throw new GoogleIdentityError(
      'GOOGLE_EMAIL_MISMATCH',
      'Continue with the same Google email used to start signup.',
    );
  }

  try {
    const existingIdentity = await repository.findIdentity(providerAccountId);
    if (existingIdentity) {
      const user = active(existingIdentity);
      await repository.touchLogin(user.tenantId, user.userId);
      return user;
    }

    if (!input.onboarding) {
      throw new GoogleIdentityError(
        'GOOGLE_ACCOUNT_NOT_REGISTERED',
        'No workspace is connected to this Google account. Start a workspace first.',
      );
    }
    if (await repository.findUserByEmail(email)) {
      throw new GoogleIdentityError(
        'EMAIL_ALREADY_REGISTERED',
        'That email already has an account. Sign in with its existing method.',
      );
    }

    try {
      return active(
        await repository.createOwnerIdentity({
          ...input.onboarding,
          email,
          googleSubject: providerAccountId,
        }),
      );
    } catch (error) {
      if (!uniqueConflict(error)) throw error;

      const racedIdentity = await repository.findIdentity(providerAccountId);
      if (racedIdentity) return active(racedIdentity);

      if (await repository.findUserByEmail(email)) {
        throw new GoogleIdentityError(
          'EMAIL_ALREADY_REGISTERED',
          'That email already has an account. Sign in with its existing method.',
        );
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof GoogleIdentityError) throw error;
    throw new GoogleIdentityError(
      'GOOGLE_UNAVAILABLE',
      'Google sign-in is temporarily unavailable. Try again shortly.',
    );
  }
}

function identityUser(input: {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  tenant: { isActive: boolean };
}): GoogleIdentityUser {
  return {
    userId: input.id,
    tenantId: input.tenantId,
    name: input.name,
    email: input.email,
    role: input.role,
    userIsActive: input.isActive,
    tenantIsActive: input.tenant.isActive,
  };
}

type GoogleIdentityClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>;

type GoogleIdentityRow = {
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  userIsActive: boolean;
  tenantIsActive: boolean;
};

export function createPrismaGoogleIdentityRepository(
  client: GoogleIdentityClient,
): GoogleIdentityRepository {
  return {
    async findIdentity(googleSubject) {
      await assertRuntimeDatabaseRole(client);
      const [identity] = await client.$queryRaw<GoogleIdentityRow[]>(Prisma.sql`
        SELECT *
        FROM autorfp_private.autorfp_auth_identity_by_google_subject(
          ${googleSubject}
        )
      `);
      return identity ?? null;
    },

    async findUserByEmail(email) {
      await assertRuntimeDatabaseRole(client);
      const [user] = await client.$queryRaw<GoogleIdentityRow[]>(Prisma.sql`
        SELECT * FROM autorfp_private.autorfp_auth_identity_by_email(${email})
      `);
      return user ?? null;
    },

    async createOwnerIdentity(input) {
      const tenantId = randomUUID();
      const userId = randomUUID();
      return withTenant(
        tenantId,
        async (transaction) => {
          const tenant = await transaction.tenant.create({
            data: {
              id: tenantId,
              name: input.restaurantName,
              addressLine: input.addressLine,
              city: input.city,
              state: input.state,
              pin: input.pin,
              phone: input.phone,
              timezone: input.timezone,
              gstin: input.gstin,
            },
          });
          const user = await transaction.user.create({
            data: {
              id: userId,
              tenantId,
              name: input.ownerName,
              email: input.email,
              googleSubject: input.googleSubject,
              role: 'OWNER',
              accountState: 'ACTIVE',
              isActive: true,
            },
          });
          return identityUser({ ...user, tenant });
        },
        client,
      );
    },

    async touchLogin(tenantId, userId) {
      await withTenant(
        tenantId,
        (transaction) =>
          transaction.user.update({
            where: { id: userId },
            data: { lastLoginAt: new Date() },
          }).then(() => undefined),
        client,
      );
    },
  };
}

export const prismaGoogleIdentityRepository =
  createPrismaGoogleIdentityRepository(prisma);
