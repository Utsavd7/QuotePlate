import { readWorkspaceAccount } from '@/lib/client/workspace-account';

describe('uncached workspace account loading', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => { jest.useFakeTimers(); fetchMock = jest.spyOn(globalThis, 'fetch'); });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  function holdHeaders() {
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
  }

  it('ends stalled headers and permits a fresh manual retry without caching account data', async () => {
    holdHeaders();
    const waiting = readWorkspaceAccount(new AbortController().signal);
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'TimeoutError' });
    await jest.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
    fetchMock.mockResolvedValueOnce(Response.json({ workspaceId: 'current' }));
    await expect(readWorkspaceAccount(new AbortController().signal)).resolves.toMatchObject({ status: 200, data: { workspaceId: 'current' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/account', expect.objectContaining({ cache: 'no-store' }));
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds a JSON body that stalls after successful headers', async () => {
    fetchMock.mockImplementationOnce(async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"workspaceId":'));
        init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true });
      },
    })));
    const waiting = readWorkspaceAccount(new AbortController().signal);
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'TimeoutError' });
    await jest.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts discarded layout reads immediately and clears their deadline', async () => {
    holdHeaders();
    const caller = new AbortController();
    const waiting = readWorkspaceAccount(caller.signal);
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort();
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
    await expect(readWorkspaceAccount(caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('works without AbortSignal.any and releases the caller listener after success', async () => {
    jest.spyOn(AbortSignal, 'any').mockImplementation(() => { throw new Error('Unsupported browser API'); });
    const caller = new AbortController();
    const cleanup = jest.spyOn(caller.signal, 'removeEventListener');
    fetchMock.mockResolvedValueOnce(Response.json({ workspaceId: 'current' }));
    await expect(readWorkspaceAccount(caller.signal)).resolves.toMatchObject({ status: 200 });
    expect(cleanup).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('returns authorization failure without requiring an error body to parse', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not JSON', { status: 401 }));
    await expect(readWorkspaceAccount(new AbortController().signal)).resolves.toEqual({ status: 401, data: null });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears deadlines on invalid successful JSON and does not turn errors into saved data', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not JSON'));
    await expect(readWorkspaceAccount(new AbortController().signal)).rejects.toMatchObject({ name: 'SyntaxError' });
    expect(jest.getTimerCount()).toBe(0);
  });
});
