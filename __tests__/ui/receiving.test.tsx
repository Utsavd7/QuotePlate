import { renderToStaticMarkup } from 'react-dom/server';
import { DeliveryCheckPanel } from '@/components/procurement/DeliveryCheckPanel';

const supplier = { supplierId: 'a', supplierName: 'Foods', deliveryDate: '2026-09-04', expectedTotalPaise: '1000', check: null, items: [{ requestItemId: 'tomato', itemKey: 'tomato', itemName: 'Tomato', unit: 'KILOGRAM', orderedQuantity: '4', unitRatePaise: '250', gstBasisPoints: 0, taxInclusive: false }] };
it('renders usable allocated item inputs, cumulative semantics, actual date and settlement fields', () => {
  const html = renderToStaticMarkup(<DeliveryCheckPanel awardId="award" requestId="request" receiving={{ checkedCount: 0, totalCount: 1, complete: false, problemCount: 0, suppliers: [supplier] }} onSaved={() => {}} />);
  for (const label of ['Cumulative received', 'Cumulative rejected', 'Billed quantity', 'Billed rate', 'Actual delivery date', 'Credit claimed', 'Credit received', 'Settlement notes', 'Tomato', 'Ordered: 4']) expect(html).toContain(label);
  expect(html).toContain('including rejected');
});
it('offers an explicit item upgrade for legacy supplier checks', () => {
  const html = renderToStaticMarkup(<DeliveryCheckPanel awardId="award" requestId="request" receiving={{ checkedCount: 1, totalCount: 1, complete: true, problemCount: 0, suppliers: [{ ...supplier, check: { supplierId: 'a', outcome: 'MATCHED', invoiceTotalPaise: '1000', differencePaise: '0', issueCodes: [], note: null, checkedAt: '2026-09-05T10:00:00.000Z', hasProblem: false } }] }} onSaved={() => {}} />);
  expect(html).toContain('Add item details');
});

import React from 'react';
import { SupplierCheckForm } from '@/components/procurement/DeliveryCheckPanel';
import { workspaceMutationFetch } from '@/lib/client/workspace-prefetch';
jest.mock('@/lib/client/workspace-prefetch', () => ({ workspaceMutationFetch: jest.fn() }));

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
function interactiveForm() {
  const state: unknown[] = [];
  let cursor = 0;
  const hook = jest.spyOn(React, 'useState').mockImplementation(((initial: unknown) => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], (value: unknown) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  }) as never);
  const onSaved = jest.fn();
  function render() { cursor = 0; return SupplierCheckForm({ awardId: 'award', supplier, onSaved }); }
  function change(label: string, value: string) {
    const tree = elements(render());
    const fieldLabel = tree.find(e => e.type === 'label' && JSON.stringify(e.props.children).includes(label));
    const field = elements(fieldLabel).find(e => e.type === 'input' || e.type === 'textarea')!;
    (field.props.onChange as (e: unknown) => void)({ target: { value } });
  }
  async function submit() { const form = render(); await (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {} }); }
  return { render, change, submit, onSaved, cleanup: () => hook.mockRestore() };
}
it('submits exact cumulative counts and credit amounts and retains invalid edits', async () => {
  jest.mocked(workspaceMutationFetch).mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  const form = interactiveForm();
  try {
    form.change('Invoice total', '10');
    form.change('Cumulative received', '3');
    form.change('Cumulative rejected', '1');
    form.change('Credit claimed', '5');
    form.change('Credit received', '6');
    await form.submit();
    expect(workspaceMutationFetch).not.toHaveBeenCalled();
    form.change('Credit received', '2');
    form.change('Actual delivery date', '2026-09-05');
    await form.submit();
    expect(form.onSaved).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(jest.mocked(workspaceMutationFetch).mock.calls[0][1]!.body as string);
    expect(payload).toMatchObject({ expectedCheckedAt: null, details: { actualDeliveryDate: '2026-09-05', creditClaimedPaise: '500', creditReceivedPaise: '200', items: [{ receivedQuantity: '3', rejectedQuantity: '1', billedQuantity: null, billedUnitRatePaise: null }] } });
  } finally { form.cleanup(); }
});
it('keeps entered counts and displays the server conflict on a failed save', async () => {
  jest.mocked(workspaceMutationFetch).mockReset().mockResolvedValue(new Response(JSON.stringify({ detail: 'Refresh before saving again.' }), { status: 409 }));
  const form = interactiveForm();
  try {
    form.change('Invoice total', '10'); form.change('Cumulative received', '3');
    await form.submit();
    expect(form.onSaved).not.toHaveBeenCalled();
    expect(JSON.stringify(form.render())).toContain('Refresh before saving again.');
    expect(elements(form.render()).some(e => e.type === 'input' && e.props.value === '3')).toBe(true);
  } finally { form.cleanup(); }
});
