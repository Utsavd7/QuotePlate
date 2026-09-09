import { getServerSession } from 'next-auth';

import { GET } from '@/app/api/overview/route';
import { AuthorizationError } from '@/lib/auth/guards';
import { getOverview } from '@/lib/overview/overview-service';
import { authOptions } from '@/lib/auth';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: { session: { strategy: 'jwt' } } }));
jest.mock('@/lib/overview/overview-service', () => ({ getOverview: jest.fn() }));

const session = { user: { tenantId: 'tenant-a', userId: 'member-a' } };

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
    jest.mocked(getServerSession).mockResolvedValue(session as never);
    jest.mocked(getOverview).mockResolvedValue(overview);
  });

  it('derives the actor from the verified session and never caches the response', async () => {
    const response = await GET();

    expect(getServerSession).toHaveBeenCalledWith(authOptions);
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(getOverview).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'member-a' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    await expect(response.json()).resolves.toEqual({ overview });
  });

  it('returns a private generic error for missing or inactive sessions', async () => {
    jest.mocked(getServerSession).mockResolvedValueOnce(null);
    const missing = await GET();

    jest.mocked(getOverview).mockRejectedValueOnce(new AuthorizationError());
    const inactive = await GET();

    expect(missing.status).toBe(401);
    expect(inactive.status).toBe(403);
    for (const response of [missing, inactive]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      expect(response.headers.get('vary')).toBe('Cookie');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(JSON.stringify(await response.json())).not.toContain('member-a');
    }
  });

  it.each([
    ['no user', {}],
    ['null user', { user: null }],
    ['missing user ID', { user: { tenantId: 'tenant-a' } }],
    ['missing tenant ID', { user: { userId: 'member-a' } }],
    ['empty user ID', { user: { tenantId: 'tenant-a', userId: '' } }],
    ['empty tenant ID', { user: { tenantId: '', userId: 'member-a' } }],
    ['numeric user ID', { user: { tenantId: 'tenant-a', userId: 12 } }],
    ['object tenant ID', { user: { tenantId: {}, userId: 'member-a' } }],
  ])('rejects a malformed session (%s) before calling the overview service', async (_label, malformed) => {
    jest.mocked(getServerSession).mockResolvedValueOnce(malformed as never);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(getOverview).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    await expect(response.json()).resolves.toMatchObject({ status: 401, detail: 'Authentication is required.' });
  });

  it('does not treat session role or active flags as proof of current access', async () => {
    jest.mocked(getServerSession).mockResolvedValueOnce({
      user: { ...session.user, role: 'OWNER', isActive: true, accountState: 'ACTIVE' },
    } as never);
    jest.mocked(getOverview).mockRejectedValueOnce(new AuthorizationError());
    const response = await GET();
    expect(response.status).toBe(403);
    expect(getOverview).toHaveBeenCalledWith({ actor: session.user });
  });

});
