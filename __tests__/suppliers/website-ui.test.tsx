import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { SupplierWebsiteContacts, WebsiteContactReview } from '@/components/suppliers/SupplierWebsiteContacts';
import { fillReviewedWebsiteContacts, type WebsiteContact } from '@/lib/suppliers/website-types';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const contact: WebsiteContact = { kind: 'email', value: 'orders@supplier.com', sourceUrl: 'https://supplier.com/contact', checkedAt: '2026-09-11T00:00:00.000Z' };
it('warns about saved contact matches without an extra review step or blocking distinct businesses', () => {
  const root = parse(renderToStaticMarkup(<WebsiteContactReview result={{ status: 'found', contacts: [contact], checkedAt: contact.checkedAt }}
    phone="" email="" existingContacts={[{ businessName: 'Saved supplier', email: 'ORDERS@supplier.com' }]} onReview={jest.fn()} />));
  expect(root.text).toContain('Saved supplier');
  expect(root.text).toContain('shared contact');
  expect(root.text).toContain('currently loaded');
  expect(root.querySelector('input[type="checkbox"]')).toBeNull();
  expect(root.querySelector('button')?.hasAttribute('disabled')).toBe(false);
  expect(root.querySelector('a')?.getAttribute('href')).toBe(contact.sourceUrl);
});
it('does not fetch or fill on render and makes checking an explicit non-submit action', () => {
  const fetcher = jest.spyOn(global, 'fetch'); const review = jest.fn();
  try {
    const root = parse(renderToStaticMarkup(<SupplierWebsiteContacts phone="" email="" disabled={false} onReview={review} />));
    expect(root.querySelector('button')?.getAttribute('type')).toBe('button');
    expect(root.text).toContain('Check website'); expect(root.text).toContain('No messages are sent');
    expect(fetcher).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled();
  } finally { fetcher.mockRestore(); }
});
it('presents provenance and review while disabling replacements of existing fields', () => {
  const root = parse(renderToStaticMarkup(<WebsiteContactReview result={{ status: 'found', contacts: [contact], checkedAt: contact.checkedAt }} phone="" email="saved@supplier.com" onReview={jest.fn()} />));
  expect(root.querySelector('a')?.getAttribute('href')).toBe(contact.sourceUrl);
  expect(root.querySelector('time')?.getAttribute('datetime')).toBe(contact.checkedAt);
  expect(root.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  expect(root.text).toContain('then save the supplier form');
});
it('fills reviewed blank fields without changing saved fields, notes, capabilities or WhatsApp', () => {
  const draft = { email: 'saved@supplier.com', phone: '', whatsappNumber: '+919111111111', notes: 'Keep notes', businessName: 'Saved supplier', capabilities: { keep: true } };
  const next = fillReviewedWebsiteContacts(draft, [contact, { ...contact, kind: 'phone', value: '+919876543210' }]);
  expect(next).toEqual({ ...draft, phone: '+919876543210' }); expect(draft.phone).toBe('');
  expect(fillReviewedWebsiteContacts(next, [{ ...contact, kind: 'phone', value: '+442071234567' }])).toEqual(next);
});
it.each(['unavailable', 'no-public-contacts'] as const)('renders clean %s without review/save actions', status => {
  const root = parse(renderToStaticMarkup(<WebsiteContactReview result={{ status, contacts: [], checkedAt: contact.checkedAt }} phone="" email="" onReview={jest.fn()} />));
  expect(root.querySelector('[role="status"]')).not.toBeNull(); expect(root.querySelector('button')).toBeNull();
});
it('integrates into existing supplier form through functional preservation, retaining manual sharing', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/components/suppliers/SupplierWorkspace.tsx'), 'utf8');
  expect(source).toContain('fillReviewedWebsiteContacts(current, [contact])');
  expect(source).toContain('onSubmit={saveSupplier}'); expect(source).toContain('onClick={shareApplicantLink}');
});
it('keeps published local phone formatting during review and fills only an empty field', () => {
  const local = { ...contact, kind: 'phone' as const, value: '98765 43210' };
  const root = parse(renderToStaticMarkup(<WebsiteContactReview result={{ status: 'found', contacts: [local], checkedAt: local.checkedAt }} phone="" email="saved@supplier.com" onReview={jest.fn()} />));
  expect(root.querySelectorAll('ul > li')).toHaveLength(1);
  expect(root.querySelector('li strong')?.text).toBe('Phone: 98765 43210');
  expect(root.querySelector('button')?.hasAttribute('disabled')).toBe(false);
  expect(fillReviewedWebsiteContacts({ phone: '', email: 'saved@supplier.com' }, [local]))
    .toEqual({ phone: '98765 43210', email: 'saved@supplier.com' });
});
