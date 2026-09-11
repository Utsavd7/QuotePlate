'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { contactRowsCsv, findSupplierContactMatches, parseContactList, reviewContactRows, type ContactRow, type ExistingSupplierContact } from '@/lib/suppliers/contact-list';
import { workspaceMutationFetch } from '@/lib/client/workspace-prefetch';
import styles from './existing-supplier-contacts.module.css';

export function ExistingSupplierContacts({ onImported, existingContacts = [] }: { onImported: (count: number) => Promise<void>; existingContacts?: readonly ExistingSupplierContact[] }) {
  const [source, setSource] = useState('');
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const review = rows ? reviewContactRows(rows) : null;

  function prepare() {
    try {
      setRows(parseContactList(source)); setError(''); setSaved(0);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (caught) { setError((caught as Error).message); }
  }
  function edit(index: number, key: keyof ContactRow, value: string) {
    setRows(current => current?.map((row, i) => i === index ? { ...row, [key]: value } : row) ?? null);
    setError('');
  }
  async function save() {
    if (lock.current || !rows) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await workspaceMutationFetch('/api/suppliers/import', {
        method: 'POST', headers: { 'Content-Type': 'text/csv; charset=utf-8' }, body: contactRowsCsv(rows),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = Array.isArray(result?.errors)
          ? result.errors.slice(0, 3).map((item: { row?: number; message?: string }) => `${typeof item.row === 'number' ? `Row ${Math.max(1, item.row - 1)}: ` : ''}${item.message ?? 'Check this contact.'}`).join(' ')
          : '';
        throw new Error(detail || result?.detail || 'We could not add these suppliers. Check the details and try again.');
      }
      const count = result?.importedCount;
      if (!Number.isInteger(count) || count < 1) throw new Error('The import response could not be confirmed. Refresh suppliers before retrying.');
      setSaved(count); setRows(null); setSource('');
      await onImported(count);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Check your connection and try again.'); }
    finally { lock.current = false; setBusy(false); }
  }

  return <details className={styles.panel}>
    <summary>Add existing contacts <span>Paste a list from your spreadsheet</span></summary>
    <div className={styles.content} aria-busy={busy}>
      <p>Start with suppliers your restaurant already uses. Review their names and contacts here, then ask them to confirm products and delivery details through a private link.</p>
      {saved > 0 && <div className={styles.success} role="status">
        <strong>{saved} supplier{saved === 1 ? '' : 's'} added.</strong>
        <p>Next, open a supplier’s workspace and create a private link for them to confirm their details.</p>
        <Link href="/supplier-collaboration">Open supplier workspaces →</Link>
      </div>}
      {!rows ? <>
        <label className={styles.source}>Supplier contact list
          <textarea value={source} onChange={event => { setSource(event.target.value); setError(''); }} disabled={busy} rows={4} maxLength={32768} placeholder={'Business name, phone, email\nUse your actual supplier contacts here'} aria-describedby="contact-list-format" />
        </label>
        <p id="contact-list-format" className={styles.help}>One supplier per line, up to 50. Use commas or paste spreadsheet columns: name, phone, optional email. A name and phone number are enough. Leave out column headings.</p>
        <button type="button" onClick={prepare} disabled={busy || !source.trim()}>Review contacts</button>
      </> : <>
        <h2 ref={heading} tabIndex={-1}>Check {rows.length} supplier{rows.length === 1 ? '' : 's'}</h2>
        <p className={styles.help}>Correct any details before adding. Existing supplier records will not be overwritten.</p>
        {existingContacts.length > 0 && <p className={styles.help}>Contact matches cover only supplier records currently loaded. Remove rows already saved, or review whether they belong to a different business with a shared contact.</p>}
        <div className={styles.tableWrap}>
          <table><thead><tr><th scope="col">Business name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col"><span className={styles.srOnly}>Actions</span></th></tr></thead>
            <tbody>{rows.map((row, index) => {
              const issue = review?.errors.find(item => item.row === index);
              const matches = findSupplierContactMatches(row, existingContacts);
              return <tr key={index}>
                {(['businessName', 'phone', 'email'] as const).map((key, column) => <td key={key} data-label={['Business name', 'Phone', 'Email'][column]}>
                  <input aria-label={`${['Business name', 'Phone', 'Email'][column]}, row ${index + 1}`} value={row[key]} type={key === 'phone' ? 'tel' : key === 'email' ? 'email' : 'text'} maxLength={key === 'businessName' ? 160 : key === 'phone' ? 80 : 320} disabled={busy} aria-invalid={Boolean(issue)} aria-describedby={issue ? `contact-row-error-${index}` : undefined} onChange={event => edit(index, key, event.target.value)} />
                  {column === 0 && issue && <small id={`contact-row-error-${index}`} className={styles.error}>{issue.message}</small>}
                  {column === 0 && matches.length > 0 && <small className={styles.help}>Contact already saved: {matches.map(match => `${match.supplier.businessName} (${match.kinds.join(' and ')})`).join(', ')}. Review before adding.</small>}
                </td>)}
                <td><button type="button" className={styles.secondary} aria-label={`Remove row ${index + 1}`} disabled={busy} onClick={() => { setRows(current => current?.filter((_, i) => i !== index) ?? null); setError(''); }}>Remove</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className={styles.actions}>
          <button type="button" disabled={busy || !rows.length || Boolean(review?.errors.length)} onClick={() => void save()}>{busy ? 'Adding suppliers…' : `Add ${rows.length} supplier${rows.length === 1 ? '' : 's'}`}</button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setRows(null); setError(''); }}>Back to pasted list</button>
        </div>
        <p className={styles.help}>This saves contacts for your restaurant. It does not send invitations or messages.</p>
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </details>;
}
