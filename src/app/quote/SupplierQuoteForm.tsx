'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { PreviousQuotePrices } from '@/lib/quotes/previous-prices';
import type { ItemSpecificationV1 } from '@/lib/domain/item-specification';
import { formatInr } from '@/lib/domain/money';
import type { ProcurementUnit } from '@/lib/domain/quantity';
import { formatScaledDecimal } from '@/lib/domain/validation';

import styles from './quote-access.module.css';

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

  function reusePreviousPrices() {
    const form = formRef.current;
    if (!form || request.latestQuote || submitting) return;
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
      ? `Previous prices filled for ${filled} item${filled === 1 ? '' : 's'}. Review prices, GST, availability and terms before submitting.`
      : 'No blank eligible price rows to fill. Your entries were kept.');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
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
        setMessage('A newer quote was loaded. Check it and submit again.');
        return;
      }
      if (!response.ok || !body || !('revision' in body)) {
        setMessage(firstProblem(body));
        return;
      }
      onSaved(body as PublicQuoteDto);
      setMessage(`Revision ${body.revision} submitted successfully.`);
    } catch {
      setMessage('Unable to submit right now. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const latest = request.latestQuote;
  const instructions = deliveryInstructions(request.deliveryDetails);

  return (
    <form ref={formRef} className={styles.quoteForm} onSubmit={submit} aria-busy={submitting}>
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
          <span>Last submitted: revision {latest.revision}</span>
          <strong>{formatInr(BigInt(latest.totalPaise))}</strong>
        </div>
      ) : null}

      <section className={styles.itemsSection} aria-labelledby="items-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionNumber}>01</p>
            <h2 id="items-heading">Items and prices</h2>
          </div>
          <p>Enter the price for the same unit shown in each row.</p>
        </div>

        {!latest && request.previousPrices ? (
          <div className={styles.latestBanner}>
            <div>
              <p>Previous quote: {dateTime(request.previousPrices.submittedAt)}</p>
              <p>Reuse matching prices and GST in blank price rows. Confirm today’s availability,
                delivery, freight and payment terms before submitting.</p>
            </div>
            <button className={styles.reuseButton} type="button" onClick={reusePreviousPrices} disabled={submitting}>
              Use previous prices
            </button>
          </div>
        ) : !latest ? <p>No matching previous prices available. Enter current prices below.</p> : null}

        <div className={styles.quoteItems}>
          {request.items.map((item, index) => {
            const latestLine = latestByItem.get(item.id);
            const disabled = cannotSupply[item.id] ?? false;
            const unit = unitLabels[item.unit];
            return (
              <article className={styles.quoteItem} key={item.id}>
                <header>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{item.name}</h3>
                    <p>{item.quantity} {unit}</p>
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
                  <label className={styles.noQuote}>
                    <input
                      type="checkbox"
                      name={`noQuote:${item.id}`}
                      defaultChecked={latestLine?.noQuote ?? false}
                      onChange={(event) =>
                        setCannotSupply((current) => ({
                          ...current,
                          [item.id]: event.currentTarget.checked,
                        }))
                      }
                    />
                    Cannot supply this item
                  </label>
                </header>
                <div className={styles.lineFields}>
                  <label>
                    Available quantity
                    <input
                      name={`quantity:${item.id}`}
                      inputMode="decimal"
                      defaultValue={latestLine?.availableQuantity ?? item.quantity}
                      disabled={disabled}
                      required={!disabled}
                    />
                  </label>
                  <label>
                    Price per {unit}
                    <span className={styles.moneyInput}>
                      <span aria-hidden="true">₹</span>
                      <input
                        name={`rate:${item.id}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        defaultValue={inrInput(latestLine?.unitRatePaise)}
                        disabled={disabled}
                        required={!disabled}
                      />
                    </span>
                  </label>
                  <label>
                    GST %
                    <input
                      name={`gst:${item.id}`}
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
                  <label className={styles.substitutionField}>
                    Substitution or pack note (optional)
                    <input
                      name={`substitution:${item.id}`}
                      maxLength={500}
                      defaultValue={latestLine?.substitution ?? ''}
                      disabled={disabled}
                    />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.commercialSection} aria-labelledby="commercial-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionNumber}>02</p>
            <h2 id="commercial-heading">Delivery and terms</h2>
          </div>
        </div>
        <div className={styles.commercialGrid}>
          <label>
            Delivery date
            <input
              type="date"
              name="deliveryDate"
              defaultValue={latest?.deliveryDate ?? request.deliveryDate}
              required
            />
          </label>
          <label>
            Quote valid until
            <input
              type="date"
              name="validUntil"
              defaultValue={latest?.validUntil ?? request.quoteDeadline.slice(0, 10)}
              required
            />
          </label>
          <label>
            Freight / delivery charge
            <span className={styles.moneyInput}>
              <span aria-hidden="true">₹</span>
              <input
                name="freightInr"
                inputMode="decimal"
                defaultValue={inrInput(latest?.freightPaise) || '0'}
                required
              />
            </span>
          </label>
          <label className={styles.wideField}>
            Payment and commercial terms
            <textarea
              name="commercialTerms"
              maxLength={2_000}
              defaultValue={latest?.commercialTerms ?? request.commercialTerms ?? ''}
            />
          </label>
          <label className={styles.wideField}>
            Note to the restaurant (optional)
            <textarea name="notes" maxLength={4_000} defaultValue={latest?.notes ?? ''} />
          </label>
        </div>
      </section>

      <footer className={styles.submitBar}>
        <div>
          <p>Quote totals are calculated and checked by QuotePlate.</p>
          <div role="status" aria-live="polite">{message}</div>
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : latest ? 'Submit new revision' : 'Submit quote'}
        </button>
      </footer>
    </form>
  );
}
