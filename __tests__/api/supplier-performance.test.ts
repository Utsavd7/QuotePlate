import { GET } from '@/app/api/supplier-performance/route';
import { getSupplierPerformance } from '@/lib/reporting/supplier-performance-service';
import { requireAccountContext } from '@/lib/server-account';
import { AuthorizationError } from '@/lib/auth/guards';

jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('@/lib/reporting/supplier-performance-service', () => ({ getSupplierPerformance: jest.fn() }));

describe('supplier performance API', () => {
  beforeEach(() => jest.resetAllMocks());
  it('requires authentication before reading supplier delivery evidence', async () => {
    jest.mocked(requireAccountContext).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(getSupplierPerformance).not.toHaveBeenCalled();
  });
  it('scopes the report to the active account and prevents shared caches', async () => {
    jest.mocked(requireAccountContext).mockResolvedValue({ tenant: { id: 'tenant-a' }, user: { id: 'user-a' } } as never);
    jest.mocked(getSupplierPerformance).mockResolvedValue({ suppliers: [], capped: false } as never);
    const response = await GET();
    expect(getSupplierPerformance).toHaveBeenCalledWith({ actor: { tenantId: 'tenant-a', userId: 'user-a' } });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ suppliers: [] });
  });
  it('rejects a deactivated account through the service authorization check', async () => {
    jest.mocked(requireAccountContext).mockResolvedValue({ tenant: { id: 'tenant-a' }, user: { id: 'user-a' } } as never);
    jest.mocked(getSupplierPerformance).mockRejectedValue(new AuthorizationError());
    expect((await GET()).status).toBe(403);
  });
});
