import { GET } from '@/app/api/overview/route';
import { AuthorizationError } from '@/lib/auth/guards';
import { getOverview } from '@/lib/overview/overview-service';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('@/lib/overview/overview-service', () => ({ getOverview: jest.fn() }));

const account = {
  tenant: { id: 'tenant-a' },
  user: { id: 'member-a' },
};

const overview = {
  generatedAt: '2026-08-28T06:00:00.000Z',
  counts: {
    activeSuppliers: 8,
    menus: { draft: 2, approved: 3 },
    requests: { draft: 1, open: 2, awarded: 4 },
    quotesReceivedForOpenRequests: 5,
  },
  attention: { items: [], hasMore: false },
  deliveryAttention: { waiting: 2, problems: 1 },
  deadlines: [],
  recentAwards: [],
};

describe('overview API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAccountContext).mockResolvedValue(account as never);
    jest.mocked(getOverview).mockResolvedValue(overview);
  });

  it('derives the actor from the authenticated account and never caches the response', async () => {
    const response = await GET();

    expect(getOverview).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    await expect(response.json()).resolves.toEqual({ overview });
  });

  it('returns a private generic error for missing or inactive sessions', async () => {
    jest.mocked(requireAccountContext).mockResolvedValueOnce(null);
    const missing = await GET();

    jest.mocked(getOverview).mockRejectedValueOnce(new AuthorizationError());
    const inactive = await GET();

    expect(missing.status).toBe(401);
    expect(inactive.status).toBe(403);
    for (const response of [missing, inactive]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      expect(JSON.stringify(await response.json())).not.toContain('member-a');
    }
  });
});
