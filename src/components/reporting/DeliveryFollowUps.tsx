import Link from 'next/link';
import { formatInr } from '@/lib/domain/money';
import type { SupplierPerformance } from '@/lib/reporting/supplier-performance';
import styles from './supplier-performance.module.css';

export function DeliveryFollowUps({ suppliers }: { suppliers: SupplierPerformance[] }) {
  const rows = suppliers.flatMap((supplier) => supplier.followUps.map((entry) => ({ ...entry, supplierName: supplier.supplierName, supplierId: supplier.supplierId })))
    .sort((a, b) => a.promisedDate.localeCompare(b.promisedDate) || a.awardId.localeCompare(b.awardId) || a.supplierId.localeCompare(b.supplierId));
  if (!suppliers.length) return null;
  return <section className={styles.card} aria-labelledby="delivery-follow-ups">
    <h2 id="delivery-follow-ups">Needs your attention</h2>
    <p>{rows.length ? `${rows.length} deliveries need a check, missing items or a credit follow-up.` : 'No delivery or credit follow-ups in this report.'} Promised dates refer to delivery, not credit payment deadlines.</p>
    {rows.length > 0 && <ul className={styles.followUps}>{rows.map((row) => <li key={`${row.awardId}:${row.supplierId}`}>
      <div><strong>{row.supplierName}</strong><span>{row.reasons.join(' · ')}</span><span>Delivery promised {row.promisedDate}{row.checkedAt ? ` · Last checked ${row.checkedAt.slice(0, 10)}` : ''}</span></div>
      <div>{BigInt(row.creditOutstandingPaise) > BigInt(0) && <strong>{formatInr(row.creditOutstandingPaise)} owed</strong>}<Link href={`/procurement/${encodeURIComponent(row.requestId)}`}>Review purchase<span className={styles.srOnly}> for {row.supplierName}, promised {row.promisedDate}</span></Link></div>
    </li>)}</ul>}
  </section>;
}
