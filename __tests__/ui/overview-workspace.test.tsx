import { renderToStaticMarkup } from 'react-dom/server';

import {
  formatInrFromPaise,
  OverviewWorkspace,
  type OverviewData,
} from '@/components/overview/OverviewWorkspace';
import { metadata } from '@/app/(app)/dashboard/page';

const overview: OverviewData = {
  generatedAt: '2026-08-28T06:00:00.000Z',
  counts: {
    activeSuppliers: 8,
    menus: { draft: 2, approved: 3 },
    requests: { draft: 1, open: 2, awarded: 4 },
    quotesReceivedForOpenRequests: 5,
  },
  deliveryAttention: { waiting: 2, problems: 1 },
  deadlines: [
    {
      requestId: 'request-open',
      title: 'Fresh produce · Bandra',
      quoteDeadline: '2026-08-29T06:30:00.000Z',
      suppliersInvited: 4,
      quotesReceived: 3,
    },
  ],
  recentAwards: [
    {
      awardId: 'award-a',
      requestId: 'request-awarded',
      title: 'Vegetables · Week 35',
      totalPaise: '9182949',
      awardedAt: '2026-08-27T10:00:00.000Z',
    },
  ],
};

describe('overview workspace', () => {
  it('renders real restaurant work, deadlines, and exact awarded totals', () => {
    const html = renderToStaticMarkup(<OverviewWorkspace initialData={overview} />);

    expect(html).toContain('Today');
    expect(html).toContain('Your next steps, from buying ingredients to checking deliveries.');
    expect(html).toContain('New purchase');
    expect(html).toContain('Active suppliers');
    expect(html).toContain('Menus ready');
    expect(html).toContain('Waiting for suppliers');
    expect(html).toContain('Quotes received');
    expect(html).toContain('Deliveries to check');
    expect(html).toContain('2 waiting');
    expect(html).toContain('1 problem');
    expect(html).toContain('Fresh produce · Bandra');
    expect(html).toContain('3 of 4 responded');
    expect(html).toContain('Vegetables · Week 35');
    expect(html).toContain('₹91,829.49');
    expect(html).toContain('<li><span>Not sent</span><strong>1</strong></li>');
    expect(html).toContain('<li><span>Waiting for suppliers</span><strong>2</strong></li>');
    expect(html).toContain('<li><span>Supplier selected</span><strong>4</strong></li>');
    expect(html).not.toContain('<li><span>Draft</span>');
    expect(html).not.toContain('<li><span>Open</span>');
    expect(html).not.toContain('<li><span>Awarded</span>');
    expect(html).toContain('href="/procurement/request-open"');
    expect(html).not.toContain('/procurement?status=OPEN');
    expect(html).not.toMatch(/\bsavings?\b|\bagents?\b|\bprototype\b|service health|\bAI\b/i);
  });

  it('has useful empty, loading, and recoverable error states', () => {
    const empty = renderToStaticMarkup(
      <OverviewWorkspace
        initialData={{
          ...overview,
          counts: {
            activeSuppliers: 0,
            menus: { draft: 0, approved: 0 },
            requests: { draft: 0, open: 0, awarded: 0 },
            quotesReceivedForOpenRequests: 0,
          },
          deadlines: [],
          recentAwards: [],
        }}
      />,
    );
    const loading = renderToStaticMarkup(<OverviewWorkspace />);
    const error = renderToStaticMarkup(
      <OverviewWorkspace initialError="We could not load your overview." />,
    );
    const withoutDeadlines = renderToStaticMarkup(
      <OverviewWorkspace initialData={{ ...overview, deadlines: [] }} />,
    );

    expect(empty).toContain('Get ready for your first purchase');
    expect(empty).toContain('Add suppliers');
    expect(empty).toContain('Add a menu');
    expect(withoutDeadlines).toContain(
      '<h3>No requests waiting for quotes</h3><p>Open a checked request when you are ready to ask suppliers for prices.</p><a href="/procurement/new">New purchase',
    );
    expect(loading).toContain('Loading your procurement overview');
    expect(error).toContain('We could not load your overview.');
    expect(error).toContain('Your saved restaurant records are unchanged.');
    expect(error).toContain('Try again');
  });

  it('uses the approved page title', () => {
    expect(metadata.title).toBe('Today');
  });

  it('formats paise exactly without floating-point rounding', () => {
    expect(formatInrFromPaise('0')).toBe('₹0.00');
    expect(formatInrFromPaise('9182949')).toBe('₹91,829.49');
    expect(formatInrFromPaise('9007199254740993123')).toBe(
      '₹90,07,19,92,54,74,09,931.23',
    );
  });
});
