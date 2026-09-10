import { serializeCsv } from '@/lib/exports/csv';
import { SupplierValidationError, validateSupplierCreateInput } from './supplier-schema';
import { normalizeSupplierContactEmail } from './contact-email';

export type ContactRow = { businessName: string; phone: string; email: string };
export const CONTACT_LIST_LIMIT = 50;

// Small, single-line CSV/TSV reader. Reject ambiguous input instead of losing columns.
function columns(line: string): string[] {
  const separator = line.includes('\t') ? '\t' : ',';
  const values: string[] = [];
  let value = '', quoted = false, closed = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === separator) {
      values.push(value.trim()); value = ''; closed = false;
    } else if (char === '"' && !value.trim() && !closed) {
      quoted = true; value = '';
    } else if (char === '"' || (closed && char.trim())) {
      throw new Error('Check quotation marks. Put each supplier on one line.');
    } else value += char;
  }
  if (quoted) throw new Error('Close quotation marks and put each supplier on one line.');
  values.push(value.trim());
  if (values.length > 3) throw new Error('Use only three columns: business name, phone, email.');
  return values;
}

export function parseContactList(input: string): ContactRow[] {
  if (new TextEncoder().encode(input).byteLength > 32_768) throw new Error('Paste a smaller list (up to 32 KB).');
  const lines = input.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length || lines.length > CONTACT_LIST_LIMIT) throw new Error('Paste between 1 and 50 suppliers.');
  return lines.map(line => {
    const [businessName = '', phone = '', email = ''] = columns(line);
    return { businessName, phone, email };
  });
}

export function reviewContactRows(rows: ContactRow[]) {
  const errors: { row: number; message: string }[] = [];
  const contacts: ContactRow[] = [];
  const phones = new Set<string>(), emails = new Set<string>();
  for (const [row, input] of rows.entries()) {
    try {
      const supplier = validateSupplierCreateInput(input);
      if (supplier.email && !normalizeSupplierContactEmail(supplier.email)) throw new Error('Enter one valid email address or leave it blank.');
      if (!supplier.phone && !supplier.email) throw new Error('Add a phone number or email address.');
      if ((supplier.phone && phones.has(supplier.phone)) || (supplier.email && emails.has(supplier.email))) {
        throw new Error('This phone or email is repeated. Keep one row for this supplier.');
      }
      if (supplier.phone) phones.add(supplier.phone);
      if (supplier.email) emails.add(supplier.email);
      contacts.push({ businessName: supplier.businessName, phone: supplier.phone ?? '', email: supplier.email ?? '' });
    } catch (error) {
      errors.push({ row, message: error instanceof SupplierValidationError
        ? Object.values(error.errors)[0]?.[0] ?? 'Check this supplier’s details.'
        : error instanceof Error ? error.message : 'Check this supplier’s details.' });
    }
  }
  return { contacts, errors };
}

export function contactRowsCsv(rows: ContactRow[]) {
  if (!rows.length || rows.length > CONTACT_LIST_LIMIT) throw new Error('Add between 1 and 50 suppliers.');
  const { contacts, errors } = reviewContactRows(rows);
  if (errors.length) throw new Error('Correct the marked contacts before adding suppliers.');
  return serializeCsv([
    ['business_name', 'phone', 'email', 'relationship_type'],
    ...contacts.map(row => [row.businessName, row.phone, row.email, 'CURRENT']),
  ]);
}
