import { getServerSession } from 'next-auth';
import { AuthorizationError } from '@/lib/auth/guards';
import { GET as listRequests, POST as createRequest } from '@/app/api/requests/route';
import {
  GET as getRequest,
  PATCH as updateRequest,
} from '@/app/api/requests/[id]/route';
import { POST as openRequest } from '@/app/api/requests/[id]/open/route';
import { POST as changeLink } from '@/app/api/requests/[id]/links/route';
import {
  changeSupplierRequestLink,
  createProcurementRequestDraft,
  getProcurementRequest,
  listProcurementRequests,
  openProcurementRequest,
  ProcurementRequestConflictError,
  ProcurementRequestNotFoundError,
  ProcurementRequestValidationError,
  updateProcurementRequestDraft,
} from '@/lib/procurement/request-service';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

jest.mock('@/lib/server-account', () => ({
  requireAccountContext: jest.fn(),
}));

jest.mock('@/lib/procurement/request-service', () => ({
  changeSupplierRequestLink: jest.fn(),
  createProcurementRequestDraft: jest.fn(),
  getProcurementRequest: jest.fn(),
  listProcurementRequests: jest.fn(),
  openProcurementRequest: jest.fn(),
  updateProcurementRequestDraft: jest.fn(),
  ProcurementRequestValidationError: jest.requireActual(
    '@/lib/procurement/request-service',
  ).ProcurementRequestValidationError,
  validateLinkActionInput: jest.requireActual(
    '@/lib/procurement/request-service',
  ).validateLinkActionInput,
  validateOpenRequestInput: jest.requireActual(
    '@/lib/procurement/request-service',
  ).validateOpenRequestInput,
  ProcurementRequestNotFoundError: jest.requireActual(
    '@/lib/procurement/request-service',
  ).ProcurementRequestNotFoundError,
  ProcurementRequestConflictError: jest.requireActual(
    '@/lib/procurement/request-service',
  ).ProcurementRequestConflictError,
}));

const account = {
  tenant: { id: 'tenant-a' },
  user: {
    id: 'member-a',
    tenantId: 'tenant-a',
    role: 'MEMBER',
    isActive: true,
  },
};

const draft = {
  title: 'Weekly vegetables — Indiranagar',
  menuId: 'menu-a',
  selectedItemIds: ['ingredient-a', 'ingredient-b'],
  defaultSourcing: {
    v: 1,
    modes: ['CURRENT', 'VERIFIED_NEW'],
    currentSupplierIds: ['supplier-a'],
    selectedNewSupplierIds: [],
    acceptVerifiedApplications: true,
  },
  sourcingOverrides: {
    'ingredient-b': {
      v: 1,
      modes: ['SELECTED_NEW'],
      currentSupplierIds: [],
      selectedNewSupplierIds: ['supplier-b'],
      acceptVerifiedApplications: false,
    },
  },
  deliveryDetails: {
    addressLine: '12, 100 Feet Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pin: '560038',
    instructions: 'Deliver before 8:00 AM at the service entrance.',
  },
  deliveryDate: '2027-01-10',
  quoteDeadline: '2027-01-09T10:00:00.000Z',
  commercialTerms: 'Rates should include packing. Payment in 15 days.',
};

const jsonRequest = (url: string, method: string, value: unknown) =>
  new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: new URL(url).origin,
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify(value),
  });

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

describe('procurement request API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getServerSession).mockResolvedValue({ user: { userId: 'member-a', tenantId: 'tenant-a' } } as never);
    jest.mocked(requireAccountContext).mockResolvedValue(account as never);
  });

  it('derives tenancy from the current account for bounded list and draft creation', async () => {
    jest.mocked(listProcurementRequests).mockResolvedValue({
      requests: [{ id: 'request-a' }],
      nextCursor: 'next-page',
    } as never);
    jest.mocked(createProcurementRequestDraft).mockResolvedValue({
      id: 'request-a',
      status: 'DRAFT',
    } as never);

    const listed = await listRequests(
      new Request('http://localhost/api/requests?limit=20&cursor=page-2'),
    );
    const created = await createRequest(
      jsonRequest('http://localhost/api/requests', 'POST', {
        ...draft,
        tenantId: 'tenant-b',
        status: 'OPEN',
        createdByUserId: 'owner-b',
      }),
    );

    expect(listProcurementRequests).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      cursor: 'page-2',
      limit: 20,
    });
    expect(createProcurementRequestDraft).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      draft: expect.objectContaining(draft),
    });
    expect(created.status).toBe(201);
    expect(listed.headers.get('cache-control')).toBe('private, no-store');
    expect(created.headers.get('cache-control')).toBe('private, no-store');
    await expect(listed.json()).resolves.toEqual({
      requests: [{ id: 'request-a' }],
      nextCursor: 'next-page',
    });
  });

  it('uses the service live-account check without a duplicate account transaction', async () => {
    jest.mocked(listProcurementRequests).mockResolvedValueOnce({ requests: [], nextCursor: null } as never);
    const response = await listRequests(new Request('http://localhost/api/requests'));
    expect(response.status).toBe(200);
    expect(requireAccountContext).not.toHaveBeenCalled();
  });

  it('denies a revoked account even with a signed session', async () => {
    jest.mocked(listProcurementRequests).mockRejectedValueOnce(new AuthorizationError());
    const response = await listRequests(new Request('http://localhost/api/requests'));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('loads and updates only the tenant request selected by the route', async () => {
    jest.mocked(getProcurementRequest).mockResolvedValue({ id: 'request-a' } as never);
    jest.mocked(updateProcurementRequestDraft).mockResolvedValue({
      id: 'request-a',
      version: 2,
    } as never);

    const loaded = await getRequest(
      new Request('http://localhost/api/requests/request-a'),
      routeContext('request-a') as never,
    );
    const updated = await updateRequest(
      jsonRequest('http://localhost/api/requests/request-a', 'PATCH', {
        expectedVersion: 1,
        title: 'Updated request',
        items: { v: 1, items: [] },
        sourcing: { v: 1, default: draft.defaultSourcing },
      }),
      routeContext('request-a') as never,
    );

    expect(getProcurementRequest).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
    });
    expect(updateProcurementRequestDraft).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
      expectedVersion: 1,
      patch: {
        title: 'Updated request',
        items: { v: 1, items: [] },
        sourcing: { v: 1, default: draft.defaultSourcing },
      },
    });
    expect(loaded.status).toBe(200);
    expect(updated.status).toBe(200);
    for (const response of [loaded, updated]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  it('opens atomically and returns each raw supplier share URL once', async () => {
    jest.mocked(openProcurementRequest).mockResolvedValue({
      request: { id: 'request-a', status: 'OPEN', version: 2 },
      links: [
        {
          supplierRequestId: 'supplier-request-a',
          supplierId: 'supplier-a',
          url: 'https://quoteplate.example/quote/raw-token',
          expiresAt: '2027-01-09T10:00:00.000Z',
        },
      ],
      applicationLink: {
        url: 'https://quoteplate.example/supplier-application#token=raw-application-token',
        expiresAt: '2027-01-09T10:00:00.000Z',
      },
    } as never);

    const response = await openRequest(
      jsonRequest('http://localhost/api/requests/request-a/open', 'POST', {
        expectedVersion: 1,
      }),
      routeContext('request-a') as never,
    );

    expect(openProcurementRequest).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      requestId: 'request-a',
      expectedVersion: 1,
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      request: { status: 'OPEN' },
      links: [{ supplierId: 'supplier-a' }],
      applicationLink: { url: expect.stringContaining('supplier-application') },
    });
  });

  it.each(['rotate', 'revoke'] as const)(
    '%ss one supplier link through an explicit versioned action',
    async (action) => {
      jest.mocked(changeSupplierRequestLink).mockResolvedValue({
        request: { id: 'request-a', version: 3 },
        supplierRequest: { id: 'supplier-request-a', revokedAt: null },
        ...(action === 'rotate'
          ? { link: { url: 'https://quoteplate.example/quote/new-token' } }
          : {}),
      } as never);

      const response = await changeLink(
        jsonRequest('http://localhost/api/requests/request-a/links', 'POST', {
          action,
          supplierRequestId: 'supplier-request-a',
          expectedVersion: 2,
        }),
        routeContext('request-a') as never,
      );

      expect(changeSupplierRequestLink).toHaveBeenCalledWith({
        actor: { tenantId: 'tenant-a', userId: 'member-a' },
        requestId: 'request-a',
        supplierRequestId: 'supplier-request-a',
        expectedVersion: 2,
        action,
      });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    },
  );

  it('rejects unknown open and link action fields instead of silently discarding them', async () => {
    jest.mocked(openProcurementRequest).mockResolvedValue({} as never);
    jest.mocked(changeSupplierRequestLink).mockResolvedValue({} as never);

    const openResponse = await openRequest(
      jsonRequest('http://localhost/api/requests/request-a/open', 'POST', {
        expectedVersion: 1,
        status: 'OPEN',
      }),
      routeContext('request-a') as never,
    );
    const linkResponse = await changeLink(
      jsonRequest('http://localhost/api/requests/request-a/links', 'POST', {
        action: 'rotate',
        supplierRequestId: 'supplier-request-a',
        expectedVersion: 2,
        tokenDigest: 'client-controlled',
      }),
      routeContext('request-a') as never,
    );

    expect(openResponse.status).toBe(422);
    expect(linkResponse.status).toBe(422);
    expect(openProcurementRequest).not.toHaveBeenCalled();
    expect(changeSupplierRequestLink).not.toHaveBeenCalled();
  });

  it('maps validation, missing, conflict, and unauthenticated failures safely', async () => {
    jest.mocked(createProcurementRequestDraft).mockRejectedValueOnce(
      new ProcurementRequestValidationError({
        quoteDeadline: ['Quote deadline must be before delivery.'],
      }),
    );
    jest.mocked(getProcurementRequest).mockRejectedValueOnce(
      new ProcurementRequestNotFoundError(),
    );
    jest.mocked(openProcurementRequest).mockRejectedValueOnce(
      new ProcurementRequestConflictError('Only a draft request can be opened.'),
    );

    const invalid = await createRequest(
      jsonRequest('http://localhost/api/requests', 'POST', draft),
    );
    const missing = await getRequest(
      new Request('http://localhost/api/requests/request-b'),
      routeContext('request-b') as never,
    );
    const conflict = await openRequest(
      jsonRequest('http://localhost/api/requests/request-a/open', 'POST', {
        expectedVersion: 1,
      }),
      routeContext('request-a') as never,
    );
    jest.mocked(getServerSession).mockResolvedValueOnce(null);
    const unauthorized = await listRequests(
      new Request('http://localhost/api/requests'),
    );

    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      title: 'Invalid procurement request',
      errors: {
        quoteDeadline: ['Quote deadline must be before delivery.'],
      },
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.not.toHaveProperty('tenantId');
    expect(conflict.status).toBe(409);
    expect(unauthorized.status).toBe(401);
    for (const response of [invalid, missing, conflict, unauthorized]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  it.each([
    ['create', (request: Request) => createRequest(request)],
    ['update', (request: Request) => updateRequest(request, routeContext('request-a') as never)],
    ['open', (request: Request) => openRequest(request, routeContext('request-a') as never)],
    ['link', (request: Request) => changeLink(request, routeContext('request-a') as never)],
  ])('rejects a cross-origin %s mutation before authentication or request work', async (operation, call) => {
    jest.mocked(requireAccountContext).mockClear();
    const suffix = operation === 'create' ? '' : operation === 'update' ? '/request-a' : `/request-a/${operation === 'link' ? 'links' : 'open'}`;
    const response = await call(new Request(`http://localhost/api/requests${suffix}`, {
      method: operation === 'update' ? 'PATCH' : 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(operation === 'create' ? draft : { expectedVersion: 1 }),
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(requireAccountContext).not.toHaveBeenCalled();
    expect(createProcurementRequestDraft).not.toHaveBeenCalled();
    expect(updateProcurementRequestDraft).not.toHaveBeenCalled();
    expect(openProcurementRequest).not.toHaveBeenCalled();
    expect(changeSupplierRequestLink).not.toHaveBeenCalled();
  });

  it('rejects non-JSON request writes before authentication', async () => {
    jest.mocked(requireAccountContext).mockClear();
    const response = await createRequest(new Request('http://localhost/api/requests', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'text/plain',
      },
      body: '{}',
    }));

    expect(response.status).toBe(415);
    expect(requireAccountContext).not.toHaveBeenCalled();
  });
});
