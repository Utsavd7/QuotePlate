'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { PROCUREMENT_CATEGORIES, type ProcurementCategory } from '@/lib/domain/procurement-categories';
import { SupplierValidationError, validateSupplierUpdateInput } from '@/lib/suppliers/supplier-schema';
import { tradingProfileIsStale as businessDetailsAreStale, type SupplierBusinessDetails, type TradingProfile, type TradingProfileInput } from '@/lib/trading-profile/types';
import type { SupplierPortalView } from '@/lib/supplier-portal/types';
import styles from './supplier-portal-public.module.css';

const confirmedDate = (value: string) => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
const businessConfirmedAt = (profile: TradingProfile) => profile.businessDetailsConfirmedAt ?? profile.updatedAt;
// Delivery terms are dated independently from the business confirmation.
const deliveryTermsAreStale = (profile: TradingProfile, now = new Date()) => now.getTime() - Date.parse(profile.updatedAt) >= 30 * 86400000;

export function TradingProfileReadView({ profile }: { profile?: TradingProfile | null }) {
 return <section className={styles.order} aria-label="Supplier trading profile">
  <h2>Trading profile</h2>
  <p className={styles.help}>Supplier-declared · not verified. Confirm terms and availability before ordering. Unknown values do not imply eligibility or coverage.</p>
  {!profile ? <p>No trading profile declared. Wholesale supply, service PINs and order terms are unknown.</p> : <>
   {profile.businessDetails ? <>
   <p>Contact details and products · Supplier-declared on <time aria-label="Business details confirmed" dateTime={businessConfirmedAt(profile)}>{confirmedDate(businessConfirmedAt(profile))} IST</time>. {businessDetailsAreStale(profile) ? 'Stale — business details were last confirmed 30 or more days ago. Ask the supplier to reconfirm.' : 'Business details confirmed within 30 days.'}</p>
   <dl className={styles.profileSummary}>
    <div><dt>Contact name</dt><dd>{profile.businessDetails.contactName || 'Not provided'}</dd></div>
    <div><dt>Phone number</dt><dd>{profile.businessDetails.phone || 'Not provided'}</dd></div>
    <div><dt>WhatsApp number</dt><dd>{profile.businessDetails.whatsappNumber || 'Not provided'}</dd></div>
    <div><dt>Email address</dt><dd>{profile.businessDetails.email || 'Not provided'}</dd></div>
    <div className={styles.profileSummaryWide}><dt>Product categories</dt><dd>{profile.businessDetails.categories.map(category => PROCUREMENT_CATEGORIES[category]).join(', ') || 'Not provided'}</dd></div>
   </dl></> : <p className={styles.help}>Contact details and product categories have not been confirmed yet. Your saved delivery terms are below.</p>}
   <p>Delivery terms · Supplier-declared on <time aria-label="Delivery terms confirmed" dateTime={profile.updatedAt}>{confirmedDate(profile.updatedAt)} IST</time>. {deliveryTermsAreStale(profile) ? 'Stale — delivery terms were last confirmed 30 or more days ago. Ask the supplier to reconfirm.' : 'Delivery terms confirmed within 30 days.'}</p>
   <dl className={styles.profileSummary}>
    <div><dt>Wholesale supply</dt><dd>{{ yes: 'Yes', no: 'No', unknown: 'Unknown' }[profile.wholesale]}</dd></div>
    <div><dt>Served PINs</dt><dd>{profile.servedPins.join(', ') || 'Unknown'}</dd></div>
    <div><dt>Minimum order (INR)</dt><dd>{profile.minimumOrderInr === null ? 'Unknown' : `₹${profile.minimumOrderInr}`}</dd></div>
    <div><dt>Local order cutoff (IST)</dt><dd>{profile.orderCutoffIst ?? 'Unknown'}</dd></div>
    <div><dt>Lead time</dt><dd>{profile.leadTimeDays === null ? 'Unknown' : `${profile.leadTimeDays} days`}</dd></div>
    <div className={styles.profileSummaryWide}><dt>Supplier note</dt><dd>{profile.note ?? 'None declared'}</dd></div>
   </dl>
  </>}
 </section>;
}

type ProfileDraft = Omit<TradingProfileInput, 'businessDetails' | 'servedPins' | 'leadTimeDays'> & {
 businessDetails: SupplierBusinessDetails;
 servedPins: string;
 leadTimeDays: string;
};

function createDraft(profile?: TradingProfile | null, defaults?: SupplierBusinessDetails): ProfileDraft {
 return {
  businessDetails: profile?.businessDetails ?? defaults ?? { contactName: null, phone: null, whatsappNumber: null, email: null, categories: [] },
  wholesale: profile?.wholesale ?? 'unknown', servedPins: profile?.servedPins.join(', ') ?? '',
  minimumOrderInr: profile?.minimumOrderInr ?? null, orderCutoffIst: profile?.orderCutoffIst ?? null,
  leadTimeDays: profile?.leadTimeDays?.toString() ?? '', note: profile?.note ?? null,
 };
}

function businessDetails(draft: ProfileDraft): SupplierBusinessDetails {
 const { categories, ...contacts } = draft.businessDetails;
 const valid = validateSupplierUpdateInput(contacts);
 if (!valid.phone && !valid.whatsappNumber && !valid.email) throw new Error('Add at least one phone number, WhatsApp number or email address.');
 if (!categories.length) throw new Error('Choose at least one product category.');
 return { contactName: valid.contactName ?? null, phone: valid.phone ?? null, whatsappNumber: valid.whatsappNumber ?? null, email: valid.email ?? null, categories };
}

const errorMessage = (error: unknown) => error instanceof SupplierValidationError
 ? Object.values(error.errors).flat().join(' ')
 : error instanceof Error ? error.message : 'Unable to save business details. Please try again.';

export function TradingProfileEditor({ initialProfile, initialBusinessDetails, portalId, disabled }: {
 initialProfile?: TradingProfile | null;
 initialBusinessDetails?: SupplierBusinessDetails;
 portalId: string;
 disabled: boolean;
}) {
 const [localProfile, setLocalProfile] = useState(initialProfile ?? null);
 // Parent refreshes update the saved summary without replacing an open draft or
 // rolling a successful child save back to an older parent snapshot.
 const profile = (initialProfile?.revision ?? 0) > (localProfile?.revision ?? 0) ? initialProfile! : localProfile;
 const [defaults, setDefaults] = useState(initialBusinessDetails);
 const [draft, setDraft] = useState(() => createDraft(initialProfile, initialBusinessDetails));
 const [expectedRevision, setExpectedRevision] = useState(initialProfile?.revision ?? 0);
 const [editing, setEditing] = useState(false);
 const [step, setStep] = useState<1 | 2>(1);
 const [operation, setOperation] = useState<'saving' | 'loading' | null>(null);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const [reviewLatest, setReviewLatest] = useState(false);
 const [latestLoaded, setLatestLoaded] = useState(false);
 const [conflict, setConflict] = useState(false);
 const lock = useRef(false);
 const feedback = useRef<HTMLParagraphElement>(null);
 const stepHeading = useRef<HTMLHeadingElement>(null);
 const editorId = useId();
 const busy = disabled || operation !== null;
 const needsConfirmation = !profile?.businessDetails || businessDetailsAreStale(profile);
 const changed = editing && (profile?.revision ?? 0) !== expectedRevision;

 useEffect(() => { if (error || notice) feedback.current?.focus(); }, [error, notice]);
 useEffect(() => { if (editing) stepHeading.current?.focus(); }, [editing, step]);

 function update<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
  setDraft(current => ({ ...current, [key]: value }));
 }
 function updateContact(key: 'contactName' | 'phone' | 'whatsappNumber' | 'email', value: string) {
  setDraft(current => ({ ...current, businessDetails: { ...current.businessDetails, [key]: value } }));
 }
 function toggleCategory(category: ProcurementCategory, checked: boolean) {
  setDraft(current => ({ ...current, businessDetails: { ...current.businessDetails, categories: checked ? [...current.businessDetails.categories, category] : current.businessDetails.categories.filter(value => value !== category) } }));
 }
 function edit() {
  setDraft(createDraft(profile, defaults ?? initialBusinessDetails)); setExpectedRevision(profile?.revision ?? 0);
  setStep(1); setEditing(true); setError(''); setNotice(''); setLatestLoaded(false); setConflict(false);
 }
 async function responseView(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
   if (response.status === 409) setConflict(true);
   throw new Error(body?.detail || 'Unable to save business details. Please try again.');
  }
  if (!body || body.portalId !== portalId) throw new Error('Supplier workspace changed. Reopen the correct private link before editing.');
  return body as SupplierPortalView;
 }
 async function reload() {
  if (lock.current || disabled) return;
  lock.current = true; setOperation('loading'); setError(''); setNotice('');
  try {
   const view = await responseView(await fetch('/api/public/supplier-portal', { cache: 'no-store', credentials: 'same-origin' }));
   setLocalProfile(view.tradingProfile ?? null); setDefaults(view.businessDetails); setReviewLatest(true); setLatestLoaded(true);
   setNotice('Latest saved details loaded. Your draft has been kept. Review the saved summary, then choose which details to use.');
  } catch (e) { setError(errorMessage(e)); }
  finally { lock.current = false; setOperation(null); }
 }
 function resolveDraft(useSaved: boolean) {
  if (useSaved) { setDraft(createDraft(profile, defaults ?? initialBusinessDetails)); setStep(1); }
  setExpectedRevision(profile?.revision ?? 0); setLatestLoaded(false); setConflict(false); setError('');
  setNotice(useSaved ? 'Your draft now uses the saved details. Review both steps before confirming.' : 'Your draft has been kept. Saving will replace the details shown in the saved summary.');
 }
 async function save(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); if (lock.current || disabled) return; setError('');
  if (step === 2 && (changed || conflict || latestLoaded)) {
   setError('Review the latest saved details and choose which details to use before saving.');
   return;
  }
  let contacts: SupplierBusinessDetails;
  try { contacts = businessDetails(draft); }
  catch (e) { setError(errorMessage(e)); return; }
  if (step === 1) { setStep(2); return; }
  const input: TradingProfileInput = {
   businessDetails: contacts, wholesale: draft.wholesale,
   servedPins: draft.servedPins.trim() ? draft.servedPins.trim().split(/[\s,]+/) : [],
   minimumOrderInr: draft.minimumOrderInr?.trim() || null, orderCutoffIst: draft.orderCutoffIst || null,
   leadTimeDays: draft.leadTimeDays ? Number(draft.leadTimeDays) : null, note: draft.note?.trim() || null,
  };
  lock.current = true; setOperation('saving'); setNotice('');
  try {
   const view = await responseView(await fetch('/api/public/supplier-portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'trading-profile', portalId, expectedRevision, profile: input }) }));
   if (!view.tradingProfile) throw new Error('Unable to confirm the saved details. Load the latest saved details before trying again.');
   setLocalProfile(view.tradingProfile); setExpectedRevision(view.tradingProfile.revision);
   setEditing(false); setReviewLatest(true); setLatestLoaded(false); setConflict(false);
   setNotice('Business details confirmed and saved. The restaurant can see your declaration below.');
  } catch (e) { setError(errorMessage(e)); }
  finally { lock.current = false; setOperation(null); }
 }

 return <section className={`${styles.order} ${styles.profileEditor}`} aria-labelledby={`${editorId}-title`}>
  <header className={styles.orderHeader}>
   <div><p className={styles.eyebrow}>Your business details</p><h2 id={`${editorId}-title`}>{needsConfirmation ? 'Confirm your business details' : 'Your confirmed business details'}</h2></div>
   <span className={styles.badge}>{!profile?.businessDetails ? 'Confirmation needed' : needsConfirmation ? 'Please reconfirm' : 'Supplier-confirmed'}</span>
  </header>
  <p className={styles.help}>Confirm your contact details, products and delivery terms for this restaurant. You can update them here anytime.</p>
  <p className={styles.help}>{profile?.businessDetails ? <>Business details · Supplier-declared on <time dateTime={businessConfirmedAt(profile)}>{confirmedDate(businessConfirmedAt(profile))} IST</time>.</> : 'We have prefilled the details this restaurant already has. Please check them before confirming.'} You can keep quoting and responding to orders below.</p>
  <div className={styles.profileActions}>
   {!editing && <button type="button" onClick={edit} disabled={busy} aria-expanded={editing} aria-controls={`${editorId}-form`}>{needsConfirmation ? 'Confirm business details' : 'Edit business details'}</button>}
   <a href="#supplier-orders-title">Go to orders and quotes</a>
  </div>
  {profile && <details className={styles.profileSaved} open={reviewLatest} onToggle={event => setReviewLatest(event.currentTarget.open)}>
   <summary>Current saved details</summary><TradingProfileReadView profile={profile} />
  </details>}
  {(error || notice) && <p ref={feedback} tabIndex={-1} role={error ? 'alert' : 'status'} className={error ? styles.error : styles.notice}>{error ? `${error} Your draft has been kept.` : notice}</p>}
  {editing && (changed || conflict || latestLoaded) && <div className={styles.record}>
   <p>{latestLoaded ? 'Review the current saved details above before continuing.' : 'The saved details changed while you were editing. Load the latest saved details to review them. Your draft is unchanged.'}</p>
   {latestLoaded && <div className={styles.profileActions}>
    <button type="button" disabled={busy} onClick={() => resolveDraft(true)}>Replace draft with saved details</button>
    <button type="button" disabled={busy} onClick={() => resolveDraft(false)}>Keep draft for next save</button>
   </div>}
  </div>}
  <form id={`${editorId}-form`} className={styles.profileForm} onSubmit={save} aria-label="Edit trading profile" hidden={!editing}>
   <p className={styles.eyebrow}>Step {step} of 2</p>
   <h3 ref={stepHeading} tabIndex={-1}>{step === 1 ? 'Contact details & products' : 'Delivery & order terms'}</h3>
   <fieldset disabled={busy || !editing || step !== 1} hidden={step !== 1}>
    <legend>How can the restaurant reach you?</legend>
    <p className={styles.help}>Provide at least one phone number, WhatsApp number or email address. Include the country code for numbers outside India.</p>
    <div className={styles.profileFields}>
     <label>Contact name (optional)<input name="contactName" autoComplete="name" maxLength={120} value={draft.businessDetails.contactName ?? ''} onChange={event => updateContact('contactName', event.target.value)} /></label>
     <label>Phone number<input name="phone" type="tel" autoComplete="tel" maxLength={40} value={draft.businessDetails.phone ?? ''} onChange={event => updateContact('phone', event.target.value)} /></label>
     <label>WhatsApp number<input name="whatsappNumber" type="tel" autoComplete="section-whatsapp tel" maxLength={40} value={draft.businessDetails.whatsappNumber ?? ''} onChange={event => updateContact('whatsappNumber', event.target.value)} /></label>
     <label>Email address<input name="email" type="email" autoComplete="email" maxLength={320} value={draft.businessDetails.email ?? ''} onChange={event => updateContact('email', event.target.value)} /></label>
    </div>
    <fieldset className={styles.profileCategories}>
     <legend>What do you supply? (choose at least one)</legend>
     <p className={styles.help}>{draft.businessDetails.categories.length} selected</p>
     <div className={styles.profileCategoryGrid}>{Object.entries(PROCUREMENT_CATEGORIES).map(([key, label]) => <label key={key} className={styles.profileCategory}>
      <input type="checkbox" name="categories" value={key} checked={draft.businessDetails.categories.includes(key as ProcurementCategory)} onChange={event => toggleCategory(key as ProcurementCategory, event.target.checked)} /><span>{label}</span>
     </label>)}</div>
    </fieldset>
    <button type="submit">Continue to delivery details</button>
   </fieldset>
   <fieldset disabled={busy || !editing || step !== 2} hidden={step !== 2}>
    <legend>Your delivery areas and order terms</legend>
    <p className={styles.help}>Leave optional terms blank if you do not know them. Saving confirms your contact details, categories and delivery terms together.</p>
    <label>Wholesale supply<select name="wholesale" value={draft.wholesale} onChange={event => update('wholesale', event.target.value as TradingProfileInput['wholesale'])}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
    <label>Delivery PIN codes (up to 100, optional)<textarea name="servedPins" maxLength={799} rows={3} value={draft.servedPins} onChange={event => update('servedPins', event.target.value)} placeholder="400001, 400002" /></label>
    <div className={styles.profileFields}>
     <label>Minimum order (INR, optional)<input name="minimumOrderInr" inputMode="decimal" maxLength={12} pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?" value={draft.minimumOrderInr ?? ''} onChange={event => update('minimumOrderInr', event.target.value)} /></label>
     <label>Order by this time (HH:mm IST, optional)<input name="orderCutoffIst" type="time" value={draft.orderCutoffIst ?? ''} onChange={event => update('orderCutoffIst', event.target.value)} /></label>
     <label>Days needed before delivery (whole days, optional)<input name="leadTimeDays" type="number" min={0} max={365} step={1} value={draft.leadTimeDays} onChange={event => update('leadTimeDays', event.target.value)} /></label>
    </div>
    <label>Supplier note (optional)<textarea name="note" maxLength={500} rows={2} value={draft.note ?? ''} onChange={event => update('note', event.target.value)} /></label>
    <p className={styles.help}>These are your declared business details for this restaurant. Saving does not send a message or change its address book.</p>
    <div className={styles.profileActions}>
     <button type="button" onClick={() => { setStep(1); setError(''); }}>Back to contacts and products</button>
     <button type="submit" disabled={changed || conflict || latestLoaded}>{operation === 'saving' ? 'Saving…' : 'Save business details'}</button>
    </div>
   </fieldset>
   <div className={styles.profileActions}>
    <button type="button" disabled={busy} onClick={() => void reload()}>{operation === 'loading' ? 'Loading…' : 'Load latest saved details'}</button>
   </div>
   <p className={styles.help}>Changes stay in this form until you save. Keep this page open to keep your draft.</p>
  </form>
 </section>;
}
