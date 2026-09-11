import { discoverWebsiteContacts, validateWebsiteInput } from '@/lib/suppliers/website-discovery';
import { parseWebsiteContacts, robotsAllows } from '@/lib/suppliers/website-parsing';
import { publicWebsiteAddress, websiteTarget, WEBSITE_HEADERS } from '@/lib/suppliers/website-safety';
import type { MenuUrlImportDependencies, MenuUrlTransportResponse } from '@/lib/menu/url-import';

const origin = 'https://supplier.com';
const checkedAt = '2026-09-11T00:00:00.000Z';
function response(body: string, statusCode = 200, headers = {}): MenuUrlTransportResponse {
  return { statusCode, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body: Buffer.from(body) };
}
function fixture(pages: Record<string, MenuUrlTransportResponse> = {}) {
  const request = jest.fn(async ({ url }: { url: URL }) => pages[url.pathname] ?? response('', 404));
  const resolve = jest.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
  const dependencies: MenuUrlImportDependencies = { request, resolve, now: () => Date.parse(checkedAt) };
  return { request, resolve, dependencies };
}
const lookup = (f: ReturnType<typeof fixture>, path = '/') => discoverWebsiteContacts(new URL(path, origin), f.dependencies);

it('deduplicates normalized phones across pages while preserving the first published value and citation', async () => {
  const f = fixture({
    '/': response('<a href="tel:98765 43210">Call</a><a href="/contact">Contact</a>'),
    '/contact': response('<a href="tel:+91 9876543210">Call</a><a href="tel:+91 9988776655">Other branch</a>'),
  });
  const result = await lookup(f);
  expect(result.contacts).toEqual([
    { kind: 'phone', value: '98765 43210', sourceUrl: `${origin}/`, checkedAt },
    { kind: 'phone', value: '+91 9988776655', sourceUrl: `${origin}/contact`, checkedAt },
  ]);
});

it('deduplicates local and international variants on one page', () => {
  const parsed = parseWebsiteContacts('<a href="tel:98765 43210">Call</a><a href="tel:+91 9876543210">Call</a>', new URL(origin), checkedAt);
  expect(parsed.contacts).toHaveLength(1);
  expect(parsed.contacts[0].value).toBe('98765 43210');
});

it.each(['http://supplier.com', 'https://supplier.com:8443', 'https://u:p@supplier.com', 'https://localhost',
  'https://metadata.internal', 'https://x.local', 'https://supplier.com?token=private', 'https://supplier.com/account',
  'https://supplier.com/%6cogin', 'https://supplier.com\\@public.com', 'https://example.org', 'https://127.1', 'https://2130706433',
  'https://[::1]', 'https://[::ffff:127.0.0.1]', 'file:///etc/passwd'])('rejects unsafe URL %s', url => {
  expect(() => validateWebsiteInput({ url })).toThrow();
});
it.each(['0.1.2.3', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1',
  '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255'])('blocks reserved IPv4 %s', address => {
  expect(publicWebsiteAddress({ address, family: 4 })).toBe(false);
});
it.each(['::', '::1', '::ffff:8.8.8.8', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2002::1', '3fff::1', '64:ff9b::1'])('blocks reserved IPv6 %s', address => {
  expect(publicWebsiteAddress({ address, family: 6 })).toBe(false);
});
it('rejects private DNS and mixed public/private answers before contacting them', async () => {
  const f = fixture();
  f.resolve.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]);
  expect((await lookup(f)).status).toBe('unavailable'); expect(f.request).not.toHaveBeenCalled();
});
it('pins each connection and rejects a DNS rebinding answer on a later page', async () => {
  const f = fixture({ '/': response('sales@supplier.com') });
  f.resolve.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  expect((await lookup(f)).status).toBe('unavailable'); expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request).toHaveBeenCalledWith(expect.objectContaining({ address: { address: '93.184.216.34', family: 4 }, headers: WEBSITE_HEADERS, timeoutMs: 8000 }));
});
it.each(['http://supplier.com/contact', 'https://evil.com/contact', 'https://127.0.0.1', '/login', '/contact?token=private'])('does not follow unsafe redirect %s', location => {
  const f = fixture({ '/': response('', 302, { location }) });
  return lookup(f).then(result => { expect(result.status).toBe('unavailable'); expect(f.request).toHaveBeenCalledTimes(2); });
});
it('checks robots before start, linked and redirected pages', async () => {
  const f = fixture({ '/robots.txt': response('User-agent: *\nDisallow: /contact', 200, { 'content-type': 'text/plain' }), '/': response('', 302, { location: '/contact' }) });
  expect((await lookup(f)).status).toBe('unavailable');
  expect(f.request.mock.calls.map(([v]) => v.url.pathname)).toEqual(['/robots.txt', '/']);
  f.request.mockClear();
  expect((await lookup(f, '/contact')).status).toBe('unavailable'); expect(f.request).toHaveBeenCalledTimes(1);
});
it.each([401, 403, 429, 500, 302])('fails closed on robots status %s', async status => {
  const f = fixture({ '/robots.txt': response('', status, { location: '/robots2.txt' }) });
  expect((await lookup(f)).status).toBe('unavailable'); expect(f.request).toHaveBeenCalledTimes(1);
});
it('honors wildcard/end matching, groups, allow specificity and crawl delays', () => {
  const robots = 'User-agent: *\nDisallow: /private\nDisallow: /*.pdf$\nAllow: /private/contact\nUser-agent: QuotePlateContactDiscovery\nDisallow: /about';
  for (const path of ['/private', '/private/a', '/file.pdf', '/about']) expect(robotsAllows(robots, new URL(path, origin))).toBe(false);
  for (const path of ['/', '/private/contact', '/file.pdf/contact']) expect(robotsAllows(robots, new URL(path, origin))).toBe(true);
  expect(robotsAllows('User-agent: *\nCrawl-delay: 10', new URL(origin))).toBe(false);
});
it('returns public contacts with provenance, checks at most three pages and skips disallowed links', async () => {
  const f = fixture({
    '/robots.txt': response('User-agent: *\nDisallow: /contact/private', 200, { 'content-type': 'text/plain' }),
    '/': response('<a href="/contact">Contact</a><a href="/about">About</a><a href="/contact/private">Contact private</a>'),
    '/contact': response('<a href="mailto:orders@supplier.com">Orders</a><a href="tel:+919876543210">Call</a><a href="/contact/more">Contact more</a>'),
    '/about': response('sales@supplier.com'),
  });
  const result = await lookup(f);
  expect(result.status).toBe('found'); expect(result.contacts).toHaveLength(3);
  expect(result.contacts[0]).toEqual({ kind: 'email', value: 'orders@supplier.com', checkedAt, sourceUrl: `${origin}/contact` });
  expect(f.request.mock.calls.map(([v]) => v.url.pathname)).toEqual(['/robots.txt', '/', '/contact', '/about']);
});
it('does not invent contacts or extract scripts, hidden elements, invalid mailboxes or unlabeled numbers', async () => {
  const f = fixture({ '/': response('<script>const email="secret@supplier.com"</script><p hidden>hide@supplier.com</p><p style="display:none">hidden@supplier.com</p><p>Supplier Ltd 9876543210</p><a href="mailto:sales@@supplier.com">Mail</a>') });
  expect(await lookup(f)).toEqual({ status: 'no-public-contacts', contacts: [], checkedAt });
});
it('extracts visible labeled international phone and email but never infers a country code', () => {
  const result = parseWebsiteContacts('Phone: +44 20 7123 4567\nEmail: Orders@Supplier.com\nMobile: 9876543210', new URL(origin), checkedAt, true);
  expect(result.contacts.map(c => c.value)).toEqual(['orders@supplier.com', '+442071234567']);
});
it.each(['<input type="password"><p>hidden@supplier.com</p>', '<p>Log in to view contact details</p>'])('does not scrape gated content', async html => {
  const f = fixture({ '/': response(html) }); expect((await lookup(f)).status).toBe('unavailable');
});
it('bounds bytes, response types, encodings and redirect loops', async () => {
  for (const page of [response('x'.repeat(1024 * 1024 + 1)), response('sales@supplier.com', 200, { 'content-type': 'application/json' }),
    response('sales@supplier.com', 200, { 'content-encoding': 'gzip' }), response('', 302, { location: '/' })]) {
    const f = fixture({ '/': page }); expect((await lookup(f)).status).toBe('unavailable');
  }
});
it('times out stalled DNS without making an outgoing request', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture(); f.resolve.mockImplementation(() => new Promise(() => {}));
    const result = lookup(f); await jest.advanceTimersByTimeAsync(8001);
    expect((await result).status).toBe('unavailable'); expect(f.request).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
it('rejects request fields beyond the public URL', () => {
  for (const body of [null, [], { url: origin, tenantId: 'other' }, { url: origin, headers: { Cookie: 'secret' } }]) expect(() => validateWebsiteInput(body)).toThrow();
  expect(websiteTarget(origin).href).toBe(`${origin}/`);
});
it('does not allow a wildcard allow rule to override a specific bot disallow', () => {
  expect(robotsAllows('User-agent: *\nAllow: /contact\nUser-agent: QuotePlateContactDiscovery\nDisallow: /', new URL('/contact', origin))).toBe(false);
});
it('treats robots patterns as bounded glob data, including regex metacharacters', () => {
  expect(robotsAllows('User-agent: *\nDisallow: /contact.(a+)$', new URL('/contact.(a+)', origin))).toBe(false);
  expect(robotsAllows(`User-agent: *\nDisallow: /${'*a'.repeat(100)}b$`, new URL(`/${'a'.repeat(200)}`, origin))).toBe(true);
});
it('supports a safe same-origin redirect and records the actual source URL', async () => {
  const f = fixture({ '/': response('', 301, { location: '/contact' }), '/contact': response('orders@supplier.com') });
  expect((await lookup(f)).contacts[0].sourceUrl).toBe(`${origin}/contact`);
  expect(f.resolve).toHaveBeenCalledTimes(3);
});
it('stops after two redirects and never carries cookies or credentials', async () => {
  const f = fixture({ '/': response('', 301, { location: '/contact' }), '/contact': response('', 302, { location: '/about' }), '/about': response('', 307, { location: '/contact/team' }) });
  expect((await lookup(f)).status).toBe('unavailable');
  expect(f.request).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(f.request.mock.calls)).not.toMatch(/cookie|authorization|referer/i);
});
it('stops stalled responses and exhausted overall deadlines', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture(); f.request.mockImplementation(() => new Promise(() => {}));
    const result = lookup(f); await jest.advanceTimersByTimeAsync(8001);
    expect((await result).status).toBe('unavailable'); expect(f.request).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
  const f = fixture(); let now = Date.parse(checkedAt);
  f.dependencies.now = () => now;
  f.request.mockImplementation(async () => { now += 8001; return response('', 404); });
  expect((await lookup(f)).status).toBe('unavailable'); expect(f.request).toHaveBeenCalledTimes(1);
});
it('rejects empty, excessive and malformed DNS results', async () => {
  for (const answers of [[], Array.from({ length: 9 }, () => ({ address: '93.184.216.34', family: 4 as const })), [{ address: 'not-an-ip', family: 4 as const }]]) {
    const f = fixture(); f.resolve.mockResolvedValue(answers);
    expect((await lookup(f)).status).toBe('unavailable'); expect(f.request).not.toHaveBeenCalled();
  }
});
it('keeps blank, invalid and placeholder mailboxes out of parsed output', () => {
  const parsed = parseWebsiteContacts('<p>sales@@supplier.com sales@-supplier.com .sales@supplier.com</p><a href="mailto:first@supplier.com,second@supplier.com">Email</a><a href="tel:+44(0)2071234567">Phone</a>', new URL(origin), checkedAt);
  expect(parsed.contacts).toEqual([]);
});
it('does not fabricate suffixes from invalid or oversized visible email tokens', () => {
  const parsed = parseWebsiteContacts(`${'a'.repeat(1024 * 1024)}\n${'a'.repeat(65)}@supplier.com\nésales@supplier.com\nEmail: orders@supplier.com.`, new URL(origin), checkedAt, true);
  expect(parsed.contacts.map(c => c.value)).toEqual(['orders@supplier.com']);
});
it.each(['9876543210', '98765 43210', '+91 98765 43210'])('accepts the published phone in an explicit labelled tel link: %s', value => {
  const parsed = parseWebsiteContacts(`<a href="tel:${value}">Call our sales team</a>`, new URL(origin), checkedAt);
  expect(parsed.contacts).toEqual([{ kind: 'phone', value, sourceUrl: `${origin}/`, checkedAt }]);
});
it('accepts visible microdata and schema.org telephone fields without inferring country codes', () => {
  const parsed = parseWebsiteContacts('<span itemprop="telephone">9876543210</span><script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","telephone":"99887 76655","contactPoint":{"@type":"ContactPoint","telephone":"+91 91234 56789"}}</script>', new URL(origin), checkedAt);
  expect(parsed.contacts.map(c => c.value).sort()).toEqual(['+91 91234 56789', '9876543210', '99887 76655'].sort());
});
it.each(['411001', '1234567890', '0123456789', '987654321', '98765432101', '9876543210ext2', '9876543210;ext=2', '9876543210,9988776655'])('rejects invalid local telephone values: %s', value => {
  const parsed = parseWebsiteContacts(`<a href="tel:${value}">Phone</a><span itemprop="telephone">${value}</span>`, new URL(origin), checkedAt);
  expect(parsed.contacts).toEqual([]);
});
it('never treats postal/order IDs, arbitrary body numbers or unrelated JSON as local telephone evidence', () => {
  const parsed = parseWebsiteContacts('<p>Postal: 411001 Order: 9876543210 Mobile: 9988776655</p><span itemprop="orderNumber">9876543210</span><script type="application/json">{"telephone":"9876543210"}</script><script type="application/ld+json">{"@context":"https://schema.org","@type":"Order","orderNumber":"9988776655"}</script>', new URL(origin), checkedAt);
  expect(parsed.contacts).toEqual([]);
});
it.each(['\n', '\r\n', '\r'])('honors robots disallow with line ending %j', newline => {
  expect(robotsAllows(`User-agent: *${newline}Disallow: /`, new URL(origin))).toBe(false);
});
it('does not request a page forbidden by CR-only robots', async () => {
  const f = fixture({ '/robots.txt': response('User-agent: *\rDisallow: /', 200, { 'content-type': 'text/plain' }) });
  expect((await lookup(f)).status).toBe('unavailable');
  expect(f.request.mock.calls.map(([v]) => v.url.pathname)).toEqual(['/robots.txt']);
});
it.each([' (24/7 support)', '. 42 branches nationwide', ', 42 branches nationwide', '\n24/7 support'])('does not append adjacent prose digits to a body phone: %s', suffix => {
  const parsed = parseWebsiteContacts(`<p>Phone: +91 98765 43210${suffix}</p>`, new URL(origin), checkedAt);
  expect(parsed.contacts.map(c => c.value)).toEqual(['+919876543210']);
});
it.each([' 24/7 support', ' 42 branches nationwide', ' 9988776655', '/9988776655'])('omits ambiguous body phone spans: %s', suffix => {
  const parsed = parseWebsiteContacts(`<p>Phone: +91 98765 43210${suffix}</p>`, new URL(origin), checkedAt);
  expect(parsed.contacts).toEqual([]);
});
it('retains entity decoding, raw-text hiding, Unicode offsets and explicit local telephone evidence', () => {
  const parsed = parseWebsiteContacts('İ<script>hidden@supplier.com</script><a href="mailto:orders&#64;supplier.com">Orders</a><a href="tel:98765&#32;43210">Call</a><p hidden>private@supplier.com</p>', new URL(origin), checkedAt);
  expect(parsed.contacts.map(c => c.value)).toEqual(['orders@supplier.com', '98765 43210']);
});
it('does not expose phone links nested inside hidden self-closing-looking HTML', () => {
  const parsed = parseWebsiteContacts('<div hidden/><a href="tel:9876543210">Call</a></div><p>Supplier</p>', new URL(origin), checkedAt);
  expect(parsed.contacts).toEqual([]);
});
it('handles robots comments containing Unicode separators in bounded time', () => {
  expect(robotsAllows(`User-agent: *\rDisallow: / #${'#'.repeat(60_000)}\u2028ignored`, new URL(origin))).toBe(false);
});
