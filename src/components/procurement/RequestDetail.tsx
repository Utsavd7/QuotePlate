'use client';

import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Truck,
  Users,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { workspaceMutationFetch } from '@/lib/client/workspace-prefetch';
import { loadPurchase } from '@/lib/client/load-purchase';
import { formatIndiaDate as displayDate } from '@/lib/domain/india-date';
import { formatInr } from '@/lib/domain/money';
import type {
  RequestItemsV1,
  RequestSourcingV1,
} from '@/lib/procurement/request-document';
import {
  cappedAllocationQuantity,
  calculateSplitAwardPreview,
  type SplitAllocation,
} from '@/lib/awards/award-preview';
import { DraftRequestEditor } from './DraftRequestEditor';
import { DeliveryCheckPanel, type DeliveryReceivingSummary } from './DeliveryCheckPanel';
import { PurchaseJourney } from './PurchaseJourney';
import ui from './purchase-ui.module.css';
import styles from './request-detail.module.css';

type Status = 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';
type RequestItem = RequestItemsV1['items'][number];
type SupplierGrant = {
  id: string;
  supplierId: string;
  expiresAt: string;
  revokedAt: string | null;
  viewedAt: string | null;
  supplier: {
    id: string;
    businessName: string;
    contactName: string | null;
    phone: string | null;
    whatsappNumber: string | null;
    email: string | null;
    isActive: boolean;
  };
};

type ProcurementRequestDetail = {
  id: string;
  title: string;
  status: Status;
  version: number;
  deliveryDetails: { addressLine?: string; city?: string; state?: string; pin?: string; instructions?: string };
  deliveryDate: string;
  quoteDeadline: string;
  commercialTerms: string | null;
  items: RequestItemsV1;
  sourcing: RequestSourcingV1;
  supplierRequests: SupplierGrant[];
};

type ComparisonItem = {
  requestItemId: string;
  requestItemKey: string;
  requestItemName: string;
  requestedQuantity: string;
  requestUnit: string;
  requestedSpecification: Record<string, unknown>;
  suppliedSpecification: {
    brand: string | null;
    packSize: string | null;
    qualityGrade: string | null;
  };
  quotedAvailableQuantity: string | null;
  quotedUnit: string | null;
  normalizedAvailableQuantity: string | null;
  normalizedUnitRatePaise: string | null;
  unitComparable: boolean;
  coverage: 'FULL' | 'PARTIAL' | 'MISSING' | 'UNIT_MISMATCH' | 'NOT_REQUESTED';
  gstBasisPoints: number | null;
  taxInclusive: boolean;
  substitution: string | null;
  subtotalPaise: string;
  gstPaise: string;
  totalPaise: string;
};

type ComparisonQuote = {
  supplierRequestId: string;
  supplierName: string;
  supplierActive: boolean;
  revision: number;
  subtotalPaise: string;
  gstPaise: string;
  freightPaise: string;
  totalPaise: string;
  deliveryDate: string;
  validUntil: string;
  submittedAt: string;
  minimumOrder: string | null;
  commercialTerms: string | null;
  notes: string | null;
  coveredItemCount: number;
  totalItemCount: number;
  fullCoverage: boolean;
  deliveryFit: 'ON_OR_BEFORE' | 'AFTER_REQUESTED_DATE';
  expired: boolean;
  missingTerms: boolean;
  missingRequestItemIds: string[];
  partialRequestItemIds: string[];
  unitMismatchRequestItemIds: string[];
  substitutions: Array<{ requestItemId: string; text: string }>;
  items: ComparisonItem[];
};

type AwardSupplierSnapshot = {
  supplierId: string;
  supplierRequestId: string;
  quoteRevision: number;
  supplierName: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  freightPaise: string;
  deliveryDate: string;
  commercialTerms?: string | null;
  lines: Array<{ requestItemId: string; itemName: string }>;
};

type AwardDetail = {
  id: string;
  requestId: string;
  rationale: string | null;
  totalPaise: string;
  createdAt: string;
  splitAward: boolean;
  deliverySnapshot?: {
    requestTitle?: string;
    requestedDeliveryDate?: string;
    deliveryDetails?: ProcurementRequestDetail['deliveryDetails'];
  };
  suppliers: AwardSupplierSnapshot[];
  lines: Array<{
    requestItemId: string;
    supplierRequestId: string;
    supplierId: string;
    quoteRevision: number;
    quantity: string;
    unit: string;
    unitRatePaise: string;
    gstBasisPoints: number;
    subtotalPaise: string;
    gstPaise: string;
    totalPaise: string;
  }>;
  receiving?: DeliveryReceivingSummary;
};

type QuoteComparison = {
  request: {
    id: string;
    title: string;
    deliveryDate: string;
    quoteDeadline: string;
    commercialTerms: string | null;
    itemCount: number;
    items: RequestItem[];
    status?: Status;
    version?: number;
    award?: AwardDetail | null;
  };
  quotes: ComparisonQuote[];
};

type ShareLink = {
  supplierRequestId: string;
  supplierId: string;
  businessName?: string;
  url: string;
  expiresAt: string;
};

type SupplierApplicationLink = {
  url: string;
  expiresAt: string;
};

type RequestUiError = {
  message: string;
  kind: 'load' | 'operation';
} | null;

const statusLabel: Record<Status, string> = { DRAFT: 'Not sent', OPEN: 'Waiting for suppliers', AWARDED: 'Supplier selected', CANCELLED: 'Cancelled' };

function unitLabel(unit: string) {
  return ({ KILOGRAM: 'kg', GRAM: 'g', LITRE: 'L', MILLILITRE: 'ml', PIECE: 'piece', PACK: 'pack', CASE: 'case', CRATE: 'crate' } as Record<string, string>)[unit] ?? unit.toLowerCase();
}

async function problemMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
  return body.detail || body.error || fallback;
}

function grantState(grant: SupplierGrant, hasQuote: boolean) {
  if (grant.revokedAt) return 'Revoked';
  if (hasQuote) return 'Quoted';
  if (grant.viewedAt) return 'Viewed';
  return 'Not viewed';
}

export function SupplierFreshLinkActions({
  link,
  busy,
  onCopy,
  onWhatsApp,
  onQr,
}: {
  link: ShareLink;
  busy: boolean;
  onCopy: () => void;
  onWhatsApp: () => void;
  onQr: () => void;
}) {
  const supplier = link.businessName ?? 'supplier';
  return (
    <>
      <button type="button" disabled={busy} onClick={onCopy}>
        <Clipboard aria-hidden="true" />Copy
      </button>
      <button type="button" disabled={busy} onClick={onWhatsApp}>
        <MessageCircle aria-hidden="true" />WhatsApp
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label={`Download QR for ${supplier}`}
        onClick={onQr}
      >
        <QrCode aria-hidden="true" />QR
      </button>
    </>
  );
}

type RequestDetailProps = {
  requestId: string;
  initialRequest?: ProcurementRequestDetail;
  initialComparison?: QuoteComparison;
};

export function RequestDetail(props: RequestDetailProps) {
  return <RequestDetailContent key={props.requestId} {...props} />;
}

function RequestDetailContent({
  requestId,
  initialRequest,
  initialComparison,
}: RequestDetailProps) {
  const router = useRouter();
  const [request, setRequest] = useState<ProcurementRequestDetail | null>(initialRequest ?? null);
  const [comparison, setComparison] = useState<QuoteComparison | null>(initialComparison ?? null);
  const [confirmedAward, setConfirmedAward] = useState<AwardDetail | null>(() =>
    initialComparison?.request.id === requestId && initialComparison.request.award?.requestId === requestId
      ? initialComparison.request.award : null);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [applicationLink, setApplicationLink] = useState<SupplierApplicationLink | null>(null);
  const [loading, setLoading] = useState(!initialRequest);
  const [working, setWorking] = useState('');
  const [error, setError] = useState<RequestUiError>(null);
  const [notice, setNotice] = useState('');
  const [editingDraft, setEditingDraft] = useState(false);
  const [refreshingQuotes, setRefreshingQuotes] = useState(false);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [awardMode, setAwardMode] = useState<'WHOLE' | 'SPLIT'>('WHOLE');
  const [wholeSupplierRequestId, setWholeSupplierRequestId] = useState('');
  const [splitAllocations, setSplitAllocations] = useState<Record<string, SplitAllocation[]>>({});
  const [rationale, setRationale] = useState('');
  const purchaseLoad = useRef<AbortController | null>(null);
  const comparisonLoad = useRef<AbortController | null>(null);
  const comparisonEpoch = useRef(0);

  const acceptComparison = useCallback((next: QuoteComparison | null) => {
    setComparison(next);
    // Clearing prices for a refresh must not discard the server-confirmed award.
    // A completed comparison replaces the snapshot, including an explicit absence.
    if (next) setConfirmedAward(next.request.id === requestId && next.request.award?.requestId === requestId
      ? next.request.award : null);
  }, [requestId]);

  const loadComparison = useCallback(async (quiet = false) => {
    comparisonLoad.current?.abort();
    const controller = new AbortController();
    comparisonLoad.current = controller;
    const epoch = ++comparisonEpoch.current;
    if (!quiet) setRefreshingQuotes(true);
    try {
      const comparisonResponse = await fetch(
        `/api/requests/${encodeURIComponent(requestId)}/comparison`,
        { cache: 'no-store', signal: controller.signal },
      );
      if (!comparisonResponse.ok) {
        throw new Error(await problemMessage(comparisonResponse, 'We could not load supplier quotes.'));
      }
      const result = (await comparisonResponse.json()) as QuoteComparison;
      if (controller.signal.aborted || comparisonEpoch.current !== epoch) return;
      acceptComparison(result);
      if (!quiet) setNotice('Supplier quotes refreshed.');
    } catch (caught) {
      if (controller.signal.aborted || comparisonEpoch.current !== epoch) return;
      if (!quiet) {
        setError({
          message: caught instanceof Error ? caught.message : 'We could not load supplier quotes.',
          kind: 'load',
        });
      }
    } finally {
      if (!controller.signal.aborted && comparisonEpoch.current === epoch) setRefreshingQuotes(false);
    }
  }, [requestId, acceptComparison]);

  const loadAll = useCallback(async (showFailure = true) => {
    purchaseLoad.current?.abort();
    comparisonLoad.current?.abort();
    comparisonEpoch.current += 1;
    const controller = new AbortController();
    purchaseLoad.current = controller;
    setRefreshingQuotes(false);
    if (showFailure) setLoading(true);
    setError(null);
    try {
      await loadPurchase<ProcurementRequestDetail, QuoteComparison>(requestId, (loaded, needsComparison) => {
        setRequest(loaded);
        setLoadingComparison(needsComparison);
        if (showFailure) setLoading(false);
      }, acceptComparison, controller.signal);
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (!showFailure) throw caught;
      setError({
        message: caught instanceof Error ? caught.message : 'We could not load this request.',
        kind: 'load',
      });
    } finally {
      if (!controller.signal.aborted) {
        setLoadingComparison(false);
        if (showFailure) setLoading(false);
      }
    }
  }, [requestId, acceptComparison]);

  useEffect(() => {
    let disposed = false;
    // Defer load-state updates until after the mounting effect; cleanup can cancel
    // this scheduled work before it starts (including Strict Mode's first mount).
    if (!initialRequest) queueMicrotask(() => { if (!disposed) void loadAll(); });
    return () => {
      disposed = true;
      purchaseLoad.current?.abort();
      comparisonLoad.current?.abort();
      comparisonEpoch.current += 1;
    };
  }, [initialRequest, loadAll]);

  useEffect(() => {
    if (request?.status !== 'OPEN' || loadingComparison) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadComparison(true);
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadComparison, request?.status, loadingComparison]);

  const quoteByGrant = useMemo(() => new Map((comparison?.quotes ?? []).map((quote) => [quote.supplierRequestId, quote])), [comparison]);

  async function openRequest() {
    if (!request || request.status !== 'DRAFT' || working) return;
    if (!window.confirm('Open this request and create one private quote link for each supplier?')) return;
    setWorking('open');
    setError(null);
    try {
      const response = await workspaceMutationFetch(`/api/requests/${encodeURIComponent(request.id)}/open`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: request.version }),
      });
      if (!response.ok) throw new Error(await problemMessage(response, 'We could not open this request.'));
      const result = (await response.json()) as {
        request: ProcurementRequestDetail;
        links: ShareLink[];
        applicationLink?: SupplierApplicationLink;
      };
      setRequest(result.request);
      setShareLinks(result.links);
      setApplicationLink(result.applicationLink ?? null);
      setComparison({ request: { id: result.request.id, title: result.request.title, deliveryDate: result.request.deliveryDate.slice(0, 10), quoteDeadline: result.request.quoteDeadline, commercialTerms: result.request.commercialTerms, itemCount: result.request.items.items.length, items: result.request.items.items }, quotes: [] });
      setNotice(result.applicationLink
        ? 'Request opened. Share the private quote links and the new supplier application link below.'
        : 'Request opened. Copy and share each supplier link below.');
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'We could not open this request.',
        kind: 'operation',
      });
    } finally {
      setWorking('');
    }
  }

  async function changeLink(grant: SupplierGrant, action: 'rotate' | 'revoke') {
    if (!request || request.status !== 'OPEN' || working) return;
    if (action === 'revoke' && !window.confirm(`Revoke ${grant.supplier.businessName}'s quote link?`)) return;
    setWorking(`${action}:${grant.id}`);
    setError(null);
    try {
      const response = await workspaceMutationFetch(`/api/requests/${encodeURIComponent(request.id)}/links`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierRequestId: grant.id, expectedVersion: request.version, action }),
      });
      if (!response.ok) throw new Error(await problemMessage(response, `We could not ${action} this link.`));
      const result = (await response.json()) as { request: ProcurementRequestDetail; link?: { url: string; expiresAt: string } };
      setRequest(result.request);
      const freshLink = result.link;
      if (freshLink) {
        setShareLinks((current) => [
          ...current.filter(({ supplierRequestId }) => supplierRequestId !== grant.id),
          { supplierRequestId: grant.id, supplierId: grant.supplierId, businessName: grant.supplier.businessName, ...freshLink },
        ]);
        setNotice(`New link created for ${grant.supplier.businessName}. Share this link now; it is not stored in readable form.`);
      } else {
        setShareLinks((current) => current.filter(({ supplierRequestId }) => supplierRequestId !== grant.id));
        setNotice(`${grant.supplier.businessName}'s link was revoked.`);
      }
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : `We could not ${action} this link.`,
        kind: 'operation',
      });
    } finally {
      setWorking('');
    }
  }

  async function copyLink(link: ShareLink) {
    try {
      await navigator.clipboard.writeText(link.url);
      setNotice(`${link.businessName ?? 'Supplier'} link copied.`);
    } catch {
      setError({
        message: 'Copy was blocked by the browser. Select and copy the link manually.',
        kind: 'operation',
      });
    }
  }

  async function copyApplicationLink() {
    if (!applicationLink) return;
    try {
      await navigator.clipboard.writeText(applicationLink.url);
      setNotice('New supplier application link copied.');
    } catch {
      setError({
        message: 'Copy was blocked by the browser. Select and copy the link manually.',
        kind: 'operation',
      });
    }
  }

  function shareApplicationOnWhatsApp() {
    if (!applicationLink) return;
    const text = `Apply to quote for our restaurant: ${applicationLink.url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  async function saveDownload(response: Response, fallbackFilename: string) {
    if (!response.ok) throw new Error(await problemMessage(response, 'We could not prepare this download.'));
    const disposition = response.headers.get('content-disposition') ?? '';
    const filename = /filename="([a-z0-9][a-z0-9.-]{0,180})"/i.exec(disposition)?.[1] ?? fallbackFilename;
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  async function download(url: string, label: string, fallbackFilename: string) {
    if (working) return;
    setWorking(`download:${label}`);
    setError(null);
    try {
      await saveDownload(await fetch(url, { cache: 'no-store' }), fallbackFilename);
      setNotice(`${label} downloaded.`);
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : `We could not download ${label.toLowerCase()}.`,
        kind: 'operation',
      });
    } finally {
      setWorking('');
    }
  }

  async function downloadQr(link: ShareLink) {
    if (!request || working) return;
    setWorking(`qr:${link.supplierRequestId}`);
    setError(null);
    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(request.id)}/qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.url }),
      });
      await saveDownload(response, 'quoteplate-supplier-link.png');
      setNotice(`${link.businessName ?? 'Supplier'} QR downloaded.`);
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'We could not create this QR code.',
        kind: 'operation',
      });
    } finally {
      setWorking('');
    }
  }

  function whatsappLink(link: ShareLink) {
    const text = `Quote request from our restaurant: ${link.url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  const splitPreview = useMemo(() => comparison
    ? calculateSplitAwardPreview({
        requestItems: comparison.request.items,
        quotes: comparison.quotes.map((quote) => ({
          supplierRequestId: quote.supplierRequestId,
          quoteRevision: quote.revision,
          supplierName: quote.supplierName,
          freightPaise: quote.freightPaise,
          expired: quote.expired,
          supplierActive: quote.supplierActive,
          items: quote.items,
        })),
        allocations: splitAllocations,
      })
    : null, [comparison, splitAllocations]);
  const wholeQuote = comparison?.quotes.find(
    ({ supplierRequestId }) => supplierRequestId === wholeSupplierRequestId,
  );
  const wholeReady = Boolean(
    wholeQuote &&
    wholeQuote.fullCoverage &&
    wholeQuote.totalItemCount === comparison?.request.itemCount &&
    wholeQuote.items.every(({ coverage }) => coverage === 'FULL') &&
    !wholeQuote.expired &&
    wholeQuote.supplierActive,
  );
  const awardReady = Boolean(
    rationale.trim() && (awardMode === 'WHOLE' ? wholeReady : splitPreview?.ready),
  );

  function awardableLine(quote: ComparisonQuote, item: ComparisonItem) {
    return Boolean(
      item.unitComparable &&
      item.normalizedAvailableQuantity &&
      item.normalizedUnitRatePaise &&
      item.gstBasisPoints !== null &&
      !quote.expired &&
      quote.supplierActive,
    );
  }

  function addSplitAllocation(requested: RequestItem, quote: ComparisonQuote, item: ComparisonItem) {
    const normalizedAvailableQuantity = item.normalizedAvailableQuantity;
    if (!normalizedAvailableQuantity) return;
    setSplitAllocations((current) => {
      const currentRows = current[requested.id] ?? [];
      if (currentRows.some((allocation) =>
        allocation.supplierRequestId === quote.supplierRequestId &&
        allocation.quoteRevision === quote.revision
      )) return current;
      const coverage = splitPreview?.itemCoverage[requested.id];
      let amount: string;
      try {
        amount = cappedAllocationQuantity(
          coverage?.remaining ?? requested.quantity,
          normalizedAvailableQuantity,
        );
      } catch {
        return current;
      }
      return {
        ...current,
        [requested.id]: [
          ...currentRows,
          {
            supplierRequestId: quote.supplierRequestId,
            quoteRevision: quote.revision,
            quantity: amount,
          },
        ],
      };
    });
  }

  function updateSplitQuantity(
    requestItemId: string,
    supplierRequestId: string,
    quoteRevision: number,
    quantity: string,
  ) {
    if (!/^\d*(?:\.\d{0,3})?$/.test(quantity)) return;
    setSplitAllocations((current) => ({
      ...current,
      [requestItemId]: (current[requestItemId] ?? []).map((allocation) =>
        allocation.supplierRequestId === supplierRequestId &&
        allocation.quoteRevision === quoteRevision
          ? { ...allocation, quantity }
          : allocation,
      ),
    }));
  }

  function removeSplitAllocation(
    requestItemId: string,
    supplierRequestId: string,
    quoteRevision: number,
  ) {
    setSplitAllocations((current) => ({
      ...current,
      [requestItemId]: (current[requestItemId] ?? []).filter(
        (allocation) =>
          allocation.supplierRequestId !== supplierRequestId ||
          allocation.quoteRevision !== quoteRevision,
      ),
    }));
  }

  async function recordAward() {
    if (!request || !comparison || request.status !== 'OPEN' || !awardReady || working) return;
    const finalTotal = awardMode === 'WHOLE'
      ? wholeQuote?.totalPaise
      : splitPreview?.totalPaise;
    if (!finalTotal) return;
    if (!window.confirm(
      `Record the final award for ${formatInr(finalTotal)}? The supplier, quantities and prices cannot be edited afterwards.`,
    )) return;
    setWorking('award');
    setError(null);
    try {
      const body = awardMode === 'WHOLE'
        ? {
            mode: 'WHOLE',
            expectedRequestVersion: request.version,
            supplierRequestId: wholeQuote!.supplierRequestId,
            quoteRevision: wholeQuote!.revision,
            rationale: rationale.trim(),
          }
        : {
            mode: 'SPLIT', expectedRequestVersion: request.version, rationale: rationale.trim(),
            selections: splitPreview?.selections ?? [],
          };
      const response = await workspaceMutationFetch(`/api/requests/${encodeURIComponent(request.id)}/award`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await problemMessage(response, 'We could not record this award.'));
      comparisonEpoch.current += 1;
      const result = (await response.json()) as { award?: AwardDetail };
      if (!result.award || result.award.requestId !== request.id) throw new Error('The recorded supplier selection was not returned.');
      setConfirmedAward(result.award);
      const nextVersion = request.version + 1;
      setRequest((current) => current && current.id === request.id
        ? { ...current, status: 'AWARDED', version: nextVersion }
        : current);
      setComparison((current) => current
        ? {
            ...current,
            request: {
              ...current.request,
              status: 'AWARDED',
              version: nextVersion,
              award: result.award,
            },
          }
        : current);
      setNotice('Award recorded. The request and winning prices are now locked.');
      try {
        await loadAll(false);
      } catch {
        setError({
          message: 'Supplier selection was recorded, but the latest view could not be loaded.',
          kind: 'operation',
        });
      }
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'We could not record this award.',
        kind: 'operation',
      });
    } finally {
      setWorking('');
    }
  }

  if (loading) return <main className={`${styles.page} ${ui.surface}`}><div className={styles.loading} aria-label="Loading request"><span /><span /><span /></div></main>;
  if (!request) return <main className={`${styles.page} ${ui.surface}`}><section className={styles.missing}><h1>Request unavailable</h1><p>{error?.message || 'This request could not be found.'} Your saved restaurant records are unchanged.</p><button type="button" onClick={() => void loadAll()}>Try again</button></section></main>;

  const delivery = request.deliveryDetails;
  const committedAward = request.status === 'AWARDED' && confirmedAward?.requestId === request.id
    ? confirmedAward : null;
  return (
    <main className={`${styles.page} ${ui.surface}`}>
      <header className={styles.header}>
        <div>
          <button className={styles.back} type="button" onClick={() => router.push('/procurement')}><ArrowLeft aria-hidden="true" />Purchases</button>
          <p className={styles.eyebrow}>Purchase</p>
          <h1>{request.title}</h1>
          <div className={styles.headerMeta}>
            <span className={styles[`status${request.status}`]}>{statusLabel[request.status]}</span>
            <span>Version {request.version}</span>
            <span>{request.items.items.length} {request.items.items.length === 1 ? 'item' : 'items'}</span>
            <span>{request.supplierRequests.length} {request.supplierRequests.length === 1 ? 'supplier' : 'suppliers'}</span>
          </div>
        </div>
        {request.status === 'DRAFT' && (
          <div className={styles.headerActions}>
            <button className={styles.secondaryButton} type="button" disabled={Boolean(working)} onClick={() => setEditingDraft((current) => !current)}>
              <Pencil aria-hidden="true" />{editingDraft ? 'Close editor' : 'Edit draft'}
            </button>
            <button className={styles.primaryButton} type="button" disabled={Boolean(working) || editingDraft} onClick={() => void openRequest()}>
              <ExternalLink aria-hidden="true" />{working === 'open' ? 'Opening…' : 'Create supplier links'}
            </button>
          </div>
        )}
        {request.status === 'AWARDED' && <div className={styles.locked}><ShieldCheck aria-hidden="true" />Supplier choice saved</div>}
      </header>

      <PurchaseJourney
        current={request.status === 'DRAFT' ? 0 : request.status === 'OPEN' ? (wholeSupplierRequestId || awardMode === 'SPLIT' ? 2 : 1) : request.status === 'AWARDED' ? 3 : undefined}
        links={request.status === 'CANCELLED' ? undefined : {
          0: '#purchase-items',
          ...(request.status === 'OPEN' ? { 1: '#purchase-comparison', ...(comparison?.quotes.length ? { 2: '#purchase-choice' } : {}) } : {}),
          ...(committedAward?.receiving ? { 3: '#delivery-check-heading' } : {}),
        }}
      />
      {request.status === 'DRAFT' && <p className={ui.nextStep}>Review ingredients and suppliers, then create links to ask for prices. Nothing is shared automatically.</p>}
      {request.status === 'OPEN' && <p className={ui.nextStep}>{loadingComparison ? 'Your request is ready. Loading supplier prices…' : comparison?.quotes.length ? 'Compare prices below, then choose one supplier or split the order.' : 'Share each private supplier link below. Prices will appear here when suppliers reply.'}</p>}

      {notice && <div className={styles.notice} role="status"><Check aria-hidden="true" />{notice}</div>}
      {error && <div className={styles.error} role="alert">{error.message}{error.kind === 'load' && <> Your saved restaurant records are unchanged.</>}</div>}

      {request.status === 'DRAFT' && editingDraft && (
        <DraftRequestEditor
          request={request}
          onCancel={() => setEditingDraft(false)}
          onSaved={() => {
            setEditingDraft(false);
            setNotice('Draft changes saved. Review the facts once more before opening it.');
            void loadAll();
          }}
        />
      )}

      <section className={styles.facts} aria-label="Request facts">
        <div><CalendarDays aria-hidden="true" /><span><small>Quote deadline</small><strong>{displayDate(request.quoteDeadline, true)}</strong></span></div>
        <div><Truck aria-hidden="true" /><span><small>Delivery date</small><strong>{displayDate(request.deliveryDate)}</strong></span></div>
        <div><MapPin aria-hidden="true" /><span><small>Deliver to</small><strong>{[delivery.addressLine, delivery.city, delivery.state, delivery.pin].filter(Boolean).join(', ')}</strong></span></div>
      </section>
      {delivery.instructions && <aside className={styles.instructions}><strong>Delivery instructions</strong>{delivery.instructions}</aside>}

      <details id="purchase-items" className={ui.disclosure} open={request.status === 'DRAFT'}>
        <summary>Requested ingredients · {request.items.items.length} items</summary>
        <div className={styles.itemTable}>
          <div className={styles.tableHeader}><span>Item</span><span>Quantity</span></div>
          {request.items.items.map((item) => (
            <div className={styles.itemRow} key={item.id}>
              <span>
                <strong>{item.name}</strong>
                {item.specification.referenceUrl ? (
                  <a href={item.specification.referenceUrl} target="_blank" rel="noopener noreferrer">
                    View food reference <ExternalLink aria-hidden="true" />
                  </a>
                ) : null}
              </span>
              <span>{item.quantity} {unitLabel(item.unit)}</span>
            </div>
          ))}
        </div>
        {request.commercialTerms && <div className={styles.terms}><strong>Terms shared with suppliers</strong><p>{request.commercialTerms}</p></div>}
      </details>

      {committedAward?.receiving && (
        <DeliveryCheckPanel
          awardId={committedAward.id}
          requestId={request.id}
          receiving={committedAward.receiving}
          onSaved={async () => {
            await loadComparison(true);
            setNotice('Delivery check saved.');
          }}
        />
      )}

      {(request.status === 'OPEN' || request.status === 'AWARDED') && (
        <details id="purchase-comparison" className={ui.disclosure} open={request.status === 'OPEN'}>
          <summary>{request.status === 'AWARDED' ? 'Prices & decision history' : 'Compare prices'}</summary>
          <header className={styles.comparisonHeader}>
            <h2>Supplier prices</h2>
            <div className={styles.quoteHeaderAction}>
              <span>{loadingComparison ? 'Loading prices…' : `${comparison?.quotes.length ?? 0} received`}</span>
              {request.status === 'OPEN' && (
                <button type="button" disabled={refreshingQuotes || loadingComparison} onClick={() => void loadComparison()}>
                  <RefreshCw aria-hidden="true" />{refreshingQuotes ? 'Refreshing…' : 'Refresh quotes'}
                </button>
              )}
            </div>
          </header>
          {loadingComparison ? (
            <div className={styles.quoteEmpty} role="status">Loading supplier prices…</div>
          ) : !comparison && error ? (
            <div className={styles.quoteEmpty}><p>Supplier prices could not be loaded.</p><button type="button" onClick={() => void loadAll()}>Try again</button></div>
          ) : !comparison || comparison.quotes.length === 0 ? (
            <div className={styles.quoteEmpty}><MessageCircle aria-hidden="true" /><h3>Waiting for supplier quotes</h3><p>Submitted quotes will appear here with GST, freight, coverage and delivery facts.</p></div>
          ) : (
            <>
              <div className={styles.quoteCards}>
                {comparison.quotes.map((quote) => (
                  <article key={quote.supplierRequestId}>
                    <div className={styles.quoteTop}><span><strong>{quote.supplierName}</strong><small>Revision {quote.revision}</small></span><i className={quote.fullCoverage ? styles.comparable : styles.incomplete}>{quote.fullCoverage ? 'Full quote' : 'Check coverage'}</i></div>
                    <strong className={styles.quoteTotal}>{formatInr(quote.totalPaise)}</strong>
                    <div className={styles.quoteBreakdown}><span>Before GST {formatInr(quote.subtotalPaise)}</span><span>GST {formatInr(quote.gstPaise)}</span><span>Freight {formatInr(quote.freightPaise)}</span></div>
                    <div className={styles.quoteFacts}><span>{quote.coveredItemCount}/{quote.totalItemCount} items</span><span>Delivery {displayDate(quote.deliveryDate)}</span><span>Valid to {displayDate(quote.validUntil)}</span></div>
                    {quote.commercialTerms && <p>{quote.commercialTerms}</p>}
                    {quote.substitutions.length > 0 && <p className={styles.substitution}>{quote.substitutions.length} substitution {quote.substitutions.length === 1 ? 'noted' : 'notes'}</p>}
                    {(quote.expired || quote.deliveryFit === 'AFTER_REQUESTED_DATE' || quote.missingTerms || !quote.supplierActive) && (
                      <div className={styles.quoteWarnings}>
                        <AlertTriangle aria-hidden="true" />
                        <ul>
                          {quote.expired && <li>Quote validity has ended.</li>}
                          {quote.deliveryFit === 'AFTER_REQUESTED_DATE' && <li>Delivery is later than requested.</li>}
                          {quote.missingTerms && <li>Payment terms were not supplied.</li>}
                          {!quote.supplierActive && <li>Supplier is inactive and cannot receive an award.</li>}
                        </ul>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <div className={styles.comparisonWrap} role="region" aria-label="Prices by ingredient" tabIndex={0}>
                <table>
                  <thead><tr><th>Requested item</th>{comparison.quotes.map((quote) => <th key={quote.supplierRequestId}>{quote.supplierName}</th>)}</tr></thead>
                  <tbody>{comparison.request.items.map((requested) => (
                    <tr key={requested.id}>
                      <th><strong>{requested.name}</strong><small>{requested.quantity} {unitLabel(requested.unit)}</small></th>
                      {comparison.quotes.map((quote) => {
                        const item = quote.items.find(({ requestItemId }) => requestItemId === requested.id);
                        return <td key={quote.supplierRequestId}>{item?.unitComparable && item.normalizedUnitRatePaise ? <><strong>{formatInr(item.normalizedUnitRatePaise)} / {unitLabel(requested.unit)}</strong><small>{item.coverage === 'PARTIAL' ? `${item.normalizedAvailableQuantity} ${unitLabel(requested.unit)} available` : 'Full requested quantity available'}</small><small>{item.gstBasisPoints === null ? 'GST not supplied' : `${item.gstBasisPoints / 100}% GST${item.taxInclusive ? ' included' : ''}`}</small>{item.substitution && <em>{item.substitution}</em>}</> : <span className={styles.unavailable}>{item?.coverage === 'UNIT_MISMATCH' ? 'Unit mismatch' : item?.coverage === 'NOT_REQUESTED' ? 'Not requested from supplier' : 'Not quoted'}</span>}</td>;
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>

              {request.status === 'OPEN' && (
                <div id="purchase-choice" className={styles.awardBox}>
                  <div><h3>Choose supplier</h3><p>Your choice is final once saved.</p></div>
                  <div aria-label="Award method" className={styles.awardModes} role="group">
                    <button aria-pressed={awardMode === 'WHOLE'} type="button" className={awardMode === 'WHOLE' ? styles.selectedMode : ''} onClick={() => setAwardMode('WHOLE')}>One supplier</button>
                    <button aria-pressed={awardMode === 'SPLIT'} type="button" className={awardMode === 'SPLIT' ? styles.selectedMode : ''} onClick={() => setAwardMode('SPLIT')}>Split by item</button>
                  </div>
                  {awardMode === 'WHOLE' ? (
                    <div className={styles.awardChoices}>{comparison.quotes.map((quote) => {
                      const eligible =
                        quote.fullCoverage &&
                        quote.totalItemCount === comparison.request.itemCount &&
                        quote.items.every(({ coverage }) => coverage === 'FULL') &&
                        !quote.expired &&
                        quote.supplierActive;
                      return (
                        <label className={wholeSupplierRequestId === quote.supplierRequestId ? styles.selectedChoice : styles.awardChoice} key={quote.supplierRequestId}>
                          <input type="radio" name="whole-award" disabled={!eligible} checked={wholeSupplierRequestId === quote.supplierRequestId} onChange={() => setWholeSupplierRequestId(quote.supplierRequestId)} />
                          <span>
                            <strong>{quote.supplierName}</strong>
                            <small>{eligible ? `${formatInr(quote.totalPaise)} · including GST & freight` : !quote.supplierActive ? 'Supplier is inactive' : quote.expired ? 'Quote validity has ended' : 'Must quote for every item in matching units'}</small>
                          </span>
                          {wholeSupplierRequestId === quote.supplierRequestId && <CheckCircle2 aria-hidden="true" />}
                        </label>
                      );
                    })}</div>
                  ) : (
                    <div className={styles.splitBuilder}>{comparison.request.items.map((requested) => {
                      const candidates = comparison.quotes.flatMap((quote) => {
                        const item = quote.items.find(({ requestItemId }) => requestItemId === requested.id);
                        return item && awardableLine(quote, item) ? [{ quote, item }] : [];
                      });
                      const allocations = splitAllocations[requested.id] ?? [];
                      const coverage = splitPreview?.itemCoverage[requested.id];
                      return (
                        <section className={styles.allocationItem} key={requested.id}>
                          <header>
                            <span><strong>{requested.name}</strong><small>{requested.quantity} {unitLabel(requested.unit)} needed</small></span>
                            <span className={coverage?.valid ? styles.coverageComplete : styles.coverageRemaining}>
                              {coverage?.valid ? 'Fully allocated' : `${coverage?.remaining ?? requested.quantity} ${unitLabel(requested.unit)} remaining`}
                            </span>
                          </header>
                          {allocations.map((allocation) => {
                            const selected = candidates.find(({ quote }) =>
                              quote.supplierRequestId === allocation.supplierRequestId &&
                              quote.revision === allocation.quoteRevision
                            );
                            if (!selected) return null;
                            return (
                              <div className={styles.allocationRow} key={`${allocation.supplierRequestId}:${allocation.quoteRevision}`}>
                                <span><strong>{selected.quote.supplierName}</strong><small>{formatInr(selected.item.normalizedUnitRatePaise!)} / {unitLabel(requested.unit)} · up to {selected.item.normalizedAvailableQuantity} {unitLabel(requested.unit)}</small></span>
                                <label><span>Quantity</span><input aria-label={`${requested.name} quantity from ${selected.quote.supplierName}`} inputMode="decimal" value={allocation.quantity} onChange={(event) => updateSplitQuantity(requested.id, allocation.supplierRequestId, allocation.quoteRevision, event.target.value)} /></label>
                                <button type="button" aria-label={`Remove ${selected.quote.supplierName} from ${requested.name}`} onClick={() => removeSplitAllocation(requested.id, allocation.supplierRequestId, allocation.quoteRevision)}><Trash2 aria-hidden="true" /></button>
                              </div>
                            );
                          })}
                          <div className={styles.availableSuppliers}>
                            {candidates.filter(({ quote }) => !allocations.some((allocation) =>
                              allocation.supplierRequestId === quote.supplierRequestId &&
                              allocation.quoteRevision === quote.revision
                            )).map(({ quote, item }) => (
                              <button type="button" disabled={coverage?.valid} key={`${quote.supplierRequestId}:${quote.revision}`} onClick={() => addSplitAllocation(requested, quote, item)}>
                                <Plus aria-hidden="true" />{quote.supplierName}<small>{item.normalizedAvailableQuantity} {unitLabel(requested.unit)} available</small>
                              </button>
                            ))}
                            {candidates.length === 0 && <p>No valid comparable supplier line is available for this item.</p>}
                          </div>
                        </section>
                      );
                    })}
                    {splitPreview && splitPreview.errors.length > 0 && <ul className={styles.allocationErrors}>{[...new Set(splitPreview.errors)].slice(0, 4).map((issue) => <li key={issue}>{issue}</li>)}</ul>}
                    </div>
                  )}
                  {(wholeQuote && awardMode === 'WHOLE') && (
                    <div className={styles.awardPreview} aria-label="Whole award landed total">
                      <span><small>Before GST</small><strong>{formatInr(wholeQuote.subtotalPaise)}</strong></span>
                      <span><small>GST</small><strong>{formatInr(wholeQuote.gstPaise)}</strong></span>
                      <span><small>Freight</small><strong>{formatInr(wholeQuote.freightPaise)}</strong></span>
                      <span className={styles.finalTotal}><small>Total including delivery</small><strong>{formatInr(wholeQuote.totalPaise)}</strong></span>
                    </div>
                  )}
                  {(splitPreview && awardMode === 'SPLIT') && (
                    <div className={styles.awardPreview} aria-label="Split award landed total">
                      <span><small>Before GST</small><strong>{formatInr(splitPreview.subtotalPaise)}</strong></span>
                      <span><small>GST</small><strong>{formatInr(splitPreview.gstPaise)}</strong></span>
                      <span><small>Freight</small><strong>{formatInr(splitPreview.freightPaise)}</strong></span>
                      <span className={styles.finalTotal}><small>Total including delivery</small><strong>{formatInr(splitPreview.totalPaise)}</strong></span>
                    </div>
                  )}
                  <label className={styles.rationale}><span>Reason for this decision *</span><textarea rows={3} maxLength={500} value={rationale} placeholder="Best complete price with delivery on the requested date." onChange={(event) => setRationale(event.target.value)} /></label>
                  <button className={styles.primaryButton} type="button" disabled={!awardReady || Boolean(working)} onClick={() => void recordAward()}>{working === 'award' ? 'Recording…' : 'Confirm supplier choice'}</button>
                </div>
              )}


            </>
          )}
              {committedAward && (() => {
                const award = committedAward;
                const suppliers = new Map(award.suppliers.map((supplier) => [supplier.supplierId, supplier]));
                return (
                  <section className={styles.awardRecord} aria-label="Recorded award">
                    <header>
                      <div><p className={styles.eyebrow}>Final decision record</p><h3>{award.splitAward ? 'Split award' : 'Supplier award'}</h3></div>
                      <span><small>Awarded {displayDate(award.createdAt, true)}</small><strong>{formatInr(award.totalPaise)}</strong></span>
                    </header>
                    <div className={styles.awardReason}><strong>Why this decision was made</strong><p>{award.rationale || 'No decision note was recorded.'}</p></div>
                    <div className={styles.awardLines}>
                      <div className={styles.awardLineHeader}><span>Item and supplier</span><span>Quantity</span><span>Rate</span><span>GST</span><span>Line total</span></div>
                      {award.lines.map((line) => {
                        const supplier = suppliers.get(line.supplierId);
                        const description = supplier?.lines.find(
                          ({ requestItemId }) => requestItemId === line.requestItemId,
                        );
                        return (
                          <div className={styles.awardLine} key={`${line.requestItemId}:${line.supplierRequestId}:${line.quoteRevision}`}>
                            <span><strong>{description?.itemName ?? 'Requested item'}</strong><small>{supplier?.supplierName ?? 'Supplier snapshot'}</small></span>
                            <span>{line.quantity} {unitLabel(line.unit)}</span>
                            <span>{formatInr(line.unitRatePaise)} / {unitLabel(line.unit)}</span>
                            <span>{line.gstBasisPoints / 100}%</span>
                            <strong>{formatInr(line.totalPaise)}</strong>
                          </div>
                        );
                      })}
                    </div>
                    <div className={styles.awardSuppliers}>
                      {award.suppliers.map((supplier) => (
                        <article key={`${supplier.supplierRequestId}:${supplier.quoteRevision}`}>
                          <strong>{supplier.supplierName}</strong>
                          <span>Quote revision {supplier.quoteRevision}</span>
                          <span>Freight {formatInr(supplier.freightPaise)}</span>
                          <span>Delivery {displayDate(supplier.deliveryDate)}</span>
                          {supplier.gstin && <span>GSTIN {supplier.gstin}</span>}
                          {supplier.commercialTerms && <p>{supplier.commercialTerms}</p>}
                        </article>
                      ))}
                    </div>
                    <p className={styles.immutableNote}><ShieldCheck aria-hidden="true" />This record uses the supplier, quote, quantity, tax and delivery facts saved at the time of the award.</p>
                  </section>
                );
              })()}
        </details>
      )}
      <section className={styles.panel}>
        <header><div><h2>Supplier links & access</h2></div><Users aria-hidden="true" /></header>
        {applicationLink && (
          <div className={styles.applicationInvite}>
            <div>
              <strong>New supplier application link</strong>
              <p>Share this with suppliers you do not already work with. You must approve each applicant before they can send a quote.</p>
              <code>{applicationLink.url}</code>
              <small>Available until {displayDate(applicationLink.expiresAt, true)}</small>
            </div>
            <span>
              <button type="button" onClick={() => void copyApplicationLink()}><Clipboard aria-hidden="true" />Copy</button>
              <button type="button" onClick={shareApplicationOnWhatsApp}><MessageCircle aria-hidden="true" />WhatsApp</button>
            </span>
          </div>
        )}
        <div className={styles.grantList}>
          {request.supplierRequests.map((grant) => {
            const quote = quoteByGrant.get(grant.id);
            const state = grantState(grant, Boolean(quote));
            const freshLink = shareLinks.find(({ supplierRequestId }) => supplierRequestId === grant.id);
            return (
              <article key={grant.id}>
                <span className={styles.supplierInitial}>{grant.supplier.businessName.charAt(0).toUpperCase()}</span>
                <span className={styles.supplierName}><strong>{grant.supplier.businessName}</strong><small>{grant.supplier.contactName || grant.supplier.phone || 'Supplier contact'}</small></span>
                <span className={styles[`grant${state.replace(' ', '')}`]}>{state}</span>
                <span className={styles.grantDate}>{grant.viewedAt ? `Viewed ${displayDate(grant.viewedAt, true)}` : `Expires ${displayDate(grant.expiresAt, true)}`}</span>
                <span className={styles.linkActions}>
                  {freshLink && (
                    <SupplierFreshLinkActions
                      link={freshLink}
                      busy={Boolean(working)}
                      onCopy={() => void copyLink(freshLink)}
                      onWhatsApp={() => whatsappLink(freshLink)}
                      onQr={() => void downloadQr(freshLink)}
                    />
                  )}
                  {request.status === 'OPEN' && !grant.revokedAt && <button type="button" disabled={Boolean(working)} onClick={() => void changeLink(grant, 'rotate')}><RefreshCw aria-hidden="true" />New link</button>}
                  {request.status === 'OPEN' && !grant.revokedAt && <button className={styles.revoke} type="button" disabled={Boolean(working)} onClick={() => void changeLink(grant, 'revoke')}><XCircle aria-hidden="true" />Revoke</button>}
                </span>
                {freshLink && <code>{freshLink.url}</code>}
              </article>
            );
          })}
        </div>
        {request.status === 'OPEN' && shareLinks.length === 0 && <p className={styles.linkHelp}><Link2 aria-hidden="true" />For safety, old links cannot be displayed again. Use “New link” only when you need another copy.</p>}
      </section>

      <details className={ui.disclosure} aria-labelledby="request-downloads-heading">
        <summary id="request-downloads-heading">Download records & purchase orders</summary>
        <div className={styles.exportGrid}>
          <button
            type="button"
            disabled={Boolean(working)}
            onClick={() => void download(
              `/api/requests/${encodeURIComponent(request.id)}/export?kind=request`,
              'Request CSV',
              'quoteplate-request.csv',
            )}
          >
            <FileSpreadsheet aria-hidden="true" />
            <span><strong>Request CSV</strong><small>Items, quantities and delivery details</small></span>
            <Download aria-hidden="true" />
          </button>
          {(request.status === 'OPEN' || request.status === 'AWARDED') && (
            <button
              type="button"
              disabled={Boolean(working)}
              onClick={() => void download(
                `/api/requests/${encodeURIComponent(request.id)}/export?kind=quotes`,
                'Quote comparison CSV',
                'quoteplate-quote-comparison.csv',
              )}
            >
              <FileSpreadsheet aria-hidden="true" />
              <span><strong>Quote comparison CSV</strong><small>Supplier totals, coverage and delivery</small></span>
              <Download aria-hidden="true" />
            </button>
          )}
          {committedAward && (
            <>
              <button
                type="button"
                disabled={Boolean(working)}
                onClick={() => void download(
                  `/api/requests/${encodeURIComponent(request.id)}/export?kind=award`,
                  'Award decision CSV',
                  'quoteplate-award-decision.csv',
                )}
              >
                <FileSpreadsheet aria-hidden="true" />
                <span><strong>Award decision CSV</strong><small>Saved supplier and decision facts</small></span>
                <Download aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={Boolean(working)}
                onClick={() => void download(
                  `/api/requests/${encodeURIComponent(request.id)}/export?kind=accounting`,
                  'Accounting CSV',
                  'quoteplate-accounting.csv',
                )}
              >
                <FileSpreadsheet aria-hidden="true" />
                <span><strong>Accounting CSV</strong><small>Line totals, GST and freight</small></span>
                <Download aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        {committedAward && (
          <div className={styles.purchaseOrders}>
            <p><ReceiptText aria-hidden="true" /><span><strong>Supplier purchase orders</strong><small>One PDF for each awarded supplier</small></span></p>
            <div>
              {committedAward.suppliers.map((supplier) => (
                <button
                  type="button"
                  disabled={Boolean(working)}
                  key={`${supplier.supplierRequestId}:${supplier.quoteRevision}`}
                  onClick={() => void download(
                    `/api/awards/${encodeURIComponent(committedAward.id)}/purchase-orders/${encodeURIComponent(supplier.supplierId)}`,
                    `Purchase order for ${supplier.supplierName}`,
                    'quoteplate-purchase-order.pdf',
                  )}
                >
                  <span><strong>Purchase order · {supplier.supplierName}</strong><small>PDF · prices and terms saved when awarded</small></span>
                  <Download aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}
      </details>
    </main>
  );
}
