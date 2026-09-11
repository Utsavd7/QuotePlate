import { GET as live } from '@/app/api/health/live/route';
import {
  EnvironmentConfigurationError,
  validateRuntimeEnvironment,
} from '@/lib/env';
import {
  checkRuntimeDatabase,
  createReadinessHandler,
} from '@/lib/health/readiness';
import { register } from '@/instrumentation';

const validRuntimeEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://autorfp_app:secret@ep-example-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connection_limit=5',
  NEXTAUTH_URL: 'https://quoteplate.example',
  NEXTAUTH_SECRET: 'a-production-session-secret-with-more-than-32-characters',
};

describe('production environment', () => {
  it('validates the runtime environment', () => {
    expect(validateRuntimeEnvironment(validRuntimeEnvironment)).toEqual(
      expect.objectContaining({
        databaseUrl: validRuntimeEnvironment.DATABASE_URL,
        siteUrl: 'https://quoteplate.example/',
      }),
    );
  });

  it('rejects incomplete Google configuration and unsafe production URLs without exposing values', () => {
    const secretValue = 'do-not-print-this-secret';
    expect(() => validateRuntimeEnvironment({
      ...validRuntimeEnvironment,
      DATABASE_URL: 'http://not-postgres.example/database',
      GOOGLE_CLIENT_ID: secretValue,
    })).toThrow(EnvironmentConfigurationError);

    try {
      validateRuntimeEnvironment({
        ...validRuntimeEnvironment,
        DATABASE_URL: 'http://not-postgres.example/database',
        GOOGLE_CLIENT_ID: secretValue,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secretValue);
      expect(String(error)).not.toContain(validRuntimeEnvironment.NEXTAUTH_SECRET);
    }
  });

  it.each([undefined, '', 'obsolete-invalid-list'])('does not require an operator allowlist in production (%s)', (legacyList) => {
    expect(() => validateRuntimeEnvironment({
      ...validRuntimeEnvironment,
      QUOTEPLATE_PILOT_EMAILS: legacyList,
    })).not.toThrow();
  });

  it('permits production-like loopback URLs for isolated local verification', () => {
    expect(validateRuntimeEnvironment({
      ...validRuntimeEnvironment,
      DATABASE_URL: 'postgresql://autorfp_app:local@127.0.0.1:5432/postgres',
      NEXTAUTH_URL: 'http://127.0.0.1:3000',
    })).toEqual(expect.objectContaining({ siteUrl: 'http://127.0.0.1:3000/' }));
  });

  it('accepts the explicit all-loopback browser-test environment without a pilot list', () => {
    expect(() => validateRuntimeEnvironment({
      ...validRuntimeEnvironment,
      DATABASE_URL: 'postgresql://autorfp_app:test@127.0.0.1:5432/quoteplate',
      NEXTAUTH_URL: 'http://127.0.0.1:52560',
      QUOTEPLATE_LOCAL_E2E: '1',
      QUOTEPLATE_PILOT_EMAILS: undefined,
    })).not.toThrow();
  });

  it.each(['127.0.0.1', '127.42.3.9', 'localhost', 'LOCALHOST', '[::1]', '[0:0:0:0:0:0:0:1]'])(
    'permits non-TLS local fixtures on parsed loopback %s',
    (hostname) => {
      expect(() => validateRuntimeEnvironment({
        ...validRuntimeEnvironment,
        NEXTAUTH_URL: `http://${hostname}:3000`,
        DATABASE_URL: `postgresql://autorfp_app:test@${hostname}:5432/quoteplate`,
        QUOTEPLATE_LOCAL_E2E: '1',
      })).not.toThrow();
    },
  );

  it.each([
    { NEXTAUTH_URL: 'http://127.app.example.com' },
    { DATABASE_URL: 'postgresql://autorfp_app:test@127.db.example.com/quoteplate' },
  ])('requires production TLS for 127-prefixed DNS names (%j)', (urls) => {
    expect(() => validateRuntimeEnvironment({ ...validRuntimeEnvironment, ...urls }))
      .toThrow(EnvironmentConfigurationError);
  });

  it('rejects remote 127-prefixed DNS fixture mode even when both URLs use TLS', () => {
    expect(() => validateRuntimeEnvironment({
      ...validRuntimeEnvironment,
      NEXTAUTH_URL: 'https://127.app.example.com',
      DATABASE_URL: 'postgresql://autorfp_app:test@127.db.example.com/quoteplate?sslmode=require',
      QUOTEPLATE_LOCAL_E2E: '1',
    })).toThrow('QUOTEPLATE_LOCAL_E2E');
  });

  it('rejects the browser-test flag when production services are remote', () => {
    try {
      validateRuntimeEnvironment({
        ...validRuntimeEnvironment,
        QUOTEPLATE_LOCAL_E2E: '1',
        QUOTEPLATE_PILOT_EMAILS: undefined,
      });
      throw new Error('Expected production test mode to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect((error as EnvironmentConfigurationError).variables).toEqual(
        ['QUOTEPLATE_LOCAL_E2E'],
      );
    }
  });
});

describe('health endpoints', () => {
  it('requires the restricted application role before the readiness probe passes', async () => {
    const safeQuery = jest
      .fn()
      .mockResolvedValueOnce([{
        currentUser: 'autorfp_app',
        rolsuper: false,
        rolbypassrls: false,
        hasBypassMembership: false,
      }])
      .mockResolvedValueOnce([{ migrationReady: true }]);
    await expect(
      checkRuntimeDatabase({ $queryRaw: safeQuery } as never),
    ).resolves.toBeUndefined();
    expect(safeQuery).toHaveBeenCalledTimes(2);

    for (const migrationResult of [[], [{ migrationReady: false }]]) {
      const staleQuery = jest
        .fn()
        .mockResolvedValueOnce([{
          currentUser: 'autorfp_app',
          rolsuper: false,
          rolbypassrls: false,
          hasBypassMembership: false,
        }])
        .mockResolvedValueOnce(migrationResult);
      await expect(
        checkRuntimeDatabase({ $queryRaw: staleQuery } as never),
      ).rejects.toThrow('required database migration');
      const readinessQuery = JSON.stringify(staleQuery.mock.calls[1]);
      expect(readinessQuery).toContain('sourceIngredientId');
      expect(readinessQuery).toContain('verifiedByUserId');
      expect(readinessQuery).toContain('legacyPasswordSalt');
      expect(readinessQuery).not.toContain('_prisma_migrations');
    }

    const unsafeQuery = jest.fn().mockResolvedValue([{
      currentUser: 'neondb_owner',
      rolsuper: false,
      rolbypassrls: false,
      hasBypassMembership: false,
    }]);
    await expect(
      checkRuntimeDatabase({ $queryRaw: unsafeQuery } as never),
    ).rejects.toMatchObject({ code: 'UNSAFE_DATABASE_ROLE' });
    expect(unsafeQuery).toHaveBeenCalledTimes(1);
  });

  it('reports liveness without reading database configuration', async () => {
    const response = await live();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('reports readiness only after validated configuration and a database check', async () => {
    const checkDatabase = jest.fn().mockResolvedValue(undefined);
    const ready = createReadinessHandler({
      environment: validRuntimeEnvironment,
      checkDatabase,
      timeoutMs: 50,
    });
    const response = await ready();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(checkDatabase).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({ status: 'ready' });
  });

  it('fails closed for missing configuration, database errors, and timeouts', async () => {
    const invalidCheck = jest.fn();
    const invalidResponse = await createReadinessHandler({
      environment: {},
      checkDatabase: invalidCheck,
      timeoutMs: 10,
    })();
    expect(invalidResponse.status).toBe(503);
    expect(invalidCheck).not.toHaveBeenCalled();

    const failedResponse = await createReadinessHandler({
      environment: validRuntimeEnvironment,
      checkDatabase: async () => { throw new Error('database-password-secret'); },
      timeoutMs: 10,
    })();
    expect(failedResponse.status).toBe(503);
    expect(await failedResponse.text()).not.toContain('database-password-secret');

    const timeoutResponse = await createReadinessHandler({
      environment: validRuntimeEnvironment,
      checkDatabase: () => new Promise(() => undefined),
      timeoutMs: 5,
    })();
    expect(timeoutResponse.status).toBe(503);
  });
});

describe('production startup validation', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) delete process.env[key];
    }
    Object.assign(process.env, originalEnvironment);
  });

  it('fails the Node cold start when the required runtime check is enabled without secrets', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.QUOTEPLATE_RUNTIME_STARTUP_CHECK = '1';
    delete process.env.DATABASE_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXTAUTH_SECRET;

    await expect(register()).rejects.toThrow('Invalid production environment');
  });

  it('does not validate during a public build or a non-Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.QUOTEPLATE_RUNTIME_STARTUP_CHECK;
    await expect(register()).resolves.toBeUndefined();

    process.env.NEXT_RUNTIME = 'edge';
    process.env.QUOTEPLATE_RUNTIME_STARTUP_CHECK = '1';
    await expect(register()).resolves.toBeUndefined();
  });

  it('accepts a complete production runtime without requiring DIRECT_URL', async () => {
    Object.assign(process.env, validRuntimeEnvironment, {
      NEXT_RUNTIME: 'nodejs',
      QUOTEPLATE_RUNTIME_STARTUP_CHECK: '1',
    });
    delete process.env.DIRECT_URL;

    await expect(register()).resolves.toBeUndefined();
  });
});
