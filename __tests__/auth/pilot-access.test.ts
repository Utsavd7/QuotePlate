import {
  localPilotTestModeAllowed,
  productionEmailOwnerSignupAllowed,
} from '@/lib/auth/pilot-access';

const localProduction = {
  NODE_ENV: 'production',
  NEXTAUTH_URL: 'http://127.0.0.1:52560',
  DATABASE_URL: 'postgresql://autorfp_app:test@127.0.0.1:5432/quoteplate',
  QUOTEPLATE_LOCAL_E2E: '1',
};

test('permits disposable owner signup only in an explicit all-loopback test environment', () => {
  expect(localPilotTestModeAllowed(localProduction)).toBe(true);
  expect(productionEmailOwnerSignupAllowed(localProduction)).toBe(true);
});

test.each([
  { ...localProduction, NEXTAUTH_URL: 'https://quoteplate.example' },
  { ...localProduction, DATABASE_URL: 'postgresql://app:test@db.example/quoteplate?sslmode=require' },
  { ...localProduction, QUOTEPLATE_LOCAL_E2E: undefined },
])('never enables the test bypass outside an explicit all-loopback environment', (environment) => {
  expect(localPilotTestModeAllowed(environment)).toBe(false);
  expect(productionEmailOwnerSignupAllowed(environment)).toBe(false);
});

test.each(['development', 'test'])('keeps local password signup available in %s', (NODE_ENV) => {
  expect(productionEmailOwnerSignupAllowed({ NODE_ENV })).toBe(true);
});

test('rejects the password fixture flag alone on a production host', () => {
  expect(productionEmailOwnerSignupAllowed({ NODE_ENV: 'production', QUOTEPLATE_LOCAL_E2E: '1' })).toBe(false);
});

test.each(['127.0.0.1', '127.42.3.9', 'localhost', 'LOCALHOST', '[::1]', '[0:0:0:0:0:0:0:1]'])(
  'permits explicit local password fixtures on parsed loopback %s',
  (hostname) => {
    const environment = {
      ...localProduction,
      NEXTAUTH_URL: `http://${hostname}:52560`,
      DATABASE_URL: `postgresql://autorfp_app:test@${hostname}:5432/quoteplate`,
    };
    expect(localPilotTestModeAllowed(environment)).toBe(true);
    expect(productionEmailOwnerSignupAllowed(environment)).toBe(true);
  },
);

test.each([
  { NEXTAUTH_URL: 'http://127.app.example.com:52560' },
  { DATABASE_URL: 'postgresql://autorfp_app:test@127.db.example.com:5432/quoteplate' },
  {
    NEXTAUTH_URL: 'https://127.app.example.com',
    DATABASE_URL: 'postgresql://autorfp_app:test@127.db.example.com/quoteplate?sslmode=require',
  },
  { NEXTAUTH_URL: 'http://localhost.example.com:52560' },
  { DATABASE_URL: 'postgresql://autorfp_app:test@[::2]:5432/quoteplate' },
])('never treats remote DNS or non-loopback IPs as local fixtures (%j)', (urls) => {
  const environment = { ...localProduction, ...urls };
  expect(localPilotTestModeAllowed(environment)).toBe(false);
  expect(productionEmailOwnerSignupAllowed(environment)).toBe(false);
});
