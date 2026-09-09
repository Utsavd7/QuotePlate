'use client';

import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Plus,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { WorkspaceHeader } from '../workspace/Workspace';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { workspaceMutationFetch } from '@/lib/client/workspace-prefetch';
import {
  PROCUREMENT_CATEGORIES,
  type ProcurementCategory,
} from '@/lib/domain/procurement-categories';
import type {
  IngredientSuggestionDto,
  MenuCleanupProposal,
  MenuDocumentV1,
} from '@/lib/menu/menu-document';

import styles from './menu-editor.module.css';

type Unit = 'KILOGRAM' | 'GRAM' | 'LITRE' | 'MILLILITRE' | 'PIECE' | 'PACK' | 'CASE' | 'CRATE';

type DishDraft = MenuDocumentV1['dishes'][number];
type IngredientDraft = DishDraft['ingredients'][number];

type ReviewedMenu = {
  id: string;
  name: string;
  status: 'DRAFT' | 'APPROVED';
  version: number;
  sourceText: string | null;
  approvedAt: string | null;
  updatedAt: string;
  document: MenuDocumentV1;
  cleanupProposals?: MenuCleanupProposal[];
  ingredientSuggestionsByDishId?: Record<string, IngredientSuggestionDto[]>;
};

const unitOptions: Array<{ value: Unit; label: string }> = [
  { value: 'KILOGRAM', label: 'kg' },
  { value: 'GRAM', label: 'g' },
  { value: 'LITRE', label: 'L' },
  { value: 'MILLILITRE', label: 'ml' },
  { value: 'PIECE', label: 'piece' },
  { value: 'PACK', label: 'pack' },
  { value: 'CASE', label: 'case' },
  { value: 'CRATE', label: 'crate' },
];

const categoryOptions = Object.entries(PROCUREMENT_CATEGORIES) as Array<
  [ProcurementCategory, string]
>;

function documentId(prefix: 'd' | 'i') {
  return `${prefix}${crypto.randomUUID().replaceAll('-', '').slice(0, 23)}`;
}

const newIngredient = (): IngredientDraft => {
  const id = documentId('i');
  return {
    id,
    itemKey: `item-${id}`,
    name: '',
    quantity: '',
    unit: 'KILOGRAM',
    specification: { v: 1, category: 'OTHER' },
  };
};

const newDish = (): DishDraft => ({
  id: documentId('d'),
  name: '',
  position: 0,
  ingredients: [newIngredient()],
});

function normalizeMenu(menu: ReviewedMenu): ReviewedMenu {
  return {
    ...menu,
    document: {
      ...menu.document,
      dishes: menu.document.dishes.map((dish) => ({
        ...dish,
        ingredients: dish.ingredients.map((ingredient) => ({
          ...ingredient,
          quantity: String(ingredient.quantity),
        })),
      })),
    },
  };
}

export function applyMenuCleanupProposal(
  document: MenuDocumentV1,
  proposal: MenuCleanupProposal,
): MenuDocumentV1 {
  if (proposal.kind === 'MERGE_DUPLICATE_DISH') {
    return {
      ...document,
      dishes: document.dishes
        .filter(({ id }) => id !== proposal.dishId)
        .map((dish, position) => ({ ...dish, position })),
    };
  }
  return {
    ...document,
    dishes: document.dishes.map((dish) => {
      if (dish.id !== proposal.dishId) return dish;
      if (proposal.ingredientId === null) {
        return dish.name === proposal.before ? { ...dish, name: proposal.after } : dish;
      }
      if (proposal.kind === 'MERGE_DUPLICATE_ITEM') {
        return {
          ...dish,
          ingredients: dish.ingredients.filter(({ id }) => id !== proposal.ingredientId),
        };
      }
      return {
        ...dish,
        ingredients: dish.ingredients.map((ingredient) => {
          if (ingredient.id !== proposal.ingredientId) return ingredient;
          if (proposal.kind === 'NORMALIZE_UNIT') {
            return { ...ingredient, unit: proposal.after as IngredientDraft['unit'] };
          }
          return ingredient.name === proposal.before
            ? { ...ingredient, name: proposal.after }
            : ingredient;
        }),
      };
    }),
  };
}

export function removeSelectedDishes(
  dishes: Readonly<MenuDocumentV1['dishes']>,
  selectedIds: ReadonlySet<string>,
): MenuDocumentV1['dishes'] {
  return dishes
    .filter(({ id }) => !selectedIds.has(id))
    .map((dish, position) => ({ ...dish, position }));
}

export function pruneSelectedDishIds(
  selectedIds: ReadonlySet<string>,
  dishes: Readonly<MenuDocumentV1['dishes']>,
) {
  const dishIds = new Set(dishes.map(({ id }) => id));
  return new Set([...selectedIds].filter((id) => dishIds.has(id)));
}

async function problemMessage(response: Response, fallback: string) {
  const problem = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
    errors?: Record<string, string[]>;
  };
  return {
    message: problem.detail || problem.error || fallback,
    fields: problem.errors ?? {},
  };
}

const deleteMenuConfirmation = 'Delete this menu permanently? Menus used in procurement history cannot be deleted.';

export async function deleteMenuAndNavigate(
  menu: Pick<ReviewedMenu, 'id' | 'version'>,
  router: { replace: (href: string) => void; refresh: () => void },
  confirm: (message: string) => boolean = window.confirm,
  onConfirmed: () => void = () => {},
): Promise<
  | { status: 'cancelled'; error: null; keepLocked: false }
  | { status: 'deleted'; error: null; keepLocked: true }
  | { status: 'failed'; error: string; keepLocked: false }
> {
  if (!confirm(deleteMenuConfirmation)) {
    return { status: 'cancelled', error: null, keepLocked: false };
  }
  onConfirmed();
  try {
    const response = await workspaceMutationFetch(`/api/menus/${encodeURIComponent(menu.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: menu.version }),
    });
    if (!response.ok) {
      return { status: 'failed', error: (await problemMessage(response, 'We could not delete this menu.')).message, keepLocked: false };
    }
    router.replace('/menus');
    router.refresh();
    return { status: 'deleted', error: null, keepLocked: true };
  } catch (caught) {
    return { status: 'failed', error: caught instanceof Error ? caught.message : 'We could not delete this menu.', keepLocked: false };
  }
}

function MenuReferenceDisclosure({ hasReference, children }: {
  hasReference: boolean;
  children: ReactNode;
}) {
  // Saved data sets the initial state; subsequent edits must not close the field.
  const [open, setOpen] = useState(hasReference);
  return <details className={styles.referenceField} open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Food photo or product link, optional</summary>
    {children}
  </details>;
}

export function MenuEditor({
  menuId,
  initialMenu,
}: {
  menuId: string;
  initialMenu?: ReviewedMenu;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState<ReviewedMenu | null>(initialMenu ? normalizeMenu(initialMenu) : null);
  const [name, setName] = useState(initialMenu?.name ?? '');
  const [dishes, setDishes] = useState<DishDraft[]>(initialMenu ? normalizeMenu(initialMenu).document.dishes : []);
  const [loading, setLoading] = useState(!initialMenu);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedDishIds, setSelectedDishIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const initialLoadStarted = useRef(false);
  const editorRoot = useRef<HTMLElement>(null);
  const errorMessage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorMessage.current?.focus();
  }, [error]);

  const loadMenu = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/menus/${encodeURIComponent(menuId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await problemMessage(response, 'We could not load this menu.')).message);
      const result = (await response.json()) as { menu: ReviewedMenu };
      const loaded = normalizeMenu(result.menu);
      setMenu(loaded);
      setName(loaded.name);
      setDishes(loaded.document.dishes);
      setSelectedDishIds(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load this menu.');
    } finally {
      setLoading(false);
    }
  }, [menuId]);

  useEffect(() => {
    if (initialMenu || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadMenu();
  }, [initialMenu, loadMenu]);

  function changeDish(index: number, patch: Partial<DishDraft>) {
    setDishes((current) => current.map((dish, dishIndex) => dishIndex === index ? { ...dish, ...patch } : dish));
  }

  function changeIngredient(dishIndex: number, ingredientIndex: number, patch: Partial<IngredientDraft>) {
    setDishes((current) => current.map((dish, currentDishIndex) => currentDishIndex === dishIndex
      ? {
          ...dish,
          ingredients: dish.ingredients.map((ingredient, currentIngredientIndex) =>
            currentIngredientIndex === ingredientIndex ? { ...ingredient, ...patch } : ingredient,
          ),
        }
      : dish));
  }

  function removeIngredient(dishIndex: number, ingredientIndex: number) {
    setDishes((current) => current.map((dish, currentDishIndex) => currentDishIndex === dishIndex
      ? { ...dish, ingredients: dish.ingredients.filter((_, index) => index !== ingredientIndex) }
      : dish));
  }

  function removeDish(dishId: string) {
    if (deleting) return;
    if (!window.confirm('Remove this dish from the draft?')) return;
    setDishes((current) => removeSelectedDishes(current, new Set([dishId])));
    setSelectedDishIds((current) => {
      const next = new Set(current);
      next.delete(dishId);
      return next;
    });
  }

  function toggleDishSelection(dishId: string) {
    if (deleting) return;
    setSelectedDishIds((current) => {
      const next = new Set(current);
      if (next.has(dishId)) next.delete(dishId);
      else next.add(dishId);
      return next;
    });
  }

  function removeSelectedDishDrafts() {
    if (deleting || selectedDishIds.size === 0) return;
    if (!window.confirm('Remove selected dishes from the draft?')) return;
    setDishes((current) => removeSelectedDishes(current, selectedDishIds));
    setSelectedDishIds(new Set());
  }

  function addSuggestedIngredient(dishIndex: number, suggestion: IngredientSuggestionDto) {
    if (deleting || suggestion.kind !== 'INGREDIENT') return;
    setDishes((current) => current.map((dish, currentDishIndex) => {
      if (currentDishIndex !== dishIndex) return dish;
      if (dish.ingredients.some(({ itemKey }) => itemKey === suggestion.itemKey)) return dish;
      return {
        ...dish,
        ingredients: [
          ...dish.ingredients,
          {
            id: documentId('i'),
            itemKey: suggestion.itemKey,
            name: suggestion.name,
            quantity: suggestion.quantity,
            unit: suggestion.unit,
            specification: suggestion.specification,
          },
        ],
      };
    }));
  }

  function applyCleanupProposal(proposal: MenuCleanupProposal) {
    const cleanedDocument = applyMenuCleanupProposal({ ...menu!.document, dishes }, proposal);
    setDishes(cleanedDocument.dishes);
    setSelectedDishIds((current) => pruneSelectedDishIds(current, cleanedDocument.dishes));
    setMenu((current) => current ? {
      ...current,
      cleanupProposals: (current.cleanupProposals ?? []).filter(({ id }) => id !== proposal.id),
    } : current);
  }

  const complete = Boolean(
    name.trim() &&
    dishes.length > 0 &&
    dishes.every((dish) =>
      dish.name.trim() &&
      dish.ingredients.length > 0 &&
      dish.ingredients.every((ingredient) => ingredient.name.trim() && ingredient.quantity.trim()),
    ),
  );

  async function saveDraft() {
    if (!menu || saving || deleting || !complete) return null;
    setSaving(true);
    setError('');
    setNotice('');
    setFieldErrors({});
    try {
      const response = await workspaceMutationFetch(`/api/menus/${encodeURIComponent(menu.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: menu.version,
          name: name.trim(),
          sourceText: menu.sourceText,
          document: {
            ...menu.document,
            dishes: dishes.map((dish, dishIndex) => ({
              ...dish,
              name: dish.name.trim(),
              position: dishIndex,
              ingredients: dish.ingredients.map((ingredient) => ({
                ...ingredient,
                name: ingredient.name.trim(),
                quantity: ingredient.quantity.trim(),
              })),
            })),
          },
        }),
      });
      if (!response.ok) {
        const problem = await problemMessage(response, 'We could not save this menu.');
        // A rejected optional value must be reachable without finding a closed panel.
        editorRoot.current?.querySelectorAll('details').forEach((details) => { details.open = true; });
        setFieldErrors(problem.fields);
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { menu: ReviewedMenu };
      const saved = normalizeMenu(result.menu);
      setMenu({
        ...saved,
        ingredientSuggestionsByDishId: menu.ingredientSuggestionsByDishId,
      });
      setName(saved.name);
      setDishes(saved.document.dishes);
      setNotice('Draft saved.');
      return saved;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not save this menu.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!menu || approving || deleting || !complete) return;
    if (!window.confirm('Approve this menu? Use only quantities your team has checked.')) return;
    setApproving(true);
    setError('');
    const saved = await saveDraft();
    if (!saved) {
      setApproving(false);
      return;
    }
    try {
      const response = await workspaceMutationFetch(`/api/menus/${encodeURIComponent(saved.id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: saved.version }),
      });
      if (!response.ok) throw new Error((await problemMessage(response, 'We could not approve this menu.')).message);
      const result = (await response.json()) as { menu: ReviewedMenu };
      const approved = normalizeMenu(result.menu);
      setMenu(approved);
      setName(approved.name);
      setDishes(approved.document.dishes);
      setNotice('Menu approved and ready for procurement.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not approve this menu.');
    } finally {
      setApproving(false);
    }
  }

  async function deleteMenu() {
    if (!menu || deleting) return;
    const result = await deleteMenuAndNavigate(menu, router, window.confirm, () => {
      setDeleting(true);
      setError('');
      setNotice('');
      setFieldErrors({});
    });
    if (result.error) setError(result.error);
    if (!result.keepLocked) setDeleting(false);
  }

  if (loading) {
    return <main className={styles.page}><div className={styles.loading} aria-label="Loading menu"><span /><span /><span /></div></main>;
  }

  if (!menu) {
    return (
      <main className={styles.page}>
        <section className={styles.missing}>
          <h1>Menu unavailable</h1>
          <p>{error || 'This menu could not be found.'}</p>
          <button type="button" onClick={() => void loadMenu()}>Try again</button>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page} ref={editorRoot}>
      <button className={styles.back} type="button" onClick={() => router.push('/menus')}>
        <ArrowLeft aria-hidden="true" /> Menus
      </button>
      <WorkspaceHeader title="Review menu" description="Check every dish, ingredient, quantity and unit before approval." actions={<>
        <span className={menu.status === 'APPROVED' ? styles.approved : styles.draft}>
          {menu.status === 'APPROVED' ? <CheckCircle2 aria-hidden="true" /> : null}
          {menu.status === 'APPROVED' ? 'Approved' : 'Draft'} · v{menu.version}
        </span>
        <button className={styles.deleteButton} type="button" disabled={deleting || saving || approving} onClick={() => void deleteMenu()}>
          <Trash2 aria-hidden="true" /> {deleting ? 'Deleting…' : 'Delete menu'}
        </button>
      </>} />
      <label className={styles.titleField}>
        <span>Menu name</span>
        <input aria-label="Menu name" value={name} maxLength={160} disabled={deleting} onChange={(event) => setName(event.target.value)} />
      </label>

      {menu.status === 'APPROVED' && (
        <div className={styles.warning}>
          Saving changes returns this menu to draft for review.
          <Link href="/service-planning">Next: plan meals &amp; portions →</Link>
        </div>
      )}
      {!complete && <p className={styles.warning}>Before saving: name the menu and each dish, then add at least one ingredient with a quantity per dish.</p>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {error && <div ref={errorMessage} tabIndex={-1} className={styles.error} role="alert">{error}</div>}
      {Object.keys(fieldErrors).length > 0 && (
        <div className={styles.error} role="alert">
          <strong>Check these menu details:</strong>
          <ul>{Object.entries(fieldErrors).map(([field, messages]) => (
            <li key={field}>{field}: {messages.join(' ')}</li>
          ))}</ul>
        </div>
      )}

      {(menu.cleanupProposals?.length ?? 0) > 0 && (
        <details className={styles.cleanupPanel} aria-label="Suggested menu cleanup">
          <summary>Suggested cleanup · {menu.cleanupProposals!.length} changes to review</summary>
          <div>
            {menu.cleanupProposals!.map((proposal) => (
              <article key={proposal.id}>
                <span><strong>{proposal.before}</strong><small>Change to {proposal.after}</small></span>
                <button type="button" disabled={deleting} onClick={() => applyCleanupProposal(proposal)}>Use change</button>
              </article>
            ))}
          </div>
        </details>
      )}

      <section className={styles.dishes} aria-label="Menu dishes">
        <div className={styles.dishToolbar} aria-label="Dish selection actions">
          <span>{selectedDishIds.size} selected</span>
          <button type="button" disabled={deleting || dishes.length === 0} onClick={() => setSelectedDishIds(new Set(dishes.map(({ id }) => id)))}>Select all</button>
          <button type="button" disabled={deleting || selectedDishIds.size === 0} onClick={() => setSelectedDishIds(new Set())}>Clear selection</button>
          <button type="button" className={styles.removeSelected} disabled={deleting || selectedDishIds.size === 0} onClick={removeSelectedDishDrafts}>
            <Trash2 aria-hidden="true" /> Remove selected
          </button>
        </div>
        {dishes.map((dish, dishIndex) => (
          <article className={styles.dish} key={dish.id ?? `new-dish-${dishIndex}`}>
            <header>
              <span>{String(dishIndex + 1).padStart(2, '0')}</span>
              <label className={styles.dishSelection}>
                <input
                  className={styles.dishCheckbox}
                  type="checkbox"
                  checked={selectedDishIds.has(dish.id)}
                  disabled={deleting}
                  onChange={() => toggleDishSelection(dish.id)}
                />
                <span className={styles.selectionLabel}>Select {dish.name || `dish ${dishIndex + 1}`}</span>
              </label>
              <label>
                <span>Dish name</span>
                <input
                  aria-label={`Dish ${dishIndex + 1} name`}
                  value={dish.name}
                  maxLength={160}
                  disabled={deleting}
                  placeholder="Dal makhani"
                  onChange={(event) => changeDish(dishIndex, { name: event.target.value })}
                />
              </label>
              <button type="button" disabled={deleting} aria-label={`Remove ${dish.name || `dish ${dishIndex + 1}`}`} onClick={() => removeDish(dish.id)}>
                <Trash2 aria-hidden="true" />
              </button>
            </header>
            <div className={styles.ingredientHeader} aria-hidden="true">
              <span>Ingredient</span><span>Quantity</span><span>Unit</span><span>Category</span><span />
            </div>
            <div className={styles.ingredients}>
              {dish.ingredients.map((ingredient, ingredientIndex) => (
                <div className={styles.ingredient} key={ingredient.id ?? `new-ingredient-${ingredientIndex}`}>
                  <label>
                    <span>Ingredient</span>
                    <input
                      aria-label={`${dish.name || `Dish ${dishIndex + 1}`} ingredient ${ingredientIndex + 1}`}
                      value={ingredient.name}
                      maxLength={160}
                      disabled={deleting}
                      placeholder="Urad dal"
                      onChange={(event) => changeIngredient(dishIndex, ingredientIndex, { name: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Quantity</span>
                    <input
                      aria-label={`${ingredient.name || 'Ingredient'} quantity`}
                      inputMode="decimal"
                      value={ingredient.quantity}
                      disabled={deleting}
                      placeholder="2.5"
                      onChange={(event) => changeIngredient(dishIndex, ingredientIndex, { quantity: event.target.value })}
                    />
                  </label>
                  <label className={styles.unitSelect}>
                    <span>Unit</span>
                    <select
                      aria-label={`${ingredient.name || 'Ingredient'} unit`}
                      value={ingredient.unit}
                      disabled={deleting}
                      onChange={(event) => changeIngredient(dishIndex, ingredientIndex, { unit: event.target.value as Unit })}
                    >
                      {unitOptions.map((unit) => <option value={unit.value} key={unit.value}>{unit.label}</option>)}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </label>
                  <label className={styles.unitSelect}>
                    <span>Category</span>
                    <select
                      aria-label={`${ingredient.name || 'Ingredient'} category`}
                      value={ingredient.specification.category}
                      disabled={deleting}
                      onChange={(event) => changeIngredient(dishIndex, ingredientIndex, {
                        specification: {
                          ...ingredient.specification,
                          category: event.target.value as ProcurementCategory,
                        },
                      })}
                    >
                      {categoryOptions.map(([category, label]) => (
                        <option value={category} key={category}>{label}</option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </label>
                  <MenuReferenceDisclosure hasReference={Boolean(ingredient.specification.referenceUrl)}>
                    <label>
                      <span>Reference link</span>
                      <input
                        aria-label={`${ingredient.name || 'Ingredient'} food reference link`}
                        type="url"
                        inputMode="url"
                        placeholder="https://example.com/item"
                        value={ingredient.specification.referenceUrl ?? ''}
                        disabled={deleting}
                        onChange={(event) => changeIngredient(dishIndex, ingredientIndex, {
                          specification: {
                            ...ingredient.specification,
                            referenceUrl: event.target.value || null,
                          },
                        })}
                      />
                    </label>
                  </MenuReferenceDisclosure>
                  <button type="button" disabled={deleting} aria-label={`Remove ${ingredient.name || 'ingredient'}`} onClick={() => removeIngredient(dishIndex, ingredientIndex)}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            {(menu.ingredientSuggestionsByDishId?.[dish.id] ?? []).some(({ kind }) => kind === 'INGREDIENT') && (
              <div className={styles.suggestions}>
                <span>Quick add</span>
                {(menu.ingredientSuggestionsByDishId?.[dish.id] ?? [])
                  .filter((suggestion) => suggestion.kind === 'INGREDIENT')
                  .filter((suggestion) => !dish.ingredients.some(({ itemKey }) => itemKey === suggestion.itemKey))
                  .map((suggestion) => (
                    <button type="button" key={suggestion.id} disabled={deleting} onClick={() => addSuggestedIngredient(dishIndex, suggestion)}>
                      <Plus aria-hidden="true" />
                      <span><strong>{suggestion.name}</strong><small>{suggestion.quantity} {unitOptions.find(({ value }) => value === suggestion.unit)?.label ?? suggestion.unit} · {suggestion.sourceLabel}</small></span>
                    </button>
                  ))}
              </div>
            )}
            <button
              className={styles.addRow}
              type="button"
              disabled={deleting}
              onClick={() => changeDish(dishIndex, { ingredients: [...dish.ingredients, newIngredient()] })}
            >
              <Plus aria-hidden="true" /> Add ingredient
            </button>
          </article>
        ))}
        <button className={styles.addDish} type="button" disabled={deleting} onClick={() => setDishes((current) => [...current, newDish()])}>
          <Plus aria-hidden="true" /> Add dish
        </button>
      </section>

      <footer className={styles.stickyActions}>
        <span>{dishes.length} {dishes.length === 1 ? 'dish' : 'dishes'} · {dishes.reduce((sum, dish) => sum + dish.ingredients.length, 0)} {dishes.reduce((sum, dish) => sum + dish.ingredients.length, 0) === 1 ? 'ingredient' : 'ingredients'}</span>
        <button className={styles.secondaryButton} type="button" disabled={!complete || saving || approving || deleting} onClick={() => void saveDraft()}>
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button className={styles.primaryButton} type="button" disabled={!complete || saving || approving || deleting} onClick={() => void approve()}>
          {approving ? 'Approving…' : 'Approve menu'}
        </button>
      </footer>
    </main>
  );
}
