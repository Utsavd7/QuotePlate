'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Camera, FileText, ImagePlus, X } from 'lucide-react';
import { parseInrToPaise } from '@/lib/domain/money';
import { MAX_PRICE_LIST_TEXT_LENGTH, parsePriceList, type PriceListItem, type PriceListSuggestion } from '@/lib/quotes/price-list';
import styles from './quote-price-assistant.module.css';

type ReviewRow = PriceListSuggestion & { selected: boolean };
export type PreparedPrice = { requestItemId: string; rateInr: string };
const units = { KILOGRAM: 'kg', GRAM: 'g', LITRE: 'L', MILLILITRE: 'ml', PIECE: 'piece', PACK: 'pack', CASE: 'case', CRATE: 'crate' };

export function QuotePriceAssistant({ items, disabled, onApply }: {
  items: readonly PriceListItem[];
  disabled: boolean;
  onApply: (prices: PreparedPrice[]) => { applied: number; skipped: number };
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [hasRead, setHasRead] = useState(false);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previewImage = useRef<HTMLImageElement>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const image = previewImage.current;
    if (!open || !photo || !image || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size > 8 * 1024 * 1024) return;
    let url: string;
    try { url = URL.createObjectURL(photo); } catch { return; }
    image.src = url;
    return () => { image.removeAttribute('src'); URL.revokeObjectURL(url); };
  }, [photo, open]);

  function cancelReading() {
    controller.current?.abort();
    controller.current = null;
    setReading(false);
  }

  function close() {
    cancelReading();
    setOpen(false);
    opener.current?.focus();
  }

  function prepare(value: string) {
    setError('');
    setMessage('');
    setRows([]);
    setUnresolved([]);
    setHasRead(false);
    try {
      const parsed = parsePriceList(value, items);
      setRows(parsed.suggestions.map(row => ({ ...row, selected: Boolean(row.requestItemId) })));
      setUnresolved(parsed.unresolved);
      setHasRead(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not read these prices. Check the text and try again.');
    }
  }

  async function readPhoto(file: File | undefined) {
    if (!file || disabled) return;
    cancelReading();
    setPhoto(file);
    const active = new AbortController();
    controller.current = active;
    setReading(true);
    setProgress(0);
    setError('');
    setMessage('');
    setRows([]);
    setUnresolved([]);
    setHasRead(false);
    try {
      const { readPriceListPhoto } = await import('@/lib/quotes/price-list-ocr');
      if (active.signal.aborted) return;
      const recognized = await readPriceListPhoto(file, {
        signal: active.signal,
        onProgress(value) {
          if (!active.signal.aborted && controller.current === active) setProgress(Math.max(0, Math.min(100, Math.round(value * 100))));
        },
      });
      if (active.signal.aborted || controller.current !== active) return;
      setText(recognized);
      prepare(recognized);
    } catch (problem) {
      if (!active.signal.aborted && controller.current === active) setError(problem instanceof Error ? problem.message : 'Could not read this photo. Try a clearer photo or enter prices below.');
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setReading(false);
      }
    }
  }

  function updateRow(index: number, changes: Partial<ReviewRow>) {
    setError('');
    setMessage('');
    setRows(current => current.map((row, i) => i === index ? { ...row, ...changes } : row));
  }

  function rejectLongText() {
    setRows([]); setUnresolved([]); setHasRead(false); setMessage('');
    setError('Use at most 12,000 characters. Nothing was pasted or cut short; your existing text was kept. Split the list into smaller parts.');
  }

  function apply() {
    if (reading || disabled) return;
    const chosen = rows.filter(row => row.selected);
    const seen = new Set<string>();
    for (const row of chosen) {
      const item = items.find(item => item.id === row.requestItemId);
      if (!item || (row.unit !== null && row.unit !== item.unit)) {
        setError('Choose the matching item and unit for each selected price.');
        return;
      }
      if (seen.has(item.id)) {
        setError(`More than one price is selected for ${item.name}. Keep just one.`);
        return;
      }
      seen.add(item.id);
      try { parseInrToPaise(row.rateInr); }
      catch { setError(`${item.name}: enter a price of 0 or more, with at most 2 decimal places.`); return; }
    }
    if (!chosen.length) { setError('Select at least one price to use.'); return; }
    const result = onApply(chosen.map(row => ({ requestItemId: row.requestItemId!, rateInr: row.rateInr })));
    setMessage(`${result.applied} price${result.applied === 1 ? '' : 's'} filled. ${result.skipped ? `${result.skipped} already filled or unavailable item${result.skipped === 1 ? ' was' : 's were'} kept. ` : ''}Check GST, quantities and delivery below before sending.`);
  }

  return <section className={styles.assistant} aria-label="Price list assistant" onKeyDown={event => {
    // Editing a proposed price must not submit the outer quote form on Enter.
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') event.preventDefault();
  }}>
    <div className={styles.intro}>
      <div><strong>Have a price list?</strong><p>Use a clear photo or paste your prices to fill this quote.</p></div>
      <button ref={opener} className={styles.button} type="button" disabled={disabled} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => {
        if (open) close();
        else { setOpen(true); requestAnimationFrame(() => heading.current?.focus()); }
      }}><FileText size={18} aria-hidden="true" />Use a price list</button>
    </div>
    {open && <div className={styles.panel} id={`${id}-panel`}>
      <div className={styles.panelTitle}><h3 ref={heading} tabIndex={-1}>Prepare your prices</h3><button type="button" className={styles.iconButton} aria-label="Close price list assistant" onClick={close}><X size={20} aria-hidden="true" /></button></div>
      <p>Clear printed English works best. You will check every price before using it.</p>
      <input ref={camera} className={styles.fileInput} tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Take price list photo" disabled={disabled || reading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readPhoto(file); }} />
      <input ref={gallery} className={styles.fileInput} tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose price list photo" disabled={disabled || reading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readPhoto(file); }} />
      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={disabled || reading} onClick={() => camera.current?.click()}><Camera size={18} aria-hidden="true" />Take photo</button>
        <button type="button" className={styles.button} disabled={disabled || reading} onClick={() => gallery.current?.click()}><ImagePlus size={18} aria-hidden="true" />Choose photo</button>
        <button type="button" className={styles.button} disabled={disabled || reading} onClick={() => source.current?.focus()}>Paste prices</button>
      </div>
      <p className={styles.hint}>JPG, PNG or WebP, up to 8 MB. Your photo stays on this device.</p>
      {reading && <div className={styles.progress}>
        <p role="status">Reading your photo… {progress}%</p>
        <progress aria-label="Reading price list photo" value={progress} max={100} />
        <button type="button" className={styles.button} onClick={cancelReading}>Cancel photo reading</button>
      </div>}
      <div className={photo ? styles.sourceReview : undefined}>
        {photo && <figure className={styles.preview}>
          {/* Local blob URLs must never go through an image optimization server. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={previewImage} alt={`Selected photo: ${photo.name}`} />
          <figcaption>Selected photo: {photo.name}. Compare every item, price and unit with the photo. If it is unreadable, enter prices manually.</figcaption>
        </figure>}
      <label className={styles.sourceLabel}>Prices from your list
        <textarea ref={source} value={text} rows={4} disabled={disabled || reading} placeholder={'Tomato 42/kg\nPaneer 320/kg'} onPaste={event => {
          const field = event.currentTarget;
          const length = text.length - (field.selectionEnd - field.selectionStart) + event.clipboardData.getData('text').length;
          if (length > MAX_PRICE_LIST_TEXT_LENGTH) { event.preventDefault(); rejectLongText(); }
        }} onChange={event => {
          if (event.target.value.length > MAX_PRICE_LIST_TEXT_LENGTH) { rejectLongText(); return; }
          setText(event.target.value); setHasRead(false); setRows([]); setUnresolved([]); setError(''); setMessage('');
        }} />
      </label>
      </div>
      <div className={styles.actions}><button type="button" className={styles.button} disabled={disabled || reading || !text.trim()} onClick={() => prepare(text)}>Read prices</button><span className={styles.hint}>One item and price per line. Include the unit when you can.</span></div>
      {hasRead && <section className={styles.results} aria-label="Prepared prices">
        <h4>Check these prices</h4>
        <p>{rows.length ? 'Match each price to the restaurant’s item. GST and supply quantities stay as entered in your quote.' : 'No clear prices found. Edit the text above, try a clearer photo, or enter your prices in the quote.'}</p>
        {rows.map((row, index) => {
          const item = items.find(item => item.id === row.requestItemId);
          return <div className={styles.row} key={row.id}>
            <label className={styles.check}><input type="checkbox" checked={row.selected} disabled={disabled || !item} onChange={event => updateRow(index, { selected: event.target.checked })} /><span>Use price {index + 1}</span></label>
            <p className={styles.sourceText}>From your list: {row.sourceText}</p>
            <div className={styles.rowFields}>
              <label>Item in this request
                <select value={row.requestItemId ?? ''} disabled={disabled} aria-label={`Item for price ${index + 1}`} onChange={event => updateRow(index, { requestItemId: event.target.value || null, selected: Boolean(event.target.value) })}>
                  <option value="">Choose an item</option>
                  {items.filter(item => row.unit === null || item.unit === row.unit).map(item => <option value={item.id} key={item.id}>{item.name} · per {units[item.unit]}</option>)}
                </select>
              </label>
              <label>Price {item ? `per ${units[item.unit]}` : row.unit ? `per ${units[row.unit]}` : 'in ₹'}
                <span className={styles.money}><span aria-hidden="true">₹</span><input aria-label={`Amount for price ${index + 1}`} inputMode="decimal" value={row.rateInr} disabled={disabled} onChange={event => updateRow(index, { rateInr: event.target.value })} /></span>
              </label>
            </div>
          </div>;
        })}
        {unresolved.length > 0 && <details className={styles.unresolved} open={rows.length === 0}>
          <summary>{unresolved.length} line{unresolved.length === 1 ? '' : 's'} need checking</summary>
          <p>These lines were not used. Correct them above or enter the price directly in your quote.</p>
          <ul>{unresolved.map((line, i) => <li key={i}>{line}</li>)}</ul>
        </details>}
        {rows.length > 0 && <button type="button" className={`${styles.button} ${styles.primary}`} disabled={disabled || reading} onClick={apply}>Use checked prices</button>}
      </section>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.message} role="status">{message}</p>}
      <button type="button" className={styles.button} onClick={close}>Back to my quote</button>
    </div>}
  </section>;
}
