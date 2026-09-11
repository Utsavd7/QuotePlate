'use client';

import { ArrowLeft, Check, ChevronDown, MapPin, Store, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { workspaceMutationFetch } from '@/lib/client/workspace-prefetch';
import type { MenuDocumentV1 } from '@/lib/menu/menu-document';
import { buildDefaultSourcingSelection, validateRequestItems, type RequestItemsV1 } from '@/lib/procurement/request-document';
import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import { PROCUREMENT_CATEGORIES, type ProcurementCategory } from '@/lib/domain/procurement-categories';
import { intakeUnits, shoppingRowErrors, type IntakeRow } from '@/lib/procurement/photo-text-intake';
import { ReviewedTextIntake } from './ReviewedTextIntake';

import { PurchaseJourney } from './PurchaseJourney';
import { WorkspaceHeader } from '../workspace/Workspace';
import ui from './purchase-ui.module.css';
import styles from './new-request-form.module.css';

type MenuSummary = {
  id: string;
  name: string;
  status: 'DRAFT' | 'APPROVED';
  version: number;
};

type ReviewedMenu = MenuSummary & { document: MenuDocumentV1 };

type SupplierChoice = {
  id: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  isActive: boolean;
  relationshipType: 'CURRENT' | 'SELECTED_NEW';
};

type AccountDelivery = { addressLine: string; city: string; state: string; pin: string };

type InitialData = {
  menus: MenuSummary[];
  suppliers: SupplierChoice[];
  account: AccountDelivery;
  menuNextCursor?: string | null;
  supplierNextCursor?: string | null;
};

async function problem(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
    errors?: Record<string, string[]>;
  };
  return { message: body.detail || body.error || fallback, fields: body.errors ?? {} };
}

function indiaDeadlineIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return '';
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function deadlineBeforeDelivery(deadlineValue: string, deliveryValue: string) {
  const deadline = indiaDeadlineIso(deadlineValue);
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryValue)) return false;
  const deliveryStart = new Date(`${deliveryValue}T00:00:00+05:30`);
  return !Number.isNaN(deliveryStart.getTime()) && new Date(deadline).getTime() < deliveryStart.getTime();
}

type RequestFormError =
  | { message: string; kind: 'load'; retry: 'initial' | 'menus' | 'suppliers' | 'menu' }
  | { message: string; kind: 'operation' }
  | null;

function draftItemKey(name: string, id: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80).replace(/^-+|-+$/g, '') || id;
}

export function NewRequestForm({ initialData }: { initialData?: InitialData }) {
  const router = useRouter();
  const [menus, setMenus] = useState(initialData?.menus.filter(({ status }) => status === 'APPROVED') ?? []);
  const [suppliers, setSuppliers] = useState(initialData?.suppliers ?? []);
  const [menuNextCursor, setMenuNextCursor] = useState(initialData?.menuNextCursor ?? null);
  const [supplierNextCursor, setSupplierNextCursor] = useState(initialData?.supplierNextCursor ?? null);
  const [loadingMoreMenus, setLoadingMoreMenus] = useState(false);
  const [loadingMoreSuppliers, setLoadingMoreSuppliers] = useState(false);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [selectedMenu, setSelectedMenu] = useState<ReviewedMenu | null>(null);
  const [menuId, setMenuId] = useState('');
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [openToNewSuppliers, setOpenToNewSuppliers] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'ALL' | 'SELECTED'>('ALL');
  const [ingredientIds, setIngredientIds] = useState<string[]>([]);
  const [additionalItems, setAdditionalItems] = useState<RequestItemsV1['items']>([]);
  const [title, setTitle] = useState('');
  const [addressLine, setAddressLine] = useState(initialData?.account.addressLine ?? '');
  const [city, setCity] = useState(initialData?.account.city ?? '');
  const [state, setState] = useState(initialData?.account.state ?? '');
  const [pin, setPin] = useState(initialData?.account.pin ?? '');
  const [instructions, setInstructions] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [quoteDeadline, setQuoteDeadline] = useState('');
  const [commercialTerms, setCommercialTerms] = useState('');
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<RequestFormError>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [optionalDetailsOpen, setOptionalDetailsOpen] = useState(false);
  const initialLoadStarted = useRef(false);
  const menuRequest = useRef<AbortController | null>(null);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [menuResponse, supplierResponse, accountResponse] = await Promise.all([
        fetch('/api/menus?limit=50', { cache: 'no-store' }),
        fetch('/api/suppliers?active=true&limit=50', { cache: 'no-store' }),
        fetch('/api/account', { cache: 'no-store' }),
      ]);
      if (!menuResponse.ok) throw new Error(await problem(menuResponse, 'We could not load approved menus.').then(({ message }) => message));
      if (!supplierResponse.ok) throw new Error(await problem(supplierResponse, 'We could not load suppliers.').then(({ message }) => message));
      if (!accountResponse.ok) throw new Error(await problem(accountResponse, 'We could not load the delivery address.').then(({ message }) => message));
      const menuResult = (await menuResponse.json()) as { menus?: MenuSummary[]; nextCursor?: string | null };
      const supplierResult = (await supplierResponse.json()) as { suppliers?: SupplierChoice[]; nextCursor?: string | null };
      const accountResult = (await accountResponse.json()) as { account?: AccountDelivery };
      setMenus((menuResult.menus ?? []).filter(({ status }) => status === 'APPROVED'));
      setSuppliers(supplierResult.suppliers ?? []);
      setMenuNextCursor(menuResult.nextCursor ?? null);
      setSupplierNextCursor(supplierResult.nextCursor ?? null);
      if (accountResult.account) {
        setAddressLine(accountResult.account.addressLine);
        setCity(accountResult.account.city);
        setState(accountResult.account.state);
        setPin(accountResult.account.pin);
      }
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'We could not prepare this request.',
        kind: 'load',
        retry: 'initial',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialData || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadInitialData();
  }, [initialData, loadInitialData]);

  useEffect(() => () => menuRequest.current?.abort(), []);

  async function loadMoreMenus() {
    if (!menuNextCursor || loadingMoreMenus) return;
    setLoadingMoreMenus(true);
    setError(null);
    try {
      const response = await fetch(`/api/menus?limit=50&cursor=${encodeURIComponent(menuNextCursor)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await problem(response, 'We could not load more approved menus.')).message);
      const result = (await response.json()) as { menus?: MenuSummary[]; nextCursor?: string | null };
      const approved = (result.menus ?? []).filter(({ status }) => status === 'APPROVED');
      setMenus((current) => [...new Map([...current, ...approved].map((menu) => [menu.id, menu])).values()]);
      setMenuNextCursor(result.nextCursor ?? null);
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'We could not load more approved menus.',
        kind: 'load',
        retry: 'menus',
      });
    } finally {
      setLoadingMoreMenus(false);
    }
  }

  async function loadMoreSuppliers() {
    if (!supplierNextCursor || loadingMoreSuppliers) return;
    setLoadingMoreSuppliers(true);
    setError(null);
    try {
      const response = await fetch(`/api/suppliers?active=true&limit=50&cursor=${encodeURIComponent(supplierNextCursor)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await problem(response, 'We could not load more suppliers.')).message);
      const result = (await response.json()) as { suppliers?: SupplierChoice[]; nextCursor?: string | null };
      setSuppliers((current) => [...new Map([...current, ...(result.suppliers ?? [])].map((supplier) => [supplier.id, supplier])).values()]);
      setSupplierNextCursor(result.nextCursor ?? null);
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'We could not load more suppliers.',
        kind: 'load',
        retry: 'suppliers',
      });
    } finally {
      setLoadingMoreSuppliers(false);
    }
  }

  async function chooseMenu(id: string) {
    menuRequest.current?.abort();
    setMenuId(id);
    setSelectedMenu(null);
    setIngredientIds([]);
    setSelectionMode('ALL');
    if (!id) {
      setLoadingMenu(false);
      return;
    }
    const controller = new AbortController();
    menuRequest.current = controller;
    setLoadingMenu(true);
    setError(null);
    try {
      const response = await fetch(`/api/menus/${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        const message = (await problem(response, 'We could not load this menu.')).message;
        if (menuRequest.current === controller) {
          setError({ message, kind: 'load', retry: 'menu' });
        }
        return;
      }
      const result = (await response.json()) as { menu: ReviewedMenu };
      if (menuRequest.current === controller) setSelectedMenu(result.menu);
    } catch (caught) {
      if (menuRequest.current === controller && !(caught instanceof Error && caught.name === 'AbortError')) {
        setError({
          message: caught instanceof Error ? caught.message : 'We could not load this menu.',
          kind: 'load',
          retry: 'menu',
        });
      }
    } finally {
      if (menuRequest.current === controller) {
        menuRequest.current = null;
        setLoadingMenu(false);
      }
    }
  }

  function retryLoad() {
    if (error?.kind !== 'load') return;
    if (error.retry === 'initial') void loadInitialData();
    if (error.retry === 'menus') void loadMoreMenus();
    if (error.retry === 'suppliers') void loadMoreSuppliers();
    if (error.retry === 'menu') void chooseMenu(menuId);
  }

  function toggleSupplier(id: string) {
    setSupplierIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleIngredient(id: string) {
    setIngredientIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  const selectedItemIds = selectedMenu
    ? selectionMode === 'ALL' ? selectedMenu.document.dishes.flatMap(({ ingredients }) => ingredients.map(({ id }) => id)) : ingredientIds
    : [];
  const itemCount = selectedItemIds.length + additionalItems.length;
  let validAdditionalItems = true;
  try { if (additionalItems.length) validateRequestItems({ v: 1, items: additionalItems }); }
  catch { validAdditionalItems = false; }

  function appendCheckedRows(rows: IntakeRow[]) {
    if (saving) return 'Wait for the current draft save to finish.';
    if (itemCount + rows.length > DOCUMENT_LIMITS.requestItems.items) return `A draft can contain at most ${DOCUMENT_LIMITS.requestItems.items} items. Remove some rows first.`;
    if (rows.some(row => shoppingRowErrors(row).length)) return 'Check each item name, quantity and unit.';
    const additions = rows.map(row => {
      const id = `list-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      return {
        id, itemKey: draftItemKey(row.name, id),
        name: row.name.trim(), quantity: row.quantity, unit: row.unit as RequestItemsV1['items'][number]['unit'],
        specification: { v: 1 as const, category: 'OTHER' as const }, sourcingOverride: null,
      };
    });
    setAdditionalItems(current => [...current, ...additions]);
    return null;
  }

  const valid = Boolean(
    title.trim() && (!menuId || selectedMenu) && !loadingMenu && itemCount > 0 && itemCount <= DOCUMENT_LIMITS.requestItems.items && validAdditionalItems &&
    (supplierIds.length > 0 || openToNewSuppliers) && addressLine.trim() && city.trim() &&
    state.trim() && /^[1-9]\d{5}$/.test(pin) && deliveryDate && deadlineBeforeDelivery(quoteDeadline, deliveryDate) &&
    (selectionMode === 'ALL' || ingredientIds.length > 0 || additionalItems.length > 0),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      if (menuId && !selectedMenu) throw new Error('Wait for the approved menu to load before saving.');
      const defaultSourcing = buildDefaultSourcingSelection(
        suppliers,
        supplierIds,
        openToNewSuppliers,
      );
      const response = await workspaceMutationFetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          menuId: menuId || null,
          selectedItemIds,
          ...(additionalItems.length ? { additionalItems: { v: 1, items: additionalItems } } : {}),
          defaultSourcing,
          sourcingOverrides: {},
          deliveryDetails: {
            addressLine: addressLine.trim(), city: city.trim(), state: state.trim(), pin,
            ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
          },
          deliveryDate,
          quoteDeadline: indiaDeadlineIso(quoteDeadline),
          commercialTerms: commercialTerms.trim() || null,
        }),
      });
      if (!response.ok) {
        const issue = await problem(response, 'We could not save this request.');
        setFieldErrors(issue.fields);
        throw new Error(issue.message);
      }
      const result = (await response.json()) as { request?: { id: string } };
      if (!result.request?.id) throw new Error('The saved request was not returned.');
      router.push(`/procurement/${encodeURIComponent(result.request.id)}`);
    } catch (caught) {
      setOptionalDetailsOpen(true);
      setError({
        message: caught instanceof Error ? caught.message : 'We could not save this request.',
        kind: 'operation',
      });
      setSaving(false);
    }
  }

  if (loading) return <main className={`${styles.page} ${ui.surface}`}><div className={styles.loading} aria-label="Preparing request"><span /><span /><span /></div></main>;

  return (
    <main className={`${styles.page} ${ui.surface}`}>
      <button className={styles.back} type="button" onClick={() => router.push('/procurement')}><ArrowLeft aria-hidden="true" /> Purchases</button>
      <WorkspaceHeader title="Choose ingredients" description="Start with an approved menu or a shopping list. Review your draft before sharing." actions={<span className={styles.draftStatus}>Not sent</span>} />

      <PurchaseJourney current={0} />

      {error && <div className={styles.error} role="alert">{error.message}{error.kind === 'load' && <> Your saved restaurant records are unchanged. <button type="button" onClick={retryLoad}>Try again</button></>}</div>}
      {Object.keys(fieldErrors).length > 0 && <ul className={styles.error} role="alert">{Object.entries(fieldErrors).flatMap(([field, messages]) => messages.map((message) => <li key={`${field}:${message}`}>{message}</li>))}</ul>}
      {!(error?.kind === 'load' && error.retry === 'initial') && <form className={styles.form} onSubmit={submit}>
        <section className={styles.section}>
          <div className={styles.sectionBody}>
            <div className={styles.sectionTitle}><div><h2>Ingredients</h2></div><Store aria-hidden="true" /></div>
            <label className={styles.field}>
              <span>Request title *</span>
              <input value={title} maxLength={160} placeholder="Fresh produce · Week 36" onChange={(event) => setTitle(event.target.value)} />
              {fieldErrors.title?.[0] && <small>{fieldErrors.title[0]}</small>}
            </label>
            <label className={`${styles.field} ${styles.selectField}`}>
              <span>Approved menu (optional with a shopping list)</span>
              <select value={menuId} disabled={loadingMenu} onChange={(event) => void chooseMenu(event.target.value)}>
                <option value="">Use a shopping list, or choose an approved menu</option>
                {menus.map((menu) => <option value={menu.id} key={menu.id}>{menu.name}</option>)}
              </select><ChevronDown aria-hidden="true" />
            </label>
            {loadingMenu && <p className={styles.choiceStatus} role="status">Loading the checked ingredient list…</p>}
            {menuNextCursor && <button className={styles.choiceMore} type="button" disabled={loadingMoreMenus} onClick={() => void loadMoreMenus()}>{loadingMoreMenus ? 'Loading…' : 'Load more approved menus'}</button>}
            {menus.length === 0 && (
              <div className={styles.inlineEmpty}>No approved menu yet. Add a shopping list below, or <button type="button" onClick={() => router.push('/menus')}>review a menu</button>.</div>
            )}
            <ReviewedTextIntake mode="shopping" onApply={appendCheckedRows} disabled={saving} />
            {additionalItems.length > 0 && <div className={styles.listDraft}>
              <h3>Shopping list draft rows</h3>
              <p>These reviewed rows are added alongside selected menu ingredients. Category starts as Other; choose a category if useful.</p>
              {additionalItems.map((item, index) => <fieldset key={item.id} disabled={saving}>
                <legend>Draft row {index + 1}</legend>
                <div className={styles.twoColumns}>
                  <label className={styles.field}><span>Item name *</span><input aria-label={`Draft item name, row ${index + 1}`} required maxLength={160} value={item.name} onChange={event => setAdditionalItems(current => current.map(row => row.id === item.id ? { ...row, name: event.target.value, itemKey: draftItemKey(event.target.value, row.id) } : row))} /></label>
                  <label className={styles.field}><span>Quantity *</span><input aria-label={`Draft quantity, row ${index + 1}`} required inputMode="decimal" maxLength={24} value={item.quantity} onChange={event => setAdditionalItems(current => current.map(row => row.id === item.id ? { ...row, quantity: event.target.value } : row))} /></label>
                  <label className={styles.field}><span>Unit *</span><select aria-label={`Draft unit, row ${index + 1}`} value={item.unit} onChange={event => setAdditionalItems(current => current.map(row => row.id === item.id ? { ...row, unit: event.target.value as typeof item.unit } : row))}>{intakeUnits.map(unit => <option key={unit} value={unit}>{unit.toLowerCase()}</option>)}</select></label>
                  <label className={styles.field}><span>Category</span><select aria-label={`Draft category, row ${index + 1}`} value={item.specification.category} onChange={event => setAdditionalItems(current => current.map(row => row.id === item.id ? { ...row, specification: { ...row.specification, category: event.target.value as ProcurementCategory } } : row))}>{Object.entries(PROCUREMENT_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                </div>
                <button className={styles.secondaryButton} type="button" onClick={() => setAdditionalItems(current => current.filter(row => row.id !== item.id))}>Remove draft row {index + 1}</button>
              </fieldset>)}
              {!validAdditionalItems && <p role="alert">Check each draft name, quantity and unit before saving. Quantities must be positive with at most three decimal places.</p>}
            </div>}
            {selectedMenu && (
              <div className={styles.demand}>
                <div className={styles.segmented}>
                  <button type="button" aria-pressed={selectionMode === 'ALL'} className={selectionMode === 'ALL' ? styles.selected : ''} onClick={() => setSelectionMode('ALL')}>All ingredients</button>
                  <button type="button" aria-pressed={selectionMode === 'SELECTED'} className={selectionMode === 'SELECTED' ? styles.selected : ''} onClick={() => setSelectionMode('SELECTED')}>Choose ingredients</button>
                </div>
                {selectionMode === 'SELECTED' && selectedMenu.document.dishes.map((dish) => (
                  <fieldset key={dish.id}>
                    <legend>{dish.name}</legend>
                    {dish.ingredients.map((ingredient) => (
                      <label className={styles.checkboxRow} key={ingredient.id}>
                        <input type="checkbox" checked={ingredientIds.includes(ingredient.id)} onChange={() => toggleIngredient(ingredient.id)} />
                        <span><strong>{ingredient.name}</strong><small>{ingredient.quantity} {ingredient.unit.toLowerCase()}</small></span>
                        {ingredientIds.includes(ingredient.id) && <Check aria-hidden="true" />}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionBody}>
            <div className={styles.sectionTitle}><div><h2>Ask which suppliers?</h2><p>Each supplier gets a private link.</p></div><Users aria-hidden="true" /></div>
            {suppliers.length === 0 ? (
              <div className={styles.inlineEmpty}>No saved supplier yet. You can invite new suppliers below or <button type="button" onClick={() => router.push('/suppliers')}>add a supplier</button>.</div>
            ) : (
              <div className={styles.supplierGrid}>
                {suppliers.map((supplier) => (
                  <label className={supplierIds.includes(supplier.id) ? styles.selectedSupplier : styles.supplier} key={supplier.id}>
                    <input type="checkbox" checked={supplierIds.includes(supplier.id)} onChange={() => toggleSupplier(supplier.id)} />
                    <span className={styles.supplierInitial}>{supplier.businessName.charAt(0).toUpperCase()}</span>
                    <span><strong>{supplier.businessName}</strong><small>{supplier.relationshipType === 'CURRENT' ? 'Regular supplier' : 'New supplier'} · {supplier.contactName || supplier.city || supplier.phone || 'Contact details not added'}</small></span>
                    {supplierIds.includes(supplier.id) && <Check aria-hidden="true" />}
                  </label>
                ))}
              </div>
            )}
            {supplierNextCursor && <button className={styles.choiceMore} type="button" disabled={loadingMoreSuppliers} onClick={() => void loadMoreSuppliers()}>{loadingMoreSuppliers ? 'Loading…' : 'Load more suppliers'}</button>}
            <label className={openToNewSuppliers ? styles.selectedOpenSupplier : styles.openSupplier}>
              <input
                type="checkbox"
                checked={openToNewSuppliers}
                onChange={(event) => setOpenToNewSuppliers(event.target.checked)}
              />
              <span>
                <strong>Also invite new verified suppliers</strong>
                <small>Get a public application link when you open this request. Only suppliers you approve can quote.</small>
              </span>
              {openToNewSuppliers && <Check aria-hidden="true" />}
            </label>

          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionBody}>
            <div className={styles.sectionTitle}><div><h2>Delivery and timing</h2><p>These details are shown to every selected supplier.</p></div><MapPin aria-hidden="true" /></div>
            <div className={styles.twoColumns}>
              <label className={`${styles.field} ${styles.full}`}><span>Delivery address *</span><input value={addressLine} onChange={(event) => setAddressLine(event.target.value)} /></label>
              <label className={styles.field}><span>City *</span><input value={city} onChange={(event) => setCity(event.target.value)} /></label>
              <label className={styles.field}><span>State *</span><input value={state} onChange={(event) => setState(event.target.value)} /></label>
              <label className={styles.field}><span>PIN code *</span><input inputMode="numeric" value={pin} maxLength={6} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} /></label>
              <label className={styles.field}><span>Delivery date *</span><input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label>
              <label className={styles.field}><span>Quote deadline (India time) *</span><input type="datetime-local" value={quoteDeadline} onChange={(event) => setQuoteDeadline(event.target.value)} /></label>
              <label className={`${styles.field} ${styles.full}`}><span>Delivery instructions</span><textarea rows={3} value={instructions} placeholder="Use the service entrance. Delivery before 8:00 AM." onChange={(event) => setInstructions(event.target.value)} /></label>
            </div>
          </div>
        </section>

        <details className={ui.disclosure} open={optionalDetailsOpen} onToggle={(event) => setOptionalDetailsOpen(event.currentTarget.open)}>
          <summary>Payment and order terms (optional)</summary>
          <div className={ui.disclosureBody}>
            <label className={styles.field}><span>Terms or notes</span><textarea rows={3} value={commercialTerms} placeholder="Rates should include packing. Payment within 15 days of accepted delivery." onChange={(event) => setCommercialTerms(event.target.value)} /></label>
            {fieldErrors.commercialTerms?.map((message) => <p role="alert" key={message}>{message}</p>)}
          </div>
        </details>

        <footer className={styles.actions}>
          <span>Nothing is shared yet. Review your draft next.</span>
          <button className={styles.secondaryButton} type="button" onClick={() => router.push('/procurement')}>Cancel</button>
          <button className={styles.primaryButton} type="submit" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save draft'}</button>
        </footer>
      </form>}
    </main>
  );
}
