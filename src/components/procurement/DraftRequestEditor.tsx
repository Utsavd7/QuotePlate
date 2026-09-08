'use client';

import { Check, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import { workspaceMutationFetch } from '@/lib/client/workspace-prefetch';
import {
  buildDefaultSourcingSelection,
  preserveRequestSourcingOverrides,
  type RequestItemsV1,
  type RequestSourcingV1,
} from '@/lib/procurement/request-document';

import ui from './purchase-ui.module.css';
import styles from './draft-request-editor.module.css';

type DraftSupplierGrant = {
  supplierId: string;
  supplier: { id: string; businessName: string; isActive: boolean };
};

type EditableProcurementRequest = {
  id: string;
  title: string;
  status: 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED';
  version: number;
  deliveryDetails: {
    addressLine?: string;
    city?: string;
    state?: string;
    pin?: string;
    instructions?: string;
  };
  deliveryDate: string;
  quoteDeadline: string;
  commercialTerms: string | null;
  items: RequestItemsV1;
  sourcing: RequestSourcingV1;
  supplierRequests: DraftSupplierGrant[];
};

type SupplierChoice = {
  id: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  isActive: boolean;
  relationshipType: 'CURRENT' | 'SELECTED_NEW';
};

type ItemSourcingDraft = {
  useRequestSuppliers: boolean;
  supplierIds: string[];
  openToNewSuppliers: boolean;
};

type DraftEditorError = {
  message: string;
  kind: 'load' | 'operation';
} | null;

function indiaDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 330 * 60 * 1_000).toISOString().slice(0, 16);
}

function indiaDeadlineIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return '';
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function problem(response: Response, fallback: string) {
  return response.json().catch(() => ({})).then((body: {
    detail?: string;
    errors?: Record<string, string[]>;
  }) => ({ message: body.detail || fallback, fields: body.errors ?? {} }));
}

async function loadActiveSuppliers(signal: AbortSignal) {
  const suppliers: SupplierChoice[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ active: 'true', limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`/api/suppliers?${query}`, {
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      throw new Error((await problem(response, 'We could not load suppliers.')).message);
    }
    const result = (await response.json()) as {
      suppliers?: SupplierChoice[];
      nextCursor?: string | null;
    };
    suppliers.push(...(result.suppliers ?? []));
    cursor = result.nextCursor ?? null;
    if (!cursor) return suppliers;
  }
  throw new Error('The supplier list is larger than this request can support.');
}

export function DraftRequestEditor({
  request,
  onCancel,
  onSaved,
}: {
  request: EditableProcurementRequest;
  onCancel: () => void;
  onSaved: (request: EditableProcurementRequest) => void;
}) {
  const [title, setTitle] = useState(request.title);
  const [supplierIds, setSupplierIds] = useState(
    request.supplierRequests.map(({ supplierId }) => supplierId),
  );
  const [openToNewSuppliers, setOpenToNewSuppliers] = useState(
    request.sourcing.default.acceptVerifiedApplications,
  );
  const [addressLine, setAddressLine] = useState(request.deliveryDetails.addressLine ?? '');
  const [city, setCity] = useState(request.deliveryDetails.city ?? '');
  const [state, setState] = useState(request.deliveryDetails.state ?? '');
  const [pin, setPin] = useState(request.deliveryDetails.pin ?? '');
  const [instructions, setInstructions] = useState(request.deliveryDetails.instructions ?? '');
  const [deliveryDate, setDeliveryDate] = useState(request.deliveryDate.slice(0, 10));
  const [quoteDeadline, setQuoteDeadline] = useState(indiaDateTimeInput(request.quoteDeadline));
  const [commercialTerms, setCommercialTerms] = useState(request.commercialTerms ?? '');
  const [itemSourcing, setItemSourcing] = useState<Record<string, ItemSourcingDraft>>(
    () => Object.fromEntries(request.items.items.map((item) => [item.id, {
      useRequestSuppliers: item.sourcingOverride === null,
      supplierIds: item.sourcingOverride
        ? [
            ...item.sourcingOverride.currentSupplierIds,
            ...item.sourcingOverride.selectedNewSupplierIds,
          ]
        : [],
      openToNewSuppliers:
        item.sourcingOverride?.acceptVerifiedApplications ?? false,
    }])),
  );
  const [suppliers, setSuppliers] = useState<SupplierChoice[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<DraftEditorError>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [optionalDetailsOpen, setOptionalDetailsOpen] = useState(Boolean(request.deliveryDetails.instructions || request.commercialTerms));

  useEffect(() => {
    const controller = new AbortController();
    void loadActiveSuppliers(controller.signal)
      .then((loaded) => setSuppliers(loaded))
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError({
            message: caught instanceof Error ? caught.message : 'We could not load suppliers.',
            kind: 'load',
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSuppliers(false);
      });
    return () => controller.abort();
  }, []);

  const currentSuppliers = useMemo(() => {
    const byId = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    for (const grant of request.supplierRequests) {
      if (!byId.has(grant.supplierId) && grant.supplier.isActive) {
        byId.set(grant.supplierId, {
          id: grant.supplierId,
          businessName: grant.supplier.businessName,
          contactName: null,
          phone: null,
          city: null,
          isActive: true,
          relationshipType: request.sourcing.default.selectedNewSupplierIds.includes(grant.supplierId)
            ? 'SELECTED_NEW'
            : 'CURRENT',
        });
      }
    }
    return [...byId.values()].sort((a, b) =>
      a.businessName.localeCompare(b.businessName, 'en-IN'),
    );
  }, [
    request.sourcing.default.selectedNewSupplierIds,
    request.supplierRequests,
    suppliers,
  ]);

  const deadlineIso = indiaDeadlineIso(quoteDeadline);
  const validItemSourcing = request.items.items.every((item) => {
    const choice = itemSourcing[item.id];
    return choice?.useRequestSuppliers !== false ||
      choice.supplierIds.length > 0 ||
      choice.openToNewSuppliers;
  });
  const valid = Boolean(
    title.trim() &&
    (supplierIds.length > 0 || openToNewSuppliers) &&
    addressLine.trim() &&
    city.trim() &&
    state.trim() &&
    /^[1-9]\d{5}$/.test(pin) &&
    /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) &&
    deadlineIso &&
    new Date(deadlineIso).getTime() < new Date(`${deliveryDate}T00:00:00+05:30`).getTime() &&
    validItemSourcing,
  );

  function toggleSupplier(id: string) {
    setSupplierIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function updateItemSourcing(itemId: string, update: Partial<ItemSourcingDraft>) {
    setItemSourcing((current) => {
      const existing = current[itemId] ?? {
        useRequestSuppliers: true,
        supplierIds: [],
        openToNewSuppliers: false,
      };
      return {
        ...current,
        [itemId]: {
          ...existing,
          ...update,
        },
      };
    });
  }

  function toggleItemSupplier(itemId: string, supplierId: string) {
    const current = itemSourcing[itemId]?.supplierIds ?? [];
    updateItemSourcing(itemId, {
      supplierIds: current.includes(supplierId)
        ? current.filter((id) => id !== supplierId)
        : [...current, supplierId],
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || saving || request.status !== 'DRAFT') return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const defaultSourcing = buildDefaultSourcingSelection(
        currentSuppliers,
        supplierIds,
        openToNewSuppliers,
      );
      const items = preserveRequestSourcingOverrides(request.items);
      items.items = items.items.map((item) => {
        const choice = itemSourcing[item.id];
        return {
          ...item,
          sourcingOverride: !choice || choice.useRequestSuppliers
            ? null
            : buildDefaultSourcingSelection(
                currentSuppliers,
                choice.supplierIds,
                choice.openToNewSuppliers,
              ),
        };
      });
      const response = await workspaceMutationFetch(`/api/requests/${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: request.version,
          title: title.trim(),
          items,
          sourcing: {
            v: 1,
            default: defaultSourcing,
          },
          deliveryDetails: {
            addressLine: addressLine.trim(),
            city: city.trim(),
            state: state.trim(),
            pin,
            ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
          },
          deliveryDate,
          quoteDeadline: deadlineIso,
          commercialTerms: commercialTerms.trim() || null,
        }),
      });
      if (!response.ok) {
        const issue = await problem(response, 'We could not save the draft.');
        setFieldErrors(issue.fields);
        throw new Error(issue.message);
      }
      const result = (await response.json()) as { request?: EditableProcurementRequest };
      if (!result.request) throw new Error('The updated draft was not returned.');
      onSaved(result.request);
    } catch (caught) {
      setOptionalDetailsOpen(true);
      setError({
        message: caught instanceof Error ? caught.message : 'We could not save the draft.',
        kind: 'operation',
      });
      setSaving(false);
    }
  }

  return (
    <form className={`${styles.editor} ${ui.surface}`} onSubmit={save} aria-label="Edit procurement draft">
      <header>
        <div>
          <h2>Edit draft</h2>
        </div>
        <button type="button" className={styles.close} onClick={onCancel} aria-label="Close draft editor">
          <X aria-hidden="true" />
        </button>
      </header>
      {error && <div className={styles.error} role="alert">{error.message}{error.kind === 'load' && <> Your saved restaurant records are unchanged.</>}</div>}
      {Object.keys(fieldErrors).length > 0 && <ul className={styles.error} role="alert">{Object.entries(fieldErrors).flatMap(([field, messages]) => messages.map((message) => <li key={`${field}:${message}`}>{message}</li>))}</ul>}
      <div className={styles.grid}>
        <label className={styles.full}>
          <span>Request title *</span>
          <input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
          {fieldErrors.title?.[0] && <small>{fieldErrors.title[0]}</small>}
        </label>
        <label className={styles.full}>
          <span>Delivery address *</span>
          <input value={addressLine} onChange={(event) => setAddressLine(event.target.value)} />
        </label>
        <label><span>City *</span><input value={city} onChange={(event) => setCity(event.target.value)} /></label>
        <label><span>State *</span><input value={state} onChange={(event) => setState(event.target.value)} /></label>
        <label><span>PIN code *</span><input inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} /></label>
        <label><span>Delivery date *</span><input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label>
        <label className={styles.full}><span>Quote deadline (India time) *</span><input type="datetime-local" value={quoteDeadline} onChange={(event) => setQuoteDeadline(event.target.value)} /></label>
      </div>
      <details className={ui.disclosure} open={optionalDetailsOpen} onToggle={(event) => setOptionalDetailsOpen(event.currentTarget.open)}>
        <summary>Delivery instructions & payment terms</summary>
        <div className={styles.grid}>
        <label className={styles.full}><span>Delivery instructions</span><textarea rows={2} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
        <label className={styles.full}><span>Payment and order terms</span><textarea rows={3} value={commercialTerms} onChange={(event) => setCommercialTerms(event.target.value)} /></label>
        </div>
      </details>
      <fieldset>
        <legend>Suppliers *</legend>
        {loadingSuppliers ? <p className={styles.help}>Loading suppliers…</p> : currentSuppliers.length === 0 ? <p className={styles.help}>Choose a saved supplier or invite new suppliers below.</p> : (
          <div className={styles.suppliers}>
            {currentSuppliers.map((supplier) => (
              <label className={supplierIds.includes(supplier.id) ? styles.selectedSupplier : styles.supplier} key={supplier.id}>
                <input type="checkbox" checked={supplierIds.includes(supplier.id)} onChange={() => toggleSupplier(supplier.id)} />
                <span><strong>{supplier.businessName}</strong><small>{supplier.contactName || supplier.city || supplier.phone || 'Active supplier'}</small></span>
                {supplierIds.includes(supplier.id) && <Check aria-hidden="true" />}
              </label>
            ))}
          </div>
        )}
        <label className={openToNewSuppliers ? styles.selectedSupplier : styles.supplier}>
          <input
            type="checkbox"
            checked={openToNewSuppliers}
            onChange={(event) => setOpenToNewSuppliers(event.target.checked)}
          />
          <span>
            <strong>Also invite new verified suppliers</strong>
            <small>You approve every applicant before they can quote.</small>
          </span>
          {openToNewSuppliers && <Check aria-hidden="true" />}
        </label>
        {(fieldErrors.sourcing?.[0] || fieldErrors.items?.[0]) && <small className={styles.fieldError}>{fieldErrors.sourcing?.[0] || fieldErrors.items?.[0]}</small>}
      </fieldset>
      <fieldset className={styles.itemPreferences}>
        <legend>Specific item suppliers (optional)</legend>
        <p className={styles.sectionHelp}>Use different suppliers for individual ingredients.</p>
        <div className={styles.itemPreferenceList}>
          {request.items.items.map((item) => {
            const choice = itemSourcing[item.id] ?? {
              useRequestSuppliers: true,
              supplierIds: [],
              openToNewSuppliers: false,
            };
            return (
              <section aria-label={`${item.name} supplier preference`} className={styles.itemPreference} key={item.id}>
                <header>
                  <span><strong>{item.name}</strong><small>{item.quantity} {item.unit.toLowerCase()}</small></span>
                  <button
                    aria-pressed={!choice.useRequestSuppliers}
                    onClick={() => updateItemSourcing(item.id, {
                      useRequestSuppliers: !choice.useRequestSuppliers,
                    })}
                    type="button"
                  >
                    {choice.useRequestSuppliers ? 'Choose differently' : 'Use request suppliers'}
                  </button>
                </header>
                {!choice.useRequestSuppliers && (
                  <div className={styles.itemPreferenceChoices}>
                    <label className={choice.openToNewSuppliers ? styles.selectedSupplier : styles.supplier}>
                      <input
                        checked={choice.openToNewSuppliers}
                        onChange={(event) => updateItemSourcing(item.id, {
                          openToNewSuppliers: event.target.checked,
                        })}
                        type="checkbox"
                      />
                      <span><strong>Open to verified new suppliers</strong><small>You approve applicants before they quote</small></span>
                      {choice.openToNewSuppliers && <Check aria-hidden="true" />}
                    </label>
                    {currentSuppliers.map((supplier) => (
                      <label className={choice.supplierIds.includes(supplier.id) ? styles.selectedSupplier : styles.supplier} key={supplier.id}>
                        <input
                          checked={choice.supplierIds.includes(supplier.id)}
                          onChange={() => toggleItemSupplier(item.id, supplier.id)}
                          type="checkbox"
                        />
                        <span><strong>{supplier.businessName}</strong><small>{supplier.relationshipType === 'CURRENT' ? 'Current supplier' : 'Selected new supplier'}</small></span>
                        {choice.supplierIds.includes(supplier.id) && <Check aria-hidden="true" />}
                      </label>
                    ))}
                    {choice.supplierIds.length === 0 && !choice.openToNewSuppliers && (
                      <p className={styles.itemError}>Choose a supplier or allow verified new suppliers for this item.</p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </fieldset>
      {!valid && <p className={styles.help}>Complete the required fields, choose a saved supplier or invite new suppliers, and keep the deadline before the delivery date.</p>}
      <footer>
        <button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.primary} disabled={!valid || saving || loadingSuppliers}>{saving ? 'Saving…' : 'Save changes'}</button>
      </footer>
    </form>
  );
}
