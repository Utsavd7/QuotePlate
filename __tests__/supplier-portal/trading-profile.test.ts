import { parseTradingProfile, readTradingProfile, tradingProfileIsStale } from '@/lib/trading-profile/domain';
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
