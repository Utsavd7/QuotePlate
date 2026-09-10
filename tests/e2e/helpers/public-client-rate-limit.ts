import { expect, type APIRequestContext } from '@playwright/test';

// Call before and after a journey, including failures, never between rate-limit
// assertions. The local fixture resets only the shared supplier-portal client;
// production limits, per-grant quotas and other public client buckets stay intact.
export async function resetSupplierPortalClientRateLimit(request: APIRequestContext) {
  const fixtureOrigin = process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562';
  const response = await request.post(
    `${fixtureOrigin}/__test/database/reset-supplier-portal-client-rate-limit`,
  );
  expect(response.status(), await response.text()).toBe(204);
}
