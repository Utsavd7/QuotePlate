import { parse } from 'node-html-parser';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  RequestDetail,
  SupplierFreshLinkActions,
} from '@/components/procurement/RequestDetail';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

function requestItem(
  id: string,
  name: string,
  quantity: string,
  unit: 'KILOGRAM' | 'LITRE',
  referenceUrl: string | null = null,
) {
  return {
    id,
    itemKey: name.toLocaleLowerCase('en-IN'),
    name,
    quantity,
    unit,
    specification: { v: 1 as const, category: unit === 'LITRE' ? 'DAIRY' as const : 'VEGETABLES' as const, referenceUrl },
    sourcingOverride: null,
  };
}

function requestItemsDocument(item: ReturnType<typeof requestItem>) {
  return { v: 1 as const, items: [item] };
}

function requestSourcingDocument(supplierId: string) {
  return {
    v: 1 as const,
    default: {
      v: 1 as const,
      modes: ['CURRENT' as const],
      currentSupplierIds: [supplierId],
      selectedNewSupplierIds: [],
      acceptVerifiedApplications: false,
    },
  };
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (!isValidElement<{ children?: ReactNode }>(node)) return '';
  return textContent(node.props.children);
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (predicate(node)) return node;
  return findElement(node.props.children as ReactNode, predicate);
}

describe('procurement request detail', () => {
  it('shows request facts, supplier progress, and deterministic quote comparison', () => {
    const html = renderToStaticMarkup(
      <RequestDetail
        requestId="request-1"
        initialRequest={{
          id: 'request-1', title: 'Fresh produce · Week 36', status: 'OPEN', version: 2,
          deliveryDetails: { addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
          deliveryDate: '2026-09-05T00:00:00.000Z', quoteDeadline: '2026-09-03T10:00:00.000Z', commercialTerms: 'Payment in 15 days',
          items: requestItemsDocument(requestItem('item-1', 'Tomato', '100', 'KILOGRAM', 'https://example.com/tomato-grade-a')),
          sourcing: requestSourcingDocument('supplier-1'),
          supplierRequests: [{ id: 'grant-1', supplierId: 'supplier-1', expiresAt: '2026-09-03T10:00:00.000Z', revokedAt: null, viewedAt: '2026-08-28T09:00:00.000Z', supplier: { id: 'supplier-1', businessName: 'GreenLeaf Fresh Foods', contactName: 'Meera Shah', phone: '+919876543210', whatsappNumber: '+919876543210', email: null, isActive: true } }],
        }}
        initialComparison={{
          request: { id: 'request-1', title: 'Fresh produce · Week 36', deliveryDate: '2026-09-05', quoteDeadline: '2026-09-03T10:00:00.000Z', commercialTerms: 'Payment in 15 days', itemCount: 1, items: [requestItem('item-1', 'Tomato', '100', 'KILOGRAM')] },
          quotes: [{ supplierRequestId: 'grant-1', supplierName: 'GreenLeaf Fresh Foods', supplierActive: true, revision: 1, subtotalPaise: '7968000', gstPaise: '398400', freightPaise: '0', totalPaise: '8366400', deliveryDate: '2026-09-05', validUntil: '2026-09-04', submittedAt: '2026-08-28T09:30:00.000Z', minimumOrder: null, commercialTerms: '15 days', notes: null, coveredItemCount: 1, totalItemCount: 1, fullCoverage: true, deliveryFit: 'ON_OR_BEFORE', expired: false, missingTerms: false, missingRequestItemIds: [], partialRequestItemIds: [], unitMismatchRequestItemIds: [], substitutions: [], items: [{ requestItemId: 'item-1', requestItemKey: 'tomato', requestItemName: 'Tomato', requestedQuantity: '100', requestUnit: 'KILOGRAM', requestedSpecification: { v: 1, category: 'VEGETABLES', description: null, preferredBrand: null, packSize: null, qualityGrade: null, notes: null, referenceUrl: null, thumbnailWebpBase64: null }, suppliedSpecification: { brand: null, packSize: null, qualityGrade: null }, quotedAvailableQuantity: '100', quotedUnit: 'KILOGRAM', normalizedAvailableQuantity: '100', normalizedUnitRatePaise: '79680', unitComparable: true, coverage: 'FULL', gstBasisPoints: 500, taxInclusive: false, substitution: null, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }] }],
        }}
      />,
    );

    expect(html).toContain('Fresh produce · Week 36');
    expect(html).toContain('Purchases');
    expect(html).toContain('Purchase');
    expect(html).toContain('Tomato');
    expect(html).toContain('View food reference');
    expect(html).toContain('https://example.com/tomato-grade-a');
    expect(html).toContain('GreenLeaf Fresh Foods');
    expect(html).toContain('₹83,664.00');
    expect(html).toContain('Viewed');
    expect(html).toContain('One supplier');
    expect(html).toContain('Split by item');
    expect(html).toContain('including GST &amp; freight');
    expect(html).toContain('Refresh quotes');
    expect(html).toContain('Waiting for suppliers');
    expect(html).toContain('Requested ingredients');
    expect(html).toContain('Compare prices');
    expect(html).toContain('Choose supplier');
    expect(html).toContain('Your choice is final once saved.');
    expect(html).toContain('Your choice is final once saved.');
    expect(html).toContain('Download records');
    expect(html).toContain('Request CSV');
    expect(html).toContain('Quote comparison CSV');
    expect(html).not.toContain('Award decision CSV');
    const document = parse(html);
    expect(document.querySelector('#purchase-comparison')?.hasAttribute('open')).toBe(true);
    expect(document.querySelector('#purchase-items')?.hasAttribute('open')).toBe(false);
    expect(document.querySelector('#request-downloads-heading')?.parentNode?.hasAttribute('open')).toBe(false);
    expect(html.indexOf('id="purchase-comparison"')).toBeLessThan(html.indexOf('Supplier links &amp; access'));
    expect(html.indexOf('Supplier links &amp; access')).toBeLessThan(html.indexOf('Download records'));
    expect(html).not.toContain('recommended winner');
    expect(html).not.toContain('>Procurement</button>');
    expect(html).not.toContain('>Procurement request</p>');
  });

  it('lets a draft be edited before private links are created', () => {
    const html = renderToStaticMarkup(
      <RequestDetail
        requestId="request-draft"
        initialRequest={{
          id: 'request-draft', title: 'Dairy · Monday', status: 'DRAFT', version: 1,
          deliveryDetails: { addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
          deliveryDate: '2026-09-05T00:00:00.000Z', quoteDeadline: '2026-09-03T10:00:00.000Z', commercialTerms: null,
          items: requestItemsDocument(requestItem('milk', 'Milk', '40', 'LITRE')),
          sourcing: requestSourcingDocument('supplier-1'),
          supplierRequests: [{ id: 'grant-draft', supplierId: 'supplier-1', expiresAt: '2026-09-03T10:00:00.000Z', revokedAt: null, viewedAt: null, supplier: { id: 'supplier-1', businessName: 'Shakti Dairy', contactName: null, phone: '+919876543210', whatsappNumber: null, email: null, isActive: true } }],
        }}
      />,
    );
    expect(html).toContain('Edit draft');
    expect(html).toContain('Create supplier links');
    expect(html).toContain('Not sent');
    expect(html).not.toContain('Private quote link for Shakti Dairy');
  });

  it('renders the complete immutable decision record after refresh', () => {
    const request = {
      id: 'request-1', title: 'Fresh produce · Week 36', status: 'AWARDED' as const, version: 3,
      deliveryDetails: { addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
      deliveryDate: '2026-09-05T00:00:00.000Z', quoteDeadline: '2026-09-03T10:00:00.000Z', commercialTerms: 'Payment in 15 days',
      items: requestItemsDocument(requestItem('item-1', 'Tomato', '100', 'KILOGRAM')),
      sourcing: requestSourcingDocument('supplier-1'),
      supplierRequests: [{ id: 'grant-1', supplierId: 'supplier-1', expiresAt: '2026-09-03T10:00:00.000Z', revokedAt: null, viewedAt: '2026-08-28T09:00:00.000Z', supplier: { id: 'supplier-1', businessName: 'Renamed Supplier', contactName: null, phone: null, whatsappNumber: null, email: null, isActive: true } }],
    };
    const html = renderToStaticMarkup(
      <RequestDetail
        requestId="request-1"
        initialRequest={request}
        initialComparison={{
          request: {
            id: request.id, title: request.title, deliveryDate: '2026-09-05', quoteDeadline: request.quoteDeadline,
            commercialTerms: request.commercialTerms, itemCount: 1, items: request.items.items,
            status: 'AWARDED', version: 3,
            award: {
              id: 'award-1', requestId: request.id, rationale: 'Best complete landed price and on-time delivery.',
              totalPaise: '8366400', createdAt: '2026-08-28T10:00:00.000Z', splitAward: false,
              suppliers: [{ supplierId: 'supplier-1', supplierRequestId: 'grant-1', quoteRevision: 2, supplierName: 'GreenLeaf Fresh Foods', freightPaise: '0', deliveryDate: '2026-09-05', gstin: '27ABCDE1234F1Z5', commercialTerms: '15 days', lines: [{ requestItemId: 'item-1', itemName: 'Tomato' }] }],
              lines: [{ requestItemId: 'item-1', supplierRequestId: 'grant-1', supplierId: 'supplier-1', quoteRevision: 2, quantity: '100', unit: 'KILOGRAM', unitRatePaise: '79680', gstBasisPoints: 500, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }],
              receiving: {
                checkedCount: 1, totalCount: 1, complete: true, problemCount: 1,
                suppliers: [{
                  supplierId: 'supplier-1', supplierName: 'GreenLeaf Fresh Foods',
                  deliveryDate: '2026-09-05', expectedTotalPaise: '8366400',
                  check: {
                    supplierId: 'supplier-1', outcome: 'ISSUES', invoiceTotalPaise: '8370000',
                    differencePaise: '3600', issueCodes: ['PRICE_DIFFERENCE'],
                    note: 'Invoice total is higher.', checkedAt: '2026-09-05T10:00:00.000Z',
                    hasProblem: true,
                  },
                }],
              },
            },
          },
          quotes: [{ supplierRequestId: 'grant-1', supplierName: 'GreenLeaf Fresh Foods', supplierActive: true, revision: 2, subtotalPaise: '7968000', gstPaise: '398400', freightPaise: '0', totalPaise: '8366400', deliveryDate: '2026-09-05', validUntil: '2026-09-04', submittedAt: '2026-08-28T09:30:00.000Z', minimumOrder: null, commercialTerms: '15 days', notes: null, coveredItemCount: 1, totalItemCount: 1, fullCoverage: true, deliveryFit: 'ON_OR_BEFORE', expired: false, missingTerms: false, missingRequestItemIds: [], partialRequestItemIds: [], unitMismatchRequestItemIds: [], substitutions: [], items: [{ requestItemId: 'item-1', requestItemKey: 'tomato', requestItemName: 'Tomato', requestedQuantity: '100', requestUnit: 'KILOGRAM', requestedSpecification: { v: 1, category: 'VEGETABLES', description: null, preferredBrand: null, packSize: null, qualityGrade: null, notes: null, referenceUrl: null, thumbnailWebpBase64: null }, suppliedSpecification: { brand: null, packSize: null, qualityGrade: null }, quotedAvailableQuantity: '100', quotedUnit: 'KILOGRAM', normalizedAvailableQuantity: '100', normalizedUnitRatePaise: '79680', unitComparable: true, coverage: 'FULL', gstBasisPoints: 500, taxInclusive: false, substitution: null, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }] }],
        }}
      />,
    );
    expect(html).toContain('Final decision record');
    expect(html).toContain('Supplier selected');
    expect(html).toContain('Best complete landed price and on-time delivery.');
    expect(html).toContain('GreenLeaf Fresh Foods');
    expect(html).toContain('₹83,664.00');
    expect(html).toContain('This record uses the supplier, quote, quantity, tax and delivery facts saved at the time of the award.');
    expect(html).toContain('Award decision CSV');
    expect(html).toContain('Accounting CSV');
    expect(html).toContain('Purchase order · GreenLeaf Fresh Foods');
    expect(html).toContain('Check delivery');
    expect(html).toContain('Invoice difference');
    expect(html).toContain('₹36.00 higher');
    expect(html).toContain('Repeat this order');
    const document = parse(html);
    expect(document.querySelector('#purchase-comparison')?.hasAttribute('open')).toBe(false);
    expect(html.indexOf('id="delivery-check-heading"')).toBeLessThan(html.indexOf('Prices &amp; decision history'));
  });

  it('offers an accessible QR download only while a fresh supplier link is visible', () => {
    const html = renderToStaticMarkup(
      <SupplierFreshLinkActions
        link={{
          supplierRequestId: 'grant-1', supplierId: 'supplier-1',
          businessName: 'GreenLeaf Fresh Foods',
          url: `https://quoteplate.example/quote#token=${'Q'.repeat(43)}`,
          expiresAt: '2026-09-03T10:00:00.000Z',
        }}
        busy={false}
        onCopy={jest.fn()}
        onWhatsApp={jest.fn()}
        onQr={jest.fn()}
      />,
    );

    expect(html).toContain('Copy');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('Download QR for GreenLeaf Fresh Foods');
  });

  it('keeps a returned award locked when an older quote refresh resolves last', async () => {
    const initialRequest = {
      id: 'request-1', title: 'Fresh produce · Week 36', status: 'OPEN' as const, version: 2,
      deliveryDetails: { addressLine: '18 Market Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
      deliveryDate: '2026-09-05T00:00:00.000Z', quoteDeadline: '2026-09-03T10:00:00.000Z', commercialTerms: 'Payment in 15 days',
      items: requestItemsDocument(requestItem('item-1', 'Tomato', '100', 'KILOGRAM')),
      sourcing: requestSourcingDocument('supplier-1'),
      supplierRequests: [{ id: 'grant-1', supplierId: 'supplier-1', expiresAt: '2026-09-03T10:00:00.000Z', revokedAt: null, viewedAt: '2026-08-28T09:00:00.000Z', supplier: { id: 'supplier-1', businessName: 'GreenLeaf Fresh Foods', contactName: 'Meera Shah', phone: '+919876543210', whatsappNumber: '+919876543210', email: null, isActive: true } }],
    };
    const quote = {
      supplierRequestId: 'grant-1', supplierName: 'GreenLeaf Fresh Foods', supplierActive: true, revision: 2,
      subtotalPaise: '7968000', gstPaise: '398400', freightPaise: '0', totalPaise: '8366400',
      deliveryDate: '2026-09-05', validUntil: '2026-09-04', submittedAt: '2026-08-28T09:30:00.000Z',
      minimumOrder: null, commercialTerms: '15 days', notes: null, coveredItemCount: 1, totalItemCount: 1,
      fullCoverage: true, deliveryFit: 'ON_OR_BEFORE' as const, expired: false, missingTerms: false,
      missingRequestItemIds: [], partialRequestItemIds: [], unitMismatchRequestItemIds: [], substitutions: [],
      items: [{ requestItemId: 'item-1', requestItemKey: 'tomato', requestItemName: 'Tomato', requestedQuantity: '100', requestUnit: 'KILOGRAM' as const, requestedSpecification: { v: 1 as const, category: 'VEGETABLES' as const, description: null, preferredBrand: null, packSize: null, qualityGrade: null, notes: null, referenceUrl: null, thumbnailWebpBase64: null }, suppliedSpecification: { brand: null, packSize: null, qualityGrade: null }, quotedAvailableQuantity: '100', quotedUnit: 'KILOGRAM' as const, normalizedAvailableQuantity: '100', normalizedUnitRatePaise: '79680', unitComparable: true, coverage: 'FULL' as const, gstBasisPoints: 500, taxInclusive: false, substitution: null, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }],
    };
    const award = {
      id: 'award-1', requestId: initialRequest.id, rationale: 'Best complete landed price and on-time delivery.',
      totalPaise: '8366400', createdAt: '2026-08-28T10:00:00.000Z', splitAward: false,
      suppliers: [{ supplierId: 'supplier-1', supplierRequestId: 'grant-1', quoteRevision: 2, supplierName: 'GreenLeaf Fresh Foods', freightPaise: '0', deliveryDate: '2026-09-05', gstin: '27ABCDE1234F1Z5', commercialTerms: '15 days', lines: [{ requestItemId: 'item-1', itemName: 'Tomato' }] }],
      lines: [{ requestItemId: 'item-1', supplierRequestId: 'grant-1', supplierId: 'supplier-1', quoteRevision: 2, quantity: '100', unit: 'KILOGRAM' as const, unitRatePaise: '79680', gstBasisPoints: 500, subtotalPaise: '7968000', gstPaise: '398400', totalPaise: '8366400' }],
    };
    const awardResponse = new Response(JSON.stringify({ award }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    let resolveStaleRefresh: (response: Response) => void = () => undefined;
    const staleRefresh = new Promise<Response>((resolve) => {
      resolveStaleRefresh = resolve;
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => staleRefresh)
      .mockResolvedValueOnce(awardResponse)
      .mockRejectedValueOnce(new Error('refresh unavailable'));
    const hadWindow = 'window' in globalThis;
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { confirm: jest.fn(() => true) },
    });

    let afterAwardHtml = '';
    let finalHtml = '';
    try {
      await jest.isolateModulesAsync(async () => {
        const values: unknown[] = [];
        let stateIndex = 0;
        jest.doMock('react', () => {
          const actual = jest.requireActual<typeof import('react')>('react');
          return {
            ...actual,
            useCallback: <T,>(callback: T) => callback,
            useEffect: () => undefined,
            useMemo: <T,>(factory: () => T) => factory(),
            useRef: <T,>(initial: T) => {
              const index = stateIndex;
              stateIndex += 1;
              if (index >= values.length) values[index] = { current: initial };
              return values[index] as { current: T };
            },
            useState: <T,>(initial: T | (() => T)) => {
              const index = stateIndex;
              stateIndex += 1;
              if (index >= values.length) values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
              const setValue = (next: T | ((current: T) => T)) => {
                values[index] = typeof next === 'function'
                  ? (next as (current: T) => T)(values[index] as T)
                  : next;
              };
              return [values[index] as T, setValue] as const;
            },
          };
        });
        const { RequestDetail: EffectRequestDetail } = await import('@/components/procurement/RequestDetail');
        const render = () => {
          stateIndex = 0;
          return EffectRequestDetail({
            requestId: initialRequest.id,
            initialRequest,
            initialComparison: {
              request: { id: initialRequest.id, title: initialRequest.title, deliveryDate: '2026-09-05', quoteDeadline: initialRequest.quoteDeadline, commercialTerms: initialRequest.commercialTerms, itemCount: 1, items: initialRequest.items.items },
              quotes: [quote],
            },
          });
        };

        let tree = render();
        const refreshButton = findElement(tree, (element) => element.type === 'button' && textContent(element) === 'Refresh quotes');
        (refreshButton?.props.onClick as (() => void) | undefined)?.();
        const supplierChoice = findElement(tree, (element) => element.type === 'input' && element.props.name === 'whole-award');
        const rationale = findElement(tree, (element) => element.type === 'textarea');
        (supplierChoice?.props.onChange as (() => void) | undefined)?.();
        (rationale?.props.onChange as ((event: { target: { value: string } }) => void) | undefined)?.({ target: { value: award.rationale } });
        tree = render();
        const recordButton = findElement(tree, (element) => element.type === 'button' && textContent(element) === 'Confirm supplier choice');
        expect(recordButton?.props.disabled).toBe(false);
        (recordButton?.props.onClick as (() => void) | undefined)?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
        tree = render();
        afterAwardHtml = renderToStaticMarkup(tree);
        resolveStaleRefresh(new Response(JSON.stringify({
          request: { id: initialRequest.id, title: initialRequest.title, deliveryDate: '2026-09-05', quoteDeadline: initialRequest.quoteDeadline, commercialTerms: initialRequest.commercialTerms, itemCount: 1, items: initialRequest.items.items, status: 'OPEN', version: 2, award: null },
          quotes: [quote],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
        await new Promise<void>((resolve) => setImmediate(resolve));
        tree = render();
        finalHtml = renderToStaticMarkup(tree);
      });
    } finally {
      jest.dontMock('react');
      fetchMock.mockRestore();
      if (hadWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
      else Reflect.deleteProperty(globalThis, 'window');
    }

    expect(afterAwardHtml).toContain('Supplier selected');
    expect(afterAwardHtml).toContain('Final decision record');
    expect(finalHtml).toContain('Supplier selected');
    expect(finalHtml).toContain('Supplier choice saved');
    expect(finalHtml).toContain('Final decision record');
    expect(finalHtml).toContain('Supplier selection was recorded, but the latest view could not be loaded.');
    expect(finalHtml).not.toContain('Your saved restaurant records are unchanged.');
    expect(finalHtml).not.toContain('Your choice is final once saved.');
    expect(finalHtml).not.toContain('>Confirm supplier choice</button>');
    expect(finalHtml).toContain('Award decision CSV');
  });
});
