import { GET as historyRoute } from '@/app/api/history/route';
import { getServerSession } from 'next-auth';
import { GET as insightsRoute } from '@/app/api/insights/route';
import {
  getFactualInsights,
  listProcurementHistory,
  ReportingValidationError,
} from '@/lib/reporting/reporting-service';
import { requireAccountContext } from '@/lib/server-account';
import { AuthorizationError } from '@/lib/auth/guards';

jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/reporting/reporting-service', () => ({
  getFactualInsights: jest.fn(),
  listProcurementHistory: jest.fn(),
  ReportingValidationError: jest.requireActual('@/lib/reporting/reporting-service').ReportingValidationError,
}));

const account = {
  tenant: { id: 'tenant-a' },
  user: { id: 'user-a', tenantId: 'tenant-a', role: 'MEMBER', isActive: true },
};

describe('reporting API', () => {
  beforeEach(() => {
    jest.mocked(getServerSession).mockReset();
    jest.mocked(getServerSession).mockResolvedValue({ user: { tenantId: 'tenant-a', userId: 'user-a' } });
    jest.mocked(requireAccountContext).mockReset();
    jest.mocked(getFactualInsights).mockReset();
    jest.mocked(listProcurementHistory).mockReset();
    jest.mocked(requireAccountContext).mockResolvedValue(account as never);
  });

  it('returns only actor-scoped factual insights with private response headers', async () => {
    jest.mocked(getFactualInsights).mockResolvedValue({ summary: { requestSampleSize: 4 } } as never);
    const response = await insightsRoute();
    expect(getFactualInsights).toHaveBeenCalledWith({ actor: { tenantId: 'tenant-a', userId: 'user-a' } });
    expect(response.status).toBe(200);
    expect(requireAccountContext).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    await expect(response.json()).resolves.toEqual({ summary: { requestSampleSize: 4 } });
  });

  it('passes bounded history pagination without accepting client tenancy', async () => {
    jest.mocked(listProcurementHistory).mockResolvedValue({ requests: [], nextCursor: null } as never);
    const response = await historyRoute(new Request('http://localhost/api/history?limit=20&cursor=opaque&tenantId=tenant-b'));
    expect(listProcurementHistory).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'user-a' },
      limit: 20,
      cursor: 'opaque',
    });
    expect(response.status).toBe(200);
  });

  it('rejects unauthenticated reporting before service access and maps bounded validation errors', async () => {
    jest.mocked(getServerSession).mockResolvedValueOnce(null);
    jest.mocked(requireAccountContext).mockResolvedValueOnce(null);
    const unauthorized = await insightsRoute();
    expect(unauthorized.status).toBe(401);
    expect(getFactualInsights).not.toHaveBeenCalled();

    jest.mocked(listProcurementHistory).mockRejectedValue(
      new ReportingValidationError({ limit: ['Limit must be between 1 and 50.'] }),
    );
    const invalid = await historyRoute(new Request('http://localhost/api/history?limit=1000'));
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      title: 'Invalid history request',
      errors: { limit: ['Limit must be between 1 and 50.'] },
    });
  });

  it('rejects database-revoked actors instead of trusting a signed session', async () => {
    jest.mocked(getFactualInsights).mockRejectedValueOnce(new AuthorizationError());
    jest.mocked(listProcurementHistory).mockRejectedValueOnce(new AuthorizationError());
    expect((await insightsRoute()).status).toBe(403);
    expect((await historyRoute(new Request('http://localhost/api/history'))).status).toBe(403);
    expect(requireAccountContext).not.toHaveBeenCalled();
  });
});
