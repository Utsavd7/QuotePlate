import {
  GoogleIdentityError,
  resolveGoogleIdentity,
  type GoogleIdentityRepository,
} from '@/lib/auth/google-identity';

const onboarding = {
  restaurantName: 'Tamarind Table',
  ownerName: 'Asha Rao',
  email: 'asha@example.com',
  addressLine: '12 Market Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560001',
  phone: '+919876543210',
  timezone: 'Asia/Kolkata',
  gstin: null,
  expiresAt: '2026-08-28T00:10:00.000Z',
};

const activeOwner = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  role: 'OWNER' as const,
  userIsActive: true,
  tenantIsActive: true,
};

function repository(
  overrides: Partial<GoogleIdentityRepository> = {},
): GoogleIdentityRepository {
  return {
    findIdentity: jest.fn().mockResolvedValue(null),
    findUserByEmail: jest.fn().mockResolvedValue(null),
    createOwnerIdentity: jest.fn().mockResolvedValue(activeOwner),
    touchLogin: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const account = { provider: 'google', providerAccountId: 'google-sub-123' };
const profile = {
  sub: 'google-sub-123',
  email: 'Asha@Example.com',
  email_verified: true,
  name: 'Asha Rao',
};

describe('Google OAuth identity resolution', () => {
  it('creates the workspace owner for a verified Google signup', async () => {
    const repo = repository();

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding }, repo),
    ).resolves.toEqual(activeOwner);
    expect(repo.createOwnerIdentity).toHaveBeenCalledWith({
      ...onboarding,
      email: 'asha@example.com',
      googleSubject: 'google-sub-123',
    });
    expect(repo.findIdentity).toHaveBeenCalledWith('google-sub-123');
  });

  it('matches a returning user only by the stable Google subject', async () => {
    const repo = repository({
      findIdentity: jest.fn().mockResolvedValue(activeOwner),
    });

    await expect(
      resolveGoogleIdentity(
        {
          account,
          profile: { ...profile, email: 'new-address@example.com' },
          onboarding: null,
        },
        repo,
      ),
    ).resolves.toEqual(activeOwner);
    expect(repo.findIdentity).toHaveBeenCalledWith('google-sub-123');
    expect(repo.findUserByEmail).not.toHaveBeenCalled();
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it.each([false, null, undefined])('rejects unverified Google email (%s) before any database access', async (email_verified) => {
    const repo = repository();

    await expect(
      resolveGoogleIdentity(
        { account, profile: { ...profile, email_verified }, onboarding },
        repo,
      ),
    ).rejects.toMatchObject<Partial<GoogleIdentityError>>({
      code: 'GOOGLE_EMAIL_UNVERIFIED',
    });
    expect(repo.findIdentity).not.toHaveBeenCalled();
  });

  it.each([
    { provider: 'other', providerAccountId: 'google-sub-123' },
    { provider: 'google', providerAccountId: 'different-sub' },
    { provider: 'google', providerAccountId: '' },
  ])('rejects invalid provider identity before database access (%j)', async (invalidAccount) => {
    const repo = repository();
    await expect(resolveGoogleIdentity({ account: invalidAccount, profile, onboarding }, repo))
      .rejects.toMatchObject({ code: 'INVALID_GOOGLE_IDENTITY' });
    expect(repo.findIdentity).not.toHaveBeenCalled();
  });

  it('does not trust a truthy string as Google email verification', async () => {
    const repo = repository();
    await expect(resolveGoogleIdentity({
      account, profile: { ...profile, email_verified: 'true' as never }, onboarding,
    }, repo)).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_UNVERIFIED' });
    expect(repo.findIdentity).not.toHaveBeenCalled();
  });

  it('rejects a provider account ID over 512 UTF-8 bytes before database access', async () => {
    const repo = repository();
    const oversizedId = 'é'.repeat(257);

    await expect(
      resolveGoogleIdentity(
        {
          account: { provider: 'google', providerAccountId: oversizedId },
          profile: { ...profile, sub: oversizedId },
          onboarding,
        },
        repo,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GOOGLE_IDENTITY' });
    expect(repo.findIdentity).not.toHaveBeenCalled();
  });

  it('requires the canonical Google subject before database access', async () => {
    const repo = repository();

    await expect(
      resolveGoogleIdentity(
        {
          account: {
            provider: 'google',
            providerAccountId: ' google-sub-123 ',
          },
          profile: { ...profile, sub: ' google-sub-123 ' },
          onboarding,
        },
        repo,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GOOGLE_IDENTITY' });
    expect(repo.findIdentity).not.toHaveBeenCalled();
  });

  it('never silently links an existing password user by email', async () => {
    const repo = repository({
      findUserByEmail: jest.fn().mockResolvedValue(activeOwner),
    });

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding }, repo),
    ).rejects.toMatchObject<Partial<GoogleIdentityError>>({
      code: 'EMAIL_ALREADY_REGISTERED',
    });
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('rejects a signup when the verified Google email differs from onboarding', async () => {
    const repo = repository();

    await expect(
      resolveGoogleIdentity(
        {
          account,
          profile: { ...profile, email: 'different@example.com' },
          onboarding,
        },
        repo,
      ),
    ).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_MISMATCH' });
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('requires explicit onboarding before creating a new owner', async () => {
    const repo = repository();
    await expect(resolveGoogleIdentity({ account, profile, onboarding: null }, repo))
      .rejects.toMatchObject({ code: 'GOOGLE_ACCOUNT_NOT_REGISTERED' });
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('rejects a different Google email during signup even for an existing identity', async () => {
    const repo = repository({ findIdentity: jest.fn().mockResolvedValue(activeOwner) });
    await expect(resolveGoogleIdentity({
      account,
      profile: { ...profile, email: 'different@example.com' },
      onboarding,
    }, repo)).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_MISMATCH' });
    expect(repo.touchLogin).not.toHaveBeenCalled();
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('reuses an existing matching identity without creating another workspace', async () => {
    const repo = repository({ findIdentity: jest.fn().mockResolvedValue(activeOwner) });
    await expect(resolveGoogleIdentity({ account, profile, onboarding }, repo)).resolves.toEqual(activeOwner);
    expect(repo.touchLogin).toHaveBeenCalledWith('tenant-1', 'user-1');
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('keeps an invited email reserved for invitation acceptance', async () => {
    const repo = repository({
      findUserByEmail: jest.fn().mockResolvedValue({ ...activeOwner, role: 'MEMBER', userIsActive: false }),
    });
    await expect(resolveGoogleIdentity({ account, profile, onboarding }, repo))
      .rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
    expect(repo.createOwnerIdentity).not.toHaveBeenCalled();
  });

  it('rejects inactive users and tenants even with a valid provider identity', async () => {
    const inactiveUser = repository({
      findIdentity: jest
        .fn()
        .mockResolvedValue({ ...activeOwner, userIsActive: false }),
    });
    const inactiveTenant = repository({
      findIdentity: jest
        .fn()
        .mockResolvedValue({ ...activeOwner, tenantIsActive: false }),
    });

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding: null }, inactiveUser),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    await expect(
      resolveGoogleIdentity(
        { account, profile, onboarding: null },
        inactiveTenant,
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  });

  it('converges a same-provider callback race without linking by email', async () => {
    const findIdentity = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeOwner);
    const repo = repository({
      findIdentity,
      createOwnerIdentity: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
    });

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding }, repo),
    ).resolves.toEqual(activeOwner);
    expect(findIdentity).toHaveBeenCalledTimes(2);
  });

  it('refuses a different-provider-ID email collision after a create race', async () => {
    const repo = repository({
      findIdentity: jest.fn().mockResolvedValue(null),
      findUserByEmail: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(activeOwner),
      createOwnerIdentity: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
    });

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding }, repo),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
  });

  it('replaces Google database details with a safe provider error', async () => {
    const repo = repository({
      findIdentity: jest
        .fn()
        .mockRejectedValue(new Error('postgres://admin:secret@internal/db')),
    });

    await expect(
      resolveGoogleIdentity({ account, profile, onboarding: null }, repo),
    ).rejects.toMatchObject<Partial<GoogleIdentityError>>({
      code: 'GOOGLE_UNAVAILABLE',
      message: 'Google sign-in is temporarily unavailable. Try again shortly.',
    });
  });
});
