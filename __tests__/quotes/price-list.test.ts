import { MAX_PRICE_LIST_TEXT_LENGTH, parsePriceList, type PriceListItem } from '@/lib/quotes/price-list';

const items: readonly PriceListItem[] = Object.freeze([
  { id: 'tomato', name: 'Tomato', unit: 'KILOGRAM' },
  { id: 'paneer', name: 'Paneer', unit: 'KILOGRAM' },
  { id: 'onion', name: 'Red Onion', unit: 'KILOGRAM' },
]);

describe('parsePriceList', () => {
  test.each([
    ['Tomato 42/kg', 'Tomato', '42', 'KILOGRAM', 'tomato'],
    ['Tomato ₹42 per kg', 'Tomato', '42', 'KILOGRAM', 'tomato'],
    ['Tomato | kg | 42', 'Tomato', '42', 'KILOGRAM', 'tomato'],
    ['Tomato | ₹42 | kg', 'Tomato', '42', 'KILOGRAM', 'tomato'],
    ['Tomato\tkg\t42', 'Tomato', '42', 'KILOGRAM', 'tomato'],
    ['Tomato kg 42', 'Tomato', '42', 'KILOGRAM', 'tomato'],
    ['Tomato (kg) 42', 'Tomato', '42', 'KILOGRAM', 'tomato'],
    ['Tomato per kg 42', 'Tomato', '42', 'KILOGRAM', 'tomato'],
    ['Paneer 320.50', 'Paneer', '320.50', null, 'paneer'],
    ['TOMATO: Rs. 42.5 PER KGS', 'TOMATO', '42.5', 'KILOGRAM', 'tomato'],
    ['red-onion INR 32/kg', 'red-onion', '32', 'KILOGRAM', 'onion'],
    ['tOmAtO. ₹0.00/KILOGRAM', 'tOmAtO.', '0.00', 'KILOGRAM', 'tomato'],
    ['Tomato 0', 'Tomato', '0', null, 'tomato'],
    ['Tomato 1,234.50/kg', 'Tomato', '1234.50', 'KILOGRAM', 'tomato'],
    ['Tomato ₹12,34,567.89', 'Tomato', '1234567.89', null, 'tomato'],
    ['Tomato ₹92,23,37,20,36,85,47,758.07/kg', 'Tomato', '92233720368547758.07', 'KILOGRAM', 'tomato'],
    ['Tomato ₹92233720368547758.07', 'Tomato', '92233720368547758.07', null, 'tomato'],
    ['Cherry Tomato 42/kg', 'Cherry Tomato', '42', 'KILOGRAM', null],
    ['Tomatoes 42/kg', 'Tomatoes', '42', 'KILOGRAM', null],
  ])('reads one exact rate from %s', (sourceText, name, rateInr, unit, requestItemId) => {
    const result = parsePriceList(sourceText, items);
    expect(result.unresolved).toEqual([]);
    expect(result.suggestions).toEqual([{ id: expect.any(String), sourceText, name, rateInr, unit, requestItemId }]);
  });

  test.each(['g', 'litres', 'ML', 'PCS', 'packs', 'case', 'crates'])('preserves explicit %s without conversion', (unit) => {
    const result = parsePriceList(`Other 4.20/${unit}`, items);
    expect(result.suggestions[0]).toMatchObject({ rateInr: '4.20', requestItemId: null });
    expect(result.suggestions[0]?.unit).not.toBeNull();
  });

  test.each([
    'Tomato 40-45/kg', 'Tomato 40–45/kg', 'Tomato 40 to 45/kg',
    'Tomato | kg | 10 | 42', 'Tomato 42/kg GST 5%', 'Tomato 42 + tax',
    'Tomato 2 kg 42', 'Tomato 42/kg 84', 'Tomato 42 per 100 g',
    'Tomato 42/box', 'Tomato 42 per dozen', 'Tomato | bag | 42',
    'Tomato (box) 42', 'Tomato per box 42', 'Tomato box 42',
    'Tomato kg 42/g', 'Tomato | kg | 42/kg',
    'Tomato 42/kg net', 'Tomato 42/kg inclusive', 'Tomato | kg | 42 | GST',
    'Tomato -42/kg', 'Tomato - 42/kg', 'Tomato +42/kg', 'Tomato −42/kg',
    'Tomato .50/kg', 'Tomato 1./kg', 'Tomato 1.234/kg', 'Tomato 1.2.3/kg',
    'Tomato 01.50/kg', 'Tomato 1e2/kg', 'Tomato 1,23/kg', 'Tomato 1234,567/kg',
    'Tomato 1,234,567/kg', 'Tomato 1,,000/kg', 'Tomato 1.000,00/kg',
    'Tomato ₹92233720368547758.08/kg', 'Tomato ₹99,99,99,99,99,99,99,999/kg',
    'Phone 9876543210', 'WhatsApp +91 9876543210', 'Contact 022-12345678',
    'Supplier 9876543210', 'Supplier 919876543210', '9876543210',
    'Date 2026-09-10', 'Tomato 10/09/2026', 'Updated 20260910',
    'PRICE LIST 2026', 'PRICE/KG 42', 'RATE 42', 'Item | Unit | Price',
    'TOTAL ₹42', 'Quantity 42', 'GST 5', 'Tomato qty 42',
    '₹42', 'Tomato', 'Tomato42', 'Tomato $42/kg', 'Tomato €42/kg',
  ])('leaves unsafe or ambiguous text unresolved: %s', (row) => {
    expect(parsePriceList(row, items)).toEqual({ suggestions: [], unresolved: [row] });
  });

  test('unit mismatches remain unresolved even though the name matches', () => {
    expect(parsePriceList('Tomato 42/g', items)).toEqual({ suggestions: [], unresolved: ['Tomato 42/g'] });
  });

  test('duplicate normalized request names are ambiguous even with different units', () => {
    const duplicates: PriceListItem[] = [...items, { id: 'other-tomato', name: 'TOMATO.', unit: 'GRAM' }];
    expect(parsePriceList('Tomato 42/kg', duplicates)).toEqual({ suggestions: [], unresolved: ['Tomato 42/kg'] });
  });

  test.each(['TOMATO. 43/kg', 'Tomato 42/kg', 'Tomato 42/g', 'Tomato 40-50/kg', 'Tomato (box) 42', 'Tomato kg 40-50', 'Tomato | kg | 2 | 42'])('never selects a winner across repeated item rows (%s)', (second) => {
    const text = `Tomato 42/kg\n${second}\nPaneer 320.50`;
    const result = parsePriceList(text, items);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.requestItemId).toBe('paneer');
    expect(result.unresolved).toEqual(['Tomato 42/kg', second]);
  });

  test('repeated unmatched names remain unresolved too', () => {
    expect(parsePriceList('Other 3/kg\nOTHER 4/kg', items).suggestions).toEqual([]);
  });

  test('normalization preserves word boundaries and does not fuzzy match', () => {
    expect(parsePriceList('RedOnion 42/kg', items).suggestions[0]?.requestItemId).toBeNull();
    expect(parsePriceList('RED   ONION 42/kg', items).suggestions[0]?.requestItemId).toBe('onion');
  });

  test.each(['Item | Unit | Quantity', 'Item | Tax | Unit', 'Item | Unit | Total', 'Item Qty', 'Item | Price | Quantity'])('does not read amounts under ambiguous table columns: %s', (header) => {
    const result = parsePriceList(`${header}\nTomato | kg | 42\nPaneer 320.50`, items);
    expect(result).toEqual({ suggestions: [], unresolved: [header, 'Tomato | kg | 42', 'Paneer 320.50'] });
  });

  test('an explicit price header starts a new unambiguous table after a quantity table', () => {
    const result = parsePriceList('Item | Unit | Quantity\nTomato | kg | 42\nItem | Unit | Rate (INR)\nPaneer | kg | 320.50', items);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ name: 'Paneer', rateInr: '320.50' });
  });

  test('ignores blank lines, handles CRLF, and returns stable unique review IDs', () => {
    const text = '\r\n  Tomato 42/kg  \r\n\r\nPaneer 320.50\r\n';
    const result = parsePriceList(text, items);
    expect(result.unresolved).toEqual([]);
    expect(result.suggestions.map((row) => row.sourceText)).toEqual(['Tomato 42/kg', 'Paneer 320.50']);
    expect(new Set(result.suggestions.map((row) => row.id)).size).toBe(2);
    expect(parsePriceList(text, items)).toEqual(result);
    expect(parsePriceList(' \r\n\t', items)).toEqual({ suggestions: [], unresolved: [] });
  });

  test('rejects overlong input entirely instead of parsing a truncated price or hiding duplicates', () => {
    expect(MAX_PRICE_LIST_TEXT_LENGTH).toBe(12_000);
    const result = parsePriceList('Tomato 42/kg\n' + 'x'.repeat(MAX_PRICE_LIST_TEXT_LENGTH), items);
    expect(result.suggestions).toEqual([]);
    expect(result.unresolved.join(' ')).toMatch(/12,?000/);
    expect(result.unresolved.join(' ').length).toBeLessThan(300);
  });

  test('accepts the character boundary and rejects more than 100 nonempty lines without truncation', () => {
    expect(parsePriceList('Tomato 42/kg'.padEnd(MAX_PRICE_LIST_TEXT_LENGTH), items).suggestions).toHaveLength(1);
    expect(parsePriceList(Array(100).fill('unreadable').join('\n'), items).unresolved).toHaveLength(100);
    const result = parsePriceList(Array(101).fill('Tomato 42/kg').join('\n'), items);
    expect(result.suggestions).toEqual([]);
    expect(result.unresolved.join(' ')).toMatch(/100/);
  });
});
