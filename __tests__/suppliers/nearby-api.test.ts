import { GET, POST } from '@/app/api/suppliers/discover/route';
import { requireAccountContext } from '@/lib/server-account';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';
import { fetchNearbyJson } from '@/lib/suppliers/nearby-provider';
jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('@/lib/security/rate-limit', () => ({ consumeDigestRateLimit: jest.fn() }));
jest.mock('@/lib/suppliers/nearby-provider', () => ({ ...jest.requireActual('@/lib/suppliers/nearby-provider'), fetchNearbyJson: jest.fn() }));
const account = { user: { id: 'u', tenantId: 't', isActive: true, accountState: 'ACTIVE' }, tenant: { id: 't', isActive: true, city: 'Mumbai', state: 'Maharashtra', pin: '400001' } };
const req = (body: unknown, headers = {}) => new Request('http://localhost/api/suppliers/discover', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const photon = { features: [{ properties: { name: 'Mumbai', countrycode: 'IN', country: 'India' }, geometry: { coordinates: [72.8777, 19.076] } }] };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAccountContext).mockResolvedValue(account as never);
  jest.mocked(consumeDigestRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
  jest.mocked(fetchNearbyJson).mockResolvedValue(photon);
});
it('prefills only authenticated restaurant area without provider use', async () => {
  const res = await GET();
  expect(await res.json()).toEqual({ area: 'Mumbai, Maharashtra, 400001' });
  expect(res.headers.get('cache-control')).toContain('no-store');
  expect(fetchNearbyJson).not.toHaveBeenCalled();
});
it('rejects missing, inactive and mismatched tenant actors', async () => {
  for (const value of [null, { ...account, tenant: { ...account.tenant, isActive: false } }, { ...account, user: { ...account.user, tenantId: 'other' } }]) {
    jest.mocked(requireAccountContext).mockResolvedValue(value as never);
    expect((await POST(req({ area: 'Mumbai' }))).status).toBe(401);
  }
  expect(fetchNearbyJson).not.toHaveBeenCalled();
});
it('rejects cross-origin, unknown URL/coordinate/ingredient fields and invalid selection', async () => {
  expect((await POST(req({ area: 'Mumbai' }, { Origin: 'https://evil.test' }))).status).toBe(403);
  for (const body of [{ area: '' }, { area: 'Mumbai', url: 'http://localhost' }, { area: 'Mumbai', lat: 19 }, { area: 'Mumbai', ingredient: '";out;' }, { area: 'Mumbai', category: '__proto__' }, { area: 'Mumbai', radius: 100 }]) {
    expect((await POST(req(body))).status).toBe(400);
  }
  expect(fetchNearbyJson).not.toHaveBeenCalled();
});
it('applies per-user and provider quotas, and returns retry-after', async () => {
  jest.mocked(consumeDigestRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 27 });
  const res = await POST(req({ area: 'Delhi' }));
  expect(res.status).toBe(429); expect(res.headers.get('retry-after')).toBe('27');
  expect(fetchNearbyJson).not.toHaveBeenCalled();
});
it('fails closed when shared rate-limit storage fails', async () => {
  jest.mocked(consumeDigestRateLimit).mockRejectedValue(new Error('db down'));
  expect((await POST(req({ area: 'Chennai' }))).status).toBe(503);
  expect(fetchNearbyJson).not.toHaveBeenCalled();
});
it('resolves India centers then searches chosen center; coalesced cache avoids provider quota/use', async () => {
  const resolved = await POST(req({ area: 'Mumbai' }));
  expect(resolved.status).toBe(200);
  const data = await resolved.json();
  expect(data.centers[0].id).toBe('19.076,72.8777');
  const calls = jest.mocked(consumeDigestRateLimit).mock.calls.map(([v]) => v);
  expect(calls.some(v => v.limit === 200 && v.windowMs === 86400000)).toBe(true);
  jest.mocked(fetchNearbyJson).mockResolvedValue({ elements: [] });
  const result = await POST(req({ area: 'Mumbai', centerId: data.centers[0].id, category: 'produce', radius: 2 }));
  expect(await result.json()).toMatchObject({ center: data.centers[0], results: [] });
  expect(fetchNearbyJson).toHaveBeenLastCalledWith('https://maps.mail.ru/osm/tools/overpass/api/interpreter', expect.objectContaining({ method: 'POST' }));
  expect(fetchNearbyJson).toHaveBeenCalledTimes(2);
  await POST(req({ area: 'Mumbai', centerId: data.centers[0].id, category: 'produce', radius: 2 }));
  expect(fetchNearbyJson).toHaveBeenCalledTimes(2);
});
it('never trusts fabricated centers, and surfaces no Indian matches without Overpass', async () => {
  jest.mocked(fetchNearbyJson).mockResolvedValue({ features: [] });
  expect(await (await POST(req({ area: 'Nonexistent area' }))).json()).toMatchObject({ centers: [] });
  const res = await POST(req({ area: 'Nonexistent area', centerId: '1,2', category: 'fish', radius: 5 }));
  expect(res.status).toBe(400);
  expect(fetchNearbyJson).toHaveBeenCalledTimes(1);
});
it('enforces the shared provider quota after the user quota and before provider fetch', async () => {
  jest.mocked(consumeDigestRateLimit)
    .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 60 })
    .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 43200 });
  const response = await POST(req({ area: 'Pune provider quota fixture' }));
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('43200');
  expect(fetchNearbyJson).not.toHaveBeenCalled();
  expect(jest.mocked(consumeDigestRateLimit).mock.calls[1][0]).toMatchObject({ limit: 200, windowMs: 86400000 });
});
it('bounds incoming bodies before any shared quota or provider use', async () => {
  expect((await POST(req({ area: 'x'.repeat(3000) }))).status).toBe(413);
  expect(consumeDigestRateLimit).not.toHaveBeenCalled();
  expect(fetchNearbyJson).not.toHaveBeenCalled();
});
it('does not cache provider failures and coalesces concurrent service cache misses', async () => {
  jest.mocked(fetchNearbyJson).mockRejectedValueOnce(new Error('temporary outage'));
  expect((await POST(req({ area: 'Service coalescing fixture' }))).status).toBe(503);
  jest.mocked(fetchNearbyJson).mockResolvedValue(photon);
  const responses = await Promise.all([POST(req({ area: 'Service coalescing fixture' })), POST(req({ area: 'Service coalescing fixture' }))]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  expect(fetchNearbyJson).toHaveBeenCalledTimes(2);
});
it('uses a shared provider spacing gate longer than the upstream timeout', async () => {
  await POST(req({ area: 'Global spacing fixture' }));
  expect(jest.mocked(consumeDigestRateLimit).mock.calls.some(([v]) => v.limit === 1 && v.windowMs === 25000)).toBe(true);
});
