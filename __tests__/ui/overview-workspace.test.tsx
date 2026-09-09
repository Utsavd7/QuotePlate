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
  attention: { hasMore: false, items: [
    { requestId: 'request-open', title: 'Fresh produce · Bandra', kind: 'compare', replies: 3, pendingDeliveries: 0, creditRemainingPaise: '0', dueAt: '2026-08-29T06:30:00.000Z' },
    { requestId: 'request-awarded', title: 'Vegetables · Week 35', kind: 'delivery', replies: 0, pendingDeliveries: 1, creditRemainingPaise: '9182949', dueAt: '2026-08-27T10:00:00.000Z' },
    { requestId: 'draft', title: 'Next week', kind: 'draft', replies: 0, pendingDeliveries: 0, creditRemainingPaise: '0', dueAt: '2026-08-29T06:30:00.000Z' },
    { requestId: 'expired', title: 'No replies yet', kind: 'expired', replies: 0, pendingDeliveries: 0, creditRemainingPaise: '0', dueAt: '2026-08-28T06:00:00.000Z' },
  ] },
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
  it('shows one task list with direct actions and keeps history out of daily work', () => {
    const html = renderToStaticMarkup(<OverviewWorkspace initialData={overview} />);
    expect(html).toContain('Needs your attention');
    expect(html.match(/>New purchase /g)).toHaveLength(1);
    expect(html).toContain('3 supplier replies received');
    expect(html).toContain('₹91,829.49 credit still owed');
    expect(html).toContain('href="/procurement/request-open#purchase-comparison"');
    expect(html).toContain('href="/procurement/request-awarded#delivery-check-heading"');
    expect(html).toContain('Continue draft for Next week');
    expect(html).toContain('Review request for No replies yet');
    expect(html).toContain('Reply deadline passed. No replies received.');
    expect(html).toContain('href="/procurement"');
    for (const heading of ['Current work', 'At a glance', 'Recent orders', 'Active suppliers', 'Reply deadlines']) {
      expect(html).not.toContain(heading);
    }
  });

  it('keeps credit-only follow-ups actionable and explains a bounded queue', () => {
    const html = renderToStaticMarkup(<OverviewWorkspace initialData={{ ...overview,
      attention: { hasMore: true, items: [{ ...overview.attention.items[1], pendingDeliveries: 0 }] },
    }} />);
    expect(html).toContain('Follow up credit for Vegetables');
    expect(html).toContain('More purchases need attention. Open all purchases to see the rest.');
    expect(html).not.toContain('delivery needs checking');
  });

  it('offers one next setup step, then a truthful waiting state', () => {
    const emptyData: OverviewData = { ...overview, attention: { items: [], hasMore: false }, counts: {
      activeSuppliers: 0, menus: { draft: 0, approved: 0 },
      requests: { draft: 0, open: 0, awarded: 0 }, quotesReceivedForOpenRequests: 0,
    } };
    const empty = renderToStaticMarkup(<OverviewWorkspace initialData={emptyData} />);
    expect(empty).toContain('Get ready for your first purchase');
    expect(empty).toContain('Add suppliers');
    expect(empty).not.toContain('Review your menu');
    const withSupplier = renderToStaticMarkup(<OverviewWorkspace initialData={{ ...emptyData,
      counts: { ...emptyData.counts, activeSuppliers: 1 },
    }} />);
    expect(withSupplier).toContain('Review your menu');
    const waiting = renderToStaticMarkup(<OverviewWorkspace initialData={{ ...overview,
      attention: { items: [], hasMore: false },
    }} />);
    expect(waiting).toContain('You’re up to date');
    expect(waiting).toContain('Your suppliers can still reply.');
  });

  it('has useful loading and recoverable error states', () => {
    const loading = renderToStaticMarkup(<OverviewWorkspace />);
    const error = renderToStaticMarkup(<OverviewWorkspace initialError="We could not load your overview." />);
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
