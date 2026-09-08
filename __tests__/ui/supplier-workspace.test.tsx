import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  cleanSupplierDraft,
  setSupplierCategoryTier,
  SupplierCapabilityFields,
  SupplierDetailError,
  SupplierErrorBanner,
  SupplierWorkspace,
} from '@/components/suppliers/SupplierWorkspace';
import { validateSupplierUpdateInput } from '@/lib/suppliers/supplier-schema';

function findButton(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    if (child.type === 'button') {
      return child as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
    }
    const nested = findButton((child.props as { children?: ReactNode }).children);
    if (nested) return nested;
  }
  return undefined;
}

const supplier = {
  id: 'supplier-1',
  businessName: 'GreenLeaf Fresh Foods',
  contactName: 'Meera Shah',
  phone: '+919876543210',
  whatsappNumber: '+919876543210',
  email: 'orders@greenleaf.example',
  addressLine: 'APMC Market, Vashi',
  city: 'Navi Mumbai',
  state: 'Maharashtra',
  pin: '400703',
  gstin: '27ABCDE1234F1Z5',
  notes: 'Morning delivery before 8:00 AM',
  relationshipType: 'CURRENT' as const,
  verificationStatus: 'VERIFIED' as const,
  isActive: true,
  createdAt: '2026-08-28T08:00:00.000Z',
  updatedAt: '2026-08-28T08:00:00.000Z',
};

describe('supplier workspace', () => {
  it('explains supplier categories in plain language and offers every category tier', () => {
    const html = renderToStaticMarkup(
      <SupplierCapabilityFields
        capabilities={{
          v: 1,
          categories: [
            { category: 'VEGETABLES', tier: 'PREFERRED', rank: 1 },
            { category: 'READY_MADE_OUTSOURCED', tier: 'BACKUP', rank: 1 },
          ],
          items: [],
        }}
        disabled={false}
        error=""
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('What they supply');
    expect(html).toContain('Select every category they supply');
    expect(html).toContain('Vegetables');
    expect(html).toContain('Coffee and Tea');
    expect(html).toContain('Ready made and Outsourced');
    expect(html).toContain('Preferred');
    expect(html).toContain('Can supply');
    expect(html).toContain('Backup');
    expect(html).toContain('aria-label="Vegetables supplier level"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(22);
    expect(html).not.toContain('Ready-made');
  });

  it('changes one category tier while keeping existing item preferences', () => {
    const items = [{
      itemKey: 'tomato',
      itemName: 'Tomato',
      tier: 'PREFERRED' as const,
      rank: 1,
    }];
    const initial = {
      v: 1 as const,
      categories: [
        { category: 'DAIRY' as const, tier: 'CAPABLE' as const, rank: 1 },
      ],
      items,
    };

    const added = setSupplierCategoryTier(initial, 'VEGETABLES', 'PREFERRED');
    const moved = setSupplierCategoryTier(added, 'DAIRY', 'BACKUP');
    const removed = setSupplierCategoryTier(moved, 'VEGETABLES', null);

    expect(added.items).toBe(items);
    expect(added.categories).toEqual([
      { category: 'VEGETABLES', tier: 'PREFERRED', rank: 1 },
      { category: 'DAIRY', tier: 'CAPABLE', rank: 1 },
    ]);
    expect(moved.categories).toEqual([
      { category: 'VEGETABLES', tier: 'PREFERRED', rank: 1 },
      { category: 'DAIRY', tier: 'BACKUP', rank: 1 },
    ]);
    expect(removed.categories).toEqual([
      { category: 'DAIRY', tier: 'BACKUP', rank: 1 },
    ]);
  });

  it('sends the capability document in the existing supplier request shape', () => {
    const payload = cleanSupplierDraft({
      businessName: '  GreenLeaf Fresh Foods  ',
      contactName: '',
      phone: '',
      whatsappNumber: '',
      email: '',
      addressLine: '',
      city: '  Navi Mumbai ',
      state: 'Maharashtra',
      pin: '',
      gstin: '',
      notes: '',
      isActive: true,
      capabilities: {
        v: 1,
        categories: [
          { category: 'VEGETABLES', tier: 'PREFERRED', rank: 1 },
        ],
        items: [],
      },
    });

    expect(validateSupplierUpdateInput(payload)).toMatchObject({
      businessName: 'GreenLeaf Fresh Foods',
      city: 'Navi Mumbai',
      capabilities: {
        v: 1,
        categories: [
          { category: 'VEGETABLES', tier: 'PREFERRED', rank: 1 },
        ],
        items: [],
      },
    });
  });

  it('uses plain language, real supplier details, and accessible actions', () => {
    const html = renderToStaticMarkup(
      <SupplierWorkspace
        initialSuppliers={[supplier]}
        initialError=""
      />,
    );

    expect(html).toContain('People you buy from');
    expect(html).toContain('Suppliers');
    expect(html).toContain('Keep the suppliers you already use and what each one can supply in one place.');
    expect(html).toContain('Your restaurant data is private from other restaurants. Each supplier can see requests you send them, their own orders and delivery checks, and estimates you explicitly share with them. Your recipes, menus and other suppliers’ prices are not shared.');
    expect(html).toContain('aria-label="Restaurant data privacy"');
    expect(html).toContain('GreenLeaf Fresh Foods');
    expect(html).toContain('Navi Mumbai');
    expect(html).toContain('Add supplier');
    expect(html).toContain('Import CSV');
    expect(html).toContain('Export CSV');
    expect(html).toContain('Search by name, phone, email, city or GSTIN');
    expect(html).toContain('aria-label="Edit GreenLeaf Fresh Foods"');
    expect(html).toContain('Active');
    expect(html).not.toContain('Verified');
    expect(html).not.toContain('AutoRFP');
    expect(html).not.toContain('violet');
  });

  it('renders a useful empty state with one clear next action', () => {
    const html = renderToStaticMarkup(
      <SupplierWorkspace initialSuppliers={[]} initialError="" />,
    );

    expect(html).toContain('Add your first supplier');
    expect(html).toContain('No supplier account is needed');
  });

  it('shows pending supplier applications with clear review actions', () => {
    const html = renderToStaticMarkup(
      <SupplierWorkspace
        initialSuppliers={[{
          ...supplier,
          id: 'supplier-applicant',
          businessName: 'Mumbai Fresh Basket',
          relationshipType: 'APPLICANT',
          verificationStatus: 'PENDING',
          isActive: false,
        }]}
        initialError=""
      />,
    );

    expect(html).toContain('Mumbai Fresh Basket');
    expect(html).toContain('Needs review');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
    expect(html).toContain('All suppliers and applications');
    expect(html).not.toContain('aria-label="Edit Mumbai Fresh Basket"');
  });

  it('keeps load failures recoverable', () => {
    const html = renderToStaticMarkup(
      <SupplierWorkspace
        initialSuppliers={[]}
        initialError="We could not load suppliers."
      />,
    );

    expect(html).toContain('We could not load suppliers.');
    expect(html).toContain('Your saved restaurant records are unchanged.');
    expect(html).toContain('Try again');
  });

  it('offers list reload only for supplier list load errors', () => {
    const loadHtml = renderToStaticMarkup(
      <SupplierErrorBanner
        error={{ kind: 'load', message: 'We could not load suppliers.' }}
        onReload={jest.fn()}
      />,
    );
    const operationHtml = renderToStaticMarkup(
      <SupplierErrorBanner
        error={{ kind: 'operation', message: 'We could not export suppliers.' }}
        onReload={jest.fn()}
      />,
    );

    expect(loadHtml).toContain('Try again');
    expect(loadHtml).toContain('Your saved restaurant records are unchanged.');
    expect(operationHtml).toContain('We could not export suppliers.');
    expect(operationHtml).not.toContain('Try again');
    expect(operationHtml).not.toContain('Your saved restaurant records are unchanged.');
  });

  it('retries a supplier-detail load for that supplier only', () => {
    const retry = jest.fn();
    const element = SupplierDetailError({
      error: { kind: 'load', message: 'We could not load this supplier.' },
      supplier,
      onRetry: retry,
    });
    const html = renderToStaticMarkup(element);
    const button = findButton(element);

    expect(html).toContain('Try again');
    expect(button).toBeDefined();
    button?.props.onClick?.();
    expect(retry).toHaveBeenCalledWith(supplier);
  });

  it('keeps the supplier privacy reassurance visible in responsive layouts', () => {
    const html = renderToStaticMarkup(
      <SupplierWorkspace initialSuppliers={[]} initialError="" />,
    );
    const css = readFileSync(
      path.resolve(__dirname, '../../src/components/suppliers/supplier-workspace.module.css'),
      'utf8',
    );

    expect(html).toContain('aria-label="Restaurant data privacy"');
    expect(css).not.toMatch(/[^{}]*\.notice[^{}]*\{[^}]*display\s*:\s*none/);
  });

  it('uses the task-led browser title', () => {
    const page = readFileSync(
      path.resolve(__dirname, '../../src/app/(app)/suppliers/page.tsx'),
      'utf8',
    );

    expect(page).toContain("metadata = { title: 'Suppliers' };");
    expect(page).not.toContain('Suppliers · QuotePlate');
  });

  it('offers the next real API page when a cursor is available', () => {
    const Workspace = SupplierWorkspace as unknown as React.ComponentType<Record<string, unknown>>;
    const html = renderToStaticMarkup(
      <Workspace initialSuppliers={[]} initialError="" initialNextCursor="supplier-page-2" />,
    );

    expect(html).toContain('Load more suppliers');
  });
});
