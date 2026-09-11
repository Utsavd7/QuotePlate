import { GET, PATCH, POST } from '@/app/api/settings/route';
import { getServerSession } from 'next-auth';
import {
  deactivateWorkspaceMember,
  getWorkspaceSettings,
  updateWorkspaceSettings,
  WorkspaceSettingsValidationError,
} from '@/lib/account/workspace-settings';
import { AuthorizationError } from '@/lib/auth/guards';
import { requireAccountContext } from '@/lib/server-account';

jest.mock('@/lib/server-account', () => ({ requireAccountContext: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/account/workspace-settings', () => ({
  getWorkspaceSettings: jest.fn(),
  updateWorkspaceSettings: jest.fn(),
  deactivateWorkspaceMember: jest.fn(),
  WorkspaceSettingsValidationError: jest.requireActual('@/lib/account/workspace-settings').WorkspaceSettingsValidationError,
}));

const tenant = { id: 'tenant-a' };
const owner = { id: 'owner-a', tenantId: 'tenant-a', role: 'OWNER', isActive: true, email: 'owner@example.test' };
const member = { ...owner, id: 'member-a', role: 'MEMBER' };
const settings = {
  workspace: {
    name: 'Monsoon Table', addressLine: '1 Market Road',
    city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9876543210',
    gstin: null, timezone: 'Asia/Kolkata',
  },
  currentUser: { id: 'owner-a', name: 'Owner', email: 'owner@example.test', role: 'OWNER' },
  permissions: { canManageWorkspace: true, canManageMembers: true },
  members: [], pendingInvitations: [],
};

function jsonRequest(method: string, body: unknown, options: { origin?: string; contentType?: string; length?: string } = {}) {
  return new Request('https://quoteplate.example/api/settings', {
    method,
    headers: {
      'content-type': options.contentType ?? 'application/json',
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.length ? { 'content-length': options.length } : {}),
    },
    body: JSON.stringify(body),
  });
}

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('settings API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getServerSession).mockResolvedValue({ user: { userId: 'owner-a', tenantId: 'tenant-a' } });
    jest.mocked(requireAccountContext).mockResolvedValue({ tenant, user: owner } as never);
    jest.mocked(getWorkspaceSettings).mockResolvedValue(settings as never);
    jest.mocked(updateWorkspaceSettings).mockResolvedValue(settings as never);
    jest.mocked(deactivateWorkspaceMember).mockResolvedValue({ userId: 'member-a' });
  });

  it('returns safe owner settings with private response headers', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(getWorkspaceSettings).toHaveBeenCalledWith({ actor: { tenantId: 'tenant-a', userId: 'owner-a' } });
    expect(requireAccountContext).not.toHaveBeenCalled();
    expect(response.headers.get('server-timing')).toMatch(/^session;dur=\d+(?:\.\d+)?, settings;dur=\d+(?:\.\d+)?$/);
    const body = await response.json();
    expect(body).toEqual(settings);
    expect(JSON.stringify(body)).not.toMatch(/tenantId|tokenDigest|passwordHash/i);
  });

  it('lets a member view settings and clearly denies every mutation before parsing it', async () => {
    jest.mocked(getServerSession).mockResolvedValue({ user: { userId: 'member-a', tenantId: 'tenant-a' } });
    jest.mocked(requireAccountContext).mockResolvedValue({ tenant, user: member } as never);
    jest.mocked(getWorkspaceSettings).mockResolvedValue({
      ...settings,
      currentUser: { ...settings.currentUser, id: 'member-a', role: 'MEMBER' },
      permissions: { canManageWorkspace: false, canManageMembers: false },
    } as never);

    expect((await GET()).status).toBe(200);
    const patch = await PATCH(jsonRequest('PATCH', { details: 'ignored' }));
    const post = await POST(jsonRequest('POST', { action: 'deactivate-member', userId: 'owner-a' }));

    expect(patch.status).toBe(403);
    expect(post.status).toBe(403);
    await expect(patch.json()).resolves.toMatchObject({ detail: 'Only workspace owners can change these settings.' });
    await expect(post.json()).resolves.toMatchObject({ detail: 'Only workspace owners can manage people.' });
    expect(updateWorkspaceSettings).not.toHaveBeenCalled();
    expect(deactivateWorkspaceMember).not.toHaveBeenCalled();
  });

  it('returns a private 401 without touching services for an unauthenticated request', async () => {
    jest.mocked(getServerSession).mockResolvedValue(null);
    jest.mocked(requireAccountContext).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(getWorkspaceSettings).not.toHaveBeenCalled();
  });

  it('keeps session lookup failures private instead of exposing internal details', async () => {
    jest.mocked(getServerSession).mockRejectedValueOnce(
      new Error('postgres password for tenant-secret'),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(await response.text()).not.toMatch(/postgres|password|tenant-secret/i);
    expect(getWorkspaceSettings).not.toHaveBeenCalled();
  });

  it('rejects a revoked database actor despite a valid signed session', async () => {
    jest.mocked(getWorkspaceSettings).mockRejectedValueOnce(new AuthorizationError());
    const response = await GET();
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(requireAccountContext).not.toHaveBeenCalled();
  });

  it('updates bounded validated restaurant, contact, and GSTIN details as the database actor', async () => {
    const details = {
      name: 'Monsoon Table', addressLine: '1 Market Road',
      city: 'Mumbai', state: 'Maharashtra', pin: '400001', phone: '9876543210',
      gstin: '27AAPFU0939F1ZV',
    };
    const response = await PATCH(jsonRequest('PATCH', { details }, { origin: 'https://quoteplate.example' }));

    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(updateWorkspaceSettings).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'owner-a' }, details,
    });
  });

  it('rejects cross-origin, non-JSON, oversized, malformed, and invalid updates safely', async () => {
    const crossOrigin = await PATCH(jsonRequest('PATCH', {}, { origin: 'https://evil.example' }));
    const nonJson = await PATCH(jsonRequest('PATCH', {}, { contentType: 'text/plain' }));
    const oversized = await PATCH(jsonRequest('PATCH', {}, { length: '20000' }));
    const malformed = await PATCH(new Request('https://quoteplate.example/api/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{',
    }));
    jest.mocked(updateWorkspaceSettings).mockRejectedValueOnce(
      new WorkspaceSettingsValidationError({ pin: ['Enter a 6-digit PIN.'] }),
    );
    const invalid = await PATCH(jsonRequest('PATCH', { details: { pin: 'x' } }));

    expect(crossOrigin.status).toBe(403);
    expect(nonJson.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(malformed.status).toBe(400);
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({ errors: { pin: ['Enter a 6-digit PIN.'] } });
    [crossOrigin, nonJson, oversized, malformed, invalid].forEach(expectPrivate);
  });

  it('deactivates members and leaves invitations to their dedicated guarded route', async () => {
    const deactivated = await POST(jsonRequest('POST', {
      action: 'deactivate-member', userId: 'member-a',
    }));
    const inviteHere = await POST(jsonRequest('POST', {
      action: 'invite-member', email: 'member@example.test', role: 'MEMBER',
    }));
    const revokeHere = await POST(jsonRequest('POST', {
      action: 'revoke-invitation', invitationId: 'invite-a',
    }));

    expect(deactivated.status).toBe(200);
    expect(inviteHere.status).toBe(400);
    expect(revokeHere.status).toBe(400);
    expect(deactivateWorkspaceMember).toHaveBeenCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'owner-a' }, userId: 'member-a',
    });
    [inviteHere, revokeHere, deactivated].forEach(expectPrivate);
  });

  it('uses generic service errors rather than exposing database or tenant details', async () => {
    jest.mocked(getWorkspaceSettings).mockRejectedValueOnce(new Error('postgres password for tenant-b'));
    const read = await GET();
    jest.mocked(deactivateWorkspaceMember).mockRejectedValueOnce(new AuthorizationError());
    const mutation = await POST(jsonRequest('POST', { action: 'deactivate-member', userId: 'member-b' }));

    expect(read.status).toBe(503);
    expect(mutation.status).toBe(403);
    expect(await read.text()).not.toMatch(/postgres|tenant-b|password/i);
    expect(await mutation.text()).not.toContain('member-b');
  });
});
