import { POST } from '@/app/api/awards/[id]/receiving/route';
import {
  recordDeliveryCheck,
  ReceivingConflictError,
  ReceivingNotFoundError,
  ReceivingSupplierError,
} from '@/lib/receiving/receiving-service';
import { validateReceivingInput, ReceivingValidationError } from '@/lib/receiving/receiving-document';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('@/lib/receiving/receiving-service', () => ({
  recordDeliveryCheck: jest.fn(),
  RECEIVING_BODY_BYTES: jest.requireActual('@/lib/receiving/receiving-service').RECEIVING_BODY_BYTES,
  ReceivingNotFoundError: jest.requireActual('@/lib/receiving/receiving-service').ReceivingNotFoundError,
  ReceivingSupplierError: jest.requireActual('@/lib/receiving/receiving-service').ReceivingSupplierError,
  ReceivingConflictError: jest.requireActual('@/lib/receiving/receiving-service').ReceivingConflictError,
}));

const account = { tenant: { id: 'tenant-a' }, user: { id: 'member-a' } };
const context = { params: Promise.resolve({ id: 'award-a' }) };
const body = {
  supplierId: 'supplier-a', outcome: 'MATCHED', invoiceTotalPaise: '105000',
  issueCodes: [], note: null, expectedCheckedAt: null,
};

function request(value: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/awards/award-a/receiving', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-origin', ...headers,
    },
    body: JSON.stringify(value),
  });
}

describe('receiving route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAccountContext).mockResolvedValue(account as never);
  });

  it('uses account tenancy and returns a private saved delivery check', async () => {
    jest.mocked(recordDeliveryCheck).mockResolvedValue({
      ...body, expectedTotalPaise: '105000', differencePaise: '0',
      checkedAt: '2026-09-04T10:20:30.000Z', hasProblem: false,
    } as never);

    const response = await POST(request(body), context as never);

    expect(recordDeliveryCheck).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' }, awardId: 'award-a', check: body,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('returns safe authentication, validation, missing, and supplier errors', async () => {
    jest.mocked(requireAccountContext).mockResolvedValueOnce(null);
    expect((await POST(request(body), context as never)).status).toBe(401);

    jest.mocked(recordDeliveryCheck)
      .mockRejectedValueOnce(new ReceivingValidationError())
      .mockRejectedValueOnce(new ReceivingNotFoundError())
      .mockRejectedValueOnce(new ReceivingSupplierError())
      .mockRejectedValueOnce(new ReceivingConflictError());
    expect((await POST(request(body), context as never)).status).toBe(422);
    expect((await POST(request(body), context as never)).status).toBe(404);
    expect((await POST(request(body), context as never)).status).toBe(409);
    expect((await POST(request(body), context as never)).status).toBe(409);
  });

  it('rejects cross origin, non JSON, invalid JSON, and oversized bodies before saving', async () => {
    const crossOrigin = request(body, { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' });
    const form = new Request('http://localhost/api/awards/award-a/receiving', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x=1',
    });
    const invalid = new Request('http://localhost/api/awards/award-a/receiving', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    const oversized = new Request('http://localhost/api/awards/award-a/receiving', {
      method: 'POST', headers: {
        'Content-Type': 'application/json', 'Content-Length': String(128 * 1024 + 1),
      }, body: '{}',
    });

    expect((await POST(crossOrigin, context as never)).status).toBe(403);
    expect((await POST(form, context as never)).status).toBe(415);
    expect((await POST(invalid, context as never)).status).toBe(400);
    expect((await POST(oversized, context as never)).status).toBe(413);
    expect(recordDeliveryCheck).not.toHaveBeenCalled();
  });
});


it('passes detailed receiving through the tenant-bound route and reports exact validation failures', async () => {
  jest.mocked(requireAccountContext).mockResolvedValue(account as never);
  jest.mocked(recordDeliveryCheck).mockImplementation(async input => {
    const parsed = validateReceivingInput(input.check);
    return { ...parsed, expectedTotalPaise: '105000', differencePaise: '0', checkedAt: '2026-09-05T10:00:00.000Z', hasProblem: true };
  });
  const details = { items: [{ requestItemId: 'tomato', receivedQuantity: '5', rejectedQuantity: '1', billedQuantity: '10', billedUnitRatePaise: '10000' }], actualDeliveryDate: '2026-09-05', creditClaimedPaise: '60000', creditReceivedPaise: '10000', settlementNote: 'Awaiting credit note' };
  const response = await POST(request({ ...body, details }), context);
  expect(response.status).toBe(200);
  expect((await response.json()).check.details).toEqual(details);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await POST(request({ ...body, details: { ...details, creditReceivedPaise: '60001' } }), context)).status).toBe(422);
  expect((await POST(request({ ...body, tenantId: 'other', details }), context)).status).toBe(422);
});
