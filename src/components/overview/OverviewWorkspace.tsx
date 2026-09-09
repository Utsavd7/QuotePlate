'use client';

import { ArrowRight, CheckCircle2, ClipboardList, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceFetch } from '@/lib/client/workspace-prefetch';
import type { AttentionItem } from '@/lib/overview/overview-attention';
import type { OverviewData as ServiceOverviewData } from '@/lib/overview/overview-service';
import styles from './overview-workspace.module.css';
import { WorkspaceHeader } from '../workspace/Workspace';

export type OverviewData = ServiceOverviewData;

function groupIndianDigits(value: string) {
  if (value.length <= 3) return value;
  const lastThree = value.slice(-3);
  const leading = value.slice(0, -3);
  const pairs: string[] = [];
  for (let end = leading.length; end > 0; end -= 2) {
    pairs.unshift(leading.slice(Math.max(0, end - 2), end));
  }
  return `${pairs.join(',')},${lastThree}`;
}

export function formatInrFromPaise(value: string) {
  const digits = /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, '') : '0';
  const padded = digits.padStart(3, '0');
  const rupees = padded.slice(0, -2);
  const paise = padded.slice(-2);
  return `₹${groupIndianDigits(rupees)}.${paise}`;
}

async function responseMessage(response: Response) {
  const value = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
  };
  return value.detail || value.error || 'We could not load your overview.';
}

function OverviewLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Loading your procurement overview">
      <div className={styles.loadingHeader} aria-hidden="true"><span /><span /></div>
      <p className={styles.loadingLabel} role="status">Loading your procurement overview</p>
      <div className={styles.loadingPanels} aria-hidden="true"><span /><span /></div>
    </main>
  );
}

function OverviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className={styles.page}>
      <section className={styles.errorState} role="alert">
        <span className={styles.errorMark}><RefreshCw aria-hidden="true" /></span>
        <p className={styles.eyebrow}>Overview unavailable</p>
        <h1>We could not load your overview.</h1>
        <p>{message}</p>
        <p>Your saved restaurant records are unchanged.</p>
        <button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" /> Try again</button>
      </section>
    </main>
  );
}

function actionFor(item: AttentionItem) {
  const base = `/procurement/${encodeURIComponent(item.requestId)}`;
  switch (item.kind) {
    case 'delivery': return {
      label: item.pendingDeliveries ? 'Check delivery' : 'Follow up credit',
      href: `${base}#delivery-check-heading`,
      detail: [
        item.pendingDeliveries ? `${item.pendingDeliveries} ${item.pendingDeliveries === 1 ? 'delivery needs' : 'deliveries need'} checking` : '',
        item.creditRemainingPaise !== '0' ? `${formatInrFromPaise(item.creditRemainingPaise)} credit still owed` : '',
      ].filter(Boolean).join(' · '),
    };
    case 'compare': return {
      label: 'Compare prices', href: `${base}#purchase-comparison`,
      detail: `${item.replies} supplier ${item.replies === 1 ? 'reply' : 'replies'} received`,
    };
    case 'expired': return { label: 'Review request', href: base, detail: 'Reply deadline passed. No replies received.' };
    case 'draft': return { label: 'Continue draft', href: base, detail: 'Saved draft · Not sent to suppliers' };
  }
}

export function OverviewWorkspace({
  initialData,
  initialError,
}: {
  initialData?: OverviewData;
  initialError?: string;
}) {
  const [data, setData] = useState<OverviewData | null>(initialData ?? null);
  const [loading, setLoading] = useState(initialData === undefined && initialError === undefined);
  const [error, setError] = useState(initialError ?? '');
  const initialLoadStarted = useRef(false);

  const loadOverview = useCallback(async (signal?: AbortSignal, usePrefetch = false) => {
    setLoading(true);
    setError('');
    try {
      const response = await (usePrefetch
        ? workspaceFetch('/api/overview', { cache: 'no-store', signal })
        : fetch('/api/overview', { cache: 'no-store', signal }));
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = (await response.json()) as { overview?: OverviewData };
      if (!result.overview) throw new Error('The overview response was incomplete.');
      setData(result.overview);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'We could not load your overview.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialData !== undefined || initialError !== undefined || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    const controller = new AbortController();
    void loadOverview(controller.signal, true);
    return () => controller.abort();
  }, [initialData, initialError, loadOverview]);

  if (loading && !data) return <OverviewLoading />;
  if (error && !data) return <OverviewError message={error} onRetry={() => void loadOverview()} />;
  if (!data) return <OverviewLoading />;

  const items = data.attention.items;
  const needsSuppliers = data.counts.activeSuppliers === 0;
  const needsMenu = data.counts.menus.approved === 0;
  const firstPurchase = Object.values(data.counts.requests).every(count => count === 0);

  return (
    <main className={styles.page}>
      <WorkspaceHeader title="Today" description="See what needs doing. Pick a purchase to continue." actions={
        <Link className={styles.primaryAction} href="/procurement/new">New purchase <ArrowRight aria-hidden="true" /></Link>
      } />
      {error && <div className={styles.inlineError} role="alert">
        <span>{error} The last loaded information remains on screen.</span>
        <button type="button" onClick={() => void loadOverview()}>Try again</button>
      </div>}
      <section className={styles.panel} aria-labelledby="attention-title">
        <header><h2 id="attention-title">Needs your attention</h2></header>
        {items.length ? (
          <ul className={styles.workList}>
            {items.map(item => {
              const action = actionFor(item);
              return <li key={item.requestId}>
                <div className={styles.workCopy}><h3>{item.title}</h3><p>{action.detail}</p></div>
                <Link className={styles.workAction} href={action.href} aria-label={`${action.label} for ${item.title}`}>
                  {action.label}<ArrowRight aria-hidden="true" />
                </Link>
              </li>;
            })}
          </ul>
        ) : firstPurchase && (needsSuppliers || needsMenu) ? (
          <div className={styles.emptyState}>
            <ClipboardList aria-hidden="true" />
            <h3>Get ready for your first purchase</h3>
            <p>{needsSuppliers ? 'Start with a supplier you already buy from.' : 'Add and approve a menu so you can choose what to buy.'}</p>
            <Link className={styles.workAction} href={needsSuppliers ? '/suppliers' : '/menus'}>
              {needsSuppliers ? 'Add suppliers' : 'Review your menu'}<ArrowRight aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <CheckCircle2 aria-hidden="true" />
            <h3>{firstPurchase ? 'Ready for your first purchase' : 'You’re up to date'}</h3>
            <p>{firstPurchase ? 'Use New purchase to ask your suppliers for prices.' : data.counts.requests.open > 0
              ? 'Your suppliers can still reply. Come back to compare their prices.'
              : 'No drafts, replies or delivery follow-ups need your attention right now.'}</p>
          </div>
        )}
        <footer className={styles.queueFooter}>
          <p>{data.attention.hasMore ? 'More purchases need attention. Open all purchases to see the rest.' : 'Find every request and past order in Purchases.'}</p>
          <Link href="/procurement">View all purchases <ArrowRight aria-hidden="true" /></Link>
        </footer>
      </section>
    </main>
  );
}
