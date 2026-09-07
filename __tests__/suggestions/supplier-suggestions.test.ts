import {
  rankSupplierSuggestions,
  SUPPLIER_SUGGESTION_LIMITS,
} from '@/lib/suggestions/supplier-suggestions';

const capabilities = (
  input: Partial<{
    itemTier: 'PREFERRED' | 'BACKUP';
    categoryTier: 'PREFERRED' | 'BACKUP' | 'CAPABLE';
  }>,
) => ({
  v: 1 as const,
  categories: input.categoryTier
    ? [{ category: 'VEGETABLES' as const, tier: input.categoryTier, rank: 1 }]
    : [],
  items: input.itemTier
    ? [{ itemKey: 'tomato', itemName: 'Tomato', tier: input.itemTier, rank: 1 }]
    : [],
});

describe('supplier suggestions', () => {
  it('uses completed delivery evidence to break otherwise equal capability matches', () => {
    const result = rankSupplierSuggestions({
      items: [{ id: 'item-1', itemKey: 'tomato', category: 'VEGETABLES' }],
      suppliers: [
        { id: 'a', businessName: 'A Farm', capabilities: capabilities({ categoryTier: 'CAPABLE' }) },
        { id: 'b', businessName: 'B Farm', capabilities: capabilities({ categoryTier: 'CAPABLE' }) },
      ],
      priorAwardSupplierIdsByItemKey: new Map(),
      deliveryEvidenceBySupplierId: new Map([
        ['a', { datedDeliveries: 4, onTimeDeliveries: 2 }],
        ['b', { datedDeliveries: 4, onTimeDeliveries: 4 }],
      ]),
    });
    expect(result['item-1'].map(s => s.supplierId)).toEqual(['b', 'a']);
    expect(result['item-1'][0].reason).toContain('4 of 4 dated deliveries on time');
  });

  it('never treats missing or limited delivery evidence as poor performance', () => {
    const result = rankSupplierSuggestions({
      items: [{ id: 'item-1', itemKey: 'tomato', category: 'VEGETABLES' }],
      suppliers: [
        { id: 'a', businessName: 'A Farm', capabilities: capabilities({ categoryTier: 'CAPABLE' }) },
        { id: 'b', businessName: 'B Farm', capabilities: capabilities({ categoryTier: 'CAPABLE' }) },
      ], priorAwardSupplierIdsByItemKey: new Map(),
      deliveryEvidenceBySupplierId: new Map([['b', { datedDeliveries: 1, onTimeDeliveries: 1 }]]),
    });
    expect(result['item-1'].map(s => s.supplierId)).toEqual(['a', 'b']);
  });
  it('uses the specified evidence precedence and literal reasons', () => {
    const result = rankSupplierSuggestions({
      items: [{ id: 'item-1', itemKey: 'tomato', category: 'VEGETABLES' }],
      suppliers: [
        { id: 'prior', businessName: 'A Prior', capabilities: capabilities({}) },
        { id: 'capable', businessName: 'B Capable', capabilities: capabilities({ categoryTier: 'CAPABLE' }) },
        { id: 'category-backup', businessName: 'C Category backup', capabilities: capabilities({ categoryTier: 'BACKUP' }) },
        { id: 'category-preferred', businessName: 'D Category preferred', capabilities: capabilities({ categoryTier: 'PREFERRED' }) },
        { id: 'item-backup', businessName: 'E Item backup', capabilities: capabilities({ itemTier: 'BACKUP' }) },
        { id: 'item-preferred', businessName: 'F Item preferred', capabilities: capabilities({ itemTier: 'PREFERRED' }) },
      ],
      priorAwardSupplierIdsByItemKey: new Map([['tomato', new Set(['prior'])]]),
    });

    expect(result).toEqual({
      'item-1': [
        { supplierId: 'item-preferred', businessName: 'F Item preferred', reason: 'Preferred for this item', selected: false },
        { supplierId: 'item-backup', businessName: 'E Item backup', reason: 'Backup for this item', selected: false },
        { supplierId: 'category-preferred', businessName: 'D Category preferred', reason: 'Preferred for this category', selected: false },
        { supplierId: 'category-backup', businessName: 'C Category backup', reason: 'Backup for this category', selected: false },
        { supplierId: 'capable', businessName: 'B Capable', reason: 'Listed for this category', selected: false },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/winner|best|recommended|savings/i);
  });

  it('caps the name-ordered candidate set at 50 and suggestions at 5 with stable name/id ties', () => {
    const suppliers = Array.from({ length: 52 }, (_, index) => ({
      id: `supplier-${String(index).padStart(2, '0')}`,
      businessName: index < 2 ? 'Same Name' : `Supplier ${String(index).padStart(2, '0')}`,
      capabilities: capabilities({ itemTier: 'PREFERRED' }),
    })).reverse();
    const result = rankSupplierSuggestions({
      items: [{ id: 'item-1', itemKey: 'tomato', category: 'VEGETABLES' }],
      suppliers,
      priorAwardSupplierIdsByItemKey: new Map(),
    });

    expect(result['item-1']).toHaveLength(SUPPLIER_SUGGESTION_LIMITS.perItem);
    expect(result['item-1']?.slice(0, 2).map(({ supplierId }) => supplierId)).toEqual([
      'supplier-00',
      'supplier-01',
    ]);
    expect(result['item-1']?.some(({ supplierId }) => supplierId === 'supplier-51')).toBe(false);
  });

  it('uses exact prior item keys as the final evidence source and returns empty arrays consistently', () => {
    const result = rankSupplierSuggestions({
      items: [
        { id: 'tomato-line', itemKey: 'tomato', category: 'VEGETABLES' },
        { id: 'onion-line', itemKey: 'onion', category: 'VEGETABLES' },
      ],
      suppliers: [{ id: 'prior', businessName: 'Prior Foods', capabilities: capabilities({}) }],
      priorAwardSupplierIdsByItemKey: new Map([['tomato', new Set(['prior'])]]),
    });

    expect(result).toEqual({
      'tomato-line': [{
        supplierId: 'prior', businessName: 'Prior Foods',
        reason: 'Supplied this item in a prior award', selected: false,
      }],
      'onion-line': [],
    });
  });
});
