import { DOCUMENT_LIMITS } from '@/lib/domain/document-limits';
import {
  buildDefaultSourcingSelection,
  preserveRequestSourcingOverrides,
  collectExplicitSupplierIds,
  RequestDocumentValidationError,
  requestAcceptsVerifiedApplications,
  resolveItemSourcing,
  type RequestItemsV1,
  type RequestSourcingV1,
  type SourcingSelectionV1,
  validateExplicitRequestSuppliers,
  validateRequestDocuments,
  validateRequestItems,
  validateRequestSourcing,
} from '@/lib/procurement/request-document';
import {
  decodeRequestCursor,
  encodeRequestCursor,
  ProcurementRequestValidationError,
  validateDraftPatchInput,
  validateLinkActionInput,
  validateOpenRequestInput,
  validateProcurementRequestDraftInput,
  validateRepeatRequestInput,
} from '@/lib/procurement/request-service';

const now = new Date('2027-01-08T09:00:00.000Z');

const specification = {
  v: 1 as const,
  category: 'DAIRY' as const,
  description: 'Unsalted table butter',
  preferredBrand: null,
  packSize: '500 g',
  qualityGrade: null,
  notes: null,
  referenceUrl: null,
  thumbnailWebpBase64: null,
};

const currentOnly: SourcingSelectionV1 = {
  v: 1,
  modes: ['CURRENT'],
  currentSupplierIds: ['supplier-current'],
  selectedNewSupplierIds: [],
  acceptVerifiedApplications: false,
};

const verifiedNew: SourcingSelectionV1 = {
  v: 1,
  modes: ['VERIFIED_NEW'],
  currentSupplierIds: [],
  selectedNewSupplierIds: [],
  acceptVerifiedApplications: true,
};

const currentAndVerified: SourcingSelectionV1 = {
  v: 1,
  modes: ['CURRENT', 'VERIFIED_NEW'],
  currentSupplierIds: ['supplier-current'],
  selectedNewSupplierIds: [],
  acceptVerifiedApplications: true,
};

const selectedNewOnly: SourcingSelectionV1 = {
  v: 1,
  modes: ['SELECTED_NEW'],
  currentSupplierIds: [],
  selectedNewSupplierIds: ['supplier-selected'],
  acceptVerifiedApplications: false,
};

function item(
  id: string,
  override: SourcingSelectionV1 | null = null,
): RequestItemsV1['items'][number] {
  return {
    id,
    itemKey: 'butter',
    name: 'Butter',
    quantity: '4.25',
    unit: 'KILOGRAM',
    specification,
    sourcingOverride: override,
  };
}

const requestItems: RequestItemsV1 = { v: 1, items: [item('ingredient-a')] };
const requestSourcing: RequestSourcingV1 = { v: 1, default: currentAndVerified };

describe('reviewed additional draft items', () => {
  const draft = {
    title: 'Shopping list', defaultSourcing: verifiedNew, sourcingOverrides: {},
    deliveryDetails: { addressLine: '12 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
    deliveryDate: '2027-01-10', quoteDeadline: '2027-01-09T10:00:00.000Z',
    additionalItems: requestItems,
  };
  it('allows validated list-only rows without an approved menu', () => {
    expect(validateProcurementRequestDraftInput(draft, now)).toMatchObject({ menuId: null, selectedItemIds: [], additionalItems: requestItems });
  });
  it('preserves the menu contract while appending separately identified rows', () => {
    expect(validateProcurementRequestDraftInput({ ...draft, menuId: 'menu-a', selectedItemIds: ['menu-row'] }, now)).toMatchObject({ menuId: 'menu-a', selectedItemIds: ['menu-row'], additionalItems: requestItems });
  });
  it('rejects empty demand, unbound menu rows, collisions and combined overflow', () => {
    for (const invalid of [
      { ...draft, additionalItems: undefined },
      { ...draft, additionalItems: { v: 1, items: [] } },
      { ...draft, selectedItemIds: ['menu-row'] },
      { ...draft, menuId: 'menu-a', selectedItemIds: ['ingredient-a'] },
      { ...draft, menuId: 'menu-a', selectedItemIds: Array.from({ length: 250 }, (_, i) => `menu-${i}`) },
      { ...draft, additionalItems: { v: 1, items: [item('same'), item('same')] } },
    ]) expect(() => validateProcurementRequestDraftInput(invalid, now)).toThrow(ProcurementRequestValidationError);
  });
  it('does not invent missing quantities, units or specifications', () => {
    for (const change of [{ quantity: '' }, { unit: '' }, { quantity: '0' }, { specification: { v: 1, category: 'GUESSED' } }]) {
      expect(() => validateProcurementRequestDraftInput({ ...draft, additionalItems: { v: 1, items: [{ ...item('row'), ...change }] } }, now)).toThrow(ProcurementRequestValidationError);
    }
  });
});

describe('compact request documents and request commands', () => {
  it('validates the exact item shape while preserving exact quantities, specifications, and duplicate item keys', () => {
    expect(validateRequestItems({
      v: 1,
      items: [
        { ...item('ingredient-a'), quantity: '4.250', unit: 'kg' },
        { ...item('ingredient-b'), quantity: '1.125' },
      ],
    })).toEqual({
      v: 1,
      items: [
        { ...item('ingredient-a'), quantity: '4.25' },
        { ...item('ingredient-b'), quantity: '1.125' },
      ],
    });

    for (const invalid of [
      { ...requestItems, unexpected: true },
      { ...requestItems, items: [{ ...item('ingredient-a'), clientFact: true }] },
      { ...requestItems, items: [item('ingredient-a'), item('ingredient-a')] },
      { ...requestItems, items: [{ ...item('ingredient-a'), quantity: '0' }] },
      { ...requestItems, items: [{ ...item('ingredient-a'), itemKey: 'Butter Key' }] },
      { ...requestItems, items: [] },
      {
        ...requestItems,
        items: Array.from(
          { length: DOCUMENT_LIMITS.requestItems.items + 1 },
          (_, index) => item(`ingredient-${index}`),
        ),
      },
    ]) {
      expect(() => validateRequestItems(invalid)).toThrow(RequestDocumentValidationError);
    }
  });

  it('enforces the 512 KiB item and 64 KiB sourcing limits from one source of truth', () => {
    expect(DOCUMENT_LIMITS.requestItems.jsonBytes).toBe(512 * 1024);
    expect(DOCUMENT_LIMITS.requestSourcing.jsonBytes).toBe(64 * 1024);

    const largeItems = {
      v: 1,
      items: Array.from({ length: 250 }, (_, index) => ({
        ...item(`ingredient-${index}`),
        specification: {
          ...specification,
          notes: 'x'.repeat(1_000),
          referenceUrl: `https://example.test/${'a'.repeat(1_950)}?i=${index}`,
        },
      })),
    };
    expect(() => validateRequestItems(largeItems)).toThrow(/512 KiB/i);

    const longId = (prefix: string) => `${prefix}-${'x'.repeat(190)}`;
    const largeSourcing = {
      v: 1,
      default: currentOnly,
      items: Array.from({ length: 200 }, (_, index) => ({
        id: `item-${index}`,
        selection: {
          ...currentOnly,
          currentSupplierIds: Array.from({ length: 20 }, (_, supplier) =>
            longId(`${index}-${supplier}`),
          ),
        },
      })),
    };
    expect(() => validateRequestSourcing(largeSourcing)).toThrow(
      RequestDocumentValidationError,
    );
  });

  it('accepts canonical nonempty mode subsets and resolves a full item replacement override', () => {
    const canonical = validateRequestSourcing({
      v: 1,
      default: {
        ...currentAndVerified,
        modes: ['VERIFIED_NEW', 'CURRENT'],
      },
    });
    expect(canonical.default.modes).toEqual(['CURRENT', 'VERIFIED_NEW']);

    expect(resolveItemSourcing(canonical, selectedNewOnly)).toEqual(
      selectedNewOnly,
    );
    expect(resolveItemSourcing(canonical, null)).toEqual(currentAndVerified);

    for (const defaultSelection of [
      { ...currentOnly, modes: [] },
      { ...currentOnly, modes: ['CURRENT', 'CURRENT'] },
      { ...currentOnly, modes: ['CURRENT', 'OTHER'] },
      { ...currentOnly, currentSupplierIds: ['supplier-current', 'supplier-current'] },
      { ...currentOnly, selectedNewSupplierIds: ['supplier-selected'] },
      { ...currentOnly, unexpected: true },
    ]) {
      expect(() => validateRequestSourcing({ v: 1, default: defaultSelection }))
        .toThrow(RequestDocumentValidationError);
    }
  });

  it('builds one canonical multiselect sourcing choice for saved and new suppliers', () => {
    expect(buildDefaultSourcingSelection([
      { id: 'current-a', relationshipType: 'CURRENT' },
      { id: 'new-a', relationshipType: 'SELECTED_NEW' },
      { id: 'current-b', relationshipType: 'CURRENT' },
    ], ['new-a', 'current-b'], true)).toEqual({
      v: 1,
      modes: ['CURRENT', 'SELECTED_NEW', 'VERIFIED_NEW'],
      currentSupplierIds: ['current-b'],
      selectedNewSupplierIds: ['new-a'],
      acceptVerifiedApplications: true,
    });
  });

  it('preserves item specific supplier choices while the default selection changes', () => {
    expect(preserveRequestSourcingOverrides(
      { v: 1, items: [item('ingredient-a', selectedNewOnly), item('ingredient-b')] },
    )).toEqual({
      v: 1,
      items: [item('ingredient-a', selectedNewOnly), item('ingredient-b')],
    });
  });

  it('allows verified-new-only demand, bounds the explicit union at 20, and rejects an unsourced effective item', () => {
    expect(validateRequestDocuments(
      { v: 1, items: [item('ingredient-a')] },
      { v: 1, default: verifiedNew },
    )).toEqual({
      items: { v: 1, items: [item('ingredient-a')] },
      sourcing: { v: 1, default: verifiedNew },
      explicitSupplierIds: [],
    });

    const twenty = Array.from({ length: 20 }, (_, index) => `supplier-${index}`);
    expect(collectExplicitSupplierIds(
      { v: 1, items: [item('ingredient-a')] },
      {
        v: 1,
        default: { ...currentOnly, currentSupplierIds: twenty },
      },
    )).toEqual(twenty);
    expect(collectExplicitSupplierIds(
      {
        v: 1,
        items: [
          item('ingredient-a', selectedNewOnly),
          item('ingredient-b', selectedNewOnly),
        ],
      },
      { v: 1, default: currentOnly },
    )).toEqual(['supplier-selected']);
    expect(() => validateRequestDocuments(
      { v: 1, items: [item('ingredient-a')] },
      {
        v: 1,
        default: {
          ...currentOnly,
          currentSupplierIds: [...twenty, 'supplier-20'],
        },
      },
    )).toThrow(/20/);
    expect(() => validateRequestDocuments(
      { v: 1, items: [item('ingredient-a', { ...currentOnly, currentSupplierIds: [] })] },
      { v: 1, default: currentOnly },
    )).toThrow(/effective sourcing/i);
  });

  it('validates active VERIFIED suppliers against the exact CURRENT or SELECTED_NEW relationship', () => {
    const items = { v: 1 as const, items: [item('ingredient-a', selectedNewOnly)] };
    const sourcing = { v: 1 as const, default: currentOnly };
    const valid = [
      {
        id: 'supplier-selected', relationshipType: 'SELECTED_NEW' as const,
        verificationStatus: 'VERIFIED' as const, isActive: true,
        applicationRequestId: null,
        verifiedAt: new Date('2027-01-01T00:00:00.000Z'),
        verifiedByUserId: 'owner-a',
      },
    ];
    expect(() => validateExplicitRequestSuppliers(items, sourcing, valid)).not.toThrow();

    for (const suppliers of [
      [],
      valid.map((supplier) => ({
        ...supplier,
        relationshipType: 'CURRENT' as const,
      })),
      valid.map((supplier) => supplier.id === 'supplier-selected'
        ? { ...supplier, verificationStatus: 'PENDING' as const }
        : supplier),
      valid.map((supplier) => supplier.id === 'supplier-selected'
        ? { ...supplier, isActive: false }
        : supplier),
    ]) {
      expect(() => validateExplicitRequestSuppliers(items, sourcing, suppliers))
        .toThrow(RequestDocumentValidationError);
    }
  });

  it('enables applications only when one effective item has both the boolean and VERIFIED_NEW mode', () => {
    expect(requestAcceptsVerifiedApplications(
      { v: 1, items: [item('ingredient-a', selectedNewOnly)] },
      { v: 1, default: currentAndVerified },
    )).toBe(false);
    expect(requestAcceptsVerifiedApplications(
      {
        v: 1,
        items: [
          item('ingredient-a', selectedNewOnly),
          item('ingredient-b', currentAndVerified),
        ],
      },
      { v: 1, default: currentOnly },
    )).toBe(true);
    expect(requestAcceptsVerifiedApplications(
      { v: 1, items: [item('ingredient-a')] },
      {
        v: 1,
        default: {
          ...currentOnly,
          acceptVerifiedApplications: true,
        },
      },
    )).toBe(false);
  });

  it('parses create and patch documents without accepting initial client-authored item facts', () => {
    const create = validateProcurementRequestDraftInput({
      title: ' Weekly vegetables — Indiranagar ',
      menuId: 'menu-a',
      selectedItemIds: ['ingredient-a', 'ingredient-b'],
      defaultSourcing: currentAndVerified,
      sourcingOverrides: { 'ingredient-b': selectedNewOnly },
      deliveryDetails: {
        addressLine: '12, 100 Feet Road', city: 'Bengaluru',
        state: 'Karnataka', pin: '560038', instructions: ' Deliver before 8:00 AM. ',
      },
      deliveryDate: '2027-01-10',
      quoteDeadline: '2027-01-09T10:00:00.000Z',
      commercialTerms: ' Payment in 15 days. ',
    }, now);
    expect(create).toMatchObject({
      title: 'Weekly vegetables — Indiranagar',
      selectedItemIds: ['ingredient-a', 'ingredient-b'],
      defaultSourcing: currentAndVerified,
      sourcingOverrides: { 'ingredient-b': selectedNewOnly },
      commercialTerms: 'Payment in 15 days.',
    });
    expect(create.deliveryDate).toEqual(new Date('2027-01-10T00:00:00.000Z'));

    expect(() => validateProcurementRequestDraftInput({
      ...create,
      items: requestItems,
    }, now)).toThrow(ProcurementRequestValidationError);
    expect(validateDraftPatchInput({ items: requestItems, sourcing: requestSourcing }, now))
      .toEqual({ items: requestItems, sourcing: requestSourcing });
  });

  it('keeps version, dates, delivery, cursor, and closed action validation', () => {
    expect(validateOpenRequestInput({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
    expect(validateLinkActionInput({
      action: 'rotate', supplierRequestId: 'grant-a', expectedVersion: 2,
    })).toEqual({ action: 'rotate', supplierRequestId: 'grant-a', expectedVersion: 2 });
    expect(() => validateOpenRequestInput({ expectedVersion: 2, status: 'OPEN' }))
      .toThrow(ProcurementRequestValidationError);

    expect(validateRepeatRequestInput({
      expectedSourceVersion: 3,
      title: 'Weekly vegetables · 17 January',
      deliveryDate: '2027-01-17',
      quoteDeadline: '2027-01-16T10:00:00.000Z',
    }, now)).toEqual({
      expectedSourceVersion: 3,
      title: 'Weekly vegetables · 17 January',
      deliveryDate: new Date('2027-01-17T00:00:00.000Z'),
      quoteDeadline: new Date('2027-01-16T10:00:00.000Z'),
    });

    const cursor = encodeRequestCursor({
      createdAt: new Date('2027-01-08T10:00:00.000Z'), id: 'request-a',
    });
    expect(cursor).not.toContain('request-a');
    expect(decodeRequestCursor(cursor)).toEqual({
      createdAt: new Date('2027-01-08T10:00:00.000Z'), id: 'request-a',
    });
    expect(() => decodeRequestCursor(`${cursor}x`))
      .toThrow(ProcurementRequestValidationError);
  });
});
