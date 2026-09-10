import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { TradingProfileReadView, TradingProfileEditor } from '@/components/supplier-portal/TradingProfile';
import type { SupplierBusinessDetails, TradingProfile } from '@/lib/trading-profile/types';
test('missing profile does not infer eligibility or coverage', () => {
 const html = renderToStaticMarkup(<TradingProfileReadView profile={null} />);
 expect(html).toContain('unknown');
 expect(html).toContain('Supplier-declared');
 expect(html).toContain('not verified');
});
test('stale declarations show unknown terms and escaped supplier notes', () => {
 const profile: TradingProfile = { wholesale: 'unknown', servedPins: [], minimumOrderInr: null, orderCutoffIst: null, leadTimeDays: null, note: '<script>alert(1)</script>', updatedAt: '2000-01-01T00:00:00.000Z', revision: 1 };
 const html = renderToStaticMarkup(<TradingProfileReadView profile={profile} />);
 expect(html).toContain('Stale');
 expect(html).toContain('Unknown');
 expect(html).not.toContain('<script>');
 expect(html).toContain('&lt;script&gt;');
});
test('editor offers explicit unknown wholesale and optional terms, disabled while busy', () => {
 const html = renderToStaticMarkup(<TradingProfileEditor portalId="private-id" disabled />);
 expect(html).toContain('Edit trading profile');
 expect(html).toContain('fieldset disabled');
 expect(html).toContain('value="unknown" selected');
 expect(html).toContain('HH:mm IST');
});

const defaults: SupplierBusinessDetails = { contactName: 'Address book contact', phone: '+919876543210', whatsappNumber: '+919876543210', email: 'addressbook@example.com', categories: ['DAIRY'] };
const oldProfile: TradingProfile = { wholesale: 'yes', servedPins: ['411001'], minimumOrderInr: '2500.00', orderCutoffIst: '16:30', leadTimeDays: 1, note: 'Saved delivery note', revision: 1, updatedAt: '2026-09-10T08:00:00.000Z' };

test('initial confirmation prefills address-book contacts and categories without requiring an account', () => {
 const html = renderToStaticMarkup(<TradingProfileEditor portalId="private-id" disabled={false} initialBusinessDetails={defaults} />);
 const document = parse(html);
 expect(document.querySelector('[name="contactName"]')?.getAttribute('value')).toBe(defaults.contactName);
 expect(document.querySelector('[name="phone"]')?.getAttribute('value')).toBe(defaults.phone);
 expect(document.querySelector('[name="email"]')?.getAttribute('value')).toBe(defaults.email);
 expect(document.querySelector('[name="categories"][value="DAIRY"]')?.hasAttribute('checked')).toBe(true);
 expect(document.querySelector('form')?.hasAttribute('hidden')).toBe(true);
 expect(html).toContain('Confirm business details');
 expect(html).not.toContain('Sign in');
});

test('saved contacts, deliberately empty values and categories win over restaurant defaults', () => {
 const profile: TradingProfile = { ...oldProfile, businessDetails: { contactName: 'Supplier contact', phone: '+919111122222', whatsappNumber: null, email: null, categories: ['VEGETABLES', 'FRUITS'] } };
 const document = parse(renderToStaticMarkup(<TradingProfileEditor portalId="private-id" disabled={false} initialProfile={profile} initialBusinessDetails={defaults} />));
 expect(document.querySelector('[name="contactName"]')?.getAttribute('value')).toBe('Supplier contact');
 expect(document.querySelector('[name="phone"]')?.getAttribute('value')).toBe('+919111122222');
 expect(document.querySelector('[name="whatsappNumber"]')?.getAttribute('value')).toBe('');
 expect(document.querySelector('[name="email"]')?.getAttribute('value')).toBe('');
 expect(document.querySelectorAll('[name="categories"][checked]').map(input => input.getAttribute('value'))).toEqual(['VEGETABLES', 'FRUITS']);
 expect(document.querySelector('[name="minimumOrderInr"]')?.getAttribute('value')).toBe('2500.00');
});

test('old delivery-only profiles remain readable and gain contact defaults when edited', () => {
 const html = renderToStaticMarkup(<TradingProfileEditor portalId="private-id" disabled={false} initialProfile={oldProfile} initialBusinessDetails={defaults} />);
 expect(html).toContain('Contact details and product categories have not been confirmed yet');
 expect(html).toContain('₹2500.00');
 expect(html).toContain('16:30');
 expect(html).toContain('Saved delivery note');
 expect(html).toContain('Confirmation needed');
 const document = parse(html);
 expect(document.querySelector('[name="phone"]')?.getAttribute('value')).toBe(defaults.phone);
 expect(document.querySelector('[name="servedPins"]')?.text).toBe('411001');
});

test('saved summary dates supplier declarations and escapes contact text', () => {
 const profile: TradingProfile = { ...oldProfile, businessDetails: { ...defaults, contactName: '<script>contact</script>', categories: ['VEGETABLES', 'FRUITS'] } };
 const html = renderToStaticMarkup(<TradingProfileReadView profile={profile} />);
 const document = parse(html);
 expect(document.querySelector('time')?.getAttribute('dateTime')).toBe(profile.updatedAt);
 expect(html).toContain('Supplier-declared on');
 expect(html).toContain('not verified');
 expect(html).toContain('Vegetables, Fruits');
 expect(html).toContain('&lt;script&gt;contact&lt;/script&gt;');
 expect(document.querySelector('script')).toBeNull();
});

test('new delivery terms do not refresh an older business confirmation', () => {
 jest.useFakeTimers().setSystemTime(new Date('2026-09-10T08:00:00.000Z'));
 try {
  const profile = { ...oldProfile, businessDetails: defaults, businessDetailsConfirmedAt: '2026-07-01T08:00:00.000Z' };
  const html = renderToStaticMarkup(<TradingProfileEditor portalId="private-id" disabled={false} initialProfile={profile} />);
  const document = parse(html);
  expect(html).toContain('Please reconfirm');
  expect(document.querySelector('button')?.text).toBe('Confirm business details');
  expect(document.querySelector('time')?.getAttribute('dateTime')).toBe(profile.businessDetailsConfirmedAt);
  const summary = parse(renderToStaticMarkup(<TradingProfileReadView profile={profile} />));
  expect(summary.querySelector('time[aria-label="Business details confirmed"]')?.getAttribute('dateTime')).toBe(profile.businessDetailsConfirmedAt);
  expect(summary.querySelector('time[aria-label="Delivery terms confirmed"]')?.getAttribute('dateTime')).toBe(profile.updatedAt);
  expect(summary.text).toContain('Stale — business details');
  expect(summary.text).toContain('Delivery terms confirmed within 30 days.');
 } finally { jest.useRealTimers(); }
});

test.each([
 ['2026-08-11T08:00:00.001Z', false],
 ['2026-08-11T08:00:00.000Z', true],
] as const)('delivery terms at %s use updatedAt for their own 30-day boundary', (updatedAt, stale) => {
 jest.useFakeTimers().setSystemTime(new Date('2026-09-10T08:00:00.000Z'));
 try {
  const profile = { ...oldProfile, updatedAt, businessDetails: defaults, businessDetailsConfirmedAt: '2026-07-01T08:00:00.000Z' };
  const summary = parse(renderToStaticMarkup(<TradingProfileReadView profile={profile} />));
  expect(summary.querySelector('time[aria-label="Delivery terms confirmed"]')?.getAttribute('dateTime')).toBe(updatedAt);
  expect(summary.text).toContain(stale ? 'Stale — delivery terms' : 'Delivery terms confirmed within 30 days.');
  expect(summary.text).toContain('Stale — business details');
 } finally { jest.useRealTimers(); }
});

test.each([
 ['2026-08-11T08:00:00.001Z', false],
 ['2026-08-11T08:00:00.000Z', true],
] as const)('business confirmation at %s uses its own 30-day boundary', (businessDetailsConfirmedAt, stale) => {
 jest.useFakeTimers().setSystemTime(new Date('2026-09-10T08:00:00.000Z'));
 try {
  const profile = { ...oldProfile, businessDetails: defaults, businessDetailsConfirmedAt };
  const document = parse(renderToStaticMarkup(<TradingProfileEditor portalId="private-id" disabled={false} initialProfile={profile} />));
  expect(document.querySelector('button')?.text).toBe(stale ? 'Confirm business details' : 'Edit business details');
 } finally { jest.useRealTimers(); }
});

test.each([
 ['2026-09-10T08:00:00.000Z', false],
 ['2026-07-01T08:00:00.000Z', true],
] as const)('older profiles without a business timestamp fall back to updatedAt %s', (updatedAt, stale) => {
 jest.useFakeTimers().setSystemTime(new Date('2026-09-10T08:00:00.000Z'));
 try {
  const profile = { ...oldProfile, updatedAt, businessDetails: defaults };
  const document = parse(renderToStaticMarkup(<TradingProfileEditor portalId="private-id" disabled={false} initialProfile={profile} />));
  expect(document.querySelector('button')?.text).toBe(stale ? 'Confirm business details' : 'Edit business details');
  expect(document.querySelector('time')?.getAttribute('dateTime')).toBe(updatedAt);
  const summary = parse(renderToStaticMarkup(<TradingProfileReadView profile={profile} />));
  expect(summary.querySelector('time[aria-label="Business details confirmed"]')?.getAttribute('dateTime')).toBe(updatedAt);
 } finally { jest.useRealTimers(); }
});
