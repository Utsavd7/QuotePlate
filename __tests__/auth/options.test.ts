import { createAuthOptions, googleAuthAvailable } from '@/lib/auth';

describe('NextAuth production options', () => {
  it('hides Google unless both OAuth secrets are configured', () => {
    expect(googleAuthAvailable({})).toBe(false);
    expect(googleAuthAvailable({ GOOGLE_CLIENT_ID: 'client' })).toBe(false);
    expect(
      googleAuthAvailable({
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
      }),
    ).toBe(true);

    const withoutGoogle = createAuthOptions({ env: {} });
    const withGoogle = createAuthOptions({
      env: {
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
      },
    });
    expect(withoutGoogle.providers.map((provider) => provider.id)).toEqual([
      'credentials',
    ]);
    expect(withGoogle.providers.map((provider) => provider.id)).toEqual([
      'credentials',
      'google',
    ]);
    expect(withGoogle.providers[1].options?.authorization?.params?.scope).toBe(
      'openid email profile',
    );
    expect(withGoogle.providers[1]).toMatchObject({
      wellKnown: 'https://accounts.google.com/.well-known/openid-configuration',
      idToken: true,
      checks: ['pkce', 'state'],
    });
  });

  it.each([undefined, 'another-owner@example.com'])('permits a verified production Google owner without an allowlist (%s)', async (legacyList) => {
    const owner = {
      userId: 'new-owner', tenantId: 'new-restaurant', name: 'Asha Rao',
      email: 'asha@example.com', role: 'OWNER' as const,
      userIsActive: true, tenantIsActive: true,
    };
    const googleIdentityRepository = {
      findIdentity: jest.fn().mockResolvedValue(null),
      findUserByEmail: jest.fn().mockResolvedValue(null),
      createOwnerIdentity: jest.fn().mockResolvedValue(owner),
      touchLogin: jest.fn(),
    };
    const env = {
      NODE_ENV: 'production', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret',
      NEXTAUTH_SECRET: 'production-test-secret-at-least-32-characters',
      QUOTEPLATE_PILOT_EMAILS: legacyList,
    };
    const googleOnboarding = {
      restaurantName: 'Tamarind Table', ownerName: 'Asha Rao', email: owner.email,
      addressLine: '12 Market Road', city: 'Bengaluru', state: 'Karnataka',
      pin: '560001', phone: '+919876543210', timezone: 'Asia/Kolkata', gstin: null,
      expiresAt: '2026-09-11T00:10:00.000Z',
    };
    const options = createAuthOptions({ env, googleOnboarding, googleIdentityRepository });
    const account = { provider: 'google', providerAccountId: 'google-new-owner', type: 'oauth' as const };
    await expect(options.callbacks!.signIn!({
      user: { id: 'provider-user' }, account,
      profile: { sub: account.providerAccountId, email: owner.email, email_verified: true } as never,
    })).resolves.toBe(true);
    expect(googleIdentityRepository.createOwnerIdentity).toHaveBeenCalledWith({
      ...googleOnboarding, googleSubject: account.providerAccountId,
    });
    await expect(options.callbacks!.jwt!({
      token: { access_token: 'must-not-persist' }, user: { id: 'provider-user' }, account,
    })).resolves.toEqual({ userId: owner.userId, tenantId: owner.tenantId });
  });

  it('uses the dedicated account pages for sign-in and safe callback errors', () => {
    const options = createAuthOptions({ env: {} });

    expect(options.pages).toEqual({
      signIn: '/signin',
      error: '/signin',
    });
  });

  it('stores only userId and tenantId in the application JWT', async () => {
    const options = createAuthOptions({ env: {} });
    const jwt = options.callbacks?.jwt;
    if (!jwt) throw new Error('JWT callback missing');

    const result = await jwt({
      token: {
        sub: 'provider-sub',
        name: 'Old display name',
        email: 'old@example.com',
        picture: 'https://example.com/avatar.png',
      },
      user: {
        id: 'user-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      } as never,
      account: null,
      profile: undefined,
      trigger: 'signIn',
      isNewUser: false,
      session: undefined,
    });

    expect(result).toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
  });

  it('does not preserve authorization when stable claims are absent', async () => {
    const options = createAuthOptions({ env: {} });
    const jwt = options.callbacks?.jwt;
    if (!jwt) throw new Error('JWT callback missing');

    const result = await jwt({
      token: { name: 'Asha', email: 'asha@example.com' },
      user: undefined as never,
      account: null,
      profile: undefined,
      trigger: 'update',
      isNewUser: false,
      session: undefined,
    });

    expect(result).toEqual({});
  });
});
