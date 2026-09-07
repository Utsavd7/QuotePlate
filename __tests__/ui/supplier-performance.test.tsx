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
    expect(html).toContain('Supplier performance');
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
