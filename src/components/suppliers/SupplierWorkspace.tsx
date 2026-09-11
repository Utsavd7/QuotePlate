'use client';

import {
  Building2,
  Check,
  Clipboard,
  Download,
  FileUp,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import {
  workspaceFetch,
  workspaceMutationFetch,
} from '@/lib/client/workspace-prefetch';
import {
  PROCUREMENT_CATEGORIES,
  type ProcurementCategory,
} from '@/lib/domain/procurement-categories';
import {
  emptySupplierCapabilities,
  type SupplierCapabilitiesV1,
  type SupplierCategoryTier,
} from '@/lib/suppliers/supplier-capabilities';

import styles from './supplier-workspace.module.css';
import workspace from '../workspace/workspace.module.css';
import { WorkspaceHeader, WorkspaceSearch, WorkspaceToolbar } from '../workspace/Workspace';
import { SupplierDiscovery } from './SupplierDiscovery';
import { ExistingSupplierContacts } from './ExistingSupplierContacts';
import { SupplierWebsiteContacts } from './SupplierWebsiteContacts';
import { fillReviewedWebsiteContacts } from '@/lib/suppliers/website-types';
import type { NearbyPrefill } from '@/lib/suppliers/nearby-types';

type SupplierSummary = {
  id: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pin: string | null;
  gstin: string | null;
  notes: string | null;
  relationshipType: 'CURRENT' | 'SELECTED_NEW' | 'APPLICANT';
  verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  capabilities?: SupplierCapabilitiesV1;
};

type SupplierDraft = Omit<
  SupplierSummary,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'capabilities'
  | 'relationshipType'
  | 'verificationStatus'
> & { capabilities: SupplierCapabilitiesV1 };

type FreshApplicantLink = {
  businessName: string;
  url: string;
  expiresAt: string;
};

type Problem = {
  detail?: string;
  error?: string;
  errors?: Record<string, string[]>;
};

export type SupplierWorkspaceError = {
  kind: 'load' | 'operation';
  message: string;
};

const emptyDraft: SupplierDraft = {
  businessName: '',
  contactName: '',
  phone: '',
  whatsappNumber: '',
  email: '',
  addressLine: '',
  city: '',
  state: '',
  pin: '',
  gstin: '',
  notes: '',
  isActive: true,
  capabilities: emptySupplierCapabilities(),
};

function draftFromSupplier(supplier: SupplierSummary): SupplierDraft {
  return {
    businessName: supplier.businessName,
    contactName: supplier.contactName ?? '',
    phone: supplier.phone ?? '',
    whatsappNumber: supplier.whatsappNumber ?? '',
    email: supplier.email ?? '',
    addressLine: supplier.addressLine ?? '',
    city: supplier.city ?? '',
    state: supplier.state ?? '',
    pin: supplier.pin ?? '',
    gstin: supplier.gstin ?? '',
    notes: supplier.notes ?? '',
    isActive: supplier.isActive,
    capabilities: supplier.capabilities ?? emptySupplierCapabilities(),
  };
}

const categoryOptions = Object.entries(PROCUREMENT_CATEGORIES) as Array<
  [ProcurementCategory, string]
>;

const categoryTiers: ReadonlyArray<{
  value: SupplierCategoryTier;
  label: string;
}> = [
  { value: 'PREFERRED', label: 'Preferred' },
  { value: 'CAPABLE', label: 'Can supply' },
  { value: 'BACKUP', label: 'Backup' },
];

function categoryLabel(label: string) {
  return label.replaceAll('-', ' ').replaceAll('&', 'and');
}

export function setSupplierCategoryTier(
  capabilities: SupplierCapabilitiesV1,
  category: ProcurementCategory,
  tier: SupplierCategoryTier | null,
): SupplierCapabilitiesV1 {
  const selected = new Map(
    capabilities.categories.map((entry) => [entry.category, entry.tier]),
  );
  if (tier === null) selected.delete(category);
  else selected.set(category, tier);

  const ranks: Record<SupplierCategoryTier, number> = {
    CAPABLE: 0,
    PREFERRED: 0,
    BACKUP: 0,
  };
  const categories = categoryOptions.flatMap(([key]) => {
    const selectedTier = selected.get(key);
    if (!selectedTier) return [];
    ranks[selectedTier] += 1;
    return [{ category: key, tier: selectedTier, rank: ranks[selectedTier] }];
  });

  return { ...capabilities, categories };
}

export function SupplierCapabilityFields({
  capabilities,
  disabled,
  error,
  onChange,
}: {
  capabilities: SupplierCapabilitiesV1;
  disabled: boolean;
  error: string;
  onChange: (capabilities: SupplierCapabilitiesV1) => void;
}) {
  const selected = new Map(
    capabilities.categories.map((entry) => [entry.category, entry.tier]),
  );

  return (
    <fieldset className={styles.capabilityPanel} disabled={disabled}>
      <legend>What they supply</legend>
      <p id="supplier-capability-help" className={styles.capabilityHelp}>
        Select every category they supply. Use Preferred for your regular choice,
        Can supply for another approved option, and Backup when your regular supplier cannot deliver.
      </p>
      <div className={styles.categoryGrid} aria-describedby="supplier-capability-help">
        {categoryOptions.map(([category, rawLabel]) => {
          const label = categoryLabel(rawLabel);
          const tier = selected.get(category);
          const inputId = `supplier-category-${category.toLowerCase()}`;
          return (
            <div
              className={`${styles.categoryChoice} ${tier ? styles.categoryChoiceSelected : ''}`}
              key={category}
              role="group"
              aria-label={label}
            >
              <label htmlFor={inputId}>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={Boolean(tier)}
                  onChange={(event) => onChange(setSupplierCategoryTier(
                    capabilities,
                    category,
                    event.target.checked ? 'CAPABLE' : null,
                  ))}
                />
                <span>{label}</span>
              </label>
              {tier && (
                <select
                  aria-label={`${label} supplier level`}
                  value={tier}
                  onChange={(event) => onChange(setSupplierCategoryTier(
                    capabilities,
                    category,
                    event.target.value as SupplierCategoryTier,
                  ))}
                >
                  {categoryTiers.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
      {error && <small className={styles.capabilityError}>{error}</small>}
    </fieldset>
  );
}

export function cleanSupplierDraft(draft: SupplierDraft) {
  return Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() || null : value,
    ]),
  );
}

function supplierPlace(supplier: SupplierSummary) {
  return [supplier.city, supplier.state].filter(Boolean).join(', ') || 'Location not added';
}

async function readProblem(response: Response, fallback: string) {
  const problem = (await response.json().catch(() => ({}))) as Problem;
  return {
    message: problem.detail || problem.error || fallback,
    errors: problem.errors ?? {},
  };
}

export function SupplierErrorBanner({
  error,
  onReload,
}: {
  error: SupplierWorkspaceError;
  onReload: () => void;
}) {
  return (
    <div className={styles.error} role="alert">
      <span>{error.message}</span>
      {error.kind === 'load' && (
        <>
          <span>Your saved restaurant records are unchanged.</span>
          <button type="button" onClick={onReload}>Try again</button>
        </>
      )}
    </div>
  );
}

export function SupplierDetailError({
  error,
  supplier,
  onRetry,
}: {
  error: SupplierWorkspaceError;
  supplier: SupplierSummary | null;
  onRetry: (supplier: SupplierSummary) => void;
}) {
  return (
    <div className={styles.dialogError} role="alert">
      <span>{error.message}</span>
      {error.kind === 'load' && supplier && (
        <>
          <br />
          <span>Your saved restaurant records are unchanged.</span>
          <button
            className={styles.secondaryButton}
            onClick={() => onRetry(supplier)}
            type="button"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}

export function SupplierWorkspace({
  initialSuppliers,
  initialError,
  initialNextCursor = null,
}: {
  initialSuppliers?: SupplierSummary[];
  initialError?: string;
  initialNextCursor?: string | null;
}) {
  const [suppliers, setSuppliers] = useState(initialSuppliers ?? []);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | 'all'>('true');
  const [loading, setLoading] = useState(initialSuppliers === undefined);
  const [error, setError] = useState<SupplierWorkspaceError | null>(initialError
    ? { kind: 'load', message: initialError }
    : null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [discoveryReview, setDiscoveryReview] = useState(false);
  const [discoveryVerified, setDiscoveryVerified] = useState(false);
  const [editing, setEditing] = useState<SupplierSummary | null>(null);
  const [draft, setDraft] = useState<SupplierDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [editorError, setEditorError] = useState<SupplierWorkspaceError | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorReady, setEditorReady] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reviewing, setReviewing] = useState('');
  const [freshApplicantLink, setFreshApplicantLink] = useState<FreshApplicantLink | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const discoveryDetails = useRef<HTMLDetailsElement>(null);
  const initialLoadStarted = useRef(false);
  const editorDialog = useRef<HTMLElement>(null);
  const savingRef = useRef(false);
  const editorRequest = useRef(0);

  const loadSuppliers = useCallback(async (
    query = search,
    filter = activeFilter,
    cursor?: string,
    usePrefetch = false,
    failureKind: SupplierWorkspaceError['kind'] = 'load',
  ) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (query.trim()) params.set('search', query.trim());
      if (filter !== 'all') params.set('active', filter);
      if (cursor) params.set('cursor', cursor);
      const response = await (usePrefetch
        ? workspaceFetch('/api/suppliers?active=true&limit=50', { cache: 'no-store' })
        : fetch(`/api/suppliers?${params}`, { cache: 'no-store' }));
      if (!response.ok) {
        const problem = await readProblem(response, 'We could not load suppliers.');
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { suppliers?: SupplierSummary[]; nextCursor?: string | null };
      const loaded = result.suppliers ?? [];
      setSuppliers((current) => cursor
        ? [...new Map([...current, ...loaded].map((supplier) => [supplier.id, supplier])).values()]
        : loaded);
      setNextCursor(result.nextCursor ?? null);
    } catch (caught) {
      setError({
        kind: failureKind,
        message: caught instanceof Error ? caught.message : 'We could not load suppliers.',
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [activeFilter, search]);

  useEffect(() => {
    if (initialSuppliers !== undefined || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadSuppliers('', 'true', undefined, true);
  }, [initialSuppliers, loadSuppliers]);

  useEffect(() => {
    if (!editorOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = editorDialog.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
    ) ?? [])];
    dialog?.querySelector<HTMLInputElement>('input[name="businessName"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        setEditorOpen(false);
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
  }, [editorOpen]);

  function openCreate(prefill?: NearbyPrefill) {
    setDiscoveryReview(Boolean(prefill));
    setDiscoveryVerified(false);
    editorRequest.current += 1;
    savingRef.current = false;
    setSaving(false);
    setEditorLoading(false);
    setEditorReady(true);
    setEditing(null);
    setDraft({ ...emptyDraft, ...prefill });
    setFieldErrors({});
    setEditorError(null);
    setEditorOpen(true);
  }

  function loadSupplierDetails(supplier: SupplierSummary) {
    const requestId = editorRequest.current + 1;
    editorRequest.current = requestId;
    setEditing(supplier);
    setDraft(draftFromSupplier(supplier));
    setFieldErrors({});
    setEditorError(null);
    setEditorLoading(true);
    setEditorReady(false);
    void (async () => {
      try {
        const response = await fetch(`/api/suppliers/${encodeURIComponent(supplier.id)}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          const problem = await readProblem(response, 'We could not load this supplier.');
          throw new Error(problem.message);
        }
        const result = (await response.json()) as {
          supplier?: SupplierSummary & { capabilities: SupplierCapabilitiesV1 };
        };
        if (!result.supplier) throw new Error('We could not load this supplier.');
        if (editorRequest.current !== requestId) return;
        setEditing(result.supplier);
        setDraft(draftFromSupplier(result.supplier));
        setEditorReady(true);
      } catch (caught) {
        if (editorRequest.current !== requestId) return;
        setEditorError({
          kind: 'load',
          message: caught instanceof Error ? caught.message : 'We could not load this supplier.',
        });
      } finally {
        if (editorRequest.current === requestId) setEditorLoading(false);
      }
    })();
  }

  function openEdit(supplier: SupplierSummary) {
    savingRef.current = false;
    setSaving(false);
    setEditorOpen(true);
    loadSupplierDetails(supplier);
  }

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !editorReady || !draft.businessName.trim() || (!editing && discoveryReview && !discoveryVerified)) return;
    savingRef.current = true;
    setSaving(true);
    setEditorError(null);
    setFieldErrors({});
    try {
      const response = await workspaceMutationFetch(
        editing ? `/api/suppliers/${encodeURIComponent(editing.id)}` : '/api/suppliers',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cleanSupplierDraft(draft)),
        },
      );
      if (!response.ok) {
        const problem = await readProblem(response, 'We could not save this supplier.');
        setFieldErrors(problem.errors);
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { supplier: SupplierSummary };
      setSuppliers((current) => {
        const withoutSaved = current.filter(({ id }) => id !== result.supplier.id);
        if (
          (activeFilter === 'true' && !result.supplier.isActive) ||
          (activeFilter === 'false' && result.supplier.isActive)
        ) return withoutSaved;
        return [result.supplier, ...withoutSaved];
      });
      setEditorOpen(false);
      setNotice(editing ? 'Supplier updated.' : 'Supplier added.');
    } catch (caught) {
      setEditorError({
        kind: 'operation',
        message: caught instanceof Error ? caught.message : 'We could not save this supplier.',
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function deactivate(supplier: SupplierSummary) {
    if (!window.confirm(`Deactivate ${supplier.businessName}? Existing request records will stay unchanged.`)) {
      return;
    }
    setError(null);
    const response = await workspaceMutationFetch(`/api/suppliers/${encodeURIComponent(supplier.id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const problem = await readProblem(response, 'We could not deactivate this supplier.');
      setError({ kind: 'operation', message: problem.message });
      return;
    }
    setSuppliers((current) => current.filter(({ id }) => id !== supplier.id));
    setNotice('Supplier deactivated.');
  }

  async function reviewApplication(
    supplier: SupplierSummary,
    decision: 'APPROVE' | 'REJECT',
  ) {
    const action = decision === 'APPROVE' ? 'approve' : 'reject';
    if (!window.confirm(`${decision === 'APPROVE' ? 'Approve' : 'Reject'} ${supplier.businessName}?`)) {
      return;
    }
    const workId = `${supplier.id}:${decision}`;
    setReviewing(workId);
    setError(null);
    try {
      const response = await workspaceMutationFetch(`/api/suppliers/${encodeURIComponent(supplier.id)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        const problem = await readProblem(response, `We could not ${action} this supplier.`);
        throw new Error(problem.message);
      }
      const result = (await response.json()) as {
        supplier: SupplierSummary;
        link?: { url: string; expiresAt: string };
      };
      setSuppliers((current) => {
        const withoutReviewed = current.filter(({ id }) => id !== result.supplier.id);
        if (
          (activeFilter === 'true' && !result.supplier.isActive) ||
          (activeFilter === 'false' && result.supplier.isActive)
        ) return withoutReviewed;
        return [result.supplier, ...withoutReviewed];
      });
      if (decision === 'APPROVE' && result.link) {
        setFreshApplicantLink({
          businessName: result.supplier.businessName,
          ...result.link,
        });
        setNotice(`${result.supplier.businessName} approved. Share the private quote link now.`);
      } else {
        setNotice(`${result.supplier.businessName} rejected.`);
      }
    } catch (caught) {
      setError({
        kind: 'operation',
        message: caught instanceof Error ? caught.message : `We could not ${action} this supplier.`,
      });
    } finally {
      setReviewing('');
    }
  }

  async function copyApplicantLink() {
    if (!freshApplicantLink) return;
    try {
      await navigator.clipboard.writeText(freshApplicantLink.url);
      setNotice(`${freshApplicantLink.businessName} quote link copied.`);
    } catch {
      setError({
        kind: 'operation',
        message: 'Copy was blocked by the browser. Select and copy the link manually.',
      });
    }
  }

  function shareApplicantLink() {
    if (!freshApplicantLink) return;
    const text = `Please send your prices to our restaurant: ${freshApplicantLink.url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  async function importCsv(file: File | undefined) {
    if (!file || importing) return;
    setImporting(true);
    setError(null);
    try {
      const response = await workspaceMutationFetch('/api/suppliers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        body: file,
      });
      if (!response.ok) {
        const problem = await readProblem(response, 'Check the CSV and try again.');
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { importedCount?: number };
      setNotice(`${result.importedCount ?? 0} suppliers imported.`);
      await loadSuppliers(search, activeFilter, undefined, false, 'operation');
    } catch (caught) {
      setError({
        kind: 'operation',
        message: caught instanceof Error ? caught.message : 'We could not import this CSV.',
      });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const response = await fetch('/api/suppliers/export', { cache: 'no-store' });
      if (!response.ok) {
        const problem = await readProblem(response, 'We could not export suppliers.');
        throw new Error(problem.message);
      }
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = href;
      link.download = 'quoteplate-suppliers.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (caught) {
      setError({
        kind: 'operation',
        message: caught instanceof Error ? caught.message : 'We could not export suppliers.',
      });
    } finally {
      setExporting(false);
    }
  }

  const input = (
    key: keyof SupplierDraft,
    label: string,
    options: { type?: string; placeholder?: string; required?: boolean } = {},
  ) => (
    <label className={styles.field}>
      <span>{label}{options.required ? ' *' : ''}</span>
      <input
        name={key}
        type={options.type ?? 'text'}
        required={options.required}
        placeholder={options.placeholder}
        value={String(draft[key] ?? '')}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
        aria-invalid={Boolean(fieldErrors[key])}
      />
      {fieldErrors[key]?.[0] && <small>{fieldErrors[key][0]}</small>}
    </label>
  );

  return (
    <main className={`${workspace.page} ${styles.page}`}>
      <WorkspaceHeader
        title="Suppliers"
        description="Find a supplier, update their details or add someone new."
        actions={<>
        <button className={styles.secondaryButton} type="button" aria-controls="supplier-discovery" onClick={() => {
          const details = discoveryDetails.current;
          if (!details) return;
          details.open = true;
          const summary = details.querySelector('summary');
          summary?.focus({ preventScroll: true });
          summary?.scrollIntoView({ block: 'start', behavior: 'instant' });
        }}><MapPin aria-hidden="true" /> Find nearby</button>
        <button className={styles.primaryButton} type="button" onClick={() => openCreate()}>
          <Plus aria-hidden="true" /> Add supplier
        </button>
        </>}
      />

      <WorkspaceToolbar label="Supplier tools">
        <form
          className={styles.searchForm}
          onSubmit={(event) => {
            event.preventDefault();
            void loadSuppliers();
          }}
        >
          <WorkspaceSearch
            label="Search suppliers"
            placeholder="Search by name, phone, email, city or GSTIN"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            action={<button type="submit">Search</button>}
          />
        </form>
        <select
          aria-label="Filter suppliers"
          value={activeFilter}
          onChange={(event) => {
            const filter = event.target.value as typeof activeFilter;
            setActiveFilter(filter);
            void loadSuppliers(search, filter);
          }}
        >
          <option value="all">All suppliers and applications</option>
          <option value="true">Active suppliers</option>
          <option value="false">Inactive suppliers and applications</option>
        </select>
        <details className={styles.fileTools}><summary>Import or export</summary><div>
        <input
          ref={fileInput}
          className={styles.hiddenInput}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void importCsv(event.target.files?.[0])}
        />
        <button className={styles.secondaryButton} type="button" onClick={() => fileInput.current?.click()} disabled={importing}>
          <FileUp aria-hidden="true" /> {importing ? 'Importing…' : 'Import CSV'}
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={exporting}
          onClick={() => void exportCsv()}
        >
          <Download aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
        </div></details>
      </WorkspaceToolbar>

      <ExistingSupplierContacts onImported={async (count) => {
        setNotice(`${count} suppliers added. Open a supplier workspace to request their business details.`);
        await loadSuppliers(search, activeFilter, undefined, false, 'operation');
      }} />

      {notice && (
        <div className={styles.notice} role="status">
          <Check aria-hidden="true" /> {notice}
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X /></button>
        </div>
      )}
      {freshApplicantLink && (
        <section className={styles.freshLink} aria-label="Approved supplier quote link">
          <div>
            <strong>{freshApplicantLink.businessName} can now quote</strong>
            <p>This private link is shown only now. Copy it and send it to the supplier.</p>
            <code>{freshApplicantLink.url}</code>
          </div>
          <span>
            <button type="button" onClick={() => void copyApplicantLink()}>
              <Clipboard aria-hidden="true" /> Copy link
            </button>
            <button type="button" onClick={shareApplicantLink}>
              <MessageCircle aria-hidden="true" /> WhatsApp
            </button>
            <button type="button" aria-label="Close approved supplier link" onClick={() => setFreshApplicantLink(null)}>
              <X aria-hidden="true" /> Close
            </button>
          </span>
        </section>
      )}
      {error && <SupplierErrorBanner error={error} onReload={() => void loadSuppliers()} />}

      {loading ? (
        <section className={styles.loading} aria-label="Loading suppliers">
          <span /><span /><span />
        </section>
      ) : suppliers.length === 0 ? (
        <section className={`${workspace.table} ${workspace.empty} ${styles.empty}`}>
          <div className={styles.emptyMark}><Building2 aria-hidden="true" /></div>
          <p className={styles.eyebrow}>Start here</p>
          <h2>Add your first supplier</h2>
          <p>No supplier account is needed. Add a contact, then send them a secure quote link when your request is ready.</p>
          <button className={styles.primaryButton} type="button" onClick={() => openCreate()}>
            <Plus aria-hidden="true" /> Add supplier
          </button>
        </section>
      ) : (
        <>
        <p className={workspace.resultCount}>{suppliers.length} shown</p>
        <section className={`${workspace.table} ${styles.list}`} aria-label="Supplier directory">
          <div className={`${workspace.tableHeader} ${styles.listHeader}`}>
            <span>Supplier</span>
            <span>Contact</span>
            <span>Location</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {suppliers.map((supplier) => (
            <article className={`${workspace.tableRow} ${styles.row}`} key={supplier.id}>
              <div className={styles.identity}>
                <span className={styles.initial}>{supplier.businessName.charAt(0).toUpperCase()}</span>
                <div>
                  <span className={styles.identityName}>{supplier.businessName}</span>
                  <p>{supplier.contactName || 'Contact person not added'}</p>
                </div>
              </div>
              <div className={styles.detail}>
                {(supplier.phone || supplier.whatsappNumber) && <span><Phone aria-hidden="true" />{supplier.phone || supplier.whatsappNumber}</span>}
                {supplier.email && <span><Mail aria-hidden="true" />{supplier.email}</span>}
                {!supplier.phone && !supplier.whatsappNumber && !supplier.email && <span>Contact details not added</span>}
              </div>
              <div className={styles.detail}>
                <span><MapPin aria-hidden="true" />{supplierPlace(supplier)}</span>
                {supplier.gstin && <span>GSTIN {supplier.gstin}</span>}
              </div>
              <div>
                <span className={
                  supplier.verificationStatus === 'PENDING'
                    ? styles.pendingBadge
                    : supplier.verificationStatus === 'REJECTED'
                      ? styles.rejectedBadge
                      : supplier.isActive
                        ? styles.activeBadge
                        : styles.inactiveBadge
                }>
                  {supplier.verificationStatus === 'PENDING'
                    ? 'Needs review'
                    : supplier.verificationStatus === 'REJECTED'
                      ? 'Rejected'
                      : supplier.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className={styles.actions}>
                {supplier.isActive && <Link href={`/supplier-collaboration?supplier=${encodeURIComponent(supplier.id)}`} aria-label={`Open workspace for ${supplier.businessName}`}>Workspace</Link>}
                {supplier.relationshipType === 'APPLICANT' && supplier.verificationStatus === 'PENDING' ? (
                  <span className={styles.reviewActions}>
                    <button
                      type="button"
                      disabled={Boolean(reviewing)}
                      onClick={() => void reviewApplication(supplier, 'APPROVE')}
                    >
                      {reviewing === `${supplier.id}:APPROVE` ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(reviewing)}
                      onClick={() => void reviewApplication(supplier, 'REJECT')}
                    >
                      {reviewing === `${supplier.id}:REJECT` ? 'Rejecting…' : 'Reject'}
                    </button>
                  </span>
                ) : (
                  <button type="button" aria-label={`Edit ${supplier.businessName}`} onClick={() => openEdit(supplier)}>
                    Edit
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
        </>
      )}

      {nextCursor && !loading && (
        <button
          className={styles.loadMore}
          type="button"
          disabled={loadingMore}
          onClick={() => void loadSuppliers(search, activeFilter, nextCursor)}
        >
          {loadingMore ? 'Loading more…' : 'Load more suppliers'}
        </button>
      )}

      <details id="supplier-discovery" ref={discoveryDetails} className={styles.discovery}>
        <summary><MapPin aria-hidden="true" /> Find nearby suppliers <span>Search your area</span></summary>
        <SupplierDiscovery onAddSupplier={openCreate} />
      </details>

      <details className={styles.privacyDetails} aria-label="Restaurant data privacy">
        <summary>Who can see supplier information?</summary>
        <p>Other restaurants cannot see your records. Suppliers see only requests, orders, delivery checks and estimates you share with them. Your recipes and other suppliers’ prices stay private.</p>
      </details>

      {editorOpen && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !savingRef.current) setEditorOpen(false);
        }}>
          <section ref={editorDialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="supplier-editor-title">
            <header>
              <div>
                <p className={styles.eyebrow}>{editing ? 'Supplier record' : 'New supplier'}</p>
                <h2 id="supplier-editor-title">{editing ? `Edit ${editing.businessName}` : 'Add supplier'}</h2>
              </div>
              <button type="button" aria-label="Close supplier form" disabled={saving} onClick={() => setEditorOpen(false)}><X /></button>
            </header>
            <form onSubmit={saveSupplier}>
              {editorError && (
                <SupplierDetailError
                  error={editorError}
                  supplier={editing}
                  onRetry={loadSupplierDetails}
                />
              )}
              {editorLoading && (
                <div className={styles.loadingDetails} role="status">Loading supplier details…</div>
              )}
              <fieldset
                className={styles.editorFields}
                disabled={saving || editorLoading || !editorReady}
                aria-busy={editorLoading}
              >
                <SupplierWebsiteContacts
                  key={editing?.id ?? 'new-supplier'}
                  phone={draft.phone}
                  email={draft.email}
                  disabled={saving || editorLoading || !editorReady}
                  onReview={(contact) => setDraft((current) => fillReviewedWebsiteContacts(current, [contact]))}
                />
                <div className={styles.formGrid}>
                  {input('businessName', 'Business name', { required: true, placeholder: 'GreenLeaf Fresh Foods' })}
                  {input('contactName', 'Contact person', { placeholder: 'Meera Shah' })}
                  {input('phone', 'Phone', { type: 'tel', placeholder: '+91 98765 43210' })}
                  {input('whatsappNumber', 'WhatsApp number', { type: 'tel', placeholder: '+91 98765 43210' })}
                  {input('email', 'Email', { type: 'email', placeholder: 'orders@example.com' })}
                  {input('gstin', 'GSTIN', { placeholder: '27ABCDE1234F1Z5' })}
                  <div className={styles.fullWidth}>{input('addressLine', 'Address', { placeholder: 'APMC Market, Vashi' })}</div>
                  {input('city', 'City', { placeholder: 'Navi Mumbai' })}
                  {input('state', 'State', { placeholder: 'Maharashtra' })}
                  {input('pin', 'PIN code', { placeholder: '400703' })}
                  <label className={styles.field}>
                    <span>Status</span>
                    <select
                      value={draft.isActive ? 'active' : 'inactive'}
                      onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.value === 'active' }))}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <SupplierCapabilityFields
                    capabilities={draft.capabilities}
                    disabled={saving || editorLoading || !editorReady}
                    error={fieldErrors.capabilities?.[0] ?? ''}
                    onChange={(capabilities) => setDraft((current) => ({ ...current, capabilities }))}
                  />
                  <label className={`${styles.field} ${styles.fullWidth}`}>
                    <span>Notes</span>
                    <textarea
                      rows={3}
                      placeholder="Delivery timing, payment terms or useful reminders"
                      value={draft.notes ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>
                </div>
              </fieldset>
              {!editing && discoveryReview && <div className={styles.discoveryReview}>
                <p>This map listing is unverified. Saving it marks the supplier as verified by your restaurant team; the map service has not checked its procurement capability.</p>
                <label><input type="checkbox" checked={discoveryVerified} disabled={saving} onChange={event => setDiscoveryVerified(event.target.checked)} required /> I have checked this supplier’s contact details and ability to supply our restaurant.</label>
              </div>}
              <footer>
                {editing?.isActive && (
                  <button className={styles.dangerButton} type="button" onClick={() => {
                    setEditorOpen(false);
                    void deactivate(editing);
                  }} disabled={saving}>
                    Deactivate
                  </button>
                )}
                <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => setEditorOpen(false)}>Cancel</button>
                <button className={styles.primaryButton} type="submit" disabled={saving || !editorReady || !draft.businessName.trim() || (!editing && discoveryReview && !discoveryVerified)}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add supplier'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
