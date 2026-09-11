import {
  GET as listSupplierRoute,
  POST as createSupplierRoute,
} from '@/app/api/suppliers/route';
import {
  DELETE as deactivateSupplierRoute,
  GET as getSupplierRoute,
  PUT as updateSupplierRoute,
} from '@/app/api/suppliers/[id]/route';
import { POST as verifySupplierRoute } from '@/app/api/suppliers/[id]/verify/route';
import { GET as exportSupplierRoute } from '@/app/api/suppliers/export/route';
import { POST as importSupplierRoute } from '@/app/api/suppliers/import/route';
import {
  createSupplier,
  decideSupplierVerification,
  deactivateSupplier,
  getSupplier,
  importSupplierRows,
  listSuppliers,
  listSuppliersForExport,
  SupplierConflictError,
  SupplierNotFoundError,
  SupplierVerificationConflictError,
  updateSupplier,
} from '@/lib/suppliers/supplier-service';
import { SupplierValidationError } from '@/lib/suppliers/supplier-schema';
import { requireAccountContext } from '@/lib/server-account';
import { getServerSession } from 'next-auth';
import { AuthorizationError } from '@/lib/auth/guards';
import { validateSupplierCapabilities } from '@/lib/suppliers/supplier-capabilities';
import { SUPPLIER_REQUEST_BODY_BYTES } from '@/lib/suppliers/supplier-http';

jest.mock('@/lib/server-account', () => ({
  requireAccountContext: jest.fn(),
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));

jest.mock('@/lib/suppliers/supplier-service', () => ({
  createSupplier: jest.fn(),
  decideSupplierVerification: jest.fn(),
  deactivateSupplier: jest.fn(),
  getSupplier: jest.fn(),
  importSupplierRows: jest.fn(),
  listSuppliers: jest.fn(),
  listSuppliersForExport: jest.fn(),
  updateSupplier: jest.fn(),
  SupplierConflictError: jest.requireActual('@/lib/suppliers/supplier-service')
    .SupplierConflictError,
  SupplierNotFoundError: jest.requireActual('@/lib/suppliers/supplier-service')
    .SupplierNotFoundError,
  SupplierVerificationConflictError: jest.requireActual('@/lib/suppliers/supplier-service')
    .SupplierVerificationConflictError,
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

const body = {
  businessName: 'Shree Balaji Fresh Produce',
  contactName: 'Mehul Shah',
  phone: '9876543210',
  email: 'sales@balajifresh.in',
  city: 'Navi Mumbai',
  state: 'Maharashtra',
  pin: '400705',
  gstin: '27AAPFU0939F1ZV',
};

const jsonRequest = (url: string, method: string, value: unknown) =>
  new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      Origin: new URL(url).origin,
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify(value),
  });

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

describe('tenant supplier API', () => {
  beforeEach(() => {
    jest.mocked(getServerSession).mockReset();
    jest.mocked(getServerSession).mockResolvedValue({ user: { userId: 'member-a', tenantId: 'tenant-a' } });
    jest.mocked(requireAccountContext).mockReset();
    jest.mocked(requireAccountContext).mockResolvedValue(account as never);
    for (const fn of [
      createSupplier,
      decideSupplierVerification,
      deactivateSupplier,
      getSupplier,
      importSupplierRows,
      listSuppliers,
      listSuppliersForExport,
      updateSupplier,
    ]) {
      jest.mocked(fn).mockReset();
    }
  });

  it('authorizes list reads in the service without a duplicate account transaction', async () => {
    jest.mocked(listSuppliers).mockResolvedValue({ suppliers: [], nextCursor: null } as never);
    expect((await listSupplierRoute(new Request('http://localhost/api/suppliers'))).status).toBe(200);
    expect(requireAccountContext).not.toHaveBeenCalled();
    jest.mocked(listSuppliers).mockRejectedValueOnce(new AuthorizationError());
    expect((await listSupplierRoute(new Request('http://localhost/api/suppliers'))).status).toBe(403);
  });

  it('creates and lists through the authenticated actor without trusting client tenancy', async () => {
    jest.mocked(createSupplier).mockResolvedValue({ id: 'supplier-a' } as never);
    jest.mocked(listSuppliers).mockResolvedValue({
      suppliers: [{ id: 'supplier-a' }],
      nextCursor: 'next-page',
    } as never);

    const created = await createSupplierRoute(
      jsonRequest('http://localhost/api/suppliers', 'POST', {
        ...body,
        tenantId: 'tenant-b',
        verifiedAt: '2026-08-27T00:00:00.000Z',
      }),
    );
    const listed = await listSupplierRoute(
      new Request(
        'http://localhost/api/suppliers?active=all&search=produce&limit=20&cursor=before',
      ),
    );

    expect(created.status).toBe(201);
    expect(createSupplier).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      supplier: expect.objectContaining(body),
    });
    expect(listSuppliers).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      active: 'all',
      search: 'produce',
      limit: '20',
      cursor: 'before',
    });
    await expect(listed.json()).resolves.toEqual({
      suppliers: [{ id: 'supplier-a' }],
      nextCursor: 'next-page',
    });
  });

  it('gets, edits, and deactivates one tenant supplier', async () => {
    jest.mocked(getSupplier).mockResolvedValue({ id: 'supplier-a' } as never);
    jest.mocked(updateSupplier).mockResolvedValue({
      id: 'supplier-a',
      businessName: 'Updated',
    } as never);
    jest.mocked(deactivateSupplier).mockResolvedValue({
      id: 'supplier-a',
      isActive: false,
    } as never);

    const loaded = await getSupplierRoute(
      new Request('http://localhost/api/suppliers/supplier-a'),
      routeContext('supplier-a') as never,
    );
    const edited = await updateSupplierRoute(
      jsonRequest('http://localhost/api/suppliers/supplier-a', 'PUT', {
        businessName: 'Updated',
      }),
      routeContext('supplier-a') as never,
    );
    const deactivated = await deactivateSupplierRoute(
      new Request('http://localhost/api/suppliers/supplier-a', {
        method: 'DELETE',
        headers: {
          Origin: 'http://localhost',
          'Sec-Fetch-Site': 'same-origin',
        },
      }),
      routeContext('supplier-a') as never,
    );

    expect(loaded.status).toBe(200);
    expect(edited.status).toBe(200);
    expect(deactivated.status).toBe(200);
    expect(getSupplier).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      supplierId: 'supplier-a',
    });
    expect(updateSupplier).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      supplierId: 'supplier-a',
      changes: { businessName: 'Updated' },
    });
    expect(deactivateSupplier).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      supplierId: 'supplier-a',
    });
  });

  it('submits an owner verification decision and maps repeat decisions safely', async () => {
    jest.mocked(decideSupplierVerification).mockResolvedValue({
      supplier: { id: 'supplier-a', verificationStatus: 'VERIFIED' },
      supplierRequest: { id: 'supplier-request-a' },
      link: {
        url: 'https://quoteplate.example/quote#token=one-time-token',
        expiresAt: '2027-01-09T09:00:00.000Z',
      },
    } as never);
    const approved = await verifySupplierRoute(
      jsonRequest('http://localhost/api/suppliers/supplier-a/verify', 'POST', {
        decision: 'APPROVE',
      }),
      routeContext('supplier-a') as never,
    );
    expect(approved.status).toBe(200);
    expect(approved.headers.get('cache-control')).toBe('private, no-store');
    await expect(approved.json()).resolves.toEqual({
      supplier: { id: 'supplier-a', verificationStatus: 'VERIFIED' },
      supplierRequest: { id: 'supplier-request-a' },
      link: {
        url: 'https://quoteplate.example/quote#token=one-time-token',
        expiresAt: '2027-01-09T09:00:00.000Z',
      },
    });
    expect(decideSupplierVerification).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      supplierId: 'supplier-a',
      decision: 'APPROVE',
    });

    jest.mocked(decideSupplierVerification).mockRejectedValue(
      new SupplierVerificationConflictError(),
    );
    const repeated = await verifySupplierRoute(
      jsonRequest('http://localhost/api/suppliers/supplier-a/verify', 'POST', {
        decision: 'REJECT',
      }),
      routeContext('supplier-a') as never,
    );
    expect(repeated.status).toBe(409);
    await expect(repeated.json()).resolves.not.toHaveProperty('capabilities');
  });

  it('maps validation, duplicate, and cross-tenant absence to safe problem responses', async () => {
    jest.mocked(createSupplier).mockRejectedValue(
      new SupplierValidationError({ businessName: ['Business name is required.'] }),
    );
    jest.mocked(updateSupplier).mockRejectedValue(
      new SupplierConflictError({ email: ['Email already belongs to another supplier.'] }),
    );
    jest.mocked(getSupplier).mockRejectedValue(new SupplierNotFoundError());

    const invalid = await createSupplierRoute(
      jsonRequest('http://localhost/api/suppliers', 'POST', { businessName: '' }),
    );
    const conflict = await updateSupplierRoute(
      jsonRequest('http://localhost/api/suppliers/supplier-a', 'PUT', {
        email: 'duplicate@example.in',
      }),
      routeContext('supplier-a') as never,
    );
    const absent = await getSupplierRoute(
      new Request('http://localhost/api/suppliers/private-b'),
      routeContext('private-b') as never,
    );

    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      title: 'Invalid supplier',
      errors: { businessName: ['Business name is required.'] },
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      errors: { email: expect.any(Array) },
    });
    expect(absent.status).toBe(404);
    await expect(absent.json()).resolves.not.toHaveProperty('tenantId');
  });

  it('maps a malformed opaque list cursor to the controlled 422 response', async () => {
    jest.mocked(listSuppliers).mockRejectedValue(
      new SupplierValidationError({ cursor: ['Cursor is invalid or expired.'] }),
    );

    const response = await listSupplierRoute(
      new Request('http://localhost/api/suppliers?cursor=forged'),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      title: 'Invalid supplier',
      errors: { cursor: ['Cursor is invalid or expired.'] },
    });
  });

  it('rejects malformed and oversized JSON before calling services', async () => {
    const malformed = await createSupplierRoute(
      new Request('http://localhost/api/suppliers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
    );
    const oversized = await updateSupplierRoute(
      jsonRequest('http://localhost/api/suppliers/supplier-a', 'PUT', {
        notes: 'x'.repeat(140_000),
      }),
      routeContext('supplier-a') as never,
    );

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(createSupplier).not.toHaveBeenCalled();
    expect(updateSupplier).not.toHaveBeenCalled();
  });

  it('admits a boundary-valid 64 KiB capability document inside its JSON envelope', async () => {
    const capabilities = validateSupplierCapabilities({
      v: 1,
      categories: [],
      items: Array.from({ length: 250 }, (_, index) => ({
        itemKey: `item-${String(index + 1).padStart(3, '0')}-${'x'.repeat(68)}`,
        itemName: 'N'.repeat(114),
        tier: 'PREFERRED',
        rank: index + 1,
      })),
    });
    const value = {
      businessName: 'B'.repeat(160),
      contactName: 'C'.repeat(120),
      email: `${'e'.repeat(300)}@x.co`,
      addressLine: 'A'.repeat(320),
      city: 'C'.repeat(100),
      state: 'S'.repeat(100),
      notes: 'N'.repeat(2_000),
      capabilities,
    };
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    expect(bytes).toBeGreaterThan(64 * 1_024);
    expect(bytes).toBeLessThanOrEqual(SUPPLIER_REQUEST_BODY_BYTES);
    jest.mocked(createSupplier).mockResolvedValue({ id: 'supplier-boundary' } as never);

    const response = await createSupplierRoute(
      jsonRequest('http://localhost/api/suppliers', 'POST', value),
    );
    expect(response.status).toBe(201);
    expect(createSupplier).toHaveBeenCalledWith(expect.objectContaining({ supplier: value }));
  });

  it('imports parsed rows transactionally and never passes raw CSV to persistence', async () => {
    jest.mocked(importSupplierRows).mockResolvedValue({ importedCount: 1 });
    const csv = [
      'business_name,contact_name,phone,email,city,state,pin,gstin',
      'Shree Balaji Fresh Produce,Mehul Shah,9876543210,sales@balajifresh.in,Navi Mumbai,Maharashtra,400705,27AAPFU0939F1ZV',
    ].join('\n');

    const response = await importSupplierRoute(
      new Request('http://localhost/api/suppliers/import', {
        method: 'POST',
        headers: {
          'content-type': 'text/csv',
          Origin: 'http://localhost',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: csv,
      }),
    );

    expect(response.status).toBe(201);
    expect(importSupplierRows).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      rows: [
        expect.objectContaining({
          row: 2,
          supplier: expect.objectContaining({
            businessName: 'Shree Balaji Fresh Produce',
            phone: '+919876543210',
            email: 'sales@balajifresh.in',
          }),
        }),
      ],
    });
    expect(importSupplierRows).not.toHaveBeenCalledWith(
      expect.objectContaining({ csv: expect.any(String) }),
    );
  });

  it('returns bounded row errors and rejects unsupported or oversized CSV bodies', async () => {
    const invalid = await importSupplierRoute(
      new Request('http://localhost/api/suppliers/import', {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: 'business_name,email\n,not-an-email',
      }),
    );
    const unsupported = await importSupplierRoute(
      new Request('http://localhost/api/suppliers/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    const oversized = await importSupplierRoute(
      new Request('http://localhost/api/suppliers/import', {
        method: 'POST',
        headers: {
          'content-type': 'text/csv',
          'content-length': String(1_048_577),
        },
        body: 'small',
      }),
    );

    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      errorCount: 2,
      errors: expect.any(Array),
    });
    expect(unsupported.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(importSupplierRows).not.toHaveBeenCalled();
  });

  it.each([
    ['create JSON', () => createSupplierRoute(new Request('http://localhost/api/suppliers', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }))],
    ['update JSON', () => updateSupplierRoute(new Request('http://localhost/api/suppliers/supplier-a', {
      method: 'PUT',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }), routeContext('supplier-a') as never)],
    ['bodyless deactivate', () => deactivateSupplierRoute(new Request('http://localhost/api/suppliers/supplier-a', {
      method: 'DELETE',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
      },
    }), routeContext('supplier-a') as never)],
    ['CSV import', () => importSupplierRoute(new Request('http://localhost/api/suppliers/import', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'text/csv',
      },
      body: 'business_name\nVendor',
    }))],
    ['verification', () => verifySupplierRoute(new Request('http://localhost/api/suppliers/supplier-a/verify', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ decision: 'APPROVE' }),
    }), routeContext('supplier-a') as never)],
  ])('rejects cross-origin %s before authentication or supplier work', async (_label, call) => {
    jest.mocked(requireAccountContext).mockClear();
    const response = await call();

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(requireAccountContext).not.toHaveBeenCalled();
    expect(createSupplier).not.toHaveBeenCalled();
    expect(updateSupplier).not.toHaveBeenCalled();
    expect(deactivateSupplier).not.toHaveBeenCalled();
    expect(importSupplierRows).not.toHaveBeenCalled();
    expect(decideSupplierVerification).not.toHaveBeenCalled();
  });

  it('rejects non-JSON supplier writes before authentication', async () => {
    jest.mocked(requireAccountContext).mockClear();
    const response = await createSupplierRoute(new Request('http://localhost/api/suppliers', {
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

  it('exports one bounded page with private download headers and a continuation cursor', async () => {
    jest.mocked(listSuppliersForExport).mockResolvedValue({
      suppliers: [
        {
          businessName: '=Formula Produce',
          contactName: 'Sales',
          phone: '+919876543210',
          whatsappNumber: null,
          email: 'sales@example.in',
          addressLine: null,
          city: 'Mumbai',
          state: 'Maharashtra',
          pin: '400001',
          gstin: null,
          notes: null,
          isActive: true,
          relationshipType: 'CURRENT',
          capabilities: { v: 1, categories: [], items: [] },
        },
      ],
      nextCursor: 'next-export-page',
    } as never);

    const response = await exportSupplierRoute(
      new Request(
        'http://localhost/api/suppliers/export?active=all&search=produce&limit=500&cursor=before',
      ),
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="quoteplate-suppliers.csv"',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-next-cursor')).toBe('next-export-page');
    expect(csv).toContain(`"'=Formula Produce"`);
    expect(listSuppliersForExport).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
      active: 'all',
      search: 'produce',
      limit: '500',
      cursor: 'before',
    });
  });

  it('rejects every supplier endpoint before reading data when unauthenticated', async () => {
    jest.mocked(getServerSession).mockResolvedValue(null);
    jest.mocked(requireAccountContext).mockResolvedValue(null);
    const responses = await Promise.all([
      listSupplierRoute(new Request('http://localhost/api/suppliers')),
      createSupplierRoute(jsonRequest('http://localhost/api/suppliers', 'POST', body)),
      getSupplierRoute(
        new Request('http://localhost/api/suppliers/supplier-a'),
        routeContext('supplier-a') as never,
      ),
      updateSupplierRoute(
        jsonRequest('http://localhost/api/suppliers/supplier-a', 'PUT', body),
        routeContext('supplier-a') as never,
      ),
      deactivateSupplierRoute(
        new Request('http://localhost/api/suppliers/supplier-a', { method: 'DELETE' }),
        routeContext('supplier-a') as never,
      ),
      importSupplierRoute(
        new Request('http://localhost/api/suppliers/import', {
          method: 'POST',
          headers: { 'content-type': 'text/csv' },
          body: 'business_name\nVendor',
        }),
      ),
      exportSupplierRoute(new Request('http://localhost/api/suppliers/export')),
      verifySupplierRoute(
        jsonRequest('http://localhost/api/suppliers/supplier-a/verify', 'POST', {
          decision: 'APPROVE',
        }),
        routeContext('supplier-a') as never,
      ),
    ]);

    expect(responses.every(({ status }) => status === 401)).toBe(true);
    expect(responses.every((response) =>
      response.headers.get('cache-control') === 'private, no-store')).toBe(true);
    expect(listSuppliers).not.toHaveBeenCalled();
    expect(importSupplierRows).not.toHaveBeenCalled();
  });
});
