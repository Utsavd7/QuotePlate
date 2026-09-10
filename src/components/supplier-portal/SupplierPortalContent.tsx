'use client';
import { useState, type FormEvent } from 'react';
import { formatInr } from '@/lib/domain/money';
import type { PortalAction, PortalOrder, SupplierPortalView } from '@/lib/supplier-portal/types';
import styles from './supplier-portal-public.module.css';
import { TradingProfileEditor } from './TradingProfile';

const needsResponse = (order: PortalOrder) => order.status === 'awaiting_quote' || (order.status === 'selected' && !order.acknowledgement) || Boolean(order.delivery && (!order.response || !order.responseIsCurrent));
const nextAction = (order: PortalOrder) => order.delivery && (!order.response || !order.responseIsCurrent) ? 'Check the delivery record and respond below.' : order.status === 'awaiting_quote' ? 'Open the restaurant’s quote link to send your prices.' : 'Check the quantities and confirm this order below.';

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
  {needsResponse(order) && <p className={styles.nextAction}>{nextAction(order)}</p>}
  <ul className={styles.items}>{order.items.map(item=><li key={item.itemId}><strong>{item.name}</strong><span>{item.quantity} {unit(item.unit)}{item.unitPricePaise !== undefined ? ` · ${money(item.unitPricePaise)} / ${unit(item.unit)}` : ''}</span></li>)}</ul>
  {(order.status === 'awaiting_quote' || order.status === 'pending') && <p className={styles.help}>Use the restaurant’s separate quote link to submit or revise prices while quoting is open.</p>}
  {order.status === 'closed' && <p className={styles.help}>This request is closed for you. Contact the restaurant if you need clarification.</p>}
  {order.acknowledgement && <p className={styles.record}><strong>{order.acknowledgement.status === 'confirmed' ? 'You confirmed this order' : 'You requested an order change'}</strong> · {date(order.acknowledgement.at)}{order.acknowledgement.note && <span>{order.acknowledgement.note}</span>}</p>}
  {order.status === 'selected' && <form onSubmit={submitAcknowledgement} aria-label={`Acknowledge ${order.title}`}>
   <fieldset disabled={busy}><legend>Can you supply this order?</legend>
    <label>Order response<select value={ack} onChange={event=>setAck(event.target.value as typeof ack)}><option value="confirmed">Confirm order</option><option value="needs_change">Request a change</option></select></label>
    <label>Note {ack === 'confirmed' ? '(optional)' : '(required)'}<textarea name="note" maxLength={1000} required={ack==='needs_change'} rows={2} /></label>
    <p className={styles.help}>Need different quantities or prices? Choose “Request a change” and explain what needs changing. The restaurant must agree to any changes.</p>
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
   {order.delivery.lines.length > 0 && <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Delivery quantities"><table role="table"><thead role="rowgroup"><tr role="row"><th>Ingredient</th><th>Ordered</th><th>Received</th><th>Rejected</th><th>Accepted</th><th>Still due</th><th>Billed quantity</th><th>Billed rate</th></tr></thead><tbody role="rowgroup">{order.delivery.lines.map(line=><tr role="row" key={line.itemId}><th role="rowheader" scope="row">{line.name}<small>{unit(line.unit)}</small></th><td role="cell" data-label="Ordered">{line.ordered}</td><td role="cell" data-label="Received">{line.received}</td><td role="cell" data-label="Rejected">{line.rejected}</td><td role="cell" data-label="Accepted">{line.accepted}</td><td role="cell" data-label="Still due">{line.outstanding}</td><td role="cell" data-label="Billed quantity">{line.billedQuantity ?? 'Not recorded'}</td><td role="cell" data-label="Billed rate">{line.billedUnitRatePaise != null ? money(line.billedUnitRatePaise) : 'Not recorded'}</td></tr>)}</tbody></table></div>}
   <dl className={styles.credits}><div><dt>Credit claimed</dt><dd>{money(order.delivery.credit.claimedPaise)}</dd></div><div><dt>Credit received</dt><dd>{money(order.delivery.credit.receivedPaise)}</dd></div><div><dt>Credit still owed</dt><dd>{money(order.delivery.credit.outstandingPaise)}</dd></div></dl>
   <p className={styles.help}>These amounts are recorded by the restaurant; they are not bank-verified payments.</p>
   {order.delivery.settlementNote && <p className={styles.record}>Settlement reference: {order.delivery.settlementNote}</p>}
   {order.delivery.notes && <p className={styles.record}>{order.delivery.notes}</p>}
   {order.response && <div className={styles.record}><strong>{order.responseIsCurrent ? (order.response.decision === 'agree' ? 'You agreed with this record' : 'You disputed this record') : 'Delivery record changed — review and respond again'}</strong><p>{order.response.note || 'No note added.'}</p>{order.response.evidenceReference && <p>Reference: {order.response.evidenceReference}</p>}<small>Response saved {date(order.response.at)}</small></div>}
   <form onSubmit={submitDelivery} aria-label={`Respond to delivery for ${order.title}`}><fieldset disabled={busy}><legend>Your delivery response</legend>
    <label>Decision<select value={decision} onChange={event=>setDecision(event.target.value as typeof decision)}><option value="agree">Agree with delivery</option><option value="dispute">Dispute this record</option></select></label>
    <label>Explanation {decision === 'dispute' ? '(required)' : '(optional)'}<textarea name="note" rows={3} maxLength={1000} required={decision==='dispute'} /></label>
    <details className={styles.optional}><summary>Add an invoice or delivery reference (optional)</summary><label>Evidence reference (optional)<input name="evidenceReference" maxLength={200} placeholder="Delivery note, invoice or credit note number" /></label></details>
    <p className={styles.help}>The restaurant can see your response and correct its check. Both sides’ records are kept; this does not settle or transfer money.</p>
    <button type="submit">{busy ? 'Saving…' : 'Save delivery response'}</button>
   </fieldset></form>
  </section>}
 </article>;
}

export function SupplierPortalContent({view,busy,onSubmit}: {view:SupplierPortalView;busy:boolean;onSubmit:(action:PortalAction)=>Promise<void>}) {
 const actionOrders = view.orders.filter(needsResponse);
 const currentOrders = view.orders.filter(order => !needsResponse(order) && order.status !== 'closed');
 const historyOrders = view.orders.filter(order => !needsResponse(order) && order.status === 'closed');
 return <>
  <header className={styles.intro}><p className={styles.eyebrow}>Your restaurant connection</p><h1>{view.restaurantName}</h1><p>Orders and delivery records for <strong>{view.supplierName}</strong>.</p><p className={styles.help}>This private link expires {date(view.expiresAt)}. Keep it with your team.</p></header>
  <TradingProfileEditor key={view.portalId} initialProfile={view.tradingProfile} initialBusinessDetails={view.businessDetails} portalId={view.portalId} disabled={busy} />
  <section aria-labelledby="supplier-orders-title">
   <h2 id="supplier-orders-title" tabIndex={-1}>Needs your response</h2>
   <p className={styles.help}>Send prices, confirm orders and check deliveries here. Other suppliers’ quotes and orders stay private.</p>
   {actionOrders.length ? actionOrders.map(order => <Order key={`${order.requestId}-${order.version}-${order.delivery?.fingerprint ?? ''}`} order={order} busy={busy} onSubmit={onSubmit} />) : <p className={styles.empty}>Nothing needs your response right now. Your orders and history are below.</p>}
  </section>
  {currentOrders.length > 0 && <section className={styles.currentOrders} aria-labelledby="current-orders-title">
   <h2 id="current-orders-title">Your current orders</h2>
   <p className={styles.help}>Check an order or update a response you have already sent.</p>
   {currentOrders.map(order => <details open={Boolean(order.acknowledgement || order.response)} key={`${order.requestId}-${order.version}-${order.delivery?.fingerprint ?? ''}`} className={styles.historyOrder}>
    <summary><span>{order.title}</span><span>{statuses[order.status]} · {date(order.deliveryDate)}</span></summary>
    <Order order={order} busy={busy} onSubmit={onSubmit} />
   </details>)}
  </section>}
  <details className={styles.secondary}>
   <summary>Order history ({historyOrders.length})</summary>
   <p className={styles.help}>Your latest 30 requests appear on this page. Open an order to check its details or update your response.</p>
   {historyOrders.map(order => <details key={`${order.requestId}-${order.version}-${order.delivery?.fingerprint ?? ''}`} className={styles.historyOrder}>
    <summary><span>{order.title}</span><span>{statuses[order.status]} · {date(order.deliveryDate)}</span></summary>
    <Order order={order} busy={busy} onSubmit={onSubmit} />
   </details>)}
   {!historyOrders.length && <p className={styles.help}>No closed orders yet.</p>}
  </details>
  <details className={styles.secondary}>
   <summary>Upcoming ingredient estimates ({view.forecasts.length})</summary>
  <section className={styles.forecasts} aria-labelledby="supplier-forecast-title"><h2 id="supplier-forecast-title">Upcoming ingredient estimates</h2><p className={styles.help}>Estimate only — these are not confirmed orders or instructions to deliver. The restaurant chose these quantities to help you plan availability.</p>{view.forecasts.length ? view.forecasts.map(forecast=><article key={forecast.id} className={styles.order}><header className={styles.orderHeader}><h3>Service {date(forecast.serviceAt)}</h3><span className={styles.badge}>{forecast.stale ? 'Outdated — ask for an update' : 'Estimate only'}</span></header><ul className={styles.items}>{forecast.items.map(item=><li key={item.itemKey}><div><strong>{item.name}</strong>{item.specification && <small>{item.specification}</small>}</div><span>{item.quantity} {unit(item.unit)}</span></li>)}</ul><p className={styles.help}>Shared {date(forecast.sharedAt)}. Confirm quantities with the restaurant before reserving stock.</p></article>) : <p className={styles.empty}>The restaurant has not shared upcoming demand with you.</p>}</section>
  </details>
 </>;
}
