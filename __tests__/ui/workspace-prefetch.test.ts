import {
  clearWorkspacePrefetch,
  prefetchWorkspace,
  setWorkspacePrefetchScope,
  workspaceFetch,
  workspaceMutationFetch,
} from '@/lib/client/workspace-prefetch';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const overviewUrl = '/api/overview';

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('workspace prefetch', () => {
  beforeEach(() => {
    clearWorkspacePrefetch();
    setWorkspacePrefetchScope('workspace-a');
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    setWorkspacePrefetchScope(null);
    jest.useRealTimers();
  });

  it('reuses a prefetched response for repeated fresh reads', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ source: 'prefetch' }));

    await prefetchWorkspace(overviewUrl);

    const first = await workspaceFetch(overviewUrl, { cache: 'no-store' });
    const second = await workspaceFetch(overviewUrl, { cache: 'no-store' });

    await expect(first.json()).resolves.toEqual({ source: 'prefetch' });
    await expect(second.json()).resolves.toEqual({ source: 'prefetch' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('populates the cache from a normal workspace fetch', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({ source: 'normal' }));

    const first = await workspaceFetch(overviewUrl);
    const second = await workspaceFetch(overviewUrl);

    await expect(first.json()).resolves.toEqual({ source: 'normal' });
    await expect(second.json()).resolves.toEqual({ source: 'normal' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps response clones independently readable', async () => {
    const networkResponse = jsonResponse({ source: 'prefetch' });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(networkResponse);

    await prefetchWorkspace(overviewUrl);
    const cachedResponse = await workspaceFetch(overviewUrl);

    await expect(networkResponse.json()).resolves.toEqual({ source: 'prefetch' });
    await expect(cachedResponse.json()).resolves.toEqual({ source: 'prefetch' });
  });

  it('deduplicates duplicate in-flight prefetches', async () => {
    let resolveFetch!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockReturnValue(pendingResponse);

    const first = prefetchWorkspace(overviewUrl);
    const second = prefetchWorkspace(overviewUrl);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse({ ok: true }));
    await Promise.all([first, second]);
  });

  it('keeps a slow in-flight prefetch deduplicated beyond the response TTL window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    let resolveFetch!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockReturnValue(pendingResponse);

    const first = prefetchWorkspace(overviewUrl);
    jest.setSystemTime(new Date('2026-09-01T00:00:31.000Z'));
    const second = prefetchWorkspace(overviewUrl);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse({ ok: true }));
    await Promise.all([first, second]);
  });

  it('ignores requests outside the private first-page allowlist', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    await prefetchWorkspace('/api/account' as typeof overviewUrl);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns stale data while an expired response refreshes in the background', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    let resolveRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ source: 'unexpected' }))
      .mockResolvedValueOnce(jsonResponse({ source: 'stale' }))
      .mockReturnValueOnce(refresh);

    await prefetchWorkspace(overviewUrl);
    jest.setSystemTime(new Date('2026-09-01T00:00:30.001Z'));

    let stale: Response | undefined;
    void workspaceFetch(overviewUrl).then((response) => {
      stale = response;
    });
    await flushMicrotasks();

    expect(stale).toBeDefined();
    await expect(stale!.json()).resolves.toEqual({ source: 'stale' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveRefresh(jsonResponse({ source: 'refreshed' }));
    await prefetchWorkspace(overviewUrl);

    const refreshed = await workspaceFetch(overviewUrl);
    await expect(refreshed.json()).resolves.toEqual({ source: 'refreshed' });
  });

  it('shares one background refresh across concurrent expired reads', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    let resolveRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ source: 'unexpected' }))
      .mockResolvedValueOnce(jsonResponse({ source: 'stale' }))
      .mockReturnValueOnce(refresh);

    await prefetchWorkspace(overviewUrl);
    jest.setSystemTime(new Date('2026-09-01T00:00:30.001Z'));

    let first: Response | undefined;
    let second: Response | undefined;
    void workspaceFetch(overviewUrl).then((response) => {
      first = response;
    });
    void workspaceFetch(overviewUrl).then((response) => {
      second = response;
    });
    await flushMicrotasks();

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    await expect(first!.json()).resolves.toEqual({ source: 'stale' });
    await expect(second!.json()).resolves.toEqual({ source: 'stale' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveRefresh(jsonResponse({ source: 'refreshed' }));
    await prefetchWorkspace(overviewUrl);
  });

  it('preserves stale data after a failed background refresh and retries later', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    let rejectRefresh!: (error: Error) => void;
    const refresh = new Promise<Response>((_, reject) => {
      rejectRefresh = reject;
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ source: 'unexpected' }))
      .mockResolvedValueOnce(jsonResponse({ source: 'stale' }))
      .mockReturnValueOnce(refresh)
      .mockResolvedValueOnce(jsonResponse({ source: 'retried' }));

    await prefetchWorkspace(overviewUrl);
    jest.setSystemTime(new Date('2026-09-01T00:00:30.001Z'));

    let stale: Response | undefined;
    void workspaceFetch(overviewUrl).then((response) => {
      stale = response;
    });
    await flushMicrotasks();

    expect(stale).toBeDefined();
    await expect(stale!.json()).resolves.toEqual({ source: 'stale' });
    rejectRefresh(new Error('refresh unavailable'));
    await prefetchWorkspace(overviewUrl);

    const retryingStale = await workspaceFetch(overviewUrl);
    await expect(retryingStale.json()).resolves.toEqual({ source: 'stale' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await prefetchWorkspace(overviewUrl);
    const retried = await workspaceFetch(overviewUrl);
    await expect(retried.json()).resolves.toEqual({ source: 'retried' });
  });

  it('evicts stale data after a terminal authorization refresh failure', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ source: 'stale' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ source: 'fresh' }));

    await prefetchWorkspace(overviewUrl);
    jest.setSystemTime(new Date('2026-09-01T00:00:30.001Z'));

    const stale = await workspaceFetch(overviewUrl);
    await expect(stale.json()).resolves.toEqual({ source: 'stale' });
    await flushMicrotasks();

    const fresh = await workspaceFetch(overviewUrl);
    await expect(fresh.json()).resolves.toEqual({ source: 'fresh' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failed prefetch and lets the normal fetch retry', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'Unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ source: 'retry' }));

    await prefetchWorkspace(overviewUrl);
    const response = await workspaceFetch(overviewUrl);

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ source: 'retry' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forces a fresh request after explicit invalidation', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ source: 'prefetch' }))
      .mockResolvedValueOnce(jsonResponse({ source: 'network' }));

    await prefetchWorkspace(overviewUrl);
    clearWorkspacePrefetch();
    const response = await workspaceFetch(overviewUrl);

    await expect(response.json()).resolves.toEqual({ source: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an already cancelled read without fetching or consuming a cache entry', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ value: 4 }));
    await prefetchWorkspace(overviewUrl);
    const controller = new AbortController(); controller.abort();
    await expect(workspaceFetch(overviewUrl, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ value: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves cancellation during body consumption without poisoning the cached response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ value: 5 }));
    await prefetchWorkspace(overviewUrl);
    const controller = new AbortController();
    const response = await workspaceFetch(overviewUrl, { signal: controller.signal });
    controller.abort();
    await expect(response.json()).rejects.toMatchObject({ name: 'AbortError' });
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ value: 5 });
  });

  it('shares cached data for a signal-bound request without replacing it', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ source: 'cached' }));
    await prefetchWorkspace(overviewUrl);
    const response = await workspaceFetch(overviewUrl, { signal: new AbortController().signal });
    await expect(response.json()).resolves.toEqual({ source: 'cached' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts a pending refresh during explicit invalidation without restoring its response', async () => {
    let resolveRefresh!: (response: Response) => void;
    let refreshSignal: AbortSignal | undefined;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce((_input, init) => {
        refreshSignal = init?.signal ?? undefined;
        return pendingRefresh;
      })
      .mockResolvedValueOnce(jsonResponse({ source: 'fresh' }));

    const prefetch = prefetchWorkspace(overviewUrl);
    clearWorkspacePrefetch();
    expect(refreshSignal?.aborted).toBe(true);
    resolveRefresh(jsonResponse({ source: 'old' }));
    await prefetch;

    const fresh = await workspaceFetch(overviewUrl);
    await expect(fresh.json()).resolves.toEqual({ source: 'fresh' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a pending foreground read after a successful same-scope mutation', async () => {
    let resolveOldRead!: (response: Response) => void;
    const oldRead = new Promise<Response>((resolve) => {
      resolveOldRead = resolve;
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(oldRead)
      .mockResolvedValueOnce(jsonResponse({ saved: true }))
      .mockResolvedValueOnce(jsonResponse({ source: 'post-mutation' }));

    const responsePromise = workspaceFetch(overviewUrl);
    await workspaceMutationFetch('/api/requests', { method: 'POST' });
    resolveOldRead(jsonResponse({ source: 'pre-mutation' }));

    const response = await responsePromise;
    const cachedResponse = await workspaceFetch(overviewUrl);

    await expect(response.json()).resolves.toEqual({ source: 'post-mutation' });
    await expect(cachedResponse.json()).resolves.toEqual({ source: 'post-mutation' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('cannot consume workspace A data after switching to workspace B', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ workspace: 'a' }))
      .mockResolvedValueOnce(jsonResponse({ workspace: 'b' }));

    await prefetchWorkspace(overviewUrl);
    setWorkspacePrefetchScope('workspace-b');
    const response = await workspaceFetch(overviewUrl);

    await expect(response.json()).resolves.toEqual({ workspace: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not populate workspace B with a workspace A request that resolves late', async () => {
    let resolveWorkspaceA!: (response: Response) => void;
    const workspaceAResponse = new Promise<Response>((resolve) => {
      resolveWorkspaceA = resolve;
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(workspaceAResponse)
      .mockResolvedValueOnce(jsonResponse({ workspace: 'b' }));

    const workspaceAPrefetch = prefetchWorkspace(overviewUrl);
    setWorkspacePrefetchScope('workspace-b');
    resolveWorkspaceA(jsonResponse({ workspace: 'a' }));
    await workspaceAPrefetch;

    const response = await workspaceFetch(overviewUrl);

    await expect(response.json()).resolves.toEqual({ workspace: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a pending workspace A fetch after switching to B', async () => {
    let resolveWorkspaceA!: (response: Response) => void;
    const workspaceAResponse = new Promise<Response>((resolve) => {
      resolveWorkspaceA = resolve;
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(workspaceAResponse)
      .mockResolvedValueOnce(jsonResponse({ workspace: 'b' }));

    const responsePromise = workspaceFetch(overviewUrl);
    setWorkspacePrefetchScope('workspace-b');
    resolveWorkspaceA(jsonResponse({ workspace: 'a' }));

    await expect(responsePromise).rejects.toMatchObject({ name: 'AbortError' });
    const cachedResponse = await workspaceFetch(overviewUrl);

    await expect(cachedResponse.json()).resolves.toEqual({ workspace: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a pending workspace A fetch without delivering B data to it', async () => {
    let refreshSignal: AbortSignal | undefined;
    let rejectWorkspaceA!: (error: DOMException) => void;
    const pendingWorkspaceA = new Promise<Response>((_resolve, reject) => {
      rejectWorkspaceA = reject;
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce((_input, init) => {
        refreshSignal = init?.signal ?? undefined;
        refreshSignal?.addEventListener('abort', () => {
          rejectWorkspaceA(new DOMException('aborted', 'AbortError'));
        });
        return pendingWorkspaceA;
      })
      .mockResolvedValueOnce(jsonResponse({ workspace: 'b' }));

    const responsePromise = workspaceFetch(overviewUrl);
    setWorkspacePrefetchScope('workspace-b');
    expect(refreshSignal?.aborted).toBe(true);

    await expect(responsePromise).rejects.toMatchObject({ name: 'AbortError' });
    const cachedResponse = await workspaceFetch(overviewUrl);

    await expect(cachedResponse.json()).resolves.toEqual({ workspace: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an ordinary workspace A failure after switching to B', async () => {
    let rejectWorkspaceA!: (error: Error) => void;
    const pendingWorkspaceA = new Promise<Response>((_resolve, reject) => {
      rejectWorkspaceA = reject;
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(pendingWorkspaceA)
      .mockResolvedValueOnce(jsonResponse({ workspace: 'b' }));

    const responsePromise = workspaceFetch(overviewUrl);
    setWorkspacePrefetchScope('workspace-b');
    rejectWorkspaceA(new Error('workspace A failed late'));

    await expect(responsePromise).rejects.toMatchObject({ name: 'AbortError' });
    const cachedResponse = await workspaceFetch(overviewUrl);

    await expect(cachedResponse.json()).resolves.toEqual({ workspace: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not prefetch or consume cached data without an active workspace scope', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ source: 'network' }));
    setWorkspacePrefetchScope(null);

    await prefetchWorkspace(overviewUrl);
    const response = await workspaceFetch(overviewUrl);

    await expect(response.json()).resolves.toEqual({ source: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bypasses the workspace cache for non-GET requests', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ source: 'prefetch' }))
      .mockResolvedValueOnce(jsonResponse({ source: 'patch' }));

    await prefetchWorkspace(overviewUrl);
    const response = await workspaceFetch(overviewUrl, { method: 'PATCH' });
    const cachedResponse = await workspaceFetch(overviewUrl);

    await expect(response.json()).resolves.toEqual({ source: 'patch' });
    await expect(cachedResponse.json()).resolves.toEqual({ source: 'prefetch' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears cached first pages around a successful non-GET mutation', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ source: 'prefetch' }))
      .mockResolvedValueOnce(jsonResponse({ saved: true }))
      .mockResolvedValueOnce(jsonResponse({ source: 'network' }));

    await prefetchWorkspace(overviewUrl);
    await workspaceMutationFetch('/api/requests', { method: 'POST' });
    const response = await workspaceFetch(overviewUrl);

    await expect(response.json()).resolves.toEqual({ source: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('prefetches sidebar destinations only on user intent', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );
    expect(source).toContain('onPointerEnter={() => void prefetchWorkspace');
    expect(source).toContain('onFocus={() => void prefetchWorkspace');
    expect(source).not.toContain('warmWorkspacePrefetch');
    expect(source).not.toContain('requestIdleCallback');
  });

  it('sets and ends the private cache scope at account and sign-out boundaries', () => {
    const layout = readFileSync(
      join(process.cwd(), 'src', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );
    const signOut = readFileSync(
      join(process.cwd(), 'src', 'components', 'auth', 'SignOutButton.tsx'),
      'utf8',
    );

    expect(layout).toContain('setWorkspacePrefetchScope(loaded.workspaceId)');
    expect(layout).toContain('setWorkspacePrefetchScope(null)');
    expect(layout.indexOf('setWorkspacePrefetchScope(loaded.workspaceId)'))
      .toBeLessThan(layout.indexOf('setReady(true)'));
    expect(signOut).toContain('setWorkspacePrefetchScope(null)');
    expect(signOut.indexOf('setWorkspacePrefetchScope(null)'))
      .toBeLessThan(signOut.indexOf("signOut({ callbackUrl: '/signin'"));
  });

  it('centralizes successful signed-in mutation invalidation', () => {
    const expectedCalls = [
      ['src/components/procurement/NewRequestForm.tsx', "workspaceMutationFetch('/api/requests'"],
      ['src/components/procurement/DraftRequestEditor.tsx', 'workspaceMutationFetch(`/api/requests/${encodeURIComponent(request.id)}`'],
      ['src/components/procurement/RequestDetail.tsx', 'workspaceMutationFetch(`/api/requests/${encodeURIComponent(request.id)}/open`'],
      ['src/components/procurement/RequestDetail.tsx', 'workspaceMutationFetch(`/api/requests/${encodeURIComponent(request.id)}/links`'],
      ['src/components/procurement/RequestDetail.tsx', 'workspaceMutationFetch(`/api/requests/${encodeURIComponent(request.id)}/award`'],
      ['src/components/menus/MenuEditor.tsx', 'workspaceMutationFetch(`/api/menus/${encodeURIComponent(menu.id)}`'],
      ['src/components/menus/MenuEditor.tsx', 'workspaceMutationFetch(`/api/menus/${encodeURIComponent(saved.id)}/approve`'],
      ['src/components/menus/MenuWorkspace.tsx', "workspaceMutationFetch('/api/menu-import/url'"],
      ['src/components/menus/MenuWorkspace.tsx', "workspaceMutationFetch('/api/parse-menu'"],
      ['src/components/suppliers/SupplierWorkspace.tsx', 'workspaceMutationFetch('],
      ['src/components/settings/SettingsWorkspace.tsx', 'workspaceMutationFetch('],
      ['src/components/reporting/HistoryWorkspace.tsx', 'workspaceMutationFetch('],
    ] as const;

    for (const [file, call] of expectedCalls) {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain(call);
    }

    const requestDetail = readFileSync(
      join(process.cwd(), 'src', 'components', 'procurement', 'RequestDetail.tsx'),
      'utf8',
    );
    expect(requestDetail).toContain('fetch(`/api/requests/${encodeURIComponent(request.id)}/qr`');
  });

  it('uses prefetched responses only from procurement and menu initial effects', () => {
    const procurement = readFileSync(
      join(process.cwd(), 'src', 'components', 'procurement', 'ProcurementWorkspace.tsx'),
      'utf8',
    );
    const menus = readFileSync(
      join(process.cwd(), 'src', 'components', 'menus', 'MenuWorkspace.tsx'),
      'utf8',
    );

    expect(procurement).toContain('async (cursor?: string, usePrefetch = false)');
    expect(procurement).toContain('void loadRequests(undefined, true)');
    expect(procurement).toContain('usePrefetch\n        ? workspaceFetch');
    expect(procurement).toContain('onClick={() => void loadRequests()}>Try again');
    expect(menus).toContain('async (cursor?: string, usePrefetch = false)');
    expect(menus).toContain('void loadMenus(undefined, true)');
    expect(menus).toContain('usePrefetch\n        ? workspaceFetch');
    expect(menus).toContain('onClick={() => void loadMenus()}>Try again');
  });

  it('uses the prefetched response only for each matching first page', () => {
    const expected = [
      ['src/components/overview/OverviewWorkspace.tsx', "workspaceFetch('/api/overview'"],
      ['src/components/procurement/ProcurementWorkspace.tsx', "workspaceFetch('/api/requests?limit=50'"],
      ['src/components/menus/MenuWorkspace.tsx', "workspaceFetch('/api/menus?limit=50'"],
      ['src/components/suppliers/SupplierWorkspace.tsx', "workspaceFetch('/api/suppliers?active=true&limit=50'"],
      ['src/components/reporting/InsightsWorkspace.tsx', "workspaceFetch('/api/insights'"],
      ['src/components/reporting/HistoryWorkspace.tsx', "workspaceFetch('/api/history?limit=25'"],
      ['src/components/settings/SettingsWorkspace.tsx', "workspaceFetch('/api/settings'"],
    ] as const;

    for (const [file, call] of expected) {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain(call);
    }
  });
});
