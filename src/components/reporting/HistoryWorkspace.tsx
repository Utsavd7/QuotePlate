'use client';

import { ArrowRight, CalendarDays, CopyPlus, FileClock, History, ListChecks, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';

import {
  workspaceFetch,
  workspaceMutationFetch,
} from '@/lib/client/workspace-prefetch';
import { formatInr } from '@/lib/domain/money';
import { WorkspaceHeader } from '../workspace/Workspace';
import styles from './reporting.module.css';

type HistoryRequest = {
  id: string;
  title: string;
  status: 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';
  version: number;
  deliveryDate: string;
  quoteDeadline: string;
  createdAt: string;
  openedAt: string | null;
  awardedAt: string | null;
  _count: { items: number; supplierRequests: number };
  respondingSupplierCount: number;
  quoteRevisionCount: number;
  award: null | {
    id: string;
    totalPaise: string;
    createdAt: string;
    supplierCount: number;
    receiving: {
      checkedCount: number;
      totalCount: number;
      complete: boolean;
      problemCount: number;
    } | null;
  };
};

type RepeatSource = Pick<HistoryRequest, 'id' | 'title' | 'status' | 'version'>;

type QuoteRevision = {
  id: string;
  requestId: string;
  requestTitle: string;
  supplierName: string;
  revision: number;
  submittedAt: string;
  totalPaise: string;
};

type ActivityRecord = {
  id: string;
  label: string;
  actorName: string;
  createdAt: string;
};

type HistoryPageData = {
  requests: HistoryRequest[];
  nextCursor: string | null;
  recentQuoteRevisions: QuoteRevision[];
  recentActivity: ActivityRecord[];
};

type HistoryError =
  | { message: string; kind: 'load'; cursor: string | null }
  | { message: string; kind: 'operation' }
  | null;

const statusLabel = { DRAFT: 'Not sent', OPEN: 'Waiting for suppliers', AWARDED: 'Supplier selected', CANCELLED: 'Cancelled' } as const;

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date);
}

function displayDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  }).format(date);
}

function indiaDeadlineIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return '';
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function defaultRepeat(request: RepeatSource) {
  const now = new Date();
  const india = new Date(now.getTime() + 330 * 60 * 1_000);
  const delivery = new Date(india);
  delivery.setUTCDate(delivery.getUTCDate() + 7);
  const deadline = new Date(delivery);
  deadline.setUTCDate(deadline.getUTCDate() - 1);
  deadline.setUTCHours(12, 0, 0, 0);
  const deliveryDate = delivery.toISOString().slice(0, 10);
  return {
    title: `${request.title} · ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${deliveryDate}T00:00:00+05:30`))}`.slice(0, 160),
    deliveryDate,
    quoteDeadline: deadline.toISOString().slice(0, 16),
  };
}

export async function resolveRepeatSource(
  requestId: string | null,
  pageRequests: RepeatSource[],
  loadRequest: (requestId: string) => Promise<RepeatSource | null>,
) {
  if (!requestId) return null;
  const visible = pageRequests.find((request) => request.id === requestId);
  const source = visible ?? await loadRequest(requestId);
  return source?.id === requestId && source.status === 'AWARDED' ? source : null;
}

async function responseProblem(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { detail?: string };
  return body.detail || fallback;
}

export function HistoryWorkspace({ initialPage }: { initialPage?: HistoryPageData }) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialPage?.requests ?? []);
  const [nextCursor, setNextCursor] = useState(initialPage?.nextCursor ?? null);
  const [recentQuoteRevisions, setRecentQuoteRevisions] = useState(initialPage?.recentQuoteRevisions ?? []);
  const [recentActivity, setRecentActivity] = useState(initialPage?.recentActivity ?? []);
  const [loading, setLoading] = useState(!initialPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<HistoryError>(null);
  const [repeatSource, setRepeatSource] = useState<RepeatSource | null>(null);
  const [repeatValues, setRepeatValues] = useState({ title: '', deliveryDate: '', quoteDeadline: '' });
  const [repeating, setRepeating] = useState(false);
  const started = useRef(false);
  const repeatLinkHandled = useRef(false);
  const repeatDialog = useRef<HTMLFormElement>(null);
  const repeatingRef = useRef(false);

  async function load(cursor?: string) {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: '25' });
      if (cursor) query.set('cursor', cursor);
      const response = await (cursor
        ? fetch(`/api/history?${query}`, { cache: 'no-store' })
        : workspaceFetch('/api/history?limit=25', { cache: 'no-store' }));
      if (!response.ok) throw new Error(await responseProblem(response, 'We could not load procurement history.'));
      const page = (await response.json()) as HistoryPageData;
      setRequests((current) => cursor ? [...current, ...page.requests] : page.requests);
      setNextCursor(page.nextCursor);
      if (!cursor) {
        setRecentQuoteRevisions(page.recentQuoteRevisions);
        setRecentActivity(page.recentActivity);
        if (!repeatLinkHandled.current) {
          const requestId = new URLSearchParams(window.location.search).get('repeat');
          repeatLinkHandled.current = true;
          if (requestId) {
            try {
              const request = await resolveRepeatSource(
                requestId,
                page.requests,
                async (id) => {
                  const sourceResponse = await fetch(
                    `/api/requests/${encodeURIComponent(id)}`,
                    { cache: 'no-store' },
                  );
                  if (!sourceResponse.ok) return null;
                  const result = (await sourceResponse.json()) as {
                    request?: RepeatSource;
                  };
                  return result.request ?? null;
                },
              );
              if (request) {
                repeatingRef.current = false;
                setRepeating(false);
                setRepeatSource(request);
                setRepeatValues(defaultRepeat(request));
                setError(null);
              } else {
                setError({
                  message: 'This completed order could not be prepared for repeating.',
                  kind: 'operation',
                });
              }
            } catch {
              setError({
                message: 'This completed order could not be prepared for repeating.',
                kind: 'operation',
              });
            }
          }
        }
      }
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'We could not load procurement history.',
        kind: 'load',
        cursor: cursor ?? null,
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (initialPage || started.current) return;
    started.current = true;
    void load();
  }, [initialPage]);

  useEffect(() => {
    if (!repeatSource) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = repeatDialog.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !repeatingRef.current) {
        event.preventDefault();
        setRepeatSource(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [repeatSource]);

  function openRepeat(request: RepeatSource) {
    repeatingRef.current = false;
    setRepeating(false);
    setRepeatSource(request);
    setRepeatValues(defaultRepeat(request));
    setError(null);
  }

  async function repeat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repeatSource || repeating) return;
    const deadline = indiaDeadlineIso(repeatValues.quoteDeadline);
    if (!repeatValues.title.trim() || !repeatValues.deliveryDate || !deadline) return;
    repeatingRef.current = true;
    setRepeating(true);
    setError(null);
    try {
      const response = await workspaceMutationFetch(`/api/requests/${encodeURIComponent(repeatSource.id)}/repeat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedSourceVersion: repeatSource.version,
          title: repeatValues.title.trim(),
          deliveryDate: repeatValues.deliveryDate,
          quoteDeadline: deadline,
        }),
      });
      if (!response.ok) throw new Error(await responseProblem(response, 'We could not create the repeated request.'));
      const result = (await response.json()) as { request?: { id: string } };
      if (!result.request?.id) throw new Error('The new draft was not returned.');
      router.push(`/procurement/${encodeURIComponent(result.request.id)}`);
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'We could not create the repeated request.',
        kind: 'operation',
      });
      repeatingRef.current = false;
      setRepeating(false);
    }
  }

  return (
    <main className={styles.page}>
      <WorkspaceHeader title="Past purchases" description="Find earlier requests and decisions, then repeat a purchase when needed." actions={
        <button className={styles.headerButton} type="button" onClick={() => router.push('/procurement/new')}><CopyPlus aria-hidden="true" />Ask suppliers for prices</button>
      } />
      {error && <div className={styles.error} role="alert">{error.message}{error.kind === 'load' && <> Your saved restaurant records are unchanged. <button type="button" onClick={() => void load(error.cursor ?? undefined)}>Try again</button></>}</div>}
      {loading ? <div className={styles.loading} aria-label="Loading history"><span /><span /><span /></div> : error?.kind === 'load' && requests.length === 0 ? null : requests.length === 0 ? (
        <section className={styles.empty}><History aria-hidden="true" /><p>No procurement history yet</p><h2>Your buying record starts when you send a request</h2><span>Sent requests, supplier response counts and awards will remain available here.</span><button type="button" onClick={() => router.push('/procurement/new')}>Ask suppliers for prices <ArrowRight aria-hidden="true" /></button></section>
      ) : (
        <section className={styles.historyPanel}>
          <div className={styles.historyHeader}><span>Request</span><span>Delivery</span><span>Suppliers</span><span>Quote versions</span><span>Final value</span><span>Status</span><span /></div>
          {requests.map((request) => (
            <article className={styles.historyRow} key={request.id}>
              <button className={styles.historyOpen} type="button" onClick={() => router.push(`/procurement/${encodeURIComponent(request.id)}`)} aria-label={`Open ${request.title}`} />
              <span className={styles.historyTitle}><strong>{request.title}</strong><small>Created {displayDate(request.createdAt)} · {request._count.items} {request._count.items === 1 ? 'item' : 'items'}</small></span>
              <span className={styles.historyDate}><span className={styles.compactLabel}>Delivery date</span><CalendarDays aria-hidden="true" />{displayDate(request.deliveryDate)}</span>
              <span className={styles.historyCount}><span className={styles.compactLabel}>Suppliers</span><strong>{request._count.supplierRequests}</strong><small>{request.respondingSupplierCount} replied</small></span>
              <span className={styles.historyRevisions}><strong>{request.quoteRevisionCount}</strong><small>quote versions</small></span>
              <span className={styles.historyValue}><span className={styles.compactLabel}>Order total</span>{request.award ? <>
                <strong>{formatInr(request.award.totalPaise)}</strong>
                <small>{request.award.supplierCount} winning {request.award.supplierCount === 1 ? 'supplier' : 'suppliers'}</small>
                {request.award.receiving && <small>
                  Delivery {request.award.receiving.checkedCount} of {request.award.receiving.totalCount} checked
                  {request.award.receiving.problemCount > 0 && ` · ${request.award.receiving.problemCount} ${request.award.receiving.problemCount === 1 ? 'problem' : 'problems'}`}
                </small>}
              </> : 'Not available'}</span>
              <i className={styles[`history${request.status}`]}>{statusLabel[request.status]}</i>
              <span className={styles.historyActions}>{request.status === 'AWARDED' && <button type="button" onClick={() => openRepeat(request)}><CopyPlus aria-hidden="true" />Repeat order</button>}<ArrowRight aria-hidden="true" /></span>
            </article>
          ))}
          {nextCursor && <button className={styles.loadMore} type="button" disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? 'Loading…' : 'Load more history'}</button>}
        </section>
      )}

      {(recentQuoteRevisions.length > 0 || recentActivity.length > 0) && (
        <section className={styles.recordGrid} aria-label="Recent procurement records">
          <article className={styles.recordPanel}>
            <header><div><p>Supplier records</p><h2>Quote versions</h2></div><FileClock aria-hidden="true" /></header>
            {recentQuoteRevisions.length === 0 ? <p className={styles.recordEmpty}>No supplier quote versions yet.</p> : (
              <ol>
                {recentQuoteRevisions.map((quote) => (
                  <li key={quote.id}>
                    <button type="button" onClick={() => router.push(`/procurement/${encodeURIComponent(quote.requestId)}`)}>
                      <span><strong>{quote.supplierName}</strong><small>{quote.requestTitle}</small></span>
                      <span><b>Version {quote.revision}</b><small>{formatInr(quote.totalPaise)} · {displayDateTime(quote.submittedAt)}</small></span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </article>
          <article className={styles.recordPanel}>
            <header><div><p>Accountable actions</p><h2>Recent activity</h2></div><ListChecks aria-hidden="true" /></header>
            {recentActivity.length === 0 ? <p className={styles.recordEmpty}>No recorded actions yet.</p> : (
              <ol>
                {recentActivity.map((activity) => (
                  <li key={activity.id} className={styles.activityRow}>
                    <span><strong>{activity.label}</strong><small>{activity.actorName}</small></span>
                    <time dateTime={activity.createdAt}>{displayDateTime(activity.createdAt)}</time>
                  </li>
                ))}
              </ol>
            )}
          </article>
        </section>
      )}

      {repeatSource && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !repeating) setRepeatSource(null); }}>
          <form className={styles.repeatDialog} onSubmit={repeat} ref={repeatDialog} role="dialog" aria-modal="true" aria-labelledby="repeat-title">
            <header><div><p>Repeat order</p><h2 id="repeat-title">Create a new draft</h2></div><button type="button" aria-label="Close repeat request" disabled={repeating} onClick={() => setRepeatSource(null)}><X aria-hidden="true" /></button></header>
            <p>The items, supplier list, delivery address and terms will be copied. The completed record stays unchanged.</p>
            <label><span>Request title *</span><input maxLength={160} value={repeatValues.title} onChange={(event) => setRepeatValues((current) => ({ ...current, title: event.target.value }))} /></label>
            <div className={styles.repeatDates}>
              <label><span>Delivery date *</span><input type="date" value={repeatValues.deliveryDate} onChange={(event) => setRepeatValues((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
              <label><span>Quote deadline (India time) *</span><input type="datetime-local" value={repeatValues.quoteDeadline} onChange={(event) => setRepeatValues((current) => ({ ...current, quoteDeadline: event.target.value }))} /></label>
            </div>
            <footer><button type="button" disabled={repeating} onClick={() => setRepeatSource(null)}>Cancel</button><button type="submit" disabled={repeating || !repeatValues.title.trim() || !repeatValues.deliveryDate || !indiaDeadlineIso(repeatValues.quoteDeadline)}>{repeating ? 'Creating…' : 'Create draft'}</button></footer>
          </form>
        </div>
      )}
    </main>
  );
}
