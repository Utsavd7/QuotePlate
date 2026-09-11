'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { INTAKE_TEXT_LIMIT, intakeUnits, invoiceMatch, invoiceRowErrors, parseInvoice, parseShoppingList, shoppingRowErrors, type AwardedIntakeItem, type IntakeRow } from '@/lib/procurement/photo-text-intake';
import styles from './reviewed-text-intake.module.css';

export type IntakeBilling = { requestItemId: string; billedQuantity: string; billedRateInr: string };
type ReviewRow = IntakeRow & { id: number; checked: boolean };

export function ReviewedTextIntake({ mode, awarded = [], billing = [], onApply, disabled = false }: {
  mode: 'shopping' | 'invoice';
  awarded?: readonly AwardedIntakeItem[];
  billing?: readonly IntakeBilling[];
  onApply: (rows: IntakeRow[]) => string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoSource, setPhotoSource] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const active = useRef<AbortController | null>(null);
  const previewImage = useRef<HTMLImageElement>(null);
  const sequence = useRef(0);
  const panelId = useId();
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  useEffect(() => {
    const image = previewImage.current;
    if (!open || !photo || !image || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size > 8 * 1024 * 1024) return;
    let url: string;
    try { url = URL.createObjectURL(photo); } catch { return; }
    image.src = url;
    return () => { image.removeAttribute('src'); URL.revokeObjectURL(url); };
  }, [photo, open]);
  const invoice = mode === 'invoice';
  const label = invoice ? 'Invoice' : 'Shopping list';

  function cancel() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setStatus('Photo reading cancelled. Your entered text is unchanged.');
  }

  async function readPhoto() {
    if (!photo || active.current || disabled || rows.length > 0) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(''); setStatus('Reading photo in this browser…'); setProgress(0);
    try {
      const { readPriceListPhoto } = await import('@/lib/quotes/price-list-ocr');
      if (active.current !== controller) return;
      const recognized = await readPriceListPhoto(photo, {
        signal: controller.signal,
        onProgress: value => { if (active.current === controller) setProgress(Math.round(value * 100)); },
      });
      if (active.current !== controller || controller.signal.aborted) return;
      const combined = [text.trim(), recognized.trim()].filter(Boolean).join('\n');
      // Enforce both the text and line limits before replacing any entered text.
      parseShoppingList(combined);
      setText(combined); setRows([]); setPhotoSource(photo.name);
      setStatus('Photo text appended below. Correct it, then choose Review text.');
    } catch (caught) {
      if (active.current === controller && !controller.signal.aborted) {
        const message = caught instanceof Error ? caught.message : 'Could not read this photo.';
        setError(`${message.replace(/price list/gi, label.toLowerCase())} You can enter the text manually.`);
        setStatus('');
      }
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  function review() {
    if (rows.length > 0 || busy || disabled) return;
    setError(''); setStatus('');
    try {
      const parsed = invoice ? parseInvoice(text) : parseShoppingList(text);
      if (!parsed.length) throw new Error('Enter at least one item line, or read a clearer photo.');
      setRows(parsed.map(row => ({ ...row, id: ++sequence.current, checked: false })));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Check the text.'); }
  }

  function issues(row: ReviewRow) {
    const errors = invoice ? invoiceRowErrors(row) : shoppingRowErrors(row);
    if (!invoice) return errors;
    const match = invoiceMatch(row, awarded);
    errors.push(...match.issues);
    if (match.item) {
      if (rows.filter(other => invoiceMatch(other, awarded).item?.requestItemId === match.item!.requestItemId).length > 1) errors.push('Duplicate invoice rows match this item. Keep one checked cumulative billed total, or enter it manually.');
      const current = billing.find(item => item.requestItemId === match.item!.requestItemId);
      if (current?.billedQuantity || current?.billedRateInr) errors.push(`Existing billed values: ${current.billedQuantity || 'blank'} × ₹${current.billedRateInr || 'blank'}. Kept unchanged; edit billing in the receiving form.`);
    }
    return errors;
  }

  function edit(id: number, field: 'name' | 'quantity' | 'unit' | 'rate', value: string) {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value, checked: false } as ReviewRow : row));
    setStatus('');
  }

  const checked = rows.filter(row => row.checked);
  const canApply = checked.length > 0 && checked.every(row => issues(row).length === 0) && !disabled && !busy;
  function apply() {
    if (!canApply) return;
    const problem = onApply(checked.map(({ name, quantity, unit, rate, source, issues }) => ({ name: name.trim(), quantity, unit, rate, source, issues })));
    if (problem) { setError(problem); return; }
    setRows(current => current.filter(row => !row.checked));
    setError('');
    setStatus(invoice ? 'Checked billed values applied. Check physical quantities and save the delivery separately.' : 'Checked rows added to your draft. Review the full request before saving.');
  }

  return <section className={styles.helper}>
    <button className={styles.toggle} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => { if (open && busy) cancel(); setOpen(!open); }}>
      {invoice ? 'Read invoice photo or text' : 'Add a shopping list'}
    </button>
    {open && <div id={panelId} className={styles.body}>
      <p>Printed English photos are read in this browser and are not uploaded. Enter one item per line. Handwriting and complex tables may need manual correction.</p>
      <p>{invoice ? 'Use the exact awarded name and unit, for example: Tomatoes 10 kg @ 40.25. Rates are rupees per unit. Check the tax basis against the award. Only billed quantities and rates can be filled; received counts, invoice totals and credits stay manual.' : 'For example: tomatoes 10 kg or 5 kg onions. Missing quantities and units must be entered before a row can be checked.'}</p>
      <div className={photo && rows.length === 0 ? styles.sourceReview : undefined}>
        {photo && <figure className={styles.preview}>
          {/* Local blob URLs must never go through an image optimization server. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={previewImage} alt={`Selected photo: ${photo.name}`} />
          <figcaption>Selected photo: {photo.name}. Compare it with the text and each review row. If it is unreadable, enter the values manually.</figcaption>
        </figure>}
      <fieldset hidden={rows.length > 0} disabled={busy || disabled || rows.length > 0} className={styles.source}>
        <label>{label} photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { setPhoto(event.target.files?.[0] ?? null); setError(''); }} /></label>
        <small>JPEG, PNG or WebP · up to 8 MB and 20 megapixels.</small>
        <button type="button" onClick={() => void readPhoto()} disabled={!photo || busy || disabled}>Read photo</button>
        <label>{label} text or description<textarea rows={5} value={text} maxLength={INTAKE_TEXT_LIMIT} onChange={event => { setText(event.target.value); setRows([]); setStatus(''); }} /></label>
        <button type="button" onClick={review}>Review text</button>
      </fieldset>
      </div>
      {!invoice && <button type="button" onClick={() => setRows(current => [...current, { id: ++sequence.current, name: '', quantity: '', unit: '', rate: '', source: 'Manual entry', issues: [], checked: false }])} disabled={busy || disabled || rows.length >= 100}>Add item manually</button>}
      {busy && <div className={styles.progress}><progress aria-label="Reading photo" max={100} value={progress} /><button type="button" onClick={cancel}>Cancel reading</button></div>}
      {error && <p role="alert">{error}</p>}
      <p role="status" aria-live="polite">{status}</p>
      {rows.length > 0 && <>
        <p>Source: {photoSource ? `photo ${photoSource} and entered text` : 'entered text'}.</p>
        <p>{invoice ? 'Check each suggested item, quantity, unit and billed rate. Editing clears its check.' : 'Check each suggested item, quantity and unit. Editing clears its check.'}</p>
        <p className={styles.hint} id={`${panelId}-discard`}>This discards pending corrections, manually added review rows and checks. Applied values are kept.</p>
        <button type="button" disabled={busy || disabled} aria-describedby={`${panelId}-discard`} onClick={() => { setRows([]); setError(''); setStatus('Pending review discarded. You can edit the source or read another photo.'); }}>Discard review and change source</button>
        {invoice && <p>Awarded items: {awarded.map(item => `${item.itemName} (${item.unit.toLowerCase()})`).join(', ')}.</p>}
        {rows.map((row, index) => {
          const errors = issues(row);
          return <fieldset key={row.id} className={styles.row} disabled={disabled || busy}>
            <legend>Row {index + 1}</legend>
            <p className={styles.sourceLine}>Source: {row.source}</p>
            <p className={styles.hint}>{errors.length ? 'Needs correction' : 'Review required'}</p>
            {row.issues.length > 0 && <p className={styles.hint}>Check the source: {row.issues[0]}</p>}
            <div className={styles.fields}>
              <label>Item name<input aria-label={`Item name, row ${index + 1}`} maxLength={160} value={row.name} onChange={event => edit(row.id, 'name', event.target.value)} /></label>
              <label>{invoice ? 'Billed quantity' : 'Quantity'}<input aria-label={`Quantity, row ${index + 1}`} inputMode="decimal" maxLength={24} value={row.quantity} onChange={event => edit(row.id, 'quantity', event.target.value)} /></label>
              <label>Unit<select aria-label={`Unit, row ${index + 1}`} value={row.unit} onChange={event => edit(row.id, 'unit', event.target.value)}><option value="">Choose unit</option>{intakeUnits.map(unit => <option key={unit} value={unit}>{unit.toLowerCase()}</option>)}</select></label>
              {invoice && <label>Billed rate in rupees<input aria-label={`Billed rate, row ${index + 1}`} inputMode="decimal" maxLength={24} value={row.rate} onChange={event => edit(row.id, 'rate', event.target.value)} /></label>}
            </div>
            {errors.length > 0 && <ul>{errors.map(message => <li key={message}>{message}</li>)}</ul>}
            <label className={styles.check}><input type="checkbox" aria-label={`Checked row ${index + 1}`} checked={row.checked && errors.length === 0} disabled={errors.length > 0} onChange={event => setRows(current => current.map(other => other.id === row.id ? { ...other, checked: event.target.checked } : other))} />I checked the item, quantity{invoice ? ', unit and billed rate' : ' and unit'}.</label>
            <button type="button" aria-label={`Remove row ${index + 1}`} onClick={() => setRows(current => current.filter(other => other.id !== row.id))}>Remove row</button>
          </fieldset>;
        })}
        <button type="button" disabled={!canApply} onClick={apply}>{invoice ? 'Apply checked billed values' : 'Add checked rows to draft'}</button>
      </>}
    </div>}
  </section>;
}
