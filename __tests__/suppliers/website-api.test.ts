import { POST } from '@/app/api/suppliers/website-contacts/route';
import { requireAccountContext } from '@/lib/server-account';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';
import { discoverWebsiteContacts } from '@/lib/suppliers/website-discovery';
jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('@/lib/security/rate-limit', () => ({ consumeDigestRateLimit: jest.fn() }));
jest.mock('@/lib/suppliers/website-discovery', () => ({ ...jest.requireActual('@/lib/suppliers/website-discovery'), discoverWebsiteContacts: jest.fn() }));
const account = { user: { id: 'u', tenantId: 't', isActive: true, accountState: 'ACTIVE' }, tenant: { id: 't', isActive: true } };
const req = (body: unknown = { url: 'https://supplier.com' }, headers = {}) => new Request('https://app.com/api/suppliers/website-contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAccountContext).mockResolvedValue(account as never);
  jest.mocked(consumeDigestRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
  jest.mocked(discoverWebsiteContacts).mockResolvedValue({ status: 'no-public-contacts', contacts: [], checkedAt: '2026-09-11T00:00:00Z' });
});
it('requires an active matching tenant before lookup or quota use', async () => {
  for (const value of [null, { ...account, user: { ...account.user, isActive: false } }, { ...account, tenant: { ...account.tenant, isActive: false } }, { ...account, user: { ...account.user, tenantId: 'other' } }]) {
    jest.mocked(requireAccountContext).mockResolvedValue(value as never); expect((await POST(req())).status).toBe(401);
  }
  expect(discoverWebsiteContacts).not.toHaveBeenCalled(); expect(consumeDigestRateLimit).not.toHaveBeenCalled();
});
it('rejects cross origin, non-JSON, oversized bodies and tenant/contact injection', async () => {
  expect((await POST(req(undefined, { Origin: 'https://evil.com' }))).status).toBe(403);
  expect((await POST(req(undefined, { 'Content-Type': 'text/plain' }))).status).toBe(415);
  expect((await POST(req({ url: 'x'.repeat(5000) }))).status).toBe(413);
  for (const body of [{ url: 'https://supplier.com', tenantId: 'other' }, { url: 'http://supplier.com' }, { url: 'https://supplier.com', email: 'private@supplier.com' }]) expect((await POST(req(body))).status).toBe(400);
  expect(discoverWebsiteContacts).not.toHaveBeenCalled(); expect(consumeDigestRateLimit).not.toHaveBeenCalled();
});
it('fails closed on quota denial or outage without fetching', async () => {
  jest.mocked(consumeDigestRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
  const limited = await POST(req()); expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('17');
  jest.mocked(consumeDigestRateLimit).mockRejectedValue(new Error('private DB info'));
  const failed = await POST(req()); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('private DB');
  expect(discoverWebsiteContacts).not.toHaveBeenCalled();
});
it('uses tenant/user/host quotas and private responses without supplier-record access', async () => {
  const response = await POST(req()); expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private'); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(consumeDigestRateLimit).toHaveBeenCalledTimes(3);
  expect(discoverWebsiteContacts).toHaveBeenCalledWith(new URL('https://supplier.com'));
  const digests = jest.mocked(consumeDigestRateLimit).mock.calls.map(([v]) => v.subjectDigest);
  jest.mocked(requireAccountContext).mockResolvedValue({ user: { ...account.user, tenantId: 't2' }, tenant: { ...account.tenant, id: 't2' } } as never);
  await POST(req());
  const next = jest.mocked(consumeDigestRateLimit).mock.calls.slice(3).map(([v]) => v.subjectDigest);
  expect(next[0]).not.toBe(digests[0]); expect(next[1]).not.toBe(digests[1]); expect(next[2]).toBe(digests[2]);
});
