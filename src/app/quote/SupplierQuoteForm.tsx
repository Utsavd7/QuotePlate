'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { PreviousQuotePrices } from '@/lib/quotes/previous-prices';
import type { ItemSpecificationV1 } from '@/lib/domain/item-specification';
import { formatInr } from '@/lib/domain/money';
import type { ProcurementUnit } from '@/lib/domain/quantity';
import { formatScaledDecimal } from '@/lib/domain/validation';

import styles from './quote-access.module.css';
import { QuoteReviewError, reviewQuote } from './quote-review';

type PublicQuoteLineDto = {
  requestItemId: string;
  noQuote: boolean;
  availableQuantity: string | null;
  unit: ProcurementUnit | null;
  unitRatePaise: string | null;
  gstBasisPoints: number | null;
  taxInclusive: boolean;
  suppliedBrand: string | null;
  suppliedPackSize: string | null;
  suppliedQualityGrade: string | null;
  substitution: string | null;
  subtotalPaise: string;
  gstPaise: string;
  totalPaise: string;
};

export type PublicQuoteDto = {
  revision: number;
  subtotalPaise: string;
  gstPaise: string;
  freightPaise: string;
  totalPaise: string;
  deliveryDate: string;
  validUntil: string;
  minimumOrder: string | null;
  commercialTerms: string | null;
  notes: string | null;
  submittedAt: string;
  items: PublicQuoteLineDto[];
};

export type PublicQuoteRequestDto = {
  restaurantName: string;
  supplierName: string;
  title: string;
  deliveryDetails: Record<string, unknown>;
  deliveryDate: string;
  quoteDeadline: string;
  commercialTerms: string | null;
  items: Array<{
    id: string;
    itemKey: string;
    name: string;
    quantity: string;
    unit: ProcurementUnit;
    specification: ItemSpecificationV1;
  }>;
  latestQuote: PublicQuoteDto | null;
  previousPrices?: PreviousQuotePrices | null;
};

const unitLabels: Record<ProcurementUnit, string> = {
  KILOGRAM: 'kg',
  GRAM: 'g',
  LITRE: 'L',
  MILLILITRE: 'ml',
  PIECE: 'piece',
  PACK: 'pack',
  CASE: 'case',
  CRATE: 'crate',
};

function inrInput(paise: string | null | undefined) {
  return paise ? formatScaledDecimal(BigInt(paise), 2) : '';
}

function gstInput(basisPoints: number | null | undefined) {
  return basisPoints === null || basisPoints === undefined
    ? '0'
    : formatScaledDecimal(BigInt(basisPoints), 2);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function deliveryAddress(details: Record<string, unknown>) {
  return ['addressLine', 'city', 'state', 'pin']
    .map((key) => details[key])
    .filter((value): value is string => typeof value === 'string' && Boolean(value))
    .join(', ');
}

function deliveryInstructions(details: Record<string, unknown>) {
  const instructions = details.instructions;
  return typeof instructions === 'string' && instructions.trim()
    ? instructions.trim()
    : null;
}

function firstProblem(body: unknown) {
  if (!body || typeof body !== 'object') return 'Unable to submit this quote.';
  const record = body as { detail?: unknown; errors?: unknown };
  if (record.errors && typeof record.errors === 'object') {
    const first = Object.values(record.errors as Record<string, unknown>)[0];
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
  }
  return typeof record.detail === 'string'
    ? record.detail
    : 'Unable to submit this quote.';
}

export function SupplierQuoteForm({
  request,
  onSaved,
  onRefresh,
}: {
  request: PublicQuoteRequestDto;
  onSaved: (quote: PublicQuoteDto) => void;
  onRefresh: () => Promise<void>;
}) {
  const latestByItem = useMemo(
    () =>
      new Map(
        (request.latestQuote?.items ?? []).map((item) => [
          item.requestItemId,
          item,
        ]),
      ),
    [request.latestQuote],
  );
  const [cannotSupply, setCannotSupply] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      request.items.map((item) => [item.id, latestByItem.get(item.id)?.noQuote ?? false]),
    ),
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<(ReturnType<typeof reviewQuote> & {
    details: Array<{ rate: string; gst: string; inclusive: boolean; substitution: string }>;
  }) | null>(null);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const entryHeading = useRef<HTMLHeadingElement>(null);
  const returningToEntry = useRef(false);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (review) reviewHeading.current?.focus();
    else if (returningToEntry.current) {
      returningToEntry.current = false;
      entryHeading.current?.focus();
    }
  }, [review]);
  useEffect(() => {
    if (error) {
      formRef.current?.querySelectorAll('details').forEach(details => { details.open = true; });
      const field = error.field ? formRef.current?.elements.namedItem(error.field) : null;
      if (field instanceof HTMLElement) field.focus();
      else errorMessage.current?.focus();
    }
  }, [error]);

  function showProblem(message: string, field?: string) {
    setReview(null);
    setError({ message, field });
  }

  function fieldError(name: string) {
    return error?.field === name
      ? { 'aria-invalid': true as const, 'aria-describedby': 'quote-error' }
      : {};
  }

  function reusePreviousPrices() {
    const form = formRef.current;
    if (!form || request.latestQuote || submitting) return;
    setReview(null);
    setError(null);
    let filled = 0;
    for (const previous of request.previousPrices?.items ?? []) {
      const rate = form.elements.namedItem(`rate:${previous.requestItemId}`);
      const gst = form.elements.namedItem(`gst:${previous.requestItemId}`);
      const inclusive = form.elements.namedItem(`inclusive:${previous.requestItemId}`);
      if (!(rate instanceof HTMLInputElement) || !(gst instanceof HTMLInputElement) ||
        !(inclusive instanceof HTMLInputElement) || rate.disabled || rate.value.trim()) continue;
      rate.value = inrInput(previous.unitRatePaise);
      gst.value = gstInput(previous.gstBasisPoints);
      inclusive.checked = previous.taxInclusive;
      filled += 1;
    }
    setMessage(filled
      ? `Previous prices filled for ${filled} item${filled === 1 ? '' : 's'}. Check prices, GST and availability before sending.`
      : 'No blank eligible price rows to fill. Your entries were kept.');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    // Validation is explicit so a hidden entry phase or closed note can always
    // be revealed before we focus a field. Hidden inputs stay mounted for edits.
    if (!event.currentTarget.checkValidity()) {
      const invalid = event.currentTarget.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:invalid, textarea:invalid, select:invalid');
      showProblem(invalid?.validationMessage || 'Complete the required fields.', invalid?.name);
      return;
    }
    const form = new FormData(event.currentTarget);
    setError(null);
    if (!review) {
      try {
        setReview({
          ...reviewQuote(form, request),
          details: request.items.map(item => ({
            rate: String(form.get(`rate:${item.id}`) ?? ''),
            gst: String(form.get(`gst:${item.id}`) ?? ''),
            inclusive: form.get(`inclusive:${item.id}`) === 'on',
            substitution: String(form.get(`substitution:${item.id}`) ?? ''),
          })),
        });
        setMessage('');
      }
      catch (problem) {
        showProblem(
          problem instanceof Error ? problem.message : 'Check your prices and delivery charge, then try again.',
          problem instanceof QuoteReviewError ? problem.field : undefined,
        );
      }
      return;
    }
    setSubmitting(true);
    setMessage('');
    const items = request.items.map((item) => {
      if (form.get(`noQuote:${item.id}`) === 'on') {
        return { requestItemId: item.id, noQuote: true };
      }
      return {
        requestItemId: item.id,
        noQuote: false,
        availableQuantity: String(form.get(`quantity:${item.id}`) ?? ''),
        unit: item.unit,
        unitRateInr: String(form.get(`rate:${item.id}`) ?? ''),
        gstPercent: String(form.get(`gst:${item.id}`) ?? ''),
        taxInclusive: form.get(`inclusive:${item.id}`) === 'on',
        suppliedBrand: latestByItem.get(item.id)?.suppliedBrand ?? null,
        suppliedPackSize: latestByItem.get(item.id)?.suppliedPackSize ?? null,
        suppliedQualityGrade:
          latestByItem.get(item.id)?.suppliedQualityGrade ?? null,
        substitution: String(form.get(`substitution:${item.id}`) ?? '') || null,
      };
    });
    const quote = {
      expectedLatestRevision: request.latestQuote?.revision ?? 0,
      deliveryDate: String(form.get('deliveryDate') ?? ''),
      validUntil: String(form.get('validUntil') ?? ''),
      minimumOrder: request.latestQuote?.minimumOrder ?? null,
      freightInr: String(form.get('freightInr') ?? ''),
      commercialTerms: String(form.get('commercialTerms') ?? '') || null,
      notes: String(form.get('notes') ?? '') || null,
      items,
    };

    try {
      const response = await fetch('/api/public/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(quote),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as
        | PublicQuoteDto
        | Record<string, unknown>
        | null;
      if (response.status === 409) {
        await onRefresh();
        showProblem('A newer quote was saved. Your entries are still here. Check the last sent total and review your entries before sending an update.');
        return;
      }
      if (!response.ok || !body || !('revision' in body)) {
        showProblem(firstProblem(body));
        return;
      }
      onSaved(body as PublicQuoteDto);
      setReview(null);
      setMessage(`Quote sent. Version ${body.revision} is saved with the restaurant.`);
    } catch {
      showProblem('Unable to send right now. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const latest = request.latestQuote;
  const instructions = deliveryInstructions(request.deliveryDetails);

  return (
    <form ref={formRef} className={styles.quoteForm} noValidate onSubmit={submit} onChange={() => { setReview(null); setError(null); }} aria-busy={submitting}>
      <fieldset className={styles.formFields} disabled={submitting}>
      <section className={styles.requestSummary} aria-labelledby="request-title">
        <div>
          <p className={styles.eyebrow}>Request from {request.restaurantName}</p>
          <h1 id="request-title">{request.title}</h1>
          <p className={styles.supplierGreeting}>For {request.supplierName}</p>
        </div>
        <dl className={styles.requestFacts}>
          <div>
            <dt>Quote by</dt>
            <dd>{dateTime(request.quoteDeadline)}</dd>
          </div>
          <div>
            <dt>Delivery date</dt>
            <dd>{request.deliveryDate}</dd>
          </div>
          <div>
            <dt>Delivery to</dt>
            <dd>{deliveryAddress(request.deliveryDetails)}</dd>
          </div>
          {instructions ? (
            <div>
              <dt>Delivery note</dt>
              <dd>{instructions}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {latest ? (
        <div className={styles.latestBanner}>
          <span>Last sent: version {latest.revision}</span>
          <strong>{formatInr(BigInt(latest.totalPaise))}</strong>
        </div>
      ) : null}

      <ol className={styles.steps} aria-label="Quote steps">
        <li aria-current={!review ? 'step' : undefined}>1. Enter prices</li>
        <li aria-current={review ? 'step' : undefined}>2. Check delivery &amp; total</li>
        <li>3. Send quote</li>
      </ol>

      <div className={styles.entry} hidden={Boolean(review)}>
      <section className={styles.itemsSection} aria-labelledby="items-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="items-heading" ref={entryHeading} tabIndex={-1}>Enter your prices</h2>
          </div>
          <p>Price each item. Adjust the quantity if you can supply less.</p>
        </div>

        {!latest && request.previousPrices ? (
          <div className={styles.latestBanner}>
            <div>
              <p>Previous quote: {dateTime(request.previousPrices.submittedAt)}</p>
              <p>Fill blank prices and GST from your last quote. Check today’s quantities and delivery charge.</p>
            </div>
            <button className={styles.reuseButton} type="button" onClick={reusePreviousPrices} disabled={submitting}>
              Use previous prices
            </button>
          </div>
        ) : !latest ? <p>No matching previous prices available. Enter current prices below.</p> : null}

        <div className={styles.sheetHeader} aria-hidden="true">
          <span>Item</span><span>Requested</span><span>Your price</span><span>Supply quantity</span><span>Availability</span>
        </div>
        <div className={styles.quoteItems}>
          {request.items.map((item) => {
            const latestLine = latestByItem.get(item.id);
            const disabled = cannotSupply[item.id] ?? false;
            const unit = unitLabels[item.unit];
            return (
              <article className={styles.quoteItem} key={item.id} aria-labelledby={`item-${item.id}`}>
                <div className={`${styles.lineFields} ${styles.priceRow}`}>
                  <div className={styles.itemDescription}>
                    <h3 id={`item-${item.id}`}>{item.name}</h3>
                    {item.specification.referenceUrl ? (
                      <a
                        href={item.specification.referenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View food reference
                      </a>
                    ) : null}
                  </div>
                  <p className={styles.requestedQuantity}><span>Requested</span>{item.quantity} {unit}</p>
                  <label>
                    Price per {unit}
                    <span className={styles.moneyInput}>
                      <span aria-hidden="true">₹</span>
                      <input
                        name={`rate:${item.id}`}
                        {...fieldError(`rate:${item.id}`)}
                        inputMode="decimal"
                        placeholder="0.00"
                        defaultValue={inrInput(latestLine?.unitRatePaise)}
                        disabled={disabled}
                        required={!disabled}
                      />
                    </span>
                  </label>
                  <label>
                    Quantity you can supply
                    <input
                      name={`quantity:${item.id}`}
                      {...fieldError(`quantity:${item.id}`)}
                      inputMode="decimal"
                      defaultValue={latestLine?.availableQuantity ?? item.quantity}
                      disabled={disabled}
                      required={!disabled}
                    />
                  </label>
                  <label className={styles.noQuote}>
                    <input
                      type="checkbox"
                      name={`noQuote:${item.id}`}
                      defaultChecked={latestLine?.noQuote ?? false}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setCannotSupply((current) => ({
                          ...current,
                          [item.id]: checked,
                        }));
                      }}
                    />
                    Cannot supply this item
                  </label>
                </div>
                <div className={`${styles.lineFields} ${styles.taxFields}`}>
                  <label>
                    GST %
                    <input
                      name={`gst:${item.id}`}
                      {...fieldError(`gst:${item.id}`)}
                      inputMode="decimal"
                      defaultValue={gstInput(latestLine?.gstBasisPoints)}
                      disabled={disabled}
                      required={!disabled}
                    />
                  </label>
                  <label className={styles.checkField}>
                    <input
                      type="checkbox"
                      name={`inclusive:${item.id}`}
                      defaultChecked={latestLine?.taxInclusive ?? false}
                      disabled={disabled}
                    />
                    GST is included
                  </label>
                  <details className={styles.substitutionField} open={latestLine?.substitution ? true : undefined}>
                    <summary>Different item or pack? Add a note (optional)</summary>
                  <label>
                    Item or pack note
                    <input
                      name={`substitution:${item.id}`}
                      {...fieldError(`substitution:${item.id}`)}
                      maxLength={500}
                      defaultValue={latestLine?.substitution ?? ''}
                      disabled={disabled}
                    />
                  </label>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.commercialSection} aria-labelledby="commercial-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="commercial-heading">Delivery &amp; terms</h2>
          </div>
        </div>
        <div className={styles.commercialGrid}>
          <label>
            Delivery date
            <input
              type="date"
              name="deliveryDate"
              {...fieldError('deliveryDate')}
              defaultValue={latest?.deliveryDate ?? request.deliveryDate}
              required
            />
          </label>
          <label>
            Quote valid until
            <input
              type="date"
              name="validUntil"
              {...fieldError('validUntil')}
              defaultValue={latest?.validUntil ?? request.quoteDeadline.slice(0, 10)}
              required
            />
          </label>
          <label>
            Delivery charge
            <span className={styles.moneyInput}>
              <span aria-hidden="true">₹</span>
              <input
                name="freightInr"
                {...fieldError('freightInr')}
                inputMode="decimal"
                defaultValue={inrInput(latest?.freightPaise) || '0'}
                required
              />
            </span>
          </label>
          <label className={styles.wideField}>
            Payment terms
            <textarea
              name="commercialTerms"
              {...fieldError('commercialTerms')}
              maxLength={2_000}
              defaultValue={latest?.commercialTerms ?? request.commercialTerms ?? ''}
            />
          </label>
          <details className={styles.wideField} open={latest?.notes ? true : undefined}>
            <summary>Add a note to the restaurant (optional)</summary>
          <label>
            Note to the restaurant
            <textarea name="notes" {...fieldError('notes')} maxLength={4_000} defaultValue={latest?.notes ?? ''} />
          </label>
          </details>
        </div>
      </section>
      </div>

      {review && <section className={styles.review} aria-labelledby="review-heading">
        <h2 id="review-heading" ref={reviewHeading} tabIndex={-1}>Review your quote</h2>
        <p>Check what you can supply and the total before sending to {request.restaurantName}.</p>
        <ul className={styles.reviewItems}>{review.items.map((item, index) => <li key={request.items[index].id}>
          <span><strong>{item.name}</strong><small>{item.quantity ?? 'Cannot supply this item'}</small>
            {item.quantity && <small>₹{review.details[index].rate} per {unitLabels[request.items[index].unit]} · GST {review.details[index].gst}% {review.details[index].inclusive ? 'included' : 'extra'}</small>}
            {item.quantity && review.details[index].substitution && <small>Item or pack note: {review.details[index].substitution}</small>}
          </span>
          <strong>{item.quantity ? formatInr(item.total) : 'No quote'}</strong>
        </li>)}</ul>
        <dl className={styles.reviewTotals}>
          <div><dt>Items before GST</dt><dd>{formatInr(review.subtotal)}</dd></div>
          <div><dt>GST</dt><dd>{formatInr(review.gst)}</dd></div>
          <div><dt>Delivery charge</dt><dd>{formatInr(review.freight)}</dd></div>
          <div className={styles.grandTotal}><dt>Total to restaurant</dt><dd>{formatInr(review.total)}</dd></div>
          <div><dt>Delivery date</dt><dd>{review.deliveryDate}</dd></div>
          <div><dt>Prices valid until</dt><dd>{review.validUntil}</dd></div>
        </dl>
        {review.commercialTerms && <p><strong>Payment terms:</strong> {review.commercialTerms}</p>}
        {request.latestQuote?.minimumOrder && <p><strong>Minimum order:</strong> {request.latestQuote.minimumOrder}</p>}
        {review.notes && <p><strong>Note to the restaurant:</strong> {review.notes}</p>}
        <button type="button" className={styles.reuseButton} onClick={() => {
          returningToEntry.current = true;
          setReview(null);
        }}>Edit prices or delivery</button>
      </section>}
      {error && <p id="quote-error" className={styles.error} role="alert" ref={errorMessage} tabIndex={-1}>{error.message}</p>}
      {message && <p className={styles.notice} role="status">{message}</p>}
      <footer className={styles.submitBar}>
        <p>{review ? 'Ready? Send this quote to the restaurant.' : 'Review the total before sending your prices.'}</p>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : review ? latest ? 'Send updated quote' : 'Send quote' : 'Review delivery & total'}
        </button>
      </footer>
      </fieldset>
    </form>
  );
}
