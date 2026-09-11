import { parseContactList, reviewContactRows, contactRowsCsv, findSupplierContactMatches, supplierContactKey } from '@/lib/suppliers/contact-list';
import { parseSupplierCsv } from '@/lib/suppliers/csv';

describe('reviewed existing supplier contacts', () => {
  it('matches exact normalized contacts and identifies all saved business matches', () => {
    const saved = [
      { businessName: 'One', phone: '+919876543210', email: 'one@example.com' },
      { businessName: 'Two', phone: '0091 98765 43210', email: 'two@example.com' },
    ];
    expect(findSupplierContactMatches({ phone: '98765 43210', email: ' TWO@example.com ' }, saved))
      .toEqual([{ supplier: saved[0], kinds: ['phone'] }, { supplier: saved[1], kinds: ['phone', 'email'] }]);
  });
  it('never matches blank, malformed or partial contacts, nor businesses just sharing a site/address', () => {
    const saved = [{ businessName: 'Same building', phone: '+919876543210', email: 'orders@example.com', website: 'https://example.com', address: 'Market' }];
    for (const contact of [{}, { phone: '43210' }, { phone: '9876543210;ext=2' }, { phone: '98765\n43210' }, { email: 'example.com' }, { email: 'mailto:orders@example.com' }, { email: 'other@example.com', phone: '+919988776655' }]) {
      expect(findSupplierContactMatches(contact, saved)).toEqual([]);
    }
    expect(supplierContactKey('phone', 'x'.repeat(81))).toBeNull();
    expect(supplierContactKey('email', 'orders+branch@example.com')).not.toBe(supplierContactKey('email', 'orders@example.com'));
  });
  it('reads pasted spreadsheet columns and simple comma-separated contacts', () => {
    expect(parseContactList('Fresh Foods\t98765 43210\tORDERS@fresh.example\nDairy House,9988776655')).toEqual([
      { businessName: 'Fresh Foods', phone: '98765 43210', email: 'ORDERS@fresh.example' },
      { businessName: 'Dairy House', phone: '9988776655', email: '' },
    ]);
  });
  it('preserves quoted names and empty contact columns', () => {
    expect(parseContactList('"Shah, Sons",,orders@example.com')).toEqual([
      { businessName: 'Shah, Sons', phone: '', email: 'orders@example.com' },
    ]);
  });
  it('refuses to silently drop columns, broken quoting or excess rows', () => {
    expect(() => parseContactList('Name,9876543210,a@example.com,unreviewed')).toThrow();
    expect(() => parseContactList('"Broken,9876543210')).toThrow();
    expect(() => parseContactList(Array.from({ length: 51 }, () => 'Name,9876543210').join('\n'))).toThrow(/50/);
  });
  it('keeps incomplete rows available to fix while requiring a name and contact', () => {
    const rows = parseContactList('Fresh Foods\n,9876543210\nDairy,wrong');
    const { errors } = reviewContactRows(rows);
    expect(errors.map(e => e.row)).toEqual([0, 1, 2]);
    expect(errors[0].message).toMatch(/phone|email/i);
  });
  it('detects duplicate contacts after normalization', () => {
    const { errors } = reviewContactRows(parseContactList('A,98765 43210\nB,+91 9876543210\nC,,ORDERS@example.com\nD,,orders@example.com'));
    expect(errors.map(e => e.row)).toEqual([1, 3]);
    expect(errors.every(e => /repeated/i.test(e.message))).toBe(true);
  });
  it('roundtrips reviewed contacts through the real import format without formula or field changes', () => {
    const rows = [{ businessName: '=Fresh, "Foods"', phone: '+919876543210', email: 'ORDERS@example.com' }];
    const imported = parseSupplierCsv(contactRowsCsv(rows));
    expect(imported[0].supplier).toMatchObject({ businessName: '=Fresh, "Foods"', phone: '+919876543210', email: 'orders@example.com', relationshipType: 'CURRENT' });
    expect(imported[0].supplier.whatsappNumber).toBeNull();
  });
  it('never serializes invalid or empty contacts', () => {
    expect(() => contactRowsCsv([{ businessName: 'A', phone: '', email: '' }])).toThrow();
    expect(() => contactRowsCsv([])).toThrow();
  });
  it('accepts phone-only contacts but rejects a URI instead of an email address', () => {
    expect(reviewContactRows(parseContactList('Fresh Foods,9876543210')).errors).toEqual([]);
    expect(reviewContactRows(parseContactList('Fresh Foods,,mailto:orders@example.com')).errors).toEqual([
      expect.objectContaining({ row: 0, message: expect.stringMatching(/valid email/) }),
    ]);
  });
});
