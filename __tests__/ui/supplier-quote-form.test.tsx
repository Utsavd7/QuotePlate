import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';

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

  const root = parse(html);
  expect(root.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  expect(root.querySelector('#review-heading')).toBeNull();
  for (const item of request.items) {
    const row = root.querySelector(`article[aria-labelledby="item-${item.id}"]`)!;
    expect(row.querySelector('h3')?.text).toBe(item.name);
    for (const field of ['rate', 'quantity', 'gst', 'inclusive', 'noQuote', 'substitution']) {
      expect(row.querySelector(`input[name="${field}:${item.id}"]`)).not.toBeNull();
    }
    expect(row.querySelector(`input[name="gst:${item.id}"]`)?.closest('details')).toBeNull();
    expect(row.querySelector('details')?.hasAttribute('open')).toBe(false);
  }
});

test('saved no-quote choices, inclusive GST and optional notes remain available when revising', () => {
  const html = renderToStaticMarkup(<SupplierQuoteForm request={{ ...request, latestQuote: {
    revision: 2, subtotalPaise: '40000', gstPaise: '2000', freightPaise: '1000', totalPaise: '43000',
    deliveryDate: request.deliveryDate, validUntil: '2026-09-03', minimumOrder: '₹400',
    commercialTerms: 'Payment on delivery', notes: 'Call before delivery', submittedAt: '2026-09-01T08:00:00Z',
    items: request.items.map((item, index) => ({ requestItemId: item.id, noQuote: index === 1,
      availableQuantity: index === 1 ? null : '10', unit: item.unit,
      unitRatePaise: index === 1 ? null : '4200', gstBasisPoints: 500, taxInclusive: true,
      suppliedBrand: null, suppliedPackSize: null, suppliedQualityGrade: null,
      substitution: index === 1 ? null : 'Two 5 kg packs', subtotalPaise: '40000', gstPaise: '2000', totalPaise: '42000',
    })),
  } }} onSaved={jest.fn()} onRefresh={jest.fn()} />);
  const root = parse(html);
  expect(root.querySelector('[name="noQuote:paneer"]')?.hasAttribute('checked')).toBe(true);
  expect(root.querySelector('[name="rate:paneer"]')?.hasAttribute('disabled')).toBe(true);
  expect(root.querySelector('[name="rate:tomato"]')?.getAttribute('value')).toBe('42');
  expect(root.querySelector('[name="inclusive:tomato"]')?.hasAttribute('checked')).toBe(true);
  expect(root.querySelector('[name="substitution:tomato"]')?.closest('details')?.hasAttribute('open')).toBe(true);
  expect(root.querySelector('[name="notes"]')?.closest('details')?.hasAttribute('open')).toBe(true);
  expect(html).toContain('Last sent: version 2');
  expect(html).not.toContain('Use previous prices');
});
