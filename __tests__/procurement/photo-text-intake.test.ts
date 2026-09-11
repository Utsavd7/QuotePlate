import { parseShoppingList, parseInvoice, invoiceMatch, shoppingRowErrors, invoiceRowErrors } from '@/lib/procurement/photo-text-intake';

const awarded = [{ requestItemId: 'tomato', itemName: 'Tomatoes', unit: 'KILOGRAM' }];

describe('reviewed local shopping lists', () => {
  it('reads one item per line with quantity before or after the name', () => {
    expect(parseShoppingList('tomatoes 10 kg\n5 kg onions')).toMatchObject([
      { name: 'tomatoes', quantity: '10', unit: 'KILOGRAM', source: 'tomatoes 10 kg', issues: [] },
      { name: 'onions', quantity: '5', unit: 'KILOGRAM', source: '5 kg onions', issues: [] },
    ]);
  });
  it.each(['tomatoes', 'tomatoes 10', 'tomatoes kg', 'tomatoes 2 bags', 'tomatoes 1/2 kg', 'tomatoes -2 kg', 'tomatoes 10 kg onions 5 kg', 'tomatoes 1,000 kg'])('keeps ambiguous source editable without fabricating values: %s', text => {
    const row = parseShoppingList(text)[0];
    expect(row.source).toBe(text);
    expect(row.issues.length).toBeGreaterThan(0);
    expect(row.quantity).toBe('');
    expect(shoppingRowErrors(row).length).toBeGreaterThan(0);
  });
  it('validates exact positive quantities and supported units', () => {
    for (const quantity of ['0', '1.2345', '99999999999999999999', '-1']) {
      expect(shoppingRowErrors({ name: 'Rice', quantity, unit: 'KILOGRAM' }).length).toBeGreaterThan(0);
    }
    expect(shoppingRowErrors({ name: 'Rice', quantity: '1.125', unit: 'KILOGRAM' })).toEqual([]);
  });
  it('bounds text without silently truncating rows', () => {
    expect(() => parseShoppingList('x'.repeat(12001))).toThrow();
    expect(() => parseShoppingList(Array(101).fill('Rice 1 kg').join('\n'))).toThrow();
    expect(parseShoppingList(' \n ')).toEqual([]);
  });
});

describe('invoice billed suggestions', () => {
  it('only parses an explicit unit rate and preserves exact decimals', () => {
    const row = parseInvoice('Tomatoes 10 kg @ ₹40.25')[0];
    expect(row).toMatchObject({ name: 'Tomatoes', quantity: '10', unit: 'KILOGRAM', rate: '40.25', issues: [] });
    expect(invoiceMatch(row, awarded)).toMatchObject({ item: awarded[0], issues: [] });
    expect(invoiceRowErrors(row)).toEqual([]);
  });
  it('does not infer a rate from totals, tax or unlabelled columns', () => {
    for (const text of ['Tomatoes 10 kg 40 400', 'Tomatoes 10 kg total 400', 'Tomatoes 10 kg', 'Tomatoes 10 kg @ 40 + GST 5%', 'Tomatoes 10 kg @ 40/l']) {
      expect(parseInvoice(text)[0].rate).toBe('');
      expect(parseInvoice(text)[0].issues.length).toBeGreaterThan(0);
    }
  });
  it('refuses fuzzy names, conversions, duplicate award matches and absent units', () => {
    const row = parseInvoice('Tomatoes 10 kg rate 40')[0];
    expect(invoiceMatch({ ...row, name: 'Tomato' }, awarded).item).toBeNull();
    expect(invoiceMatch({ ...row, unit: 'GRAM' }, awarded).item).toBeNull();
    expect(invoiceMatch({ ...row, unit: '' }, awarded).item).toBeNull();
    expect(invoiceMatch(row, [...awarded, { ...awarded[0], requestItemId: 'other' }]).item).toBeNull();
  });
  it('accepts explicit zero billing without using ordered counts or awarded rates', () => {
    const row = parseInvoice('Tomatoes 0 kg @ 0')[0];
    expect(invoiceRowErrors(row)).toEqual([]);
    expect(row).toMatchObject({ quantity: '0', rate: '0' });
  });
});
