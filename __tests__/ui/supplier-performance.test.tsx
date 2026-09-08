import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SupplierPerformanceWorkspace } from '@/components/reporting/SupplierPerformanceWorkspace';
import { buildSupplierPerformance } from '@/lib/reporting/supplier-performance';

describe('supplier performance workspace', () => {
  it('explains missing evidence rather than claiming reliability', () => {
    const html = renderToStaticMarkup(<SupplierPerformanceWorkspace initialData={{
      generatedAt: '2026-09-07T12:00:00Z', capped: false, awardSampleSize: 1, notes: [],
      suppliers: buildSupplierPerformance([{ awardId: 'award-a', requestId: 'request-a', supplierId: 'supplier-a', supplierName: 'Farm A', promisedDate: '2026-09-07', actualDeliveryDate: null, checkedAt: null, complete: false, issueCodes: [], invoiceDifferencePaise: '0', creditClaimedPaise: '0', creditReceivedPaise: '0', lines: [] }]),
    }} />);
    expect(html).toContain('Delivery record');
    expect(html).toContain('Not enough dated deliveries');
    expect(html).toContain('No item quantities recorded');
    expect(html).not.toContain('100%');
  });
  it('offers receiving as the next action when no awards exist', () => {
    const html = renderToStaticMarkup(<SupplierPerformanceWorkspace initialData={{ generatedAt: '', capped: false, awardSampleSize: 0, notes: [], suppliers: [] }} />);
    expect(html).toContain('Record your first delivery');
    expect(html).toContain('href="/procurement"');
  });
});

it('shows actionable credit evidence and discloses the billed-cost basis', () => {
  const html = renderToStaticMarkup(<SupplierPerformanceWorkspace initialData={{
    generatedAt: '2026-09-08T12:00:00Z', capped: false, awardSampleSize: 1, notes: [],
    suppliers: buildSupplierPerformance([{ awardId: 'a', requestId: 'purchase-a', supplierId: 's', supplierName: 'Local supplier', promisedDate: '2026-09-07', actualDeliveryDate: '2026-09-07', checkedAt: '2026-09-08T12:00:00Z', complete: false, issueCodes: ['QUALITY'], invoiceDifferencePaise: '0', creditClaimedPaise: '500', creditReceivedPaise: '0', lines: [{ itemKey: 'tomato', itemName: 'Tomato', unit: 'KILOGRAM', orderedQuantity: '10', receivedQuantity: '9', rejectedQuantity: '0', billedQuantity: '10', billedUnitRatePaise: '4000', gstBasisPoints: 0, taxInclusive: false }] }]),
  }} />);
  expect(html).toContain('Needs your attention');
  expect(html).toContain('₹5.00 owed');
  expect(html).toContain('href="/procurement/purchase-a"');
  expect(html).toContain('₹44.44 / kg');
  expect(html).toContain('provisional');
  expect(html).toContain('Freight and order-level credits are excluded');
});
