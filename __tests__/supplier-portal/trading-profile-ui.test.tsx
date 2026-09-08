import { renderToStaticMarkup } from 'react-dom/server';
import { TradingProfileReadView, TradingProfileEditor } from '@/components/supplier-portal/TradingProfile';
import type { TradingProfile } from '@/lib/trading-profile/types';
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
