'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatInr } from '@/lib/domain/money';
import type { SupplierPerformanceReport } from '@/lib/reporting/supplier-performance-service';
import styles from './supplier-performance.module.css';

const unitNames: Record<string, string> = { KILOGRAM: 'kg', GRAM: 'g', LITRE: 'l', MILLILITRE: 'ml', PIECE: 'pieces', PACK: 'packs', CASE: 'cases', CRATE: 'crates' };

export function SupplierPerformanceWorkspace({ initialData }: { initialData?: SupplierPerformanceReport }) {
  const [data, setData] = useState(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (initialData && refresh === 0) return;
    const controller = new AbortController();
    fetch('/api/supplier-performance', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('We could not load supplier performance. Please try again.');
      const report = await response.json() as SupplierPerformanceReport;
      if (!controller.signal.aborted) setData(report);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'We could not load supplier performance.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialData, refresh]);
  const totals = data?.suppliers.reduce((sum, supplier) => ({
    checked: sum.checked + supplier.checkedDeliveries,
    claimed: sum.claimed + BigInt(supplier.creditClaimedPaise),
    settled: sum.settled + BigInt(supplier.creditReceivedPaise),
    outstanding: sum.outstanding + BigInt(supplier.creditOutstandingPaise),
  }), { checked: 0, claimed: BigInt(0), settled: BigInt(0), outstanding: BigInt(0) });

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p>Learn from every delivery</p><h1>Supplier performance</h1><span>Compare what arrived, what was accepted, and which credits are still owed.</span></div>
      <button type="button" disabled={loading} onClick={() => { setLoading(true); setError(''); setRefresh((value) => value + 1); }}>{loading ? 'Loading…' : 'Refresh'}</button>
    </header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading && !data && <p role="status">Loading delivery records…</p>}
    {data && totals && <>
      <section className={styles.metrics} aria-label="Delivery and credit summary">
        <article><span>Deliveries checked</span><strong>{totals.checked}</strong></article>
        <article><span>Credits claimed</span><strong>{formatInr(totals.claimed.toString())}</strong></article>
        <article><span>Credits received</span><strong>{formatInr(totals.settled.toString())}</strong></article>
        <article><span>Still owed</span><strong>{formatInr(totals.outstanding.toString())}</strong></article>
      </section>
      <p className={styles.scope}>{data.capped ? 'Latest 100 purchase awards' : `${data.awardSampleSize} purchase awards`} · Your restaurant’s recorded evidence. Credits received are recorded settlements, not verified bank payments.</p>
      {data.suppliers.length === 0 ? <section className={styles.card}><h2>Record your first delivery</h2><p>Check an awarded purchase to start building a supplier record.</p><Link href="/procurement">Open purchases</Link></section> : data.suppliers.map((supplier) => <section key={supplier.supplierId} className={styles.card}>
        <div className={styles.supplierHeader}><h2>{supplier.supplierName}</h2><span>{supplier.evidence === 'ESTABLISHED' ? `${supplier.datedDeliveries} dated deliveries` : 'Not enough dated deliveries'}</span></div>
        <dl className={styles.facts}>
          <div><dt>On-time delivery</dt><dd>{supplier.onTimePercent === null ? 'Not measured' : `${supplier.onTimePercent}%`}<small>{supplier.onTimeDeliveries} of {supplier.datedDeliveries} dated, completed deliveries</small></dd></div>
          <div><dt>Recorded problems</dt><dd>{supplier.problemDeliveries}<small>{supplier.checkedDeliveries} checked; {supplier.awardedDeliveries - supplier.checkedDeliveries} unchecked; {supplier.partialDeliveries} partial</small></dd></div>
          <div><dt>Credits still owed</dt><dd>{formatInr(supplier.creditOutstandingPaise)}<small>{formatInr(supplier.creditReceivedPaise)} received of {formatInr(supplier.creditClaimedPaise)} claimed</small></dd></div>
        </dl>
        {supplier.items.length === 0 ? <p>No item quantities recorded. Open a purchase and add item-level receiving details.</p> : <div className={styles.tableWrap} role="region" aria-label={`${supplier.supplierName} ingredient performance`} tabIndex={0}>
          <table><thead><tr><th>Ingredient</th><th>Ordered</th><th>Accepted</th><th>Fulfilment</th><th>Rejected</th><th>Checks</th></tr></thead>
            <tbody>{supplier.items.map((item) => <tr key={`${item.itemKey}:${item.unit}:${item.specificationKey}`}><td>{item.itemName}<small>{unitNames[item.unit] ?? item.unit}</small></td><td>{item.orderedQuantity}</td><td>{item.acceptedQuantity}</td><td>{item.fulfillmentPercent ?? '—'}{item.fulfillmentPercent !== null ? '%' : ''}</td><td>{item.rejectionPercent ?? '—'}{item.rejectionPercent !== null ? '%' : ''}</td><td>{item.observations}</td></tr>)}</tbody>
          </table>
        </div>}
        <details><summary>Recent delivery evidence</summary>{supplier.recentDeliveries.length ? <ul>{supplier.recentDeliveries.map((delivery) => <li key={delivery.awardId}><Link href={`/procurement/${encodeURIComponent(delivery.requestId)}`}>Review purchase</Link><span>Promised {delivery.promisedDate} · {delivery.actualDeliveryDate ? `Arrived ${delivery.actualDeliveryDate}` : 'Arrival date not recorded'} · {delivery.complete ? 'Complete' : 'Partial'}</span></li>)}</ul> : <p>No delivery checks recorded yet.</p>}</details>
      </section>)}
      <aside className={styles.method}><h2>How to read these numbers</h2>{data.notes.map((note) => <p key={note}>{note}</p>)}</aside>
    </>}
  </main>;
}
