import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';

import { HistoryWorkspace, resolveRepeatSource } from '@/components/reporting/HistoryWorkspace';
import { InsightsWorkspace } from '@/components/reporting/InsightsWorkspace';
import { metadata as historyMetadata } from '@/app/(app)/history/page';
import { metadata as insightsMetadata } from '@/app/(app)/insights/page';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

async function renderAfterFailedInitialEffect(
  workspace: 'history' | 'procurement' | 'new-request',
  message: string,
) {
  let html = '';
  await jest.isolateModulesAsync(async () => {
    const values: unknown[] = [];
    const effects: Array<() => void | (() => void)> = [];
    let stateIndex = 0;
    jest.doMock('react', () => {
      const actual = jest.requireActual<typeof import('react')>('react');
      return {
        ...actual,
        useCallback: <T,>(callback: T) => callback,
        useEffect: (effect: () => void | (() => void)) => effects.push(effect),
        useRef: <T,>(initial: T) => {
          const index = stateIndex;
          stateIndex += 1;
          if (index >= values.length) values[index] = { current: initial };
          return values[index] as { current: T };
        },
        useState: <T,>(initial: T | (() => T)) => {
          const index = stateIndex;
          stateIndex += 1;
          if (index >= values.length) {
            values[index] = typeof initial === 'function'
              ? (initial as () => T)()
              : initial;
          }
          const setValue = (next: T | ((current: T) => T)) => {
            values[index] = typeof next === 'function'
              ? (next as (current: T) => T)(values[index] as T)
              : next;
          };
          return [values[index] as T, setValue] as const;
        },
      };
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(message));
    let EffectWorkspace: ComponentType;
    if (workspace === 'history') {
      const workspaceModule = await import('@/components/reporting/HistoryWorkspace');
      EffectWorkspace = workspaceModule.HistoryWorkspace;
    } else if (workspace === 'procurement') {
      const workspaceModule = await import('@/components/procurement/ProcurementWorkspace');
      EffectWorkspace = workspaceModule.ProcurementWorkspace;
    } else {
      const workspaceModule = await import('@/components/procurement/NewRequestForm');
      EffectWorkspace = workspaceModule.NewRequestForm;
    }
    stateIndex = 0;
    renderToStaticMarkup(<EffectWorkspace />);
    effects[0]?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    stateIndex = 0;
    html = renderToStaticMarkup(<EffectWorkspace />);
    fetchMock.mockRestore();
  });
  jest.dontMock('react');
  return html;
}

describe('reporting workspaces', () => {
  it('loads a completed repeat source directly when it is older than the visible history page', async () => {
    const older = {
      id: 'request-old', title: 'Older vegetable order', status: 'AWARDED' as const, version: 7,
    };
    const loadRequest = jest.fn().mockResolvedValue(older);

    await expect(resolveRepeatSource('request-old', [], loadRequest)).resolves.toEqual(older);
    expect(loadRequest).toHaveBeenCalledWith('request-old');
  });

  it('labels observed supplier evidence without invented savings or forecasts', () => {
    const html = renderToStaticMarkup(<InsightsWorkspace initialData={{
      generatedAt: '2026-08-28T12:00:00.000Z', capped: false,
      summary: { requestSampleSize: 4, supplierRequestsSent: 12, supplierResponses: 9, responseRatePercent: '75', quoteLinesExpected: 40, quoteLinesFullyCovered: 34, quotedLineCoveragePercent: '85', awardedRequestCount: 3, totalAwardedPaise: '4526000' },
      priceRanges: [{ itemName: 'Tomato', unit: 'KILOGRAM', quoteCount: 3, minimumUnitRatePaise: '4200', maximumUnitRatePaise: '5100', minimumSupplierName: 'GreenLeaf', maximumSupplierName: 'Shakti Foods', observedVariancePercent: '21.43' }],
      historyGuidance: [{ itemKey: 'tomato', itemName: 'Tomato', unit: 'KILOGRAM', lastOrderedQuantity: '90', lastOrderedAt: '2026-08-20T10:00:00.000Z', lastSupplierNames: ['GreenLeaf'], seasonalNotice: null, unusualQuantityNotice: 'Quantity check: this is more than twice recent orders.' }],
      notes: ['Observed ranges compare submitted quotes; they are not savings claims or automatic recommendations.'],
    }} />);
    expect(html).toContain('Reports');
    expect(html).toContain('Compare supplier prices and review your spending.');
    expect(html).toContain('75%');
    expect(html).toContain('₹45,260.00');
    expect(html).toContain('₹42.00');
    expect(html).toContain('range, not savings');
    expect(html).toContain('Your previous purchases');
    expect(html).toContain('Last ordered 90 kg');
    expect(html).toContain('GreenLeaf');
    expect(html).toContain('Quantity check');
    expect(html).not.toContain('forecast');
    expect(html).not.toContain('recommended supplier');
  });

  it('shows permanent history and offers an awarded request as a new draft', () => {
    const html = renderToStaticMarkup(<HistoryWorkspace initialPage={{
      nextCursor: null,
      requests: [{ id: 'request-1', title: 'Fresh produce · Week 36', status: 'AWARDED', version: 3, deliveryDate: '2026-09-05', quoteDeadline: '2026-09-03T10:00:00.000Z', createdAt: '2026-08-28T08:00:00.000Z', openedAt: '2026-08-28T08:05:00.000Z', awardedAt: '2026-08-28T10:00:00.000Z', _count: { items: 8, supplierRequests: 3 }, respondingSupplierCount: 2, quoteRevisionCount: 5, award: { id: 'award-1', totalPaise: '9182949', createdAt: '2026-08-28T10:00:00.000Z', supplierCount: 1, receiving: { checkedCount: 1, totalCount: 1, complete: true, problemCount: 1 } } }],
      recentQuoteRevisions: [{ id: 'quote-5', requestId: 'request-1', requestTitle: 'Fresh produce · Week 36', supplierName: 'GreenLeaf Foods', revision: 3, submittedAt: '2026-08-28T09:45:00.000Z', totalPaise: '7968000' }],
      recentActivity: [
        { id: 'audit-2', label: 'Delivery checked', actorName: 'Neha Singh', createdAt: '2026-08-28T11:00:00.000Z' },
        { id: 'audit-1', label: 'Award recorded', actorName: 'Neha Singh', createdAt: '2026-08-28T10:00:00.000Z' },
      ],
    }} />);
    expect(html).toContain('Past purchases');
    expect(html).toContain('Find earlier requests and decisions, then repeat a purchase when needed.');
    expect(html).toContain('Ask suppliers for prices');
    expect(html).toContain('Fresh produce · Week 36');
    expect(html).toContain('₹91,829.49');
    expect(html).toContain('Repeat order');
    expect(html).toContain('Supplier selected');
    expect(html).toContain('2 replied');
    expect(html).toContain('5');
    expect(html).toContain('Quote versions');
    expect(html).toContain('Version 3');
    expect(html).toContain('GreenLeaf Foods');
    expect(html).toContain('Recent activity');
    expect(html).toContain('Award recorded');
    expect(html).toContain('Delivery 1 of 1 checked');
    expect(html).toContain('1 problem');
    expect(html).toContain('Delivery checked');
    expect(html).not.toContain('metadata');
  });

  it('uses the approved reporting page titles', () => {
    expect(insightsMetadata.title).toBe('Reports');
    expect(historyMetadata.title).toBe('Past purchases');
  });

  it('does not mistake a failed history load for an empty buying record', () => {
    return renderAfterFailedInitialEffect(
      'history',
      'We could not load procurement history.',
    ).then((html) => {
      expect(html).toContain('We could not load procurement history.');
      expect(html).toContain('Your saved restaurant records are unchanged.');
      expect(html).toContain('Try again');
      expect(html).not.toContain('No procurement history yet');
    });
  });

  it.each([
    {
      workspace: 'procurement' as const,
      message: 'We could not load procurement requests.',
      misleadingEmpty: 'Create your first request',
    },
    {
      workspace: 'new-request' as const,
      message: 'We could not prepare this request.',
      misleadingEmpty: '<form class="form"',
    },
  ])('does not render a false empty state after the $workspace effect fails', async ({
    workspace,
    message,
    misleadingEmpty,
  }) => {
    const html = await renderAfterFailedInitialEffect(workspace, message);

    expect(html).toContain(message);
    expect(html).toContain('Your saved restaurant records are unchanged.');
    expect(html).toContain('Try again');
    expect(html).not.toContain(misleadingEmpty);
  });

  it('labels the insights empty-state destination as asking suppliers for prices', () => {
    const html = renderToStaticMarkup(<InsightsWorkspace initialData={{
      generatedAt: '2026-08-28T12:00:00.000Z', capped: false,
      summary: { requestSampleSize: 0, supplierRequestsSent: 0, supplierResponses: 0, responseRatePercent: null, quoteLinesExpected: 0, quoteLinesFullyCovered: 0, quotedLineCoveragePercent: null, awardedRequestCount: 0, totalAwardedPaise: '0' },
      priceRanges: [], historyGuidance: [], notes: [],
    }} />);

    expect(html).toContain(
      'This page will use only submitted records.</span><a href="/procurement/new">Ask suppliers for prices',
    );
  });
});
