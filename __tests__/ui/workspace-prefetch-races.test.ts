import {
  clearWorkspacePrefetch, prefetchWorkspace, setWorkspacePrefetchScope,
  workspaceFetch, workspaceMutationFetch,
} from '@/lib/client/workspace-prefetch';
const overviewUrl = '/api/overview';
function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, ...init });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('workspace prefetch', () => {
  beforeEach(() => {
    setWorkspacePrefetchScope(null); clearWorkspacePrefetch();
    jest.restoreAllMocks(); jest.useRealTimers(); setWorkspacePrefetchScope('workspace-a');
  });
  afterEach(() => { setWorkspacePrefetchScope(null); jest.useRealTimers(); });

  it('shares a prefetched response with signal-bound overview reads, using independent clones', async () => {
    const network = jsonResponse({ value: 1 });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(network);
    await prefetchWorkspace(overviewUrl);
    const first = await workspaceFetch(overviewUrl, { cache: 'no-store', signal: new AbortController().signal });
    const second = await workspaceFetch(overviewUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(first.json()).resolves.toEqual({ value: 1 });
    await expect(second.json()).resolves.toEqual({ value: 1 });
    await expect(network.json()).resolves.toEqual({ value: 1 });
  });

  it('deduplicates simultaneous foreground reads and navigation prefetch', async () => {
    const pending = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockReturnValue(pending.promise);
    const prefetch = prefetchWorkspace(overviewUrl);
    const first = workspaceFetch(overviewUrl, { signal: new AbortController().signal });
    const second = workspaceFetch(overviewUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(jsonResponse({ value: 2 }));
    await prefetch;
    await expect((await first).json()).resolves.toEqual({ value: 2 });
    await expect((await second).json()).resolves.toEqual({ value: 2 });
  });

  it('cancels one reader immediately without cancelling the shared network request', async () => {
    const pending = deferred<Response>();
    let networkSignal: AbortSignal | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => { networkSignal = init?.signal ?? undefined; return pending.promise; });
    const controller = new AbortController();
    const cancelled = workspaceFetch(overviewUrl, { signal: controller.signal });
    const cancelledCheck = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const other = workspaceFetch(overviewUrl);
    controller.abort();
    await cancelledCheck;
    expect(networkSignal?.aborted).toBe(false);
    pending.resolve(jsonResponse({ value: 3 }));
    await expect((await other).json()).resolves.toEqual({ value: 3 });
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

  it('bounds stale reuse and waits for one shared refresh after the grace period', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    const pending = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ old: true })).mockReturnValueOnce(pending.promise);
    await prefetchWorkspace(overviewUrl);
    clock.mockReturnValue(29_999);
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ old: true });
    clock.mockReturnValue(60_000);
    let settled = false;
    const first = workspaceFetch(overviewUrl).then(response => { settled = true; return response; });
    const second = workspaceFetch(overviewUrl);
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.resolve(jsonResponse({ fresh: true }));
    await expect((await first).json()).resolves.toEqual({ fresh: true });
    await expect((await second).json()).resolves.toEqual({ fresh: true });
  });

  it.each([401, 403, 404, 429, 503])('exposes refresh status %i rather than silently displaying expired data', async status => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ old: true })).mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, { status })).mockResolvedValueOnce(jsonResponse({ fresh: true }));
    await prefetchWorkspace(overviewUrl); clock.mockReturnValue(60_001);
    expect((await workspaceFetch(overviewUrl)).status).toBe(status);
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('propagates an expired refresh network failure and lets the next read retry', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ old: true })).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(jsonResponse({ fresh: true }));
    await prefetchWorkspace(overviewUrl); clock.mockReturnValue(60_000);
    await expect(workspaceFetch(overviewUrl)).rejects.toThrow('offline');
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ fresh: true });
  });

  it.each(['workspace-b', null, 'same-workspace-new-session'])('rejects old consumers across session boundary %s without giving them new-session data', async scope => {
    const pending = deferred<Response>();
    let networkSignal: AbortSignal | undefined;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => { networkSignal = init?.signal ?? undefined; return pending.promise; }).mockResolvedValueOnce(jsonResponse({ fresh: true }));
    const old = workspaceFetch(overviewUrl);
    if (scope === 'same-workspace-new-session') { setWorkspacePrefetchScope(null); setWorkspacePrefetchScope('workspace-a'); }
    else setWorkspacePrefetchScope(scope);
    expect(networkSignal?.aborted).toBe(true);
    pending.resolve(jsonResponse({ secret: 'old workspace' }));
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ fresh: true });
  });

  it('invalidates and refetches old foreground reads after a same-session mutation', async () => {
    const pending = deferred<Response>();
    jest.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise).mockResolvedValueOnce(jsonResponse({ saved: true })).mockResolvedValueOnce(jsonResponse({ fresh: true }));
    const old = workspaceFetch(overviewUrl);
    await workspaceMutationFetch('/api/requests', { method: 'POST' });
    pending.resolve(jsonResponse({ old: true }));
    await expect((await old).json()).resolves.toEqual({ fresh: true });
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ fresh: true });
  });

  it('does not return/cache a read while a mutation is in flight', async () => {
    const mutation = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ old: true })).mockReturnValueOnce(mutation.promise).mockResolvedValueOnce(jsonResponse({ fresh: true }));
    await prefetchWorkspace(overviewUrl);
    const write = workspaceMutationFetch('/api/requests', { method: 'PATCH' });
    let settled = false;
    const read = workspaceFetch(overviewUrl).then(response => { settled = true; return response; });
    await prefetchWorkspace(overviewUrl);
    await Promise.resolve(); expect(settled).toBe(false); expect(fetchMock).toHaveBeenCalledTimes(2);
    mutation.resolve(jsonResponse({ saved: true })); await write;
    await expect((await read).json()).resolves.toEqual({ fresh: true });
  });

  it('invalidates even when the mutation response is lost after a possible server commit', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ old: true })).mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(jsonResponse({ fresh: true }));
    await prefetchWorkspace(overviewUrl);
    await expect(workspaceMutationFetch('/api/requests', { method: 'POST' })).rejects.toThrow('response lost');
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ fresh: true });
  });

  it.each([{ headers: { Authorization: 'Bearer other' } }, { credentials: 'omit' as const }, { cache: 'reload' as const }])('does not share representations with custom request semantics: %j', async init => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ cached: true })).mockResolvedValueOnce(jsonResponse({ direct: true }));
    await prefetchWorkspace(overviewUrl);
    await expect((await workspaceFetch(overviewUrl, init)).json()).resolves.toEqual({ direct: true });
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never prefetches outside the fixed first-page allowlist or without a scope', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ direct: true }));
    await prefetchWorkspace('/api/account' as typeof overviewUrl);
    setWorkspacePrefetchScope(null); await prefetchWorkspace(overviewUrl);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ direct: true });
  });

  it('an authorization denial clears other cached private pages', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ private: true }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }));
    await prefetchWorkspace('/api/settings');
    expect((await workspaceFetch(overviewUrl)).status).toBe(401);
    expect((await workspaceFetch('/api/settings')).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a mutation from the old session cannot invalidate a new session cache', async () => {
    const pending = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise).mockResolvedValueOnce(jsonResponse({ workspace: 'b' }));
    const mutation = workspaceMutationFetch('/api/requests', { method: 'POST' });
    setWorkspacePrefetchScope('workspace-b');
    await prefetchWorkspace(overviewUrl);
    pending.resolve(jsonResponse({ saved: true })); await mutation;
    await expect((await workspaceFetch(overviewUrl)).json()).resolves.toEqual({ workspace: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waits for every overlapping mutation and permits a waiting consumer to abort', async () => {
    const one = deferred<Response>(), two = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise).mockResolvedValueOnce(jsonResponse({ fresh: true }));
    const firstWrite = workspaceMutationFetch('/api/requests', { method: 'POST' });
    const secondWrite = workspaceMutationFetch('/api/menus', { method: 'POST' });
    const controller = new AbortController();
    const cancelled = workspaceFetch(overviewUrl, { signal: controller.signal });
    const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await cancellation;
    let completed = false;
    const read = workspaceFetch(overviewUrl).then(response => { completed = true; return response; });
    one.resolve(jsonResponse({ saved: true })); await firstWrite;
    expect(completed).toBe(false); expect(fetchMock).toHaveBeenCalledTimes(2);
    two.resolve(jsonResponse({ saved: true })); await secondWrite;
    await expect((await read).json()).resolves.toEqual({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])('does not deliver another pending successful read after denial %i', async status => {
    const pending = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jsonResponse({ error: 'Access denied' }, { status }));
    const old = workspaceFetch('/api/settings');
    expect((await workspaceFetch(overviewUrl)).status).toBe(status);
    // Model an already completed transport whose promise ignores AbortController.
    pending.resolve(jsonResponse({ private: 'must not reach old consumer' }));
    const result = await old;
    expect(result.status).toBe(status);
    await expect(result.json()).resolves.toEqual({ error: 'Access denied' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

});
