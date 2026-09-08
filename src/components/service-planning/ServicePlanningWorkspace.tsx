'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MenuDocumentV1 } from '@/lib/menu/menu-document';
import type { PlanInput, computePlan } from '@/lib/service-planning/planning';
import { PlanningSummary } from './PlanningSummary';
import styles from './service-planning.module.css';
type Menu = {
  id: string;
  name: string;
  version: number;
  document: MenuDocumentV1;
};
type Plan = {
  id: string;
  version: number;
  name: string;
  requestId: string | null;
  document: PlanInput;
  menuSnapshot: MenuDocumentV1;
  readiness: ReturnType<typeof computePlan>;
  supplierOptions?: {
    id: string;
    businessName: string;
    evidence: string;
    itemKeys?: string[];
  }[];
};
type Listing = {
  plans: {
    id: string;
    name: string;
    version: number;
    serviceAt: string;
  }[];
  menus: Menu[];
  deliveryDetails: {
    addressLine: string;
    city: string;
    state: string;
    pin: string;
  };
};
async function api<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
  const response = await fetch(`/api/service-planning${path}`, {
    method,
    cache: 'no-store',
    headers: method === 'GET' ? undefined : {
      'Content-Type': 'application/json'
    },
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.errors ? Object.values(data.errors).flat().join(' ') : data.detail ?? 'Unable to load planning.');
  return data;
}
const localTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function ServicePlanningWorkspace() {
  const [listing, setListing] = useState<Listing | null>(null),
    [plan, setPlan] = useState<Plan | null>(null),
    [document, setDocument] = useState<PlanInput | null>(null),
    [menuId, setMenuId] = useState(''),
    [snapshot, setSnapshot] = useState<MenuDocumentV1 | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [deliveryDate, setDeliveryDate] = useState(''),
    [deadline, setDeadline] = useState(''),
    [repeatAt, setRepeatAt] = useState('');
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorMessage.current?.focus();
  }, [error]);
  useEffect(() => {
    api<Listing>('').then(setListing).catch(e => setError(e.message));
  }, []);
  const edit = (next: PlanInput) => {
    setDocument(next);
    setDirty(true);
    setNotice('Unsaved changes. Save to update missing ingredients.');
  };
  function selectMenu(id: string) {
    const menu = listing?.menus.find(m => m.id === id);
    if (!menu) return;
    setMenuId(id);
    setSnapshot(menu.document);
    setPlan(null);
    setDirty(true);
    setDocument({
      name: `${menu.name} service`,
      serviceAt: '',
      dishes: menu.document.dishes.map(d => ({
        dishId: d.id,
        batchServings: '',
        portions: '0'
      })),
      inventory: [...new Map(menu.document.dishes.flatMap(d => d.ingredients).map(i => [i.itemKey, {
        itemKey: i.itemKey,
        unit: i.unit,
        yieldPercent: '',
        stock: '',
        incoming: []
      }])).values()]
    });
    setNotice('Choose portions, then enter how many servings one recipe batch makes.');
  }
  async function load(id: string) {
    setBusy(true);
    setError('');
    try {
      const p = await api<Plan>(`/${id}`);
      setPlan(p);
      setDocument({
        ...p.document,
        inventory: [...new Map(p.menuSnapshot.dishes.flatMap(d => d.ingredients).map(i => [i.itemKey, p.document.inventory.find(s => s.itemKey === i.itemKey) ?? {
          itemKey: i.itemKey,
          unit: i.unit,
          yieldPercent: '',
          stock: '',
          incoming: []
        }])).values()]
      });
      setSnapshot(p.menuSnapshot);
      setDirty(false);
      setNotice('Saved plan loaded.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!document) return;
    const documentToSave = { ...document, inventory: document.inventory.filter(i => i.stock !== '' || i.yieldPercent !== '') };
    setBusy(true);
    setError('');
    try {
      const p = await api<Plan>(plan ? `/${plan.id}` : '', plan ? 'PUT' : 'POST', plan ? {
        expectedVersion: plan.version,
        document: documentToSave
      } : {
        menuId,
        document: documentToSave
      });
      setPlan(p);
      setDocument(p.document);
      setDirty(false);
      setNotice(`Plan saved · version ${p.version}. Missing ingredients updated.`);
      setListing(await api<Listing>(''));
      await load(p.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function repeat() {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      const p = await api<Plan>(`/${plan.id}/repeat`, 'POST', {
        expectedVersion: plan.version,
        serviceAt: new Date(repeatAt).toISOString()
      });
      setListing(await api<Listing>(''));
      await load(p.id);
      setNotice('New daily plan saved. Enter fresh stock, yield and confirmed arrivals.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function procure() {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{
        reviewUrl: string;
      }>(`/${plan.id}/procurement`, 'POST', {
        expectedVersion: plan.version,
        deliveryDate,
        quoteDeadline: new Date(deadline).toISOString(),
        deliveryDetails: listing?.deliveryDetails
      });
      window.location.assign(result.reviewUrl);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return <main className={styles.workspace}>
    <header>
      <p className={styles.eyebrow}>Today · Daily planning</p>
      <h1>Plan meals</h1>
      <p>Choose meals and portions. Check stock. Buy what is missing.</p>
    </header>

    <nav className={styles.steps} aria-label="Planning steps">
      <a href="#planning-meals">1 · Meals &amp; portions</a>
      {document ? <a href="#planning-stock">2 · Stock</a> : <span>2 · Stock</span>}
      {plan ? <a href="#planning-review">3 · Missing ingredients</a> : <span>3 · Missing ingredients</span>}
    </nav>

    {error && <p ref={errorMessage} tabIndex={-1} role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}

    {!listing ? <p>Loading saved plans and approved menus…</p> : <>
      <section id="planning-meals" aria-labelledby="planning-meals-title">
        <h2 id="planning-meals-title">1. Choose meals &amp; portions</h2>
        <div className={styles.grid}>
          <label>Start from an approved menu
            <select disabled={busy} value={menuId} onChange={e => selectMenu(e.target.value)}><option value="">Select an approved menu</option>{listing.menus.map(m => <option key={m.id} value={m.id}>{m.name} · v{m.version}</option>)}</select>
          </label>
          <label>Saved plan
            <select disabled={busy} value={plan?.id ?? ''} onChange={e => void load(e.target.value)}><option value="" disabled>Select a saved plan</option>{listing.plans.map(p => <option key={p.id} value={p.id}>{p.name} · v{p.version} · {new Date(p.serviceAt).toLocaleDateString()}</option>)}</select>
          </label>
        </div>
        {listing.menus.length === 0 && <p><Link href="/menus">Approve a menu</Link> to start a plan.</p>}
      </section>

      {document && snapshot && <>
        {plan?.requestId && <p className={styles.notice}>This plan has a purchase draft. Repeat it below to plan another day.</p>}
        <fieldset disabled={busy || !!plan?.requestId}>
          <legend>Meals, portions and stock</legend>
          <div className={styles.grid}>
            <label>Plan name
              <input value={document.name} onChange={e => edit({ ...document, name: e.target.value })} />
            </label>
            <label>Service date and time (local time)
              <input type="datetime-local" value={localTime(document.serviceAt)} onChange={e => edit({
                ...document,
                serviceAt: e.target.value ? new Date(e.target.value).toISOString() : ''
              })} />
            </label>
          </div>
          <p>Set portions to 0 to skip a dish. For each selected dish, enter the servings one recipe batch makes.</p>
          <div className={styles.dishList}>
            {document.dishes.map((d, n) => {
              const dish = snapshot.dishes.find(s => s.id === d.dishId);
              return <article className={styles.dish} key={d.dishId}>
                <h3>{dish?.name}</h3>
                <div className={styles.grid}>
                  <label>Desired portions
                    <input aria-label={`Desired portions for ${d.dishId}`} inputMode="decimal" value={d.portions} onChange={e => edit({
                      ...document,
                      dishes: document.dishes.map((r, i) => i === n ? { ...r, portions: e.target.value } : r)
                    })} />
                  </label>
                  <label>Servings per recipe batch
                    <input aria-label={`Batch servings for ${d.dishId}`} inputMode="decimal" placeholder="Required for selected dishes" value={d.batchServings} onChange={e => edit({
                      ...document,
                      dishes: document.dishes.map((r, i) => i === n ? { ...r, batchServings: e.target.value } : r)
                    })} />
                  </label>
                </div>
                <details>
                  <summary>Recipe quantities · {dish?.name}</summary>
                  <p>Usable ingredients for one batch. These are not assumed to be per portion.</p>
                  {dish?.ingredients.map(i => <p key={i.id}>{i.name}: {i.quantity} {i.unit}</p>)}
                </details>
              </article>;
            })}
          </div>
          <a className={styles.nextLink} href="#planning-stock">Next: check stock →</a>

          <section id="planning-stock" aria-labelledby="planning-stock-title">
            <h2 id="planning-stock-title">2. Check stock</h2>
            <p>Enter usable stock, including 0 when empty. Yield is the % usable after preparation. Enter 100 only when there is no preparation loss.</p>
            {document.inventory.map((stock, n) => {
              const change = (next: typeof stock) => edit({
                ...document,
                inventory: document.inventory.map((s, i) => i === n ? next : s)
              });
              const name = snapshot.dishes.flatMap(d => d.ingredients).find(i => i.itemKey === stock.itemKey)?.name ?? stock.itemKey;
              return <div className={styles.stockRow} key={stock.itemKey} role="group" aria-label={`${name} stock`}>
                <h3>{name}</h3>
                <div className={styles.grid}>
                  <label>Current usable stock
                    <input inputMode="decimal" value={stock.stock} onChange={e => change({ ...stock, stock: e.target.value })} />
                  </label>
                  <label>Unit
                    <select value={stock.unit} onChange={e => change({ ...stock, unit: e.target.value })}>{['KILOGRAM', 'GRAM', 'LITRE', 'MILLILITRE', 'PIECE', 'PACK', 'CASE', 'CRATE'].map(u => <option key={u}>{u}</option>)}</select>
                  </label>
                  <label>Usable yield %
                    <input inputMode="decimal" value={stock.yieldPercent} onChange={e => change({ ...stock, yieldPercent: e.target.value })} />
                  </label>
                </div>
                {stock.incoming.map((arrival, j) => {
                  const update = (next: typeof arrival) => change({
                    ...stock,
                    incoming: stock.incoming.map((a, k) => k === j ? next : a)
                  });
                  return <div key={j} className={styles.arrival}>
                    <label>Confirmed usable incoming quantity
                      <input value={arrival.quantity} inputMode="decimal" onChange={e => update({ ...arrival, quantity: e.target.value })} />
                    </label>
                    <label>Confirmed arrival time
                      <input type="datetime-local" value={localTime(arrival.arrivesAt)} onChange={e => update({
                        ...arrival,
                        arrivesAt: e.target.value ? new Date(e.target.value).toISOString() : ''
                      })} />
                    </label>
                    <label>Confirmation evidence
                      <input placeholder="Supplier, reference or call details" value={arrival.evidence} onChange={e => update({ ...arrival, evidence: e.target.value })} />
                    </label>
                    <button className={styles.secondaryButton} type="button" onClick={() => change({
                      ...stock,
                      incoming: stock.incoming.filter((_, k) => k !== j)
                    })}>Remove arrival</button>
                  </div>;
                })}
                <button className={styles.secondaryButton} type="button" onClick={() => change({
                  ...stock,
                  incoming: [...stock.incoming, { quantity: '', arrivesAt: '', confirmed: true, evidence: '' }]
                })}>Add confirmed arrival</button>
              </div>;
            })}
            <p>Only confirmed deliveries arriving by service time count as stock.</p>
          </section>
          <button type="button" disabled={!dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save and check missing ingredients'}</button>
        </fieldset>

        {plan && <div id="planning-review">
          <p className={styles.savedVersion}>Saved version {plan.version}{dirty ? ' — save your changes to update these results' : ''}</p>
          <PlanningSummary readiness={plan.readiness} />
          <section aria-labelledby="planning-buy-title">
            <h2 id="planning-buy-title">Buy missing ingredients</h2>
            {plan.requestId ? <Link className={styles.nextLink} href={`/procurement/${plan.requestId}`}>Review purchase draft →</Link> : <>
              <p>Create a draft for shortages. Review suppliers before sending.</p>
              {dirty && <p className={styles.notice}>Save your changes above before creating a draft.</p>}
              {plan.readiness.ready && <p className={styles.notice}>You have enough usable stock. No purchase is needed.</p>}
              {plan.readiness.ingredients.some(i => i.blocked) && <p className={styles.error}>Resolve the stock, yield or recipe issues above before buying.</p>}
              <div className={styles.grid}>
                <label>Required delivery date
                  <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
                </label>
                <label>Quote deadline (local time)
                  <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
                </label>
              </div>
              <p>Delivery to: {listing.deliveryDetails?.addressLine}, {listing.deliveryDetails?.city}, {listing.deliveryDetails?.pin}. <Link href="/settings">Edit delivery address</Link></p>
              <button disabled={busy || dirty || plan.readiness.ready || plan.readiness.ingredients.some(i => i.blocked) || !deadline || !deliveryDate} onClick={() => void procure()}>Create purchase draft</button>
            </>}
          </section>
          <details>
            <summary>Supplier options to review</summary>
            <p>Suggestions only. Confirm specifications, price, quantity and delivery before ordering.</p>
            {plan.supplierOptions?.length ? plan.supplierOptions.map(s => <p key={s.id}><Link href="/suppliers">{s.businessName}</Link> — {s.evidence}</p>) : <p>No matching saved suppliers. Review sourcing in the purchase draft.</p>}
          </details>
          <section>
            <h2>Repeat for another day</h2>
            <p>Copies recipes and portions. Enter fresh stock, yields and arrivals for the new day; purchase links are cleared.</p>
            <label>New service date and time
              <input type="datetime-local" value={repeatAt} onChange={e => setRepeatAt(e.target.value)} />
            </label>
            <button className={styles.secondaryButton} disabled={busy || dirty || !repeatAt} onClick={() => void repeat()}>Repeat for another day</button>
          </section>
        </div>}
      </>}
    </>}
  </main>;
}
