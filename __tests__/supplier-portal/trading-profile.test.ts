import { parseTradingProfile, parseTradingProfileSubmission, readTradingProfile, tradingProfileIsStale } from '@/lib/trading-profile/domain';
import { PROCUREMENT_CATEGORIES } from '@/lib/domain/procurement-categories';
import { businessDetailsConfirmationDate } from '@/lib/trading-profile/types';
const profile = { wholesale: 'unknown' as const, servedPins: [], minimumOrderInr: null, orderCutoffIst: null, leadTimeDays: null, note: null };
test('unknown terms remain unknown and zero minimum is explicit', () => {
 expect(parseTradingProfile(profile)).toEqual(profile);
 expect(parseTradingProfile({ ...profile, minimumOrderInr: '0.00' }).minimumOrderInr).toBe('0.00');
 expect(readTradingProfile(null)).toBeNull();
});
test.each([
 { wholesale: true }, { servedPins: ['000000'] }, { servedPins: ['400001', '400001'] },
 { servedPins: Array(101).fill('400001') }, { minimumOrderInr: '-1' }, { minimumOrderInr: '1e3' },
 { minimumOrderInr: '1.001' }, { orderCutoffIst: '24:00' }, { orderCutoffIst: '9:00' },
 { leadTimeDays: -1 }, { leadTimeDays: 366 }, { note: 'x'.repeat(501) }, { note: '\u0000' }, { updatedAt: 'forged' },
])('rejects invalid or unbounded declarations %j', patch => expect(() => parseTradingProfile({ ...profile, ...patch })).toThrow());
test('stored profile validates revisions, timestamp and exact 30-day freshness boundary', () => {
 const saved = { ...profile, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' };
 expect(readTradingProfile(saved)).toEqual(saved);
 expect(tradingProfileIsStale(saved, new Date('2026-08-30T23:59:59Z'))).toBe(false);
 expect(tradingProfileIsStale(saved, new Date('2026-08-31T00:00:00Z'))).toBe(true);
 expect(() => readTradingProfile({ ...saved, revision: 0 })).toThrow();
 expect(() => readTradingProfile({ ...saved, updatedAt: 'yesterday' })).toThrow();
});

const businessDetails = {
 contactName: 'Anaya Shah', phone: '+919876543210', whatsappNumber: null, email: null,
 categories: ['VEGETABLES', 'FRUITS'],
};
test('business confirmation normalizes supplier contacts without changing delivery terms', () => {
 const input = { ...profile, wholesale: 'yes', servedPins: ['400001'], minimumOrderInr: '2500.00', orderCutoffIst: '18:30', leadTimeDays: 1, note: 'Call first', businessDetails: {
  ...businessDetails, contactName: '  Anaya Shah  ', phone: '98765 43210', whatsappNumber: '0091 (98765) 43211', email: ' SALES@EXAMPLE.TEST ',
 } };
 expect(parseTradingProfile(input)).toEqual({ ...input, businessDetails: {
  ...businessDetails, whatsappNumber: '+919876543211', email: 'sales@example.test',
 } });
});
test.each([
 { phone: '9876543210', whatsappNumber: null, email: null },
 { phone: null, whatsappNumber: '+44 20 7946 0958', email: null },
 { phone: null, whatsappNumber: null, email: 'ORDERS@EXAMPLE.TEST' },
])('a declaration can use any one valid contact channel %j', contact => {
 expect(parseTradingProfile({ ...profile, businessDetails: { ...businessDetails, contactName: ' ', ...contact } })).toMatchObject({ businessDetails: { contactName: null, categories: businessDetails.categories } });
});
test('all known procurement categories fit in a business declaration', () => {
 const categories = Object.keys(PROCUREMENT_CATEGORIES);
 expect(parseTradingProfile({ ...profile, businessDetails: { ...businessDetails, categories } })).toMatchObject({ businessDetails: { categories } });
});
test.each([
 { contactName: 123 }, { contactName: 'अ'.repeat(41) }, { contactName: 'Anaya\nShah' },
 { phone: 'not-a-phone' }, { phone: 9876543210 }, { whatsappNumber: '123' },
 { email: 'not-an-email' }, { email: 'a@b..test' }, { email: 'a'.repeat(310) + '@example.test' },
 { phone: null, whatsappNumber: null, email: null },
 { phone: ' ', whatsappNumber: '', email: '  ' },
 { categories: [] }, { categories: null }, { categories: 'VEGETABLES' },
 { categories: ['VEGETABLES', 'VEGETABLES'] }, { categories: Array(23).fill('FRUITS') },
 { categories: ['vegetables'] }, { categories: ['UNKNOWN'] },
 { categories: ['toString'] }, { categories: ['__proto__'] }, { categories: [1] },
 { verificationStatus: 'VERIFIED' }, { supplierId: 'someone-else' }, { notes: 'private notes' },
])('rejects malformed or unbounded business confirmations %j', patch => {
 expect(() => parseTradingProfile({ ...profile, businessDetails: { ...businessDetails, ...patch } })).toThrow(expect.objectContaining({ status: 422 }));
});
test.each([null, [], {}, undefined, { ...businessDetails, email: undefined }])('provided businessDetails must contain exactly the declared fields: %j', value => {
 expect(() => parseTradingProfile({ ...profile, businessDetails: value })).toThrow(expect.objectContaining({ status: 422 }));
});
test('business confirmation retains the existing bounded JSON envelope', () => {
 expect(() => parseTradingProfile({ ...profile, businessDetails: { ...businessDetails, phone: ' '.repeat(8192) + '9876543210' } })).toThrow(expect.objectContaining({ status: 422 }));
});
test('old profiles and old submissions stay unchanged while new saved declarations round trip', () => {
 const legacy = { ...profile, revision: 4, updatedAt: '2026-09-01T00:00:00.000Z' };
 const submission = { action: 'trading-profile', portalId: 'portal-own', expectedRevision: 4, profile };
 expect(readTradingProfile(legacy)).toEqual(legacy);
 expect(readTradingProfile(legacy)).not.toHaveProperty('businessDetails');
 expect(parseTradingProfileSubmission(submission)).toEqual(submission);
 const confirmed = { ...legacy, businessDetails };
 expect(readTradingProfile(confirmed)).toEqual(confirmed);
 expect(parseTradingProfileSubmission({ ...submission, profile: { ...profile, businessDetails } })).toMatchObject({ profile: { businessDetails } });
 expect(() => readTradingProfile({ ...confirmed, businessDetails: { ...businessDetails, categories: [] } })).toThrow(expect.objectContaining({ status: 503 }));
});

test('contact freshness uses its own confirmation date after newer terms edits', () => {
 const saved = { ...profile, businessDetails: { ...businessDetails, categories: ['VEGETABLES' as const] }, revision: 2,
  businessDetailsConfirmedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
 expect(tradingProfileIsStale(saved, new Date('2026-08-30T23:59:59.999Z'))).toBe(false);
 expect(tradingProfileIsStale(saved, new Date('2026-08-31T00:00:00.000Z'))).toBe(true);
 expect(readTradingProfile(saved)).toEqual(saved);
 expect(businessDetailsConfirmationDate(saved)).toBe(saved.businessDetailsConfirmedAt);
});
test('legacy business confirmation without its own timestamp remains readable and uses updatedAt', () => {
 const saved = { ...profile, businessDetails, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' };
 const read = readTradingProfile(saved)!;
 expect(read).toEqual(saved);
 expect(businessDetailsConfirmationDate(read)).toBe(saved.updatedAt);
 expect(businessDetailsConfirmationDate({ ...profile, revision: 1, updatedAt: saved.updatedAt })).toBeNull();
 expect(tradingProfileIsStale(read, new Date('2026-08-31T00:00:00.000Z'))).toBe(true);
});
test.each([null, '', '2026-08-01', '2026-08-01T00:00:00Z', '2026-08-01T05:30:00.000+05:30', 'yesterday', '2026-10-01T00:00:00.000Z'])('rejects invalid stored confirmation dates %j', businessDetailsConfirmedAt => {
 expect(() => readTradingProfile({ ...profile, businessDetails, businessDetailsConfirmedAt, revision: 2, updatedAt: '2026-09-01T00:00:00.000Z' })).toThrow(expect.objectContaining({ status: 503 }));
});
test('a confirmation date belongs only to stored business details and cannot be supplied by a client', () => {
 const businessDetailsConfirmedAt = '2026-08-01T00:00:00.000Z';
 expect(() => readTradingProfile({ ...profile, businessDetailsConfirmedAt, revision: 1, updatedAt: businessDetailsConfirmedAt })).toThrow(expect.objectContaining({ status: 503 }));
 expect(() => parseTradingProfile({ ...profile, businessDetails, businessDetailsConfirmedAt })).toThrow(expect.objectContaining({ status: 422 }));
});
test.each([
 'mailto:supplier@example.com', 'first,last@example.com', 'first@example.com,second@example.com',
 'Supplier<supplier@example.com>', 'first:second@example.com', 'first;second@example.com',
 '.supplier@example.com', 'supplier.@example.com', 'first..last@example.com',
 'supplier@-example.com', 'supplier@example-.com', 'supplier@bad_domain.com',
 'supplier@example.c', 'supplier@example.123', 'supplier@' + 'a'.repeat(64) + '.com',
 'a'.repeat(65) + '@example.com', 'संपर्क@example.com', 'supplier@éxample.com',
])('rejects invalid sole email contact %s', email => {
 expect(() => parseTradingProfile({ ...profile, businessDetails: { ...businessDetails, phone: null, whatsappNumber: null, email } })).toThrow(expect.objectContaining({ status: 422 }));
});
test('valid single mailboxes preserve plus addressing and normalize case', () => {
 expect(parseTradingProfile({ ...profile, businessDetails: { ...businessDetails, phone: null, email: '  Orders.Team+Kitchen@Sub.Example.COM  ' } })).toMatchObject({ businessDetails: { email: 'orders.team+kitchen@sub.example.com' } });
});
