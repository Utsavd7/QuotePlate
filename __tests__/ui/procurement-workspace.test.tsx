import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProcurementWorkspace } from '@/components/procurement/ProcurementWorkspace';
import { metadata } from '@/app/(app)/procurement/page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('procurement workspace', () => {
  it('shows delivery dates and quote deadlines in India time across the UTC day boundary', () => {
    const html = renderToStaticMarkup(
      <ProcurementWorkspace initialRequests={[{
        id: 'india-date-request', title: 'Morning delivery', status: 'OPEN', version: 1,
        deliveryDate: '2026-09-06T00:00:00.000Z',
        quoteDeadline: '2026-09-05T19:00:00.000Z',
        openedAt: null, awardedAt: null,
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
        itemCount: 1, supplierCount: 1,
      }]} />,
    );

    expect(html).toContain('6 Sept 2026');
    expect(html).toContain('6 Sept, 12:30 am');
  });

  it('shows real request state without fabricated savings', () => {
    const html = renderToStaticMarkup(
      <ProcurementWorkspace
        initialRequests={[
          {
            id: 'request-1',
            title: 'Fresh produce · Week 36',
            status: 'OPEN',
            version: 2,
            deliveryDate: '2026-09-05T00:00:00.000Z',
            quoteDeadline: '2026-09-03T10:00:00.000Z',
            openedAt: '2026-08-28T08:00:00.000Z',
            awardedAt: null,
            createdAt: '2026-08-28T08:00:00.000Z',
            updatedAt: '2026-08-28T08:00:00.000Z',
            itemCount: 14,
            supplierCount: 4,
          },
        ]}
        initialError=""
      />,
    );

    expect(html).toContain('Purchases');
    expect(html).toContain('Choose ingredients, then ask your suppliers for prices.');
    expect(html).toContain('Fresh produce · Week 36');
    expect(html).toContain('14 items');
    expect(html).toContain('4 suppliers');
    expect(html).toContain('Waiting for suppliers');
    expect(html).toContain('Quote by');
    expect(html).toContain('Delivery');
    expect(html).toContain('Choose ingredients');
    expect(html).toContain('aria-label="Purchase steps"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Purchase history &amp; reports');
    expect(html).not.toContain('savings');
    expect(html).not.toContain('AI');
  });

  it('keeps both dates labelled when the desktop table heading is hidden', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/procurement/procurement-workspace.module.css'),
      'utf8',
    );

    expect(css).toMatch(/@media\(max-width:44rem\)[\s\S]*\.requestRow>\.date:first-of-type\{display:flex/);
    expect(css).toMatch(/\.mobileLabel/);
  });

  it('has a useful empty state', () => {
    const html = renderToStaticMarkup(
      <ProcurementWorkspace initialRequests={[]} initialError="" />,
    );

    expect(html).toContain('Create your first request');
    expect(html).toContain('approved menu');
    expect(html).toContain('Choose ingredients');
  });

  it('translates every stored request status for restaurant users', () => {
    const html = renderToStaticMarkup(
      <ProcurementWorkspace
        initialError=""
        initialRequests={[
          ...['DRAFT', 'OPEN', 'AWARDED', 'CANCELLED'].map((status, index) => ({
            id: `request-${index}`,
            title: `Request ${index}`,
            status: status as 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED',
            version: 1,
            deliveryDate: '2026-09-05T00:00:00.000Z',
            quoteDeadline: '2026-09-03T10:00:00.000Z',
            openedAt: null,
            awardedAt: null,
            createdAt: '2026-08-28T08:00:00.000Z',
            updatedAt: '2026-08-28T08:00:00.000Z',
            itemCount: 1,
            supplierCount: 1,
          })),
        ]}
      />,
    );

    expect(html).toContain('Not sent');
    expect(html).toContain('Waiting for suppliers');
    expect(html).toContain('Supplier selected');
    expect(html).toContain('Cancelled');
  });

  it('uses the approved page title', () => {
    expect(metadata.title).toBe('Purchases');
  });

  it('offers the next real API page when a cursor is available', () => {
    const Workspace = ProcurementWorkspace as unknown as React.ComponentType<Record<string, unknown>>;
    const html = renderToStaticMarkup(
      <Workspace initialRequests={[]} initialError="" initialNextCursor="request-page-2" />,
    );

    expect(html).toContain('Load more requests');
  });
});
