'use client';

import { AlertTriangle, CheckCircle2, ClipboardCheck, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { workspaceMutationFetch } from '@/lib/client/workspace-prefetch';
import { formatIndiaDate as displayDate } from '@/lib/domain/india-date';
import { formatInr, parseInrToPaise } from '@/lib/domain/money';
import type { ReceivingSummary } from '@/lib/receiving/receiving-document';
import { calculateReceivingDetails, validateReceivingDetails, type ReceivingDetails } from '@/lib/receiving/receiving-details';
import ui from './purchase-ui.module.css';
import detailStyles from './delivery-check.module.css';
import styles from './request-detail.module.css';

type IssueCode = 'LATE' | 'MISSING_QUANTITY' | 'WRONG_ITEM' | 'QUALITY' | 'PRICE_DIFFERENCE' | 'OTHER';

export type DeliveryReceivingSummary = ReceivingSummary;

const issueOptions: Array<{ code: IssueCode; label: string }> = [
  { code: 'LATE', label: 'Late delivery' },
  { code: 'MISSING_QUANTITY', label: 'Missing quantity' },
  { code: 'WRONG_ITEM', label: 'Wrong item' },
  { code: 'QUALITY', label: 'Poor quality' },
  { code: 'PRICE_DIFFERENCE', label: 'Price difference' },
  { code: 'OTHER', label: 'Other problem' },
];

function rupeesInput(paise: string) {
  const value = BigInt(paise);
  const whole = value / BigInt(100);
  const fraction = (value % BigInt(100)).toString().padStart(2, '0');
  return fraction === '00' ? whole.toString() : `${whole}.${fraction}`;
}

function differenceText(value: string) {
  const difference = BigInt(value);
  if (difference === BigInt(0)) return 'Matches accepted total';
  const absolute = difference < BigInt(0) ? -difference : difference;
  return `${formatInr(absolute.toString())} ${difference > BigInt(0) ? 'higher' : 'lower'}`;
}

export function SupplierCheckForm({ awardId, supplier, onSaved }: {
  awardId: string;
  supplier: DeliveryReceivingSummary['suppliers'][number];
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(!supplier.check);
  const [invoiceInr, setInvoiceInr] = useState(supplier.check ? rupeesInput(supplier.check.invoiceTotalPaise) : '');
  const [outcome, setOutcome] = useState<'MATCHED' | 'ISSUES'>(supplier.check?.outcome ?? 'MATCHED');
  const [issueCodes, setIssueCodes] = useState<IssueCode[]>(supplier.check?.issueCodes ?? []);
  const [note, setNote] = useState(supplier.check?.note ?? '');
  const [rows, setRows] = useState(() => (supplier.items ?? []).map(item => {
    const saved = supplier.check?.details?.items.find(row => row.requestItemId === item.requestItemId);
    return { requestItemId: item.requestItemId, receivedQuantity: saved?.receivedQuantity ?? '', rejectedQuantity: saved?.rejectedQuantity ?? '0', billedQuantity: saved?.billedQuantity ?? '', billedRateInr: saved?.billedUnitRatePaise != null ? rupeesInput(saved.billedUnitRatePaise) : '' };
  }));
  const [actualDate, setActualDate] = useState(supplier.check?.details?.actualDeliveryDate ?? '');
  const [creditClaimed, setCreditClaimed] = useState(rupeesInput(supplier.check?.details?.creditClaimedPaise ?? '0'));
  const [creditReceived, setCreditReceived] = useState(rupeesInput(supplier.check?.details?.creditReceivedPaise ?? '0'));
  const [settlementNote, setSettlementNote] = useState(supplier.check?.details?.settlementNote ?? '');
  function readDetails(): ReceivingDetails | undefined {
    if (!supplier.items?.length) return undefined;
    return validateReceivingDetails({
      items: rows.map(row => ({ requestItemId: row.requestItemId, receivedQuantity: row.receivedQuantity, rejectedQuantity: row.rejectedQuantity,
        billedQuantity: row.billedQuantity || null, billedUnitRatePaise: row.billedRateInr ? parseInrToPaise(row.billedRateInr).toString() : null })),
      actualDeliveryDate: actualDate || null, creditClaimedPaise: parseInrToPaise(creditClaimed).toString(), creditReceivedPaise: parseInrToPaise(creditReceived).toString(), settlementNote: settlementNote.trim() || null,
    });
  }
  let preview: ReturnType<typeof calculateReceivingDetails> | undefined;
  try { const details = readDetails(); if (details) preview = calculateReceivingDetails(supplier.items!, details); } catch { /* Incomplete form; validate on save. */ }
  function changeRow(index: number, field: 'receivedQuantity' | 'rejectedQuantity' | 'billedQuantity' | 'billedRateInr', value: string) {
    setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [billingDetailsOpen, setBillingDetailsOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map(row => [row.requestItemId, Boolean(row.billedQuantity || row.billedRateInr)])),
  );

  function showError(message: string) {
    setError(message);
    setBillingDetailsOpen(Object.fromEntries(rows.map(row => [row.requestItemId, true])));
  }


  function toggleIssue(code: IssueCode) {
    setIssueCodes((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    let invoiceTotalPaise: string;
    try {
      const paise = parseInrToPaise(invoiceInr);
      if (paise < BigInt(0) || (paise === BigInt(0) && !supplier.items?.length)) throw new RangeError();
      invoiceTotalPaise = paise.toString();
    } catch {
      showError('Enter the invoice total in rupees.');
      return;
    }
    if (outcome === 'ISSUES' && issueCodes.length === 0) {
      showError('Choose at least one delivery problem.');
      return;
    }
    let details: ReceivingDetails | undefined;
    try {
      details = readDetails();
      if (details) calculateReceivingDetails(supplier.items!, details);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : 'Check item counts and credit amounts.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await workspaceMutationFetch(`/api/awards/${encodeURIComponent(awardId)}/receiving`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(details ? { details } : {}),
          supplierId: supplier.supplierId,
          outcome,
          invoiceTotalPaise,
          issueCodes: outcome === 'ISSUES' ? issueCodes : [],
          note: note.trim() || null,
          expectedCheckedAt: supplier.check?.checkedAt ?? null,
        }),
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(problem.detail || 'We could not save this delivery check.');
      }
      await onSaved();
      setEditing(false);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : 'We could not save this delivery check.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing && supplier.check) {
    const check = supplier.check;
    return (
      <article className={check.hasProblem ? styles.deliveryIssue : styles.deliveryMatched}>
        <header>
          <span>
            {check.hasProblem ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            <span><strong>{supplier.supplierName}</strong><small>Delivery {displayDate(supplier.deliveryDate)}</small></span>
          </span>
          <i>{check.hasProblem ? 'Needs attention' : 'Received as agreed'}</i>
        </header>
        <dl>
          <div><dt>Accepted total</dt><dd>{formatInr(supplier.expectedTotalPaise)}</dd></div>
          <div><dt>Invoice total</dt><dd>{formatInr(check.invoiceTotalPaise)}</dd></div>
          <div><dt>Invoice difference</dt><dd>{differenceText(check.differencePaise)}</dd></div>
        </dl>
        {check.details && <div className={detailStyles.summary}>
          <p>{check.deliveryComplete ? 'Delivery complete' : 'Partial delivery · quantities outstanding'} · Actual delivery: {check.details.actualDeliveryDate ? displayDate(check.details.actualDeliveryDate) : 'Not recorded'}</p>
          <details className={ui.disclosure}>
            <summary>Saved item quantities & price differences</summary>
          {check.itemDetails?.map(item => <div key={item.requestItemId}><strong>{item.itemName}</strong><p>Ordered {item.orderedQuantity} · received {item.receivedQuantity} (including rejected {item.rejectedQuantity}) · accepted {item.acceptedQuantity} · outstanding {item.pendingQuantity} {item.unit.toLowerCase()}</p><small>Item discrepancy {formatInr(item.discrepancyPaise)}</small></div>)}
          </details>
          <p>Credit claimed {formatInr(check.details.creditClaimedPaise)} · received {formatInr(check.details.creditReceivedPaise)} · remaining {formatInr(check.creditRemainingPaise ?? '0')}</p>
          {check.details.settlementNote && <blockquote>{check.details.settlementNote}</blockquote>}
        </div>}
        {check.issueCodes.length > 0 && <p>{check.issueCodes.map((code) => issueOptions.find((option) => option.code === code)?.label).join(' · ')}</p>}
        {check.note && <blockquote>{check.note}</blockquote>}
        <footer><small>Checked {displayDate(check.checkedAt, true)}</small><button type="button" onClick={() => setEditing(true)}>{!check.details && supplier.items?.length ? 'Add item details' : 'Update check'}</button></footer>
      </article>
    );
  }

  return (
    <form className={`${styles.deliveryForm} ${ui.surface}`} onSubmit={save}>
      <header>
        <span><ClipboardCheck aria-hidden="true" /><span><strong>{supplier.supplierName}</strong><small>Expected {formatInr(supplier.expectedTotalPaise)} · delivery {displayDate(supplier.deliveryDate)}</small></span></span>
        {supplier.check && <button type="button" onClick={() => setEditing(false)}>Cancel</button>}
      </header>
      <label className={styles.invoiceField}><span>Invoice total in rupees *</span><span><b>₹</b><input inputMode="decimal" value={invoiceInr} placeholder="1,250.00" onChange={(event) => setInvoiceInr(event.target.value.replace(/,/g, ''))} /></span></label>
      {supplier.items?.length ? <div className={detailStyles.details}>
        <p>Enter totals so far, including rejected units in received counts. Each save replaces the previous totals. Rejected units stay outstanding until accepted replacements arrive.</p>
        {supplier.check && !supplier.check.details && <p>Add the item counts you have checked.</p>}
        {supplier.items.map((item, index) => <fieldset key={item.requestItemId} className={detailStyles.item}>
          <legend>{item.itemName}</legend>
          <p>Ordered: {item.orderedQuantity} {item.unit.toLowerCase()} · accepted rate {formatInr(item.unitRatePaise)} · {item.taxInclusive ? 'including' : 'excluding'} GST</p>
          <div className={detailStyles.fields}>
            <label>Received so far<input required inputMode="decimal" maxLength={24} value={rows[index]?.receivedQuantity ?? ''} onChange={event => changeRow(index, 'receivedQuantity', event.target.value)} /></label>
            <label>Rejected so far<input required inputMode="decimal" maxLength={24} value={rows[index]?.rejectedQuantity ?? ''} onChange={event => changeRow(index, 'rejectedQuantity', event.target.value)} /></label>
          </div>
          <details className={ui.disclosure} open={billingDetailsOpen[item.requestItemId]}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setBillingDetailsOpen(current => ({ ...current, [item.requestItemId]: open }));
            }}>
            <summary>Invoice quantity & rate (optional)</summary>
            <div className={detailStyles.fields}>
            <label>Billed quantity (optional)<input inputMode="decimal" maxLength={24} value={rows[index]?.billedQuantity ?? ''} onChange={event => changeRow(index, 'billedQuantity', event.target.value)} /></label>
            <label>Billed rate in rupees<input inputMode="decimal" maxLength={24} value={rows[index]?.billedRateInr ?? ''} onChange={event => changeRow(index, 'billedRateInr', event.target.value)} /></label>
            </div>
          </details>
          {preview && <p>Accepted {preview.itemDetails[index].acceptedQuantity} · outstanding {preview.itemDetails[index].pendingQuantity} · discrepancy {formatInr(preview.itemDetails[index].discrepancyPaise)}</p>}
        </fieldset>)}
        <details className={ui.disclosure}><summary>How price differences are calculated</summary><p className={detailStyles.help}>Item discrepancy compares billed value with accepted quantity at the awarded rate, using awarded GST. Without billing details it estimates against the full allocated value. Freight is excluded; the invoice difference above compares the whole invoice.</p></details>
        <div className={detailStyles.fields}>
          <label>Actual delivery date<input type="date" value={actualDate} onChange={event => setActualDate(event.target.value)} /></label>
          <label>Credit claimed in rupees<input inputMode="decimal" maxLength={24} value={creditClaimed} onChange={event => setCreditClaimed(event.target.value)} /></label>
          <label>Credit received in rupees<input inputMode="decimal" maxLength={24} value={creditReceived} onChange={event => setCreditReceived(event.target.value)} /></label>
        </div>
        <p className={detailStyles.help}>Use the latest arrival date, including replacements. Completed deliveries use this date for on-time reports.</p>
        {preview && <p role="status">Item discrepancy {formatInr(preview.discrepancyPaise)} · Credit remaining {formatInr(preview.creditRemainingPaise)}</p>}
        <label>Settlement notes<textarea maxLength={500} rows={2} value={settlementNote} onChange={event => setSettlementNote(event.target.value)} placeholder="Credit note reference, refund or agreed adjustment" /></label>
      </div> : null}
      <fieldset className={styles.deliveryOutcome}>
        <legend>How was the delivery?</legend>
        <label><input type="radio" name={`outcome-${supplier.supplierId}`} checked={outcome === 'MATCHED'} onChange={() => { setOutcome('MATCHED'); setIssueCodes([]); }} />Received as agreed</label>
        <label><input type="radio" name={`outcome-${supplier.supplierId}`} checked={outcome === 'ISSUES'} onChange={() => setOutcome('ISSUES')} />Report a problem</label>
      </fieldset>
      {outcome === 'ISSUES' && (
        <div className={styles.deliveryProblems}><span>What went wrong?</span><div>{issueOptions.map((option) => (
          <label key={option.code}><input type="checkbox" checked={issueCodes.includes(option.code)} onChange={() => toggleIssue(option.code)} />{option.label}</label>
        ))}</div></div>
      )}
      <label className={styles.deliveryNote}><span>Note, if useful</span><textarea maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Example: 2 kg tomato was missing." /></label>
      {error && <p className={styles.deliveryError} role="alert">{error}</p>}
      <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save delivery check'}</button>
    </form>
  );
}

export function DeliveryCheckPanel({ awardId, requestId, receiving, onSaved }: {
  awardId: string;
  requestId: string;
  receiving: DeliveryReceivingSummary;
  onSaved: () => Promise<void> | void;
}) {
  return (
    <section className={`${styles.panel} ${styles.deliveryPanel} ${ui.surface}`} aria-labelledby="delivery-check-heading">
      <header><div><h2 id="delivery-check-heading">Check delivery</h2></div><span>{receiving.checkedCount} of {receiving.totalCount} checked</span></header>
      <p className={styles.deliveryIntro}>Check quantities and invoice totals. Record any delivery problems.</p>
      <div className={styles.deliveryGrid}>{receiving.suppliers.map((supplier) => (
        <SupplierCheckForm key={`${supplier.supplierId}:${supplier.check?.checkedAt ?? 'new'}`} awardId={awardId} supplier={supplier} onSaved={onSaved} />
      ))}</div>
      {receiving.complete && (
        <div className={styles.repeatOrder}>
          <span><RotateCcw aria-hidden="true" /><span><strong>All deliveries checked</strong><small>Your invoice and supplier record is ready for the next purchase.</small></span></span>
          <Link href={`/history?repeat=${encodeURIComponent(requestId)}`}>Repeat this order</Link>
        </div>
      )}
    </section>
  );
}
