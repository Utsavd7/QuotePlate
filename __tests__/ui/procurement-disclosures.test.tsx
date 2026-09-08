import { parse } from 'node-html-parser';
import { renderToStaticMarkup } from 'react-dom/server';
import { DraftRequestEditor } from '@/components/procurement/DraftRequestEditor';

const request = {
  id: 'draft', title: 'Monday vegetables', status: 'DRAFT' as const, version: 1,
  deliveryDetails: { addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001', instructions: 'Use the kitchen entrance' },
  deliveryDate: '2026-09-10', quoteDeadline: '2026-09-09T10:00:00.000Z',
  commercialTerms: 'Payment in 15 days',
  items: { v: 1 as const, items: [{
    id: 'tomato', itemKey: 'tomato', name: 'Tomato', quantity: '12', unit: 'KILOGRAM' as const,
    specification: { v: 1 as const, category: 'VEGETABLES' as const }, sourcingOverride: null,
  }] },
  sourcing: { v: 1 as const, default: {
    v: 1 as const, modes: ['CURRENT' as const], currentSupplierIds: ['supplier'],
    selectedNewSupplierIds: [], acceptVerifiedApplications: false,
  } },
  supplierRequests: [{ supplierId: 'supplier', supplier: { id: 'supplier', businessName: 'Market Foods', isActive: true } }],
};

it('reveals saved delivery notes and terms when reopening a draft', () => {
  const document = parse(renderToStaticMarkup(<DraftRequestEditor request={request} onCancel={() => {}} onSaved={() => {}} />));
  const notes = document.querySelector('details');
  expect(notes?.hasAttribute('open')).toBe(true);
  expect(notes?.querySelectorAll('textarea').map(field => field.textContent)).toEqual(['Use the kitchen entrance', 'Payment in 15 days']);
  expect(notes?.querySelectorAll('input,select')).toHaveLength(0);
  expect(document.querySelector('input')?.getAttribute('value')).toBe('Monday vegetables');
  expect(document.querySelectorAll('input[type="checkbox"]').every(field => !field.closest('details'))).toBe(true);
});

it('collapses empty optional notes while leaving required fields and supplier choices available', () => {
  const document = parse(renderToStaticMarkup(<DraftRequestEditor request={{ ...request, commercialTerms: null, deliveryDetails: { ...request.deliveryDetails, instructions: '' } }} onCancel={() => {}} onSaved={() => {}} />));
  expect(document.querySelector('details')?.hasAttribute('open')).toBe(false);
  expect(document.querySelectorAll('input').every(field => !field.closest('details'))).toBe(true);
  expect(document.textContent).toContain('Specific item suppliers (optional)');
  expect(document.textContent).toContain('Choose differently');
});
