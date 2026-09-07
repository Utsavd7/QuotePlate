'use client';

import { ArrowRight, BarChart3, CheckCircle2, IndianRupee, RefreshCw, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { workspaceFetch } from '@/lib/client/workspace-prefetch';
import { formatInr } from '@/lib/domain/money';
import styles from './reporting.module.css';

type FactualInsights = {
  generatedAt: string;
  capped: boolean;
  summary: {
    requestSampleSize: number;
    supplierRequestsSent: number;
    supplierResponses: number;
    responseRatePercent: string | null;
    quoteLinesExpected: number;
    quoteLinesFullyCovered: number;
    quotedLineCoveragePercent: string | null;
    awardedRequestCount: number;
    totalAwardedPaise: string;
  };
  priceRanges: Array<{
    itemName: string;
    unit: string;
    quoteCount: number;
    minimumUnitRatePaise: string;
    maximumUnitRatePaise: string;
    minimumSupplierName: string;
    maximumSupplierName: string;
    observedVariancePercent: string | null;
  }>;
  historyGuidance: Array<{
    itemKey: string;
    itemName: string;
    unit: string;
    lastOrderedQuantity: string | null;
    lastOrderedAt: string | null;
    lastSupplierNames: string[];
    seasonalNotice: string | null;
    unusualQuantityNotice: string | null;
  }>;
  notes: string[];
};

function unitLabel(unit: string) {
  return ({ KILOGRAM: 'kg', GRAM: 'g', LITRE: 'L', MILLILITRE: 'ml', PIECE: 'piece', PACK: 'pack', CASE: 'case', CRATE: 'crate' } as Record<string, string>)[unit] ?? unit.toLowerCase();
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

async function problem(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { detail?: string };
  return body.detail || 'We could not load procurement insights.';
}

export function InsightsWorkspace({ initialData }: { initialData?: FactualInsights }) {
  const [data, setData] = useState<FactualInsights | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState('');
  const started = useRef(false);

  async function load(usePrefetch = false) {
    setLoading(true);
    setError('');
    try {
      const response = await (usePrefetch
        ? workspaceFetch('/api/insights', { cache: 'no-store' })
        : fetch('/api/insights', { cache: 'no-store' }));
      if (!response.ok) throw new Error(await problem(response));
      setData((await response.json()) as FactualInsights);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load procurement insights.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialData || started.current) return;
    started.current = true;
    void load(true);
  }, [initialData]);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p>Submitted facts only</p><h1>Savings and prices</h1><span>See supplier response, submitted price differences, and facts from previous buying.</span></div>
        <button type="button" disabled={loading} onClick={() => void load()}><RefreshCw aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}</button>
      </header>
      <p><Link href="/supplier-performance">See delivery performance and credits owed</Link> · <Link href="/service-planning">Plan ingredients for today’s service</Link></p>
      {error && <div className={styles.error} role="alert">{error} Your saved restaurant records are unchanged.</div>}
      {loading && !data ? <div className={styles.loading} aria-label="Loading insights"><span /><span /><span /></div> : data && data.summary.requestSampleSize > 0 ? (
        <>
          <section className={styles.metrics} aria-label="Procurement summary">
            <article><Users aria-hidden="true" /><span><small>Supplier response</small><strong>{data.summary.responseRatePercent ?? 'Not available'}{data.summary.responseRatePercent ? '%' : ''}</strong><em>{data.summary.supplierResponses} of {data.summary.supplierRequestsSent} requested suppliers</em></span></article>
            <article><CheckCircle2 aria-hidden="true" /><span><small>Full line coverage</small><strong>{data.summary.quotedLineCoveragePercent ?? 'Not available'}{data.summary.quotedLineCoveragePercent ? '%' : ''}</strong><em>{data.summary.quoteLinesFullyCovered} of {data.summary.quoteLinesExpected} expected quote lines</em></span></article>
            <article><IndianRupee aria-hidden="true" /><span><small>Awarded value</small><strong>{formatInr(data.summary.totalAwardedPaise)}</strong><em>{data.summary.awardedRequestCount} completed {data.summary.awardedRequestCount === 1 ? 'award' : 'awards'}</em></span></article>
            <article><BarChart3 aria-hidden="true" /><span><small>Requests in this view</small><strong>{data.summary.requestSampleSize}</strong><em>{data.capped ? 'Latest 50 requests' : 'All open and awarded requests'}</em></span></article>
          </section>

          <section className={styles.panel}>
            <header><div><p>Observed quote range</p><h2>Where submitted unit rates differ</h2></div><span>{data.priceRanges.length} comparable {data.priceRanges.length === 1 ? 'item' : 'items'}</span></header>
            {data.priceRanges.length === 0 ? <div className={styles.inlineEmpty}><h3>More comparable quotes are needed</h3><p>A price range appears after at least two suppliers quote the same requested item in comparable units.</p></div> : (
              <div className={styles.rangeTable} role="region" aria-label="Observed supplier price ranges" tabIndex={0}>
                <div className={styles.rangeHeader}><span>Item</span><span>Lowest submitted</span><span>Highest submitted</span><span>Observed difference</span><span>Evidence</span></div>
                {data.priceRanges.map((range) => (
                  <div className={styles.rangeRow} key={`${range.itemName}:${range.unit}`}>
                    <span><strong>{range.itemName}</strong><small>per {unitLabel(range.unit)}</small></span>
                    <span><strong>{formatInr(range.minimumUnitRatePaise)}</strong><small>{range.minimumSupplierName}</small></span>
                    <span><strong>{formatInr(range.maximumUnitRatePaise)}</strong><small>{range.maximumSupplierName}</small></span>
                    <span><strong>{range.observedVariancePercent ? `${range.observedVariancePercent}%` : 'Not available'}</strong><small>range, not savings</small></span>
                    <span>{range.quoteCount} quotes</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          {data.historyGuidance.length > 0 && (
            <section className={`${styles.panel} ${styles.guidancePanel}`}>
              <header><div><p>From your own records</p><h2>Previous buying guidance</h2></div><span>{data.historyGuidance.length} items</span></header>
              <div className={styles.guidanceGrid}>
                {data.historyGuidance.map((item) => (
                  <article key={`${item.itemKey}:${item.unit}`}>
                    <strong>{item.itemName}</strong>
                    {item.lastOrderedQuantity && item.lastOrderedAt ? (
                      <p>Last ordered {item.lastOrderedQuantity} {unitLabel(item.unit)} on {shortDate(item.lastOrderedAt)}</p>
                    ) : <p>No previous award for this item yet.</p>}
                    {item.lastSupplierNames.length > 0 && <small>Previously supplied by {item.lastSupplierNames.join(', ')}</small>}
                    {item.seasonalNotice && <em>{item.seasonalNotice}</em>}
                    {item.unusualQuantityNotice && <em>{item.unusualQuantityNotice}</em>}
                  </article>
                ))}
              </div>
            </section>
          )}
          <aside className={styles.method}><strong>How to read this</strong>{data.notes.map((note) => <p key={note}>{note}</p>)}</aside>
        </>
      ) : data ? (
        <section className={styles.empty}>
          <BarChart3 aria-hidden="true" /><p>Insights start with real supplier responses</p><h2>Collect your first comparable quotes</h2><span>Open a procurement request and share the secure supplier links. This page will use only submitted records.</span>
          <Link href="/procurement/new">Ask suppliers for prices <ArrowRight aria-hidden="true" /></Link>
        </section>
      ) : null}
    </main>
  );
}
