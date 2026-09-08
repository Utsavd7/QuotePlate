import { createPortalHttp } from '@/lib/supplier-portal/http';
const view = { portalId: 'portal-vendor', restaurantName: 'Kitchen', supplierName: 'Vendor', expiresAt: '2026-10-07T00:00:00.000Z', orders: [], forecasts: [] };
function setup() {
 const operations = { exchange: jest.fn().mockResolvedValue({ expiresAt: view.expiresAt }), publicView: jest.fn().mockResolvedValue(view), act: jest.fn().mockResolvedValue(view), restaurantView: jest.fn().mockResolvedValue({ canManage: false }), rotate: jest.fn(), revoke: jest.fn(), share: jest.fn(), withdraw: jest.fn() };
 const limit = jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
 const account = jest.fn().mockResolvedValue({ tenant: { id: 't' }, user: { id: 'u' } });
 return { operations, limit, account, http: createPortalHttp({ operations, limit, account }) };
}
const req = (path: string, body?: unknown, extra: Record<string, string> = {}) => new Request('https://example.test' + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
test('exchange uses an independent HttpOnly path-scoped cookie and no-store', async () => {
 const { http, operations } = setup();
 const token = 'a'.repeat(43);
 const response = await http.access(req('/api/public/supplier-portal/access', { token }));
 expect(response.status).toBe(200);
 expect(operations.exchange).toHaveBeenCalledWith(token);
 expect(response.headers.get('set-cookie')).toMatch(/supplier_portal=.*HttpOnly/);
 expect(response.headers.get('set-cookie')).toContain('Path=/api/public/supplier-portal');
 expect(response.headers.get('set-cookie')).toMatch(/SameSite=strict/i);
 expect(response.headers.get('set-cookie')).toContain('Secure');
 expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(JSON.stringify(await response.json())).not.toContain(token);
});
test('public POST returns the complete snapshot and only uses its own cookie', async () => {
 const { http, operations } = setup();
 const action = { portalId: view.portalId, action: 'acknowledge', requestId: 'r', expectedVersion: 1, status: 'confirmed', note: '' };
 const response = await http.public(req('/api/public/supplier-portal', action, { cookie: 'supplier_portal=' + 'a'.repeat(43) }));
 expect(await response.json()).toEqual(view);
 expect(operations.act).toHaveBeenCalledWith('a'.repeat(43), action);
 await http.public(req('/api/public/supplier-portal', undefined, { cookie: 'supplier_quote=other' }));
 expect(operations.publicView).toHaveBeenLastCalledWith(undefined);
});
test('rejects cross-origin, non-JSON, overlarge bodies and rate limits before operations', async () => {
 const { http, operations, limit } = setup();
 expect((await http.access(req('/api/public/supplier-portal/access', { token: 'x' }, { origin: 'https://evil.test' }))).status).toBe(403);
 expect((await http.access(req('/api/public/supplier-portal/access', {}, { 'content-type': 'text/plain' }))).status).toBe(415);
 expect((await http.access(req('/api/public/supplier-portal/access', { token: 'x'.repeat(17000) }))).status).toBe(413);
 limit.mockResolvedValue({ allowed: false, retryAfterSeconds: 25 });
 const limited = await http.public(req('/api/public/supplier-portal'));
 expect(limited.status).toBe(429);
 expect(limited.headers.get('retry-after')).toBe('25');
 expect(operations.exchange).not.toHaveBeenCalled();
 expect(operations.publicView).not.toHaveBeenCalled();
});
test('restaurant GET authenticates and returns canManage without granting mutations', async () => {
 const { http, account } = setup();
 expect(await (await http.restaurant(req('/api/suppliers/s/portal'), 's')).json()).toEqual({ canManage: false });
 account.mockResolvedValue(null);
 expect((await http.restaurant(req('/api/suppliers/s/portal'), 's')).status).toBe(401);
});
test('failed exchange and unavailable public grant clear old cookie without reflecting tokens', async () => {
 const { http, operations } = setup();
 const { PortalError } = await import('@/lib/supplier-portal/domain');
 operations.exchange.mockRejectedValue(new PortalError('This supplier portal is invalid or no longer available.', 410));
 const response = await http.access(req('/api/public/supplier-portal/access', { token: 'secret-invalid-link' }, { cookie: 'supplier_portal=' + 'a'.repeat(43) }));
 expect(response.status).toBe(410);
 expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
 expect(await response.text()).not.toMatch(/secret-invalid-link|aaaaaaaa/);
 operations.publicView.mockRejectedValue(new PortalError('Unavailable', 410));
 expect((await http.public(req('/api/public/supplier-portal'))).headers.get('set-cookie')).toContain('Max-Age=0');
});
test('duplicate portal cookies are rejected and internal errors stay private', async () => {
 const { http, operations } = setup();
 await http.public(req('/api/public/supplier-portal', undefined, { cookie: 'supplier_portal=' + 'a'.repeat(43) + '; supplier_portal=' + 'b'.repeat(43) }));
 expect(operations.publicView).toHaveBeenCalledWith(undefined);
 operations.publicView.mockRejectedValue(new Error('database connection secret'));
 const response = await http.public(req('/api/public/supplier-portal'));
 expect(response.status).toBe(500);
 expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(await response.text()).not.toContain('database connection secret');
});
test('rate-limited access clears a previously selected supplier cookie', async () => {
 const { http, limit } = setup();
 limit.mockResolvedValue({ allowed: false, retryAfterSeconds: 25 });
 const response = await http.access(req('/api/public/supplier-portal/access', { token: 'a'.repeat(43) }));
 expect(response.status).toBe(429);
 expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
});
