/** Fixed OSM tag mappings: category leads, never promises of particular stock. */
export const NEARBY_CATEGORIES = {
  produce: { label: 'Produce', shops: ['greengrocer', 'farm'], wholesale: ['fruit', 'vegetables', 'fruit_and_vegetables'] },
  dairy: { label: 'Dairy', shops: ['dairy', 'cheese'], wholesale: ['dairy'] },
  meat: { label: 'Meat', shops: ['butcher'], wholesale: ['meat'] },
  fish: { label: 'Fish', shops: ['seafood'], wholesale: ['fish', 'seafood'] },
  drygroceries: { label: 'Dry groceries', shops: ['grocery', 'supermarket', 'convenience'], wholesale: ['food', 'grocery'] },
  spices: { label: 'Spices', shops: ['spices'], wholesale: ['spices'] },
  packaging: { label: 'Packaging', shops: ['packaging'], wholesale: ['packaging'] },
} as const;
export type NearbyCategory = keyof typeof NEARBY_CATEGORIES;
export type NearbyCenter = { id: string; label: string; lat: number; lon: number };
export type NearbyResult = {
  id: string; name: string; distanceKm: number; phone: string | null; website: string | null;
  address: string; city: string; state: string; pin: string; category: NearbyCategory;
  kind: 'Wholesale listing' | 'Retail potential'; sourceUrl: string; mapUrl: string;
  verificationStatus: 'UNVERIFIED';
};
export class NearbyError extends Error {
  constructor(message: string, public status = 502, public retryAfterSeconds = 60) { super(message); }
}
export function isNearbyCategory(value: unknown): value is NearbyCategory {
  return typeof value === 'string' && Object.hasOwn(NEARBY_CATEGORIES, value);
}
function coords(lat: unknown, lon: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= 6 && lat <= 38 &&
    typeof lon === 'number' && Number.isFinite(lon) && lon >= 68 && lon <= 98;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function str(value: unknown, max = 200) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : ''; }
export function parseNearbyCenters(data: unknown): NearbyCenter[] {
  const features = record(data).features;
  if (!Array.isArray(features)) throw new NearbyError('The area service returned an invalid response.');
  const centers = new Map<string, NearbyCenter>();
  for (const f of features.slice(0, 20)) {
    const feature = record(f), p = record(feature.properties), c = record(feature.geometry).coordinates;
    if (str(p.countrycode).toUpperCase() !== 'IN' || !Array.isArray(c) || !coords(c[1], c[0])) continue;
    const lat = Number(c[1].toFixed(5)), lon = Number(c[0].toFixed(5));
    const id = `${lat},${lon}`;
    const label = [...new Set([p.name, p.district, p.city, p.state, p.postcode, 'India'].map(v => str(v)).filter(Boolean))].join(', ');
    if (label === 'India') continue;
    centers.set(id, { id, label, lat, lon });
  }
  return [...centers.values()].slice(0, 5);
}
export function buildNearbyQuery(center: Pick<NearbyCenter, 'lat' | 'lon'>, category: unknown, radius: unknown) {
  if (!coords(center.lat, center.lon) || !isNearbyCategory(category) || ![2, 5, 10].includes(radius as number)) throw new NearbyError('Choose a valid Indian area, category and radius.', 400);
  const mapping = NEARBY_CATEGORIES[category];
  const around = `(around:${Number(radius) * 1000},${center.lat},${center.lon})`;
  return `[out:json][timeout:15][maxsize:8388608];(nwr["shop"~"^(${mapping.shops.join('|')})$"]${around};nwr["shop"="wholesale"]["wholesale"~"^(${mapping.wholesale.join('|')})$"]${around};);out body center 100;`;
}
function distance(lat: number, lon: number, c: NearbyCenter) {
  const rad = Math.PI / 180;
  const a = Math.sin((lat - c.lat) * rad / 2) ** 2 + Math.cos(c.lat * rad) * Math.cos(lat * rad) * Math.sin((lon - c.lon) * rad / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function safeWebsite(value: unknown) {
  try {
    const url = new URL(str(value, 500));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function parseNearbyResults(data: unknown, center: NearbyCenter, category: NearbyCategory, radius: number): NearbyResult[] {
  buildNearbyQuery(center, category, radius);
  const envelope = record(data);
  if (envelope.remark || !Array.isArray(envelope.elements)) throw new NearbyError('The map service could not complete this search. Try again later.');
  const results: NearbyResult[] = [], seen = new Set<string>();
  const mapping = NEARBY_CATEGORIES[category];
  for (const item of envelope.elements.slice(0, 100)) {
    const e = record(item), t = record(e.tags), c = record(e.center);
    const lat = e.lat ?? c.lat, lon = e.lon ?? c.lon;
    const name = str(t.name || t['name:en'], 160);
    // Live OSM results can have stale/conflicting shop tags. Suppress explicit
    // non-food or closed-business evidence instead of presenting it as a lead.
    if (['yes', 'true', '1'].includes(str(t.disused).toLowerCase()) ||
      ['yes', 'true', '1'].includes(str(t.abandoned).toLowerCase()) ||
      ['accountant', 'lawyer', 'insurance', 'estate_agent', 'travel_agent'].includes(str(t.office)) ||
      /\b(?:chartered\s+accountant|optics|optical|pharmacy|chemist|dental|dentist)\b/i.test(`${name} ${str(t.designation)}`)) continue;

    const wholesale = t.shop === 'wholesale' && (mapping.wholesale as readonly string[]).includes(str(t.wholesale));
    if (!name || !coords(lat, lon) || (!wholesale && !(mapping.shops as readonly string[]).includes(str(t.shop)))) continue;
    if (t['addr:country'] && !['IN', 'INDIA'].includes(str(t['addr:country']).toUpperCase())) continue;
    if (!['node', 'way', 'relation'].includes(String(e.type)) || !Number.isSafeInteger(e.id) || Number(e.id) <= 0) continue;
    const km = distance(lat as number, lon as number, center);
    if (km > radius) continue;
    const id = `${e.type}/${e.id}`;
    // Node/way duplicates are common; retain separate branches beyond ~100 m.
    const duplicate = `${name.toLowerCase()}|${Number(lat).toFixed(3)}|${Number(lon).toFixed(3)}`;
    if (seen.has(id) || seen.has(duplicate)) continue;
    seen.add(id); seen.add(duplicate);
    const address = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'], t['addr:city'], t['addr:state'], t['addr:postcode']].map(v => str(v, 80)).filter(Boolean).join(', ');
    results.push({ id, name, distanceKm: Math.round(km * 100) / 100, category,
      phone: str(t.phone || t['contact:phone'], 80) || null, website: safeWebsite(t.website || t['contact:website']),
      address, city: str(t['addr:city'], 80), state: str(t['addr:state'], 80), pin: /^[1-9]\d{5}$/.test(str(t['addr:postcode'])) ? str(t['addr:postcode']) : '',
      kind: wholesale ? 'Wholesale listing' : 'Retail potential', sourceUrl: `https://www.openstreetmap.org/${id}`,
      mapUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`, verificationStatus: 'UNVERIFIED',
    });
  }
  return results.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 40);
}
export function nearbyPrefill(result: NearbyResult) {
  return { businessName: result.name, phone: result.phone || '', addressLine: result.address.slice(0, 240), city: result.city, state: result.state, pin: result.pin,
    notes: `Unverified OpenStreetMap lead. ${result.kind}; ${NEARBY_CATEGORIES[result.category].label} category match only. Confirm products, contact and delivery before saving. Source: ${result.sourceUrl}${result.website ? ` Website: ${result.website}` : ''}` };
}
export type NearbyPrefill = ReturnType<typeof nearbyPrefill>;
