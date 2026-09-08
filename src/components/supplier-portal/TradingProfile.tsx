'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { tradingProfileIsStale, type TradingProfile, type TradingProfileInput } from '@/lib/trading-profile/types';
import type { SupplierPortalView } from '@/lib/supplier-portal/types';
import styles from './supplier-portal-public.module.css';

export function TradingProfileReadView({ profile }: { profile?: TradingProfile | null }) {
 return <section className={styles.order} aria-label="Supplier trading profile">
  <h2>Trading profile</h2><p className={styles.help}>Supplier-declared · not verified. Confirm terms and availability before ordering. Unknown values do not imply eligibility or coverage.</p>
  {!profile ? <p>No trading profile declared. Wholesale supply, service PINs and order terms are unknown.</p> : <>
   <p>{tradingProfileIsStale(profile) ? 'Stale — last confirmed 30 or more days ago. Ask the supplier to reconfirm.' : 'Last confirmed within 30 days.'} Updated {new Date(profile.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.</p>
   <dl><dt>Wholesale supply</dt><dd>{{ yes: 'Yes', no: 'No', unknown: 'Unknown' }[profile.wholesale]}</dd>
    <dt>Served PINs</dt><dd>{profile.servedPins.join(', ') || 'Unknown'}</dd>
    <dt>Minimum order (INR)</dt><dd>{profile.minimumOrderInr === null ? 'Unknown' : `₹${profile.minimumOrderInr}`}</dd>
    <dt>Local order cutoff (IST)</dt><dd>{profile.orderCutoffIst ?? 'Unknown'}</dd>
    <dt>Lead time</dt><dd>{profile.leadTimeDays === null ? 'Unknown' : `${profile.leadTimeDays} days`}</dd>
    <dt>Supplier note</dt><dd>{profile.note ?? 'None declared'}</dd></dl>
  </>}
 </section>;
}

export function TradingProfileEditor({ initialProfile, portalId, disabled }: { initialProfile?: TradingProfile | null; portalId: string; disabled: boolean }) {
 const [profile, setProfile] = useState(initialProfile ?? null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const lock = useRef(false);
 const feedback = useRef<HTMLParagraphElement>(null);
 useEffect(() => {
  if (!error && !notice) return;
  let parent = feedback.current?.parentElement;
  while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
  feedback.current?.focus();
 }, [error, notice]);
 async function responseView(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || 'Unable to save trading profile.');
  const view = body as SupplierPortalView;
  if (view.portalId !== portalId) throw new Error('Supplier workspace changed. Reload the page before editing.');
  return view;
 }
 async function reload() {
  if (lock.current) return;
  lock.current = true; setBusy(true); setError(''); setNotice('');
  try { const view = await responseView(await fetch('/api/public/supplier-portal', { cache: 'no-store' })); setProfile(view.tradingProfile ?? null); setNotice('Latest profile loaded. Review before saving.'); }
  catch(e) { setError((e as Error).message); }
  finally { lock.current = false; setBusy(false); }
 }
 async function save(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); if (lock.current) return;
  const data = new FormData(event.currentTarget);
  const value = (key: string) => String(data.get(key) ?? '').trim();
  const input: TradingProfileInput = { wholesale: value('wholesale') as TradingProfileInput['wholesale'], servedPins: value('servedPins') ? value('servedPins').split(/[\s,]+/) : [], minimumOrderInr: value('minimumOrderInr') || null, orderCutoffIst: value('orderCutoffIst') || null, leadTimeDays: value('leadTimeDays') ? Number(value('leadTimeDays')) : null, note: value('note') || null };
  lock.current = true; setBusy(true); setError(''); setNotice('');
  try {
   const view = await responseView(await fetch('/api/public/supplier-portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'trading-profile', portalId, expectedRevision: profile?.revision ?? 0, profile: input }) }));
   setProfile(view.tradingProfile ?? null); setNotice('Trading profile confirmed and saved.');
  } catch(e) { setError((e as Error).message); }
  finally { lock.current = false; setBusy(false); }
 }
 return <>
  <TradingProfileReadView profile={profile} />
  <form className={styles.order} onSubmit={save} aria-label="Edit trading profile" key={profile?.revision ?? 0}>
   <fieldset disabled={disabled || busy}><legend>Your delivery areas and order terms</legend>
    <p className={styles.help}>These details help the restaurant plan orders. Leave anything you do not know blank. Saving confirms all your details again.</p>
    <label>Wholesale supply<select name="wholesale" defaultValue={profile?.wholesale ?? 'unknown'}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
    <label>Delivery PIN codes (up to 100, optional)<textarea name="servedPins" maxLength={799} rows={3} defaultValue={profile?.servedPins.join(', ') ?? ''} placeholder="400001, 400002" /></label>
    <label>Minimum order (INR, optional)<input name="minimumOrderInr" inputMode="decimal" maxLength={12} pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?" defaultValue={profile?.minimumOrderInr ?? ''} /></label>
    <label>Order by this time (HH:mm IST, optional)<input name="orderCutoffIst" type="time" defaultValue={profile?.orderCutoffIst ?? ''} /></label>
    <label>Days needed before delivery (whole days, optional)<input name="leadTimeDays" type="number" min={0} max={365} step={1} defaultValue={profile?.leadTimeDays ?? ''} /></label>
    <label>Supplier note (optional)<input name="note" maxLength={500} defaultValue={profile?.note ?? ''} /></label>
    <button type="submit">{busy ? 'Saving…' : 'Save business details'}</button>
    <button type="button" onClick={() => void reload()}>Load latest saved details</button>
   </fieldset>
  </form>
  {error && <p className={styles.error} ref={feedback} tabIndex={-1} role="alert">{error} Check your details or load the latest saved details before trying again.</p>}{notice && <p className={styles.notice} ref={feedback} tabIndex={-1} role="status">{notice}</p>}
 </>;
}
