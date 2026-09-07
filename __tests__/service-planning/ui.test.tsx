import { renderToStaticMarkup } from 'react-dom/server';
import { PlanningSummary } from '@/components/service-planning/PlanningSummary';
it('shows blockers and evidence instead of declaring a deficient service ready', () => {
  const html = renderToStaticMarkup(<PlanningSummary readiness={{
    ready: false,
    warnings: ['Pack conversion required'],
    allocationPolicy: 'Stock allocated once',
    ingredients: [{
      itemKey: 'rice',
      name: 'Rice',
      unit: 'KILOGRAM',
      specification: {
        v: 1,
        category: 'OTHER'
      },
      required: '2',
      available: '1',
      deficit: '1',
      usableDeficit: '1',
      yieldPercent: '100',
      blocked: true,
      evidence: ['Confirmed incoming arrives after service']
    }],
    dishes: [{
      dishId: 'd',
      name: 'Rice bowl',
      portions: '10',
      ready: false,
      evidence: ['Short 1 kg']
    }]
  }} />);
  expect(html).toContain('Needs attention');
  expect(html).toContain('Pack conversion required');
  expect(html).toContain('Confirmed incoming arrives after service');
  expect(html).toContain('Short 1 kg');
});
