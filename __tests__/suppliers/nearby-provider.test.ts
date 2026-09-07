import liveFixture from './nearby-osm-fixture.json';
import { buildNearbyQuery, parseNearbyResults, parseNearbyCenters, nearbyPrefill } from '@/lib/suppliers/nearby-types';
import { fetchNearbyJson, createNearbyCache } from '@/lib/suppliers/nearby-provider';
const center = { id: '1', label: 'Mumbai, India', lat: 19.076, lon: 72.8777 };
const node = { type: 'node', id: 1, lat: center.lat, lon: center.lon, tags: { name: 'Fresh Foods', shop: 'greengrocer', phone: '+91 9876543210', website: 'javascript:alert(1)' } };
describe('nearby provider boundaries', () => {
  it('builds only numeric coordinates and fixed categories', () => {
    expect(buildNearbyQuery(center, 'produce', 2)).toContain('(around:2000,19.076,72.8777)');
    for (const input of ['produce"];out;', '__proto__', 'https://localhost']) expect(() => buildNearbyQuery(center, input, 2)).toThrow();
    expect(() => buildNearbyQuery({ ...center, lat: '1);out;' } as never, 'produce', 2)).toThrow();
    expect(() => buildNearbyQuery(center, 'produce', 200)).toThrow();
  });
  it('filters foreign or malformed Photon centers and duplicates', () => {
    const f = (code: string) => ({ properties: { countrycode: code, name: 'Mumbai', country: 'India' }, geometry: { coordinates: [72.8777, 19.076] } });
    expect(parseNearbyCenters({ features: [f('IN'), f('IN'), f('US'), {}, f('')] })).toHaveLength(1);
  });
  it('deduplicates OSM nodes and ways, filters out-of-radius and wrong-country entries, strips unsafe links', () => {
    const results = parseNearbyResults({ elements: [node, node, { ...node, type: 'way', id: 2, center }, { ...node, id: 3, lat: 20 }, { ...node, id: 4, tags: { ...node.tags, 'addr:country': 'US' } }] }, center, 'produce', 2);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Fresh Foods', distanceKm: 0, website: null, kind: 'Retail potential', verificationStatus: 'UNVERIFIED' });
    expect(nearbyPrefill(results[0]).notes).toContain('Unverified');
    expect(nearbyPrefill(results[0])).not.toHaveProperty('whatsappNumber');
  });
  it('rejects incomplete Overpass results and malformed envelopes', () => {
    expect(() => parseNearbyResults({ remark: 'runtime error: timeout', elements: [] }, center, 'produce', 2)).toThrow();
    expect(() => parseNearbyCenters({})).toThrow();
  });
  it('never follows redirects or accepts arbitrary provider URLs', async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1' } }));
    await expect(fetchNearbyJson('https://evil.test/api', {}, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(fetchNearbyJson('https://photon.komoot.io/api?q=a', {}, fetcher)).rejects.toThrow();
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  });
  it('caps streamed bytes even without content-length', async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(33)); }, cancel() { cancelled = true; } });
    await expect(fetchNearbyJson('https://photon.komoot.io/api', {}, async () => new Response(stream), 32)).rejects.toThrow(/large/);
    expect(cancelled).toBe(true);
  });
  it('bounds a stalled response body', async () => {
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); } });
    await expect(fetchNearbyJson('https://photon.komoot.io/api', {}, async () => new Response(stream), 100, 10)).rejects.toThrow(/timed out/);
  });
  it('returns retryable 429 errors without retrying', async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response('', { status: 429 }));
    await expect(fetchNearbyJson('https://photon.komoot.io/api', {}, fetcher)).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('coalesces cache misses, expires entries, bounds size, does not cache failures', async () => {
    let now = 0;
    const cache = createNearbyCache<number>(2, () => now);
    const loader = jest.fn(async () => 1);
    await Promise.all([cache.get('a', 10, loader), cache.get('a', 10, loader)]);
    expect(loader).toHaveBeenCalledTimes(1);
    now = 11;
    await cache.get('a', 10, loader);
    expect(loader).toHaveBeenCalledTimes(2);
    await cache.get('b', 10, loader); await cache.get('c', 10, loader);
    await cache.get('a', 10, loader); expect(loader).toHaveBeenCalledTimes(5);
    const bad = jest.fn(async () => { throw new Error('bad'); });
    await expect(cache.get('bad', 10, bad)).rejects.toThrow();
    await expect(cache.get('bad', 10, bad)).rejects.toThrow();
    expect(bad).toHaveBeenCalledTimes(2);
  });
});
it('includes honestly tagged wholesale leads and valid website/contact data', () => {
  const results = parseNearbyResults({ elements: [{ ...node, tags: { name: 'Produce Wholesale', shop: 'wholesale', wholesale: 'vegetables', 'contact:website': 'https://example.org', 'addr:city': 'Mumbai' } }] }, center, 'produce', 2);
  expect(results[0]).toMatchObject({ kind: 'Wholesale listing', website: 'https://example.org/', city: 'Mumbai', phone: null });
  expect(parseNearbyResults({ elements: [{ ...node, tags: { name: 'Building materials', shop: 'wholesale', wholesale: 'construction' } }] }, center, 'produce', 2)).toEqual([]);
});
it('identifies QuotePlate truthfully to providers instead of using a blocked stock User-Agent', async () => {
  const fetcher = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response('{"elements":[]}', { status: new Headers(init?.headers).get('User-Agent') === 'QuotePlate/1.0 (nearby supplier discovery; https://quoteplate.netlify.app)' ? 200 : 406 }));
  await expect(fetchNearbyJson('https://maps.mail.ru/osm/tools/overpass/api/interpreter', { method: 'POST' }, fetcher)).resolves.toEqual({ elements: [] });
});
it('requests node coordinates as well as way/relation centers, not tags-only output', () => {
  const query = buildNearbyQuery(center, 'drygroceries', 2);
  expect(query).toContain('out body center 100;');
  expect(query).not.toContain('out center tags');
});

it('does not send to the retired main instance or lookalike provider hosts', async () => {
  const fetcher = jest.fn();
  for (const url of ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru.evil.test/osm/tools/overpass/api/interpreter', 'https://maps.mail.ru/api/interpreter']) {
    await expect(fetchNearbyJson(url, {}, fetcher)).rejects.toThrow(/Unsupported/);
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it('parses the captured real OSM response with node coordinates and way centers', () => {
  // Captured 2026-09-07 from the publicly permitted VK Maps Overpass instance.
  // © OpenStreetMap contributors, ODbL. Replayed offline; no test network traffic.
  const fixture = liveFixture;
  const results = parseNearbyResults(fixture, { id: '19.11588,72.8542', label: 'Andheri East, Mumbai, India', lat: 19.11588, lon: 72.8542 }, 'drygroceries', 2);
  expect(results).toHaveLength(23);
  expect(results.some(r => /Optics|Jain Tripathi/.test(r.name))).toBe(false);
  expect(results[0]).toMatchObject({ name: '7-Eleven', distanceKm: 0.14, verificationStatus: 'UNVERIFIED' });
  expect(results.find(r => r.name === 'saraswati stores')).toMatchObject({ phone: '02228227111' });
  expect(results.some(r => r.id.startsWith('way/'))).toBe(true);
});

it('rejects visibly conflicting non-food and closed business tags in category results', () => {
 const food={...node,tags:{name:'Market Groceries',shop:'convenience'}};
 const elements=[food,{...food,id:2,tags:{name:'Jain Tripathi & Co.',shop:'convenience',designation:'Chartered Accountant'}},{...food,id:3,tags:{name:'Regal Optics',shop:'convenience'}},{...food,id:4,tags:{name:'Old market',shop:'convenience',disused:'yes'}},{...food,id:5,tags:{name:'Consulting',shop:'convenience',office:'accountant'}}];
 expect(parseNearbyResults({elements},center,'drygroceries',2).map(item=>item.name)).toEqual(['Market Groceries']);
});
