'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MapPin, Search } from 'lucide-react';
import { NEARBY_CATEGORIES, nearbyPrefill, type NearbyCategory, type NearbyCenter, type NearbyPrefill, type NearbyResult } from '@/lib/suppliers/nearby-types';
import { findSupplierContactMatches, type ExistingSupplierContact } from '@/lib/suppliers/contact-list';
import styles from './nearby-supplier-search.module.css';
type Props = { onAddSupplier: (prefill?: NearbyPrefill) => void; existingContacts?: readonly ExistingSupplierContact[] };
export function NearbySupplierResults({ results, existingContacts = [], onAddSupplier }: Props & { results: NearbyResult[] }) {
  return <>{existingContacts.length > 0 && <p className={styles.help}>Contact matches cover only supplier records currently loaded. Other saved suppliers may not appear here.</p>}
  <div className={styles.results}>{results.map(item => {
    const prefill = nearbyPrefill(item);
    const matches = findSupplierContactMatches(prefill, existingContacts);
    return <article className={styles.card} key={item.id}>
    <div className={styles.cardHeading}><h3>{item.name}</h3><span>{item.distanceKm} km</span></div>
    <p className={styles.badges}><span>{item.kind}</span><span>Unverified</span></p>
    <p>{item.address || 'Street address not mapped'}</p>
    {item.phone && <p>Phone: {item.phone}</p>}
    {prefill.email && <p>Email: {prefill.email}</p>}
    {!item.phone && !item.website && !prefill.email && <p>Contact details not mapped</p>}
    {matches.length > 0 && <p className={styles.match}>Contact already saved: {matches.map(match => `${match.supplier.businessName} (${match.kinds.join(' and ')})`).join(', ')}. Review whether this is the same supplier or a shared contact before adding.</p>}
    <div className={styles.links}>
      {item.website && <a href={item.website} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Website ↗</a>}
      <a href={item.mapUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Map ↗</a>
      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">OSM listing ↗</a>
    </div>
    <button type="button" onClick={() => onAddSupplier(prefill)}>Review and add<span className={styles.srOnly}> {item.name}</span></button>
  </article>;
  })}</div></>;
}
export function NearbySupplierSearch({ onAddSupplier, existingContacts }: Props) {
  const [area, setArea] = useState('');
  const [category, setCategory] = useState<NearbyCategory>('produce');
  const [radius, setRadius] = useState(2);
  const [centers, setCenters] = useState<NearbyCenter[]>([]);
  const [centerId, setCenterId] = useState('');
  const [resolved, setResolved] = useState(false);
  const [found, setFound] = useState<{ center: NearbyCenter; results: NearbyResult[]; limited?: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/suppliers/discover', { cache: 'no-store', signal: abort.signal }).then(async res => {
      if (!res.ok) return;
      const data = await res.json();
      if (!dirty.current && typeof data.area === 'string') setArea(data.area);
    }).catch(() => {});
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  async function search(event: FormEvent, action: 'resolve' | 'search') {
    event.preventDefault();
    if (inFlight.current) return;
    if (retryAt > Date.now()) { setError(`Please wait ${Math.ceil((retryAt - Date.now()) / 1000)} seconds before trying again.`); return; }
    dirty.current = true;
    inFlight.current = true;
    setBusy(action); setError(''); setFound(null);
    if (action === 'resolve') { setCenters([]); setCenterId(''); setResolved(false); }
    const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 35000);
    try {
      const res = await fetch('/api/suppliers/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify(action === 'resolve' ? { area } : { area, centerId, category, radius }) });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          const seconds = Number(res.headers.get('retry-after')) || 60;
          setRetryAt(Date.now() + seconds * 1000);
          throw new Error(`${data.detail || 'Search usage limit reached.'} Wait ${seconds} seconds before trying again.`);
        }
        throw new Error(data.detail || 'Could not search this area. Try again later.');
      }
      if (action === 'resolve') {
        setCenters(data.centers); setResolved(true);
        if (data.centers.length === 1) setCenterId(data.centers[0].id);
      } else { setFound(data); }
    } catch (caught) {
      setError(abort.signal.aborted ? 'Search timed out. Try again later.' : caught instanceof Error ? caught.message : 'Search unavailable. Try again later.');
    } finally { clearTimeout(timer); inFlight.current = false; setBusy(''); }
  }
  const center = centers.find(c => c.id === centerId);
  return <section className={styles.panel} aria-labelledby="nearby-title" aria-busy={Boolean(busy)}>
    <header className={styles.heading}><MapPin aria-hidden="true" /><div><h2 id="nearby-title">Find suppliers in your area</h2><p>Discover food shops and wholesalers from OpenStreetMap, right here.</p></div><span className={styles.free}>Free search</span></header>
    <p className={styles.help}>Category matches are possible leads, not guaranteed ingredient availability or delivery. Retail shops may not supply restaurants. Packaging and some categories have sparse map coverage.</p>
    <form onSubmit={event => void search(event, 'resolve')} className={styles.areaForm}>
      <label>Restaurant area in India<input required maxLength={160} disabled={Boolean(busy)} value={area} placeholder="Locality, city or PIN code" onChange={event => {
        dirty.current = true; setArea(event.target.value); setCenters([]); setCenterId(''); setFound(null); setResolved(false); setError('');
      }} /></label>
      <button disabled={Boolean(busy) || area.trim().length < 2} type="submit">{busy === 'resolve' ? 'Finding area…' : 'Find my area'}</button>
    </form>
    <form onSubmit={event => void search(event, 'search')}>
      <fieldset disabled={Boolean(busy)} className={styles.controls}>
        <label>Category<select value={category} onChange={event => { setCategory(event.target.value as NearbyCategory); setFound(null); }}>
          {Object.entries(NEARBY_CATEGORIES).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}
        </select></label>
        <label>Search radius<select value={radius} onChange={event => { setRadius(Number(event.target.value)); setFound(null); }}>{[2, 5, 10].map(km => <option key={km} value={km}>{km} km</option>)}</select></label>
        <button className={styles.primary} type="submit" disabled={!centerId || Boolean(busy)}><Search aria-hidden="true" />{busy === 'search' ? 'Searching nearby…' : 'Find nearby suppliers'}</button>
      </fieldset>
      {resolved && centers.length > 1 && <label className={styles.matches}>Several areas matched. Choose your area<select disabled={Boolean(busy)} value={centerId} onChange={event => { setCenterId(event.target.value); setFound(null); }}>
        <option value="">Choose an Indian area</option>{centers.map(c => <option value={c.id} key={c.id}>{c.label}</option>)}
      </select></label>}
      {center && <p className={styles.center}>Search area: <strong>{center.label}</strong>. <a href={`https://www.openstreetmap.org/?mlat=${center.lat}&mlon=${center.lon}#map=15/${center.lat}/${center.lon}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open map location ↗</a> to check before searching.</p>}
      {resolved && centers.length === 0 && <p role="status" className={styles.center}>No Indian area matched. Try a nearby locality and city, or a PIN code.</p>}
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {busy && <p role="status" className={styles.help}>{busy === 'resolve' ? 'Finding Indian area matches…' : 'Looking for mapped shops and wholesalers…'}</p>}
    {found && <section aria-label="Nearby supplier results">
      <p role="status" className={styles.center}>{found.results.length ? `${found.results.length} mapped leads` : 'No mapped suppliers found'} within {radius} km of {found.center.label}. Distances are straight-line estimates.</p>
      {!found.results.length && <p className={styles.help}>Map coverage is incomplete. Try another category, a larger radius, or the web search below.</p>}
      {found.limited && <p className={styles.help}>Showing up to 40 leads. Try a smaller radius for a more focused search.</p>}
      <NearbySupplierResults results={found.results} onAddSupplier={onAddSupplier} existingContacts={existingContacts} />
      {found.results.length > 0 && <p className={styles.help}>Review and add opens an unsaved form. Check contact details, products and delivery before saving. Before saving, confirm that your restaurant has checked the supplier. Saving then marks it as restaurant-verified. No automatic messages.</p>}
    </section>}
    <footer className={styles.help}>Only when you search, your area goes to Photon; the selected coordinates, category and radius go to VK Maps’ Overpass service in Russia. Public results may be cached for up to an hour (areas for 24 hours). No automatic messages or supplier additions. Free services have usage limits and may be busy or unavailable. Data: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · <a href="https://github.com/komoot/photon" target="_blank" rel="noopener noreferrer">Photon</a> · <a href="https://maps.mail.ru/osm/tools/overpass/" target="_blank" rel="noopener noreferrer">VK Maps / Overpass</a>.</footer>
  </section>;
}
