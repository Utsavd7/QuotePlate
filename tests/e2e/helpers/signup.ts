import { expect, type APIRequestContext } from '@playwright/test';

// The serial E2E suite shares a production-mode localhost client identifier.
// Reset its signup bucket before fixture creation, never between rate-limit assertions.
export async function resetSignupClientRateLimit(request: APIRequestContext) {
  const gatewayOrigin = process.env.AUTH_E2E_FIXTURE_ORIGIN ?? 'http://127.0.0.1:52562';
  const response = await request.post(
    `${gatewayOrigin}/__test/database/reset-workspace-client-rate-limit`,
  );
  expect(response.status(), await response.text()).toBe(204);
}
