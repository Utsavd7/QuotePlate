import { renderToStaticMarkup } from 'react-dom/server';

import {
  SupplierQuoteForm,
  type PublicQuoteRequestDto,
} from '@/app/quote/SupplierQuoteForm';

const request: PublicQuoteRequestDto = {
  restaurantName: 'Monsoon Table Pune',
  supplierName: 'Shakti Fresh Foods',
  title: 'Weekly vegetables and dairy',
  deliveryDetails: {
    addressLine: '18 Koregaon Park Road',
    city: 'Pune',
    state: 'Maharashtra',
    pin: '411001',
    instructions: 'Use the service entrance before 8 AM.',
  },
  deliveryDate: '2026-09-02',
  quoteDeadline: '2026-09-01T10:00:00.000Z',
  commercialTerms: 'Rates must include packing.',
  items: [
    {
      id: 'tomato', itemKey: 'tomato', name: 'Tomato', quantity: '100',
      unit: 'KILOGRAM',
      specification: { v: 1, category: 'VEGETABLES', referenceUrl: 'https://example.com/tomato-grade-a' },
    },
    {
      id: 'paneer', itemKey: 'paneer', name: 'Paneer', quantity: '25.5',
      unit: 'KILOGRAM',
      specification: { v: 1, category: 'DAIRY' },
    },
  ],
  latestQuote: null,
};

test('supplier quote form is understandable, complete, and account-free', () => {
  const html = renderToStaticMarkup(
    <SupplierQuoteForm
      request={request}
      onSaved={jest.fn()}
      onRefresh={jest.fn()}
    />,
  );

  expect(html).toContain('Monsoon Table Pune');
  expect(html).toContain('Shakti Fresh Foods');
  expect(html).toContain('Weekly vegetables and dairy');
  expect(html).toContain('18 Koregaon Park Road, Pune, Maharashtra, 411001');
  expect(html).toContain('Use the service entrance before 8 AM.');
  expect(html).toContain('Tomato');
  expect(html).toContain('100 kg');
  expect(html).toContain('View food reference');
  expect(html).toContain('https://example.com/tomato-grade-a');
  expect(html).toContain('Paneer');
  expect(html).toContain('Price per kg');
  expect(html).toContain('GST %');
  expect(html).toContain('GST is included');
  expect(html).toContain('Cannot supply this item');
  expect(html).toContain('Delivery charge');
  expect(html).toContain('Review delivery &amp; total');
  expect(html).toContain('Quote steps');
  expect(html).not.toContain('>Send quote</button>');
  expect(html).not.toContain('Create account');
});
