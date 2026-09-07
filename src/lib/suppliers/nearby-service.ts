import { createHash } from 'node:crypto';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';
import { createNearbyCache, fetchNearbyJson } from './nearby-provider';
import { buildNearbyQuery, isNearbyCategory, NearbyError, parseNearbyCenters, parseNearbyResults, type NearbyCenter, type NearbyResult } from './nearby-types';
const centers = createNearbyCache<NearbyCenter[]>(100);
const results = createNearbyCache<NearbyResult[]>(100);
// Reuse the existing DB-backed scope, with separate versioned subject namespaces.
// Provider subjects are constant across tenants/users/instances; no process-local quota.
async function quota(subject: string, limit: number, windowMs: number) {
  try {
    const rate = await consumeDigestRateLimit({ scope: 'supplier-request', subjectDigest: createHash('sha256').update(`nearby:v1:${subject}`).digest('hex'), limit, windowMs, now: new Date() });
    if (!rate.allowed) throw new NearbyError('Nearby search usage limit reached. Please try later.', 429, rate.retryAfterSeconds);
  } catch (error) {
    if (error instanceof NearbyError) throw error;
    throw new NearbyError('Nearby search is temporarily unavailable. Please try later.', 503);
  }
}
async function providerQuota(provider: 'photon' | 'overpass') {
  await quota(`provider:${provider}:day`, 200, 86400000);
  await quota(`provider:${provider}:minute`, 6, 60000);
  // Outlast the 20-second upstream timeout: do not run requests in parallel
  // across serverless workers (operator's April 2026 usage guidance).
  await quota(`provider:${provider}:spacing`, 1, 25000);
}
export async function discoverNearby(userId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new NearbyError('Enter an area in India.', 400);
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some(k => !['area', 'centerId', 'category', 'radius'].includes(k)) || typeof v.area !== 'string' || v.area.trim().length < 2 || v.area.length > 160 || /[\u0000-\u001f]/.test(v.area)) throw new NearbyError('Enter a brief locality, city or PIN code in India.', 400);
  if (v.category !== undefined && !isNearbyCategory(v.category) || v.radius !== undefined && ![2, 5, 10].includes(v.radius as number) || v.centerId !== undefined && (typeof v.centerId !== 'string' || v.centerId.length > 60)) throw new NearbyError('Choose a valid category, radius and matched area.', 400);
  if (v.centerId !== undefined && (!isNearbyCategory(v.category) || v.radius === undefined)) throw new NearbyError('Choose a category and radius.', 400);
  await quota(`user:${userId}:hour`, 20, 3600000);
  const area = v.area.trim().replace(/\s+/g, ' ');
  const matches = await centers.get(area.toLowerCase(), 86400000, async () => {
    await providerQuota('photon');
    const params = new URLSearchParams({ q: `${area}, India`, limit: '5', lang: 'en', bbox: '68,6,98,38' });
    return parseNearbyCenters(await fetchNearbyJson(`https://photon.komoot.io/api?${params}`, {}, fetch, 128 * 1024, 8000));
  });
  if (v.centerId === undefined) return { centers: matches };
  const center = matches.find(c => c.id === v.centerId);
  if (!center) throw new NearbyError('That area is no longer available. Resolve the area again and select an Indian match.', 400);
  const category = v.category as Parameters<typeof parseNearbyResults>[2], radius = v.radius as number;
  const query = buildNearbyQuery(center, category, radius);
  const found = await results.get(`${center.id}:${category}:${radius}`, 3600000, async () => {
    await providerQuota('overpass');
    // Single independently operated public instance; no fallback or host rotation.
    // https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
    // Main overpass-api.de excludes Netlify apps; do not re-enable it here.
    const data = await fetchNearbyJson('https://maps.mail.ru/osm/tools/overpass/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }).toString() });
    return parseNearbyResults(data, center, category, radius);
  });
  return { center, category, radius, results: found, limited: found.length >= 40 };
}
