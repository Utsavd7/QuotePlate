'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatInr } from '@/lib/domain/money';
import { Link2, MessageSquare, Sprout } from 'lucide-react';
import type { RestaurantPortalView, PortalOrder } from '@/lib/supplier-portal/types';
import type { computePlan } from '@/lib/service-planning/planning';
import { WorkspaceHeader, WorkspaceToolbar } from '../workspace/Workspace';
import styles from './restaurant-supplier-portal.module.css';
import { TradingProfileReadView } from './TradingProfile';

type Ingredient = Pick<ReturnType<typeof computePlan>['ingredients'][number], 'itemKey' | 'name' | 'deficit' | 'usableDeficit' | 'unit' | 'specification' | 'blocked'>;
export type SavedDemandPlan = {
  id: string; name: string; version: number; requestId: string | null;
  document: { serviceAt: string };
  readiness: { ingredients: Ingredient[]; warnings: string[] };
};
type FreshLink = { url: string; expiresAt: string };
type Supplier = { id: string; businessName: string; isActive: boolean };
type PlanListing = { plans: { id: string; name: string; version: number; serviceAt: string }[] };
const date = (value: string) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const unit = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const shortageRows = (plan: SavedDemandPlan) => plan.readiness.ingredients.filter(i => !i.blocked && Number(i.deficit) > 0);

export function demandBlockReason(plan: SavedDemandPlan | null, now = Date.now()): string {
  if (!plan?.id || !Number.isInteger(plan.version) || plan.version < 1) return 'Choose a saved plan. Save any changes in service planning before reviewing.';
  if (plan.requestId) return 'This plan has already been converted to procurement. Review its request instead.';
  if (!(Date.parse(plan.document.serviceAt) > now)) return 'The service date must be in the future. Update and save the plan first.';
  if (plan.readiness.ingredients.some(i => i.blocked) || plan.readiness.warnings.some(w => w.includes('recipe has no ingredients'))) return 'Resolve the plan’s blocked ingredients or incomplete recipes before sharing.';
  if (!shortageRows(plan).length) return 'This plan has no purchasable shortages to share.';
  return '';
}

export function demandPayload(plan: SavedDemandPlan | null, selectedItemKeys: string[]) {
  if (!plan || demandBlockReason(plan)) return null;
  const allowed = new Set(shortageRows(plan).map(i => i.itemKey));
  const itemKeys = [...new Set(selectedItemKeys)].filter(key => allowed.has(key));
  return itemKeys.length ? { planId: plan.id, expectedPlanVersion: plan.version, itemKeys } : null;
}

async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, cache: 'no-store', signal,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error([data?.detail, ...Object.values(data?.errors ?? {}).flat()].filter(Boolean).join(' ') || 'Unable to complete this action. Please try again.');
  return data as T;
}

export function PortalControls({ canManage, access, freshLink, busy, onCreate, onRevoke, onCopy, onDismiss }: {
  canManage: boolean; access: RestaurantPortalView['access']; freshLink: FreshLink | null; busy: boolean;
  onCreate: () => void; onRevoke: () => void; onCopy: () => void; onDismiss: () => void;
}) {
  const [now] = useState(() => Date.now());
  const active = access && !access.revokedAt && Date.parse(access.expiresAt) > now;
  return <section className={styles.panel} aria-labelledby="portal-access-title">
    <div className={styles.sectionHeading}><Link2 aria-hidden="true" /><h2 id="portal-access-title">Private supplier link</h2></div>
    <p>Give this supplier access to their orders, delivery checks and the estimates you choose to share.</p>
    <p><span className={active ? styles.badge : styles.mutedBadge}>{active ? 'Active access' : access?.revokedAt ? 'Access revoked' : access ? 'Access expired' : 'No active link'}</span>{active && <> Expires {date(access.expiresAt)}.</>}</p>
    {!canManage ? <p className={styles.hint}>Only an owner can create or revoke links, share estimates or withdraw them. You can review supplier activity.</p> : <>
      <p className={styles.hint}>Links last 30 days. Replacing a link immediately invalidates the previous one. Share it manually with this supplier; no messages are sent automatically.</p>
      <div className={styles.actions}><button disabled={busy} onClick={onCreate}>{active ? 'Replace private link' : 'Create private link'}</button>{access && !access.revokedAt && <button className={styles.secondary} disabled={busy} onClick={onRevoke}>Revoke access</button>}</div>
      {freshLink && <div className={styles.freshLink}>
        <label>New private link<input readOnly value={freshLink.url} onFocus={e => e.currentTarget.select()} /></label>
        <p>Copy this link now. It is shown only here after creation and cannot be retrieved later. Expires {date(freshLink.expiresAt)}.</p>
        <div className={styles.actions}><button disabled={busy} onClick={onCopy}>Copy link</button><button className={styles.secondary} onClick={onDismiss}>Dismiss link</button></div>
      </div>}
    </>}
  </section>;
}

export function SupplierOrders({ orders }: { orders: PortalOrder[] }) {
  const status = { awaiting_quote: 'Awaiting quote', pending: 'Quote received', selected: 'Selected order', closed: 'Closed' };
  return <section className={styles.panel} aria-labelledby="orders-title">
    <div className={styles.sectionHeading}><MessageSquare aria-hidden="true" /><h2 id="orders-title">Orders & delivery responses</h2></div>
    <p className={styles.hint}>Latest 30 requests for this supplier, with their orders and responses. Acknowledgements do not change your award. Correct receiving records in the original request.</p>
    {!orders.length && <p className={styles.empty}>No invited requests or orders for this supplier yet.</p>}
    {orders.map(order => <article className={styles.card} key={order.requestId}>
      <div className={styles.cardHeading}><h3>{order.title}</h3><span className={styles.badge}>{status[order.status]}</span></div>
      <p className={styles.hint}>Delivery {order.deliveryDate}</p>
      <ul>{order.items.map(item => <li key={item.itemId}>{item.name} · {item.quantity} {unit(item.unit)}</li>)}</ul>
      <h4>Supplier acknowledgement</h4>
      {order.acknowledgement ? <><p>{order.acknowledgement.status === 'confirmed' ? 'Confirmed' : 'Change requested'} · {date(order.acknowledgement.at)}</p>{order.acknowledgement.note && <p className={styles.note}>{order.acknowledgement.note}</p>}</> : <p className={styles.hint}>No acknowledgement yet.</p>}
      {order.delivery && <details><summary>Restaurant delivery check · {order.delivery.status}</summary>
        <p>Checked {date(order.delivery.checkedAt)}</p>
        {order.delivery.invoiceTotalPaise !== undefined && <p>Invoice recorded: {formatInr(order.delivery.invoiceTotalPaise)}</p>}
        {order.delivery.expectedTotalPaise !== undefined && <p>Accepted supplier total: {formatInr(order.delivery.expectedTotalPaise)}</p>}
        {!!order.delivery.issueCodes?.length && <p>Recorded issues: {order.delivery.issueCodes.map(unit).join(' · ')}</p>}
        {order.delivery.settlementNote && <p>Settlement reference: {order.delivery.settlementNote}</p>}
        <div className={styles.scroll} tabIndex={0} role="region" aria-label={`Delivery quantities for ${order.title}`}><table><thead><tr><th>Ingredient</th><th>Ordered</th><th>Received</th><th>Rejected</th><th>Accepted</th><th>Outstanding</th></tr></thead><tbody>{order.delivery.lines.map(line => <tr key={line.itemId}><th scope="row">{line.name} ({unit(line.unit)})</th><td>{line.ordered}</td><td>{line.received}</td><td>{line.rejected}</td><td>{line.accepted}</td><td>{line.outstanding}</td></tr>)}</tbody></table></div>
        {order.delivery.notes && <p className={styles.note}>{order.delivery.notes}</p>}
      </details>}
      <h4>Supplier delivery response</h4>
      {order.response ? <>
        <p><span className={order.response.decision === 'dispute' ? styles.warningBadge : styles.badge}>{order.response.decision === 'agree' ? 'Agrees with check' : 'Disputed'}</span>{!order.responseIsCurrent && <span className={styles.warningBadge}>Outdated response</span>}</p>
        {!order.responseIsCurrent && <p className={styles.hint}>The receiving check changed after this response. A new supplier response is needed.</p>}
        <p className={styles.note}>{order.response.note}</p>{order.response.evidenceReference && <p>Evidence reference: {order.response.evidenceReference}</p>}<p className={styles.hint}>{date(order.response.at)}</p>
      </> : <p className={styles.hint}>No delivery response yet.</p>}
      <Link href={`/procurement/${encodeURIComponent(order.requestId)}`}>Review request / correct delivery check →</Link>
    </article>)}
  </section>;
}

export function DemandReview({ plan, selectedItemKeys, disabled, onSelect }: { plan: SavedDemandPlan; selectedItemKeys: string[]; disabled: boolean; onSelect: (keys: string[]) => void }) {
  const reason = demandBlockReason(plan);
  return <>
    <p>Saved version {plan.version} · Service {date(plan.document.serviceAt)}</p>
    {reason && <p className={styles.warning}>{reason} <Link href={plan.requestId ? `/procurement/${encodeURIComponent(plan.requestId)}` : '/service-planning'}>Review plan or request</Link></p>}
    {plan.readiness.warnings.length > 0 && <ul className={styles.hint}>{plan.readiness.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    <fieldset disabled={disabled || !!reason} className={styles.selection}><legend>Choose exact purchase shortages to share</legend>
      {shortageRows(plan).map((item, index) => <label key={`${item.itemKey}-${index}`} className={styles.ingredient}>
        <input type="checkbox" checked={selectedItemKeys.includes(item.itemKey)} onChange={e => onSelect(e.target.checked ? [...selectedItemKeys, item.itemKey] : selectedItemKeys.filter(key => key !== item.itemKey))} />
        <span><strong>{item.name}</strong><span className={styles.specification}>{[item.specification.description, item.specification.preferredBrand, item.specification.packSize, item.specification.qualityGrade, item.specification.notes].filter(Boolean).join(' · ') || 'No additional specifications'}</span></span>
        <span className={styles.quantity}>{item.deficit} {unit(item.unit)}<small>Purchase quantity</small></span>
      </label>)}
    </fieldset>
  </>;
}

export function RestaurantSupplierPortal() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [listingLoaded, setListingLoaded] = useState(false);
  const [listingError, setListingError] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [listingBusy, setListingBusy] = useState(true);
  const [view, setView] = useState<RestaurantPortalView | null>(null);
  const [freshLink, setFreshLink] = useState<FreshLink | null>(null);
  const [plans, setPlans] = useState<PlanListing['plans']>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [planId, setPlanId] = useState('');
  const [plan, setPlan] = useState<SavedDemandPlan | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const mutationLock = useRef(false);
  const portalPath = `/api/suppliers/${encodeURIComponent(supplierId)}/portal`;

  useEffect(() => {
    const controller = new AbortController();
    api<{ suppliers: Supplier[]; nextCursor?: string | null }>('/api/suppliers?active=true&limit=50', 'GET', undefined, controller.signal)
      .then(data => { setSuppliers(data.suppliers.filter(s => s.isActive)); setCursor(data.nextCursor ?? null); setListingLoaded(true); setListingError(''); })
      .catch(e => { if (!controller.signal.aborted) setListingError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setListingBusy(false); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!supplierId) return;
    const controller = new AbortController();
    api<RestaurantPortalView>(portalPath, 'GET', undefined, controller.signal)
      .then(setView).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [supplierId, portalPath, reload]);

  useEffect(() => {
    if (!view?.canManage) return;
    const controller = new AbortController();
    api<PlanListing>('/api/service-planning', 'GET', undefined, controller.signal)
      .then(data => { setPlans(data.plans); setPlansLoaded(true); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [view?.canManage, supplierId, reload]);

  useEffect(() => {
    if (!planId) return;
    const controller = new AbortController();
    api<SavedDemandPlan>(`/api/service-planning/${encodeURIComponent(planId)}`, 'GET', undefined, controller.signal)
      .then(setPlan).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setPlanLoading(false); });
    return () => controller.abort();
  }, [planId, reload]);

  function selectSupplier(id: string) {
    setSupplierId(id); setView(null); setFreshLink(null); setPlanId(''); setPlan(null); setSelectedItemKeys([]);
    setPlansLoaded(false); setPlans([]); setError(''); setNotice(''); setLoading(!!id); setPlanLoading(false);
  }
  function selectPlan(id: string) {
    setPlanId(id); setPlan(null); setSelectedItemKeys([]); setError(''); setNotice(''); setPlanLoading(!!id);
  }
  async function mutate(action: 'create' | 'revoke' | 'share' | 'withdraw', shareId?: string) {
    if (!view?.canManage || !supplierId || mutationLock.current) return;
    const payload = demandPayload(plan, selectedItemKeys);
    if (action === 'share' && !payload) { setError(demandBlockReason(plan) || 'Choose at least one ingredient.'); return; }
    mutationLock.current = true; setBusy(true); setError(''); setNotice('');
    if (action === 'create' || action === 'revoke') setFreshLink(null);
    try {
      if (action === 'create') {
        const link = await api<FreshLink>(portalPath, 'POST');
        setFreshLink(link); setView({ ...view, access: { expiresAt: link.expiresAt, revokedAt: null } });
        setNotice('New private link created. Copy and share it manually.');
      } else {
        await api(action === 'revoke' ? portalPath : `${portalPath}/demand`, action === 'share' ? 'POST' : 'DELETE', action === 'share' ? payload : action === 'withdraw' ? { shareId } : undefined);
        if (action === 'share') setSelectedItemKeys([]);
        if (action === 'revoke') setView({ ...view, access: view.access ? { ...view.access, revokedAt: new Date().toISOString() } : null });
        if (action === 'withdraw') setView({ ...view, forecasts: view.forecasts.filter(f => f.id !== shareId) });
        setNotice(action === 'share' ? 'Selected ingredients shared as an estimate. No order or message was sent.' : action === 'revoke' ? 'Supplier access revoked.' : 'Estimate withdrawn from the supplier portal.');
      }
      try { setView(await api<RestaurantPortalView>(portalPath)); }
      catch { setError('Action saved, but activity could not be refreshed. Refresh activity to see the latest state.'); }
    } catch (e) {
      setError((e as Error).message);
      if (action === 'share') { setSelectedItemKeys([]); setPlan(null); setPlanId(''); }
    } finally { mutationLock.current = false; setBusy(false); }
  }
  async function moreSuppliers() {
    if (!cursor) return;
    setListingBusy(true); setListingError('');
    try {
      const data = await api<{ suppliers: Supplier[]; nextCursor?: string | null }>(`/api/suppliers?active=true&limit=50&cursor=${encodeURIComponent(cursor)}`);
      setSuppliers(current => [...new Map([...current, ...data.suppliers.filter(s => s.isActive)].map(s => [s.id, s])).values()]); setCursor(data.nextCursor ?? null);
    } catch (e) { setListingError((e as Error).message); } finally { setListingBusy(false); }
  }
  function refresh() {
    setView(null); setPlan(null); setSelectedItemKeys([]); setFreshLink(null); setError(''); setNotice(''); setLoading(!!supplierId); setListingBusy(true); setPlanLoading(!!planId); setReload(n => n + 1);
  }
  async function copyLink() {
    if (!freshLink) return;
    try { await navigator.clipboard.writeText(freshLink.url); setNotice('Private link copied. Share it only with this supplier.'); }
    catch { setError('Clipboard unavailable. Select and copy the link from the field.'); }
  }

  return <main className={styles.workspace}>
    <WorkspaceHeader title="Orders & messages" description="Choose a supplier to check orders, delivery replies or share upcoming needs." />
    <WorkspaceToolbar label="Choose supplier"><label className={styles.supplierField}>Supplier<select aria-label="Supplier" value={supplierId} disabled={busy} onChange={e => selectSupplier(e.target.value)}><option value="">Choose an active supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.businessName}</option>)}</select></label><Link href="/suppliers">Manage suppliers →</Link>{cursor && <button className={styles.secondary} disabled={listingBusy || busy} onClick={() => void moreSuppliers()}>Load more suppliers</button>}</WorkspaceToolbar>
    {listingBusy && <p role="status">Loading suppliers…</p>}
    {listingError && <p role="alert" className={styles.error}>{listingError} <button disabled={busy} onClick={refresh}>Retry</button></p>}
    {listingLoaded && !suppliers.length && <p className={styles.empty}>Add a supplier first, then manage orders and messages here.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {supplierId && <button className={styles.secondary} disabled={busy || loading || planLoading} onClick={refresh}>Refresh activity</button>}
    {loading && <p role="status">Loading supplier activity…</p>}
    {view && <>
      <h2 className={styles.supplierName}>{view.supplierName}</h2>
      <PortalControls canManage={view.canManage} access={view.access} freshLink={freshLink} busy={busy} onCreate={() => void mutate('create')} onRevoke={() => void mutate('revoke')} onCopy={() => void copyLink()} onDismiss={() => setFreshLink(null)} />
      <details className={styles.secondaryDetails}><summary>Supplier delivery terms</summary><TradingProfileReadView profile={view.tradingProfile} /></details>
      <SupplierOrders orders={view.orders} />
      <details key={supplierId} className={styles.secondaryDetails} open={view.forecasts.length > 0}>
      <summary>Plan ahead: share ingredient needs{view.forecasts.length > 0 ? ` · ${view.forecasts.length} shared${view.forecasts.some(forecast => forecast.stale) ? ' · Review outdated estimates' : ''}` : ''}</summary>
      <section className={styles.panel} aria-labelledby="demand-title"><div className={styles.sectionHeading}><Sprout aria-hidden="true" /><h2 id="demand-title">Share upcoming needs</h2></div>
        <p>Choose ingredients to help this supplier prepare. Only selected quantities, specifications and the date are shared. Recipes, portions, stock and prices stay private.</p>
        <p className={styles.hint}>This is a plan, not an order. Confirm stock and delivery with the supplier.</p>
        {view.canManage && <>
          <label>Saved service plan<select aria-label="Saved service plan" value={planId} disabled={busy || !plansLoaded} onChange={e => selectPlan(e.target.value)}><option value="">Choose a saved plan</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name} · v{p.version} · {date(p.serviceAt)}</option>)}</select></label>
          {!plansLoaded ? <p>Loading saved plans…</p> : !plans.length && <p>No saved plans yet. <Link href="/service-planning">Create and save a service plan</Link>.</p>}
          {planLoading && <p role="status">Loading saved shortages…</p>}
          {plan && <DemandReview plan={plan} selectedItemKeys={selectedItemKeys} disabled={busy} onSelect={setSelectedItemKeys} />}
          <p className={styles.hint}>Review the saved version here after saving changes in <Link href="/service-planning">service planning</Link>. Eligibility and version are checked again when you share.</p>
          <button disabled={busy || planLoading || !demandPayload(plan, selectedItemKeys)} onClick={() => void mutate('share')}>Share {selectedItemKeys.length || ''} selected ingredient{selectedItemKeys.length === 1 ? '' : 's'} with {view.supplierName}</button>
        </>}
        <h3 className={styles.sharesTitle}>Shared estimates</h3>
        {!view.forecasts.length && <p className={styles.empty}>No demand estimates shared with this supplier.</p>}
        {view.forecasts.map(forecast => <article className={styles.card} key={forecast.id}>
          <div className={styles.cardHeading}><h4>Service {date(forecast.serviceAt)}</h4><span className={forecast.stale ? styles.warningBadge : styles.badge}>{forecast.stale ? 'Outdated estimate' : 'Shared estimate'}</span></div>
          <p className={styles.hint}>Shared {date(forecast.sharedAt)} · Saved version {forecast.planVersion} · Estimate, not an order</p>
          {forecast.stale && <p>The plan changed or was converted to procurement. Review the latest saved plan before sharing again.</p>}
          <ul>{forecast.items.map(item => <li key={item.itemKey}><strong>{item.name}</strong> · {item.quantity} {unit(item.unit)}{item.specification && <span className={styles.specification}>{item.specification}</span>}</li>)}</ul>
          {view.canManage && <button className={styles.secondary} disabled={busy} onClick={() => void mutate('withdraw', forecast.id)} aria-label={`Withdraw estimate for ${date(forecast.serviceAt)} shared ${date(forecast.sharedAt)}`}>Withdraw estimate</button>}
        </article>)}
      </section>
      </details>
    </>}
    {!supplierId && suppliers.length > 0 && <p className={styles.empty}>Choose a supplier above to see their orders and replies.</p>}
  </main>;
}
