'use client';
import { useState, type FormEvent } from 'react';
import { formatInr } from '@/lib/domain/money';
import type { PortalAction, PortalOrder, SupplierPortalView } from '@/lib/supplier-portal/types';
import styles from './supplier-portal-public.module.css';

const statuses = { awaiting_quote: 'Awaiting your quote', pending: 'Decision pending', selected: 'Selected for purchase', closed: 'Closed' };
const date = (value: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(value));
const unit = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const money = formatInr;
const issueLabel = (value: string) => ({ LATE: 'Late delivery', MISSING_QUANTITY: 'Missing quantity', WRONG_ITEM: 'Wrong item', QUALITY: 'Quality issue', PRICE_DIFFERENCE: 'Price difference', OTHER: 'Other issue' }[value] ?? value);

function Order({ order, busy, onSubmit }: { order: PortalOrder; busy: boolean; onSubmit: (action: PortalAction) => Promise<void> }) {
 const [ack, setAck] = useState<'confirmed' | 'needs_change'>('confirmed');
 const [decision, setDecision] = useState<'agree' | 'dispute'>('agree');
 async function submitAcknowledgement(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const data = new FormData(event.currentTarget);
  await onSubmit({action:'acknowledge',requestId:order.requestId,expectedVersion:order.version,status:ack,note:String(data.get('note') ?? '')});
 }
 async function submitDelivery(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); if(!order.delivery) return; const data = new FormData(event.currentTarget);
  await onSubmit({action:'delivery-response',requestId:order.requestId,expectedVersion:order.version,fingerprint:order.delivery.fingerprint,decision,note:String(data.get('note') ?? ''),evidenceReference:String(data.get('evidenceReference') ?? '')});
 }
 return <article className={styles.order}>
  <header className={styles.orderHeader}><div><p className={styles.eyebrow}>Delivery {date(order.deliveryDate)}</p><h3>{order.title}</h3></div><span className={styles.badge}>{statuses[order.status]}</span></header>
  <ul className={styles.items}>{order.items.map(item=><li key={item.itemId}><strong>{item.name}</strong><span>{item.quantity} {unit(item.unit)}{item.unitPricePaise !== undefined ? ` · ${money(item.unitPricePaise)} / ${unit(item.unit)}` : ''}</span></li>)}</ul>
  {(order.status === 'awaiting_quote' || order.status === 'pending') && <p className={styles.help}>Use the restaurant’s separate quote link to submit or revise prices while quoting is open.</p>}
  {order.status === 'closed' && <p className={styles.help}>This request is closed for you. Contact the restaurant if you need clarification.</p>}
  {order.acknowledgement && <p className={styles.record}><strong>{order.acknowledgement.status === 'confirmed' ? 'You confirmed this order' : 'You requested an order change'}</strong> · {date(order.acknowledgement.at)}{order.acknowledgement.note && <span>{order.acknowledgement.note}</span>}</p>}
  {order.status === 'selected' && <form onSubmit={submitAcknowledgement} aria-label={`Acknowledge ${order.title}`}>
   <fieldset disabled={busy}><legend>Confirm the awarded quantities</legend>
    <label>Order response<select value={ack} onChange={event=>setAck(event.target.value as typeof ack)}><option value="confirmed">Confirm order</option><option value="needs_change">Request a change</option></select></label>
    <label>Note {ack === 'confirmed' ? '(optional)' : '(required)'}<textarea name="note" maxLength={1000} required={ack==='needs_change'} rows={2} /></label>
    <p className={styles.help}>Your response does not change the accepted prices or quantities. Agree any changes with the restaurant.</p>
    <button type="submit">{busy ? 'Saving…' : 'Save order response'}</button>
   </fieldset>
  </form>}
  {order.delivery && <section className={styles.delivery} aria-label={`Delivery check for ${order.title}`}>
   <h4>The restaurant’s delivery record</h4><p className={styles.help}>Checked {date(order.delivery.checkedAt)} · {unit(order.delivery.status)}</p>
   {order.delivery.actualDeliveryDate && <p className={styles.help}>Actual delivery: {date(order.delivery.actualDeliveryDate)}</p>}
   {(order.delivery.issueCodes?.length ?? 0) > 0 && <p className={styles.record}><strong>Recorded issues:</strong> {order.delivery.issueCodes!.map(issueLabel).join(' · ')}</p>}
   {(order.delivery.invoiceTotalPaise !== undefined || order.delivery.expectedTotalPaise !== undefined) && <dl className={styles.credits}>
    {order.delivery.expectedTotalPaise !== undefined && <div><dt>Accepted supplier total</dt><dd>{money(order.delivery.expectedTotalPaise)}</dd></div>}
    {order.delivery.invoiceTotalPaise !== undefined && <div><dt>Invoice recorded</dt><dd>{money(order.delivery.invoiceTotalPaise)}</dd></div>}
   </dl>}
   {order.delivery.lines.length > 0 && <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Delivery quantities"><table><thead><tr><th>Ingredient</th><th>Ordered</th><th>Received</th><th>Rejected</th><th>Accepted</th><th>Still due</th><th>Billed quantity</th><th>Billed rate</th></tr></thead><tbody>{order.delivery.lines.map(line=><tr key={line.itemId}><th scope="row">{line.name}<small>{unit(line.unit)}</small></th><td>{line.ordered}</td><td>{line.received}</td><td>{line.rejected}</td><td>{line.accepted}</td><td>{line.outstanding}</td><td>{line.billedQuantity ?? 'Not recorded'}</td><td>{line.billedUnitRatePaise != null ? money(line.billedUnitRatePaise) : 'Not recorded'}</td></tr>)}</tbody></table></div>}
   <dl className={styles.credits}><div><dt>Credit claimed</dt><dd>{money(order.delivery.credit.claimedPaise)}</dd></div><div><dt>Credit received</dt><dd>{money(order.delivery.credit.receivedPaise)}</dd></div><div><dt>Credit still owed</dt><dd>{money(order.delivery.credit.outstandingPaise)}</dd></div></dl>
   <p className={styles.help}>These amounts are recorded by the restaurant; they are not bank-verified payments.</p>
   {order.delivery.settlementNote && <p className={styles.record}>Settlement reference: {order.delivery.settlementNote}</p>}
   {order.delivery.notes && <p className={styles.record}>{order.delivery.notes}</p>}
   {order.response && <div className={styles.record}><strong>{order.responseIsCurrent ? (order.response.decision === 'agree' ? 'You agreed with this record' : 'You disputed this record') : 'Delivery record changed — review and respond again'}</strong><p>{order.response.note || 'No note added.'}</p>{order.response.evidenceReference && <p>Reference: {order.response.evidenceReference}</p>}<small>Response saved {date(order.response.at)}</small></div>}
   <form onSubmit={submitDelivery} aria-label={`Respond to delivery for ${order.title}`}><fieldset disabled={busy}><legend>Your delivery response</legend>
    <label>Decision<select value={decision} onChange={event=>setDecision(event.target.value as typeof decision)}><option value="agree">Agree with delivery</option><option value="dispute">Dispute this record</option></select></label>
    <label>Explanation {decision === 'dispute' ? '(required)' : '(optional)'}<textarea name="note" rows={3} maxLength={1000} required={decision==='dispute'} /></label>
    <label>Evidence reference (optional)<input name="evidenceReference" maxLength={200} placeholder="Delivery note, invoice or credit note number" /></label>
    <p className={styles.help}>The restaurant can see your response and correct its check. Both sides’ records are kept; this does not settle or transfer money.</p>
    <button type="submit">{busy ? 'Saving…' : 'Save delivery response'}</button>
   </fieldset></form>
  </section>}
 </article>;
}

export function SupplierPortalContent({view,busy,onSubmit}: {view:SupplierPortalView;busy:boolean;onSubmit:(action:PortalAction)=>Promise<void>}) {
 return <>
  <header className={styles.intro}><p className={styles.eyebrow}>Your restaurant connection</p><h1>{view.restaurantName}</h1><p>Orders and delivery records for <strong>{view.supplierName}</strong>.</p><p className={styles.help}>This private link expires {date(view.expiresAt)}. Keep it with your team.</p></header>
  <section aria-labelledby="supplier-orders-title"><h2 id="supplier-orders-title">Your orders</h2><p className={styles.help}>See your latest 30 requests and respond to awarded orders. Other suppliers’ quotes and orders stay private.</p>{view.orders.length ? view.orders.map(order=><Order key={`${order.requestId}-${order.version}-${order.delivery?.fingerprint ?? ''}`} order={order} busy={busy} onSubmit={onSubmit} />) : <p className={styles.empty}>No requests have been shared with you yet.</p>}</section>
  <section className={styles.forecasts} aria-labelledby="supplier-forecast-title"><h2 id="supplier-forecast-title">Upcoming ingredient estimates</h2><p className={styles.help}>Estimate only — these are not confirmed orders or instructions to deliver. The restaurant chose these quantities to help you plan availability.</p>{view.forecasts.length ? view.forecasts.map(forecast=><article key={forecast.id} className={styles.order}><header className={styles.orderHeader}><h3>Service {date(forecast.serviceAt)}</h3><span className={styles.badge}>{forecast.stale ? 'Outdated — ask for an update' : 'Estimate only'}</span></header><ul className={styles.items}>{forecast.items.map(item=><li key={item.itemKey}><div><strong>{item.name}</strong>{item.specification && <small>{item.specification}</small>}</div><span>{item.quantity} {unit(item.unit)}</span></li>)}</ul><p className={styles.help}>Shared {date(forecast.sharedAt)}. Confirm quantities with the restaurant before reserving stock.</p></article>) : <p className={styles.empty}>The restaurant has not shared upcoming demand with you.</p>}</section>
 </>;
}
