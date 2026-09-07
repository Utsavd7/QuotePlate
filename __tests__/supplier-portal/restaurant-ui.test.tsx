import { renderToStaticMarkup } from 'react-dom/server';
import { DemandReview, PortalControls, SupplierOrders, demandBlockReason, demandPayload, type SavedDemandPlan } from '@/components/supplier-portal/RestaurantSupplierPortal';
const plan: SavedDemandPlan = {
  id: 'p1', version: 7, name: 'Private menu', requestId: null,
  document: { serviceAt: '2099-09-08T12:00:00Z' },
  readiness: { warnings: [], ingredients: [
    { itemKey: 'rice', name: 'Rice', deficit: '1.251', usableDeficit: '1', unit: 'KILOGRAM', blocked: false, specification: { v: 1, category: 'OTHER', description: 'Long grain' } },
    { itemKey: 'salt', name: 'Salt', deficit: '0', usableDeficit: '0', unit: 'KILOGRAM', blocked: false, specification: { v: 1, category: 'OTHER' } },
  ] },
};
it('requires explicit purchase shortage selections and shares only keys and saved version', () => {
  expect(demandPayload(plan, [])).toBeNull();
  expect(demandPayload(plan, ['salt', 'unknown'])).toBeNull();
  expect(demandPayload(plan, ['rice'])).toEqual({ planId: 'p1', expectedPlanVersion: 7, itemKeys: ['rice'] });
  const html = renderToStaticMarkup(<DemandReview plan={plan} selectedItemKeys={[]} disabled={false} onSelect={() => {}} />);
  expect(html).toContain('1.251');
  expect(html).toContain('Long grain');
  expect(html).not.toContain('Salt');
  expect(html).not.toContain('checked=""');
});
it('blocks unsaved, past, converted and any blocked plan, even when selected row is valid', () => {
  expect(demandBlockReason(null)).toBeTruthy();
  expect(demandBlockReason(plan)).toBe('');
  for (const p of [ { ...plan, requestId: 'request' }, { ...plan, document: { serviceAt: '2000-01-01T00:00:00Z' } }, { ...plan, readiness: { ...plan.readiness, ingredients: [...plan.readiness.ingredients, { ...plan.readiness.ingredients[0], itemKey: 'blocked', blocked: true }] } } ]) {
    expect(demandBlockReason(p)).toBeTruthy();
    expect(demandPayload(p, ['rice'])).toBeNull();
  }
});
it('does not render management controls or a fresh secret for members', () => {
  const html = renderToStaticMarkup(<PortalControls canManage={false} access={null} freshLink={{ url: 'https://secret', expiresAt: '2099-01-01' }} busy={false} onCreate={() => {}} onRevoke={() => {}} onCopy={() => {}} onDismiss={() => {}} />);
  expect(html).toContain('Only an owner');
  expect(html).not.toContain('<button');
  expect(html).not.toContain('https://secret');
});
it('shows outdated disputes with original supplier evidence and a correction link', () => {
  const html = renderToStaticMarkup(<SupplierOrders orders={[{ requestId: 'r1', title: 'Morning delivery', deliveryDate: '2099-01-01', status: 'selected', version: 1, items: [], acknowledgement: { status: 'needs_change', note: 'Later arrival', at: '2099-01-01' }, delivery: null, response: { decision: 'dispute', note: 'Two crates returned', evidenceReference: 'DN-42', at: '2099-01-01', fingerprint: 'old' }, responseIsCurrent: false }]} />);
  expect(html).toContain('Latest 30 requests');
  expect(html).toContain('Outdated response');
  expect(html).toContain('DN-42');
  expect(html).toContain('Later arrival');
  expect(html).toContain('/procurement/r1');
});
