'use client';

import { useEffect, useRef, useState } from 'react';
import type { WebsiteContact, WebsiteContactResult } from '@/lib/suppliers/website-types';
import { findSupplierContactMatches, type ExistingSupplierContact } from '@/lib/suppliers/contact-list';
import styles from './supplier-workspace.module.css';
import websiteStyles from './supplier-website-contacts.module.css';

function PublishedContact({ contact, filled, disabled, existingContacts, onReview }: {
  contact: WebsiteContact;
  filled: boolean;
  disabled: boolean;
  existingContacts: readonly ExistingSupplierContact[];
  onReview: (contact: WebsiteContact) => void;
}) {
  const matches = findSupplierContactMatches({ [contact.kind]: contact.value }, existingContacts);
  return <li className={websiteStyles.contact}>
    <div className={websiteStyles.details}>
      <strong>{contact.kind === 'email' ? 'Email' : 'Phone'}: {contact.value}</strong>
      <a href={contact.sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Published source</a>
      <span className={websiteStyles.checked}>Checked <time dateTime={contact.checkedAt}>{contact.checkedAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}</time></span>
      {matches.length > 0 && <p>Same {contact.kind} saved for {matches.map(match => match.supplier.businessName).join(', ')}. Check whether this is the same supplier or a shared contact.</p>}
    </div>
    <button type="button" className={styles.secondaryButton} disabled={disabled || filled}
      onClick={() => { if (!disabled && !filled) onReview(contact); }}>Use this {contact.kind}</button>
  </li>;
}

export function WebsiteContactReview({ result, phone, email, disabled = false, existingContacts = [], onReview }: {
  result: WebsiteContactResult;
  phone: string | null;
  email: string | null;
  disabled?: boolean;
  existingContacts?: readonly ExistingSupplierContact[];
  onReview: (contact: WebsiteContact) => void;
}) {
  if (result.status !== 'found') return <p role="status">{result.status === 'unavailable'
    ? 'This website could not be checked safely or does not allow automated access. You can add contact details manually.'
    : 'No public phone numbers or email addresses were found on the checked pages. You can add them manually.'}</p>;
  return <section className={websiteStyles.review} aria-label="Review published website contacts">
    <p>Check that each contact belongs to this supplier. Use a contact to fill an empty field, then save the supplier form.</p>
    {existingContacts.length > 0 && <p className={websiteStyles.checked}>Contact matches cover only supplier records currently loaded. Other saved suppliers may not appear here.</p>}
    <ul className={websiteStyles.contacts}>
    {result.contacts.map(contact => <PublishedContact key={JSON.stringify([contact.kind, contact.value, contact.sourceUrl, contact.checkedAt])}
      contact={contact} filled={Boolean((contact.kind === 'phone' ? phone : email)?.trim())} disabled={disabled}
      existingContacts={existingContacts} onReview={onReview} />)}
    </ul>
    <p>Existing phone, email and WhatsApp details are preserved. These contacts have not been verified by QuotePlate.</p>
  </section>;
}

export function SupplierWebsiteContacts({ phone, email, disabled, existingContacts = [], onReview }: {
  phone: string | null;
  email: string | null;
  disabled: boolean;
  existingContacts?: readonly ExistingSupplierContact[];
  onReview: (contact: WebsiteContact) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WebsiteContactResult | null>(null);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function discover() {
    if (active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setResult(null); setError('');
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch('/api/suppliers/website-contacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        cache: 'no-store', body: JSON.stringify({ url: url.trim() }), signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'Website contacts are unavailable. Try again later.');
      setResult(body as WebsiteContactResult);
    } catch (caught) {
      setError(caught instanceof Error && caught.name !== 'AbortError' ? caught.message : 'This website check timed out. Try again later.');
    } finally {
      clearTimeout(timer); active.current = null; setBusy(false);
    }
  }
  return <details className={styles.discovery}>
    <summary>Find contacts on the supplier’s website</summary>
    <p>Check a public HTTPS website and up to two linked contact/about pages. Runs only when you choose Check website. No messages are sent.</p>
    <label className={styles.field}>
      <span>Supplier website</span>
      <input type="text" inputMode="url" placeholder="https://supplier.com" maxLength={2048}
        value={url} disabled={disabled || busy} onChange={event => { setUrl(event.target.value); setResult(null); setError(''); }} />
    </label>
    <button type="button" className={styles.secondaryButton} disabled={disabled || busy || !url.trim()} onClick={() => void discover()}>
      {busy ? 'Checking website…' : 'Check website'}
    </button>
    {busy && <p role="status">Checking permitted public pages…</p>}
    {error && <p role="alert">{error}</p>}
    {result && <WebsiteContactReview result={result} phone={phone} email={email} disabled={disabled || busy} existingContacts={existingContacts} onReview={onReview} />}
  </details>;
}
