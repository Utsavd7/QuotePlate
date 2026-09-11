import {
  prefetchWorkspace, setWorkspacePrefetchScope, workspaceFetch,
} from '@/lib/client/workspace-prefetch';

const url = '/api/overview';
const timeout = { name: 'TimeoutError', message: 'Loading took too long. Please try again.' };

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

// Real Response/stream behavior; only the transport is controlled by the test.
function streamingResponse(signal?: AbortSignal | null) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const abort = () => controller.error(signal!.reason);
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
  }), { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } });
  signal?.addEventListener('abort', abort, { once: true });
  return {
    response,
    enqueue(value: string) { controller.enqueue(new TextEncoder().encode(value)); },
    finish(value: string) {
      signal?.removeEventListener('abort', abort);
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
    fail(error: Error) {
      signal?.removeEventListener('abort', abort);
      controller.error(error);
    },
  };
}

describe('workspace read deadlines', () => {
  beforeEach(() => {
    setWorkspacePrefetchScope(null);
    jest.restoreAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(0);
    setWorkspacePrefetchScope('workspace-a');
  });
  afterEach(() => {
    setWorkspacePrefetchScope(null);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('bounds shared headers at 15s and permits a manual retry after an abort-aware fetch stalls', async () => {
    let transport!: AbortSignal;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementationOnce((_input, init) => {
      transport = init!.signal!;
      return new Promise<Response>((_resolve, reject) => {
        transport.addEventListener('abort', () => reject(transport.reason), { once: true });
      });
    }).mockResolvedValueOnce(jsonResponse({ retried: true }));
    const prefetch = prefetchWorkspace(url);
    const first = jest.fn(); const second = jest.fn();
    const reads = [workspaceFetch(url).then(first, first), workspaceFetch(url).then(second, second)];
    await jest.advanceTimersByTimeAsync(14_999);
    expect(first).not.toHaveBeenCalled();
    expect(transport.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(first).toHaveBeenCalledWith(expect.objectContaining(timeout));
    expect(second).toHaveBeenCalledWith(expect.objectContaining(timeout));
    expect(transport.aborted).toBe(true);
    await Promise.all([prefetch, ...reads]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ retried: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('streams chunks before completion, then times out a body that never ends and evicts it for retry', async () => {
    let transport!: AbortSignal;
    let stream!: ReturnType<typeof streamingResponse>;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
      transport = init!.signal!;
      stream = streamingResponse(transport);
      return stream.response;
    }).mockResolvedValueOnce(jsonResponse({ retried: true }));
    const response = await workspaceFetch(url);
    expect(response).toBeInstanceOf(Response);
    expect(response.url).toBe(stream.response.url);
    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.type).toBe(stream.response.type);
    expect(response.redirected).toBe(false);
    const reader = response.body!.getReader();
    stream.enqueue('{"value":');
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toBe('{"value":');
    const settled = jest.fn();
    const pending = reader.read().then(settled, settled);
    await jest.advanceTimersByTimeAsync(14_999);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining(timeout));
    await pending;
    expect(transport.reason).toMatchObject(timeout);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ retried: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('starts a separate 15s body deadline after slow headers settle', async () => {
    const headers = deferred<Response>();
    let transport!: AbortSignal;
    jest.spyOn(globalThis, 'fetch').mockImplementationOnce((_input, init) => {
      transport = init!.signal!;
      return headers.promise;
    });
    const pending = workspaceFetch(url);
    await jest.advanceTimersByTimeAsync(14_000);
    headers.resolve(streamingResponse(transport).response);
    const response = await pending;
    const settled = jest.fn();
    const body = response.json().then(settled, settled);
    await jest.advanceTimersByTimeAsync(14_999);
    expect(transport.aborted).toBe(false);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining(timeout));
    await body;
  });

  it('cleans up both deadlines after a quick response without expiring the fresh cache', async () => {
    let transport!: AbortSignal;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
      transport = init!.signal!;
      return jsonResponse({ fresh: true });
    });
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ fresh: true });
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(15_001);
    expect(transport.aborted).toBe(false);
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not leave a deadline behind for a response without a body', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    const response = await workspaceFetch(url);
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['caller signal', 'stream cancel'])('clears a cancelled reader deadline without cancelling another reader: %s', async cancellation => {
    let transport!: AbortSignal;
    let stream!: ReturnType<typeof streamingResponse>;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
      transport = init!.signal!;
      stream = streamingResponse(transport);
      return stream.response;
    });
    const caller = new AbortController();
    const first = await workspaceFetch(url, { signal: caller.signal });
    await jest.advanceTimersByTimeAsync(5_000);
    const second = await workspaceFetch(url);
    if (cancellation === 'caller signal') {
      caller.abort();
      await expect(first.json()).rejects.toMatchObject({ name: 'AbortError' });
    } else await first.body!.cancel();
    await jest.advanceTimersByTimeAsync(10_001);
    expect(transport.aborted).toBe(false);
    stream.finish('{"shared":true}');
    await expect(second.json()).resolves.toEqual({ shared: true });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(transport.aborted).toBe(false);
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ shared: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleans up a transport body error without later aborting its transport or replacement', async () => {
    let transport!: AbortSignal;
    let stream!: ReturnType<typeof streamingResponse>;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
      transport = init!.signal!;
      stream = streamingResponse(transport);
      return stream.response;
    }).mockResolvedValueOnce(jsonResponse({ fresh: true }));
    const response = await workspaceFetch(url);
    const failed = expect(response.json()).rejects.toThrow('connection lost');
    stream.fail(new Error('connection lost'));
    await failed;
    expect(jest.getTimerCount()).toBe(0);
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ fresh: true });
    await jest.advanceTimersByTimeAsync(15_001);
    expect(transport.aborted).toBe(false);
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out an unread returned body even when the caller never starts consuming it', async () => {
    let transport!: AbortSignal;
    jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
      transport = init!.signal!;
      return streamingResponse(transport).response;
    });
    const response = await workspaceFetch(url);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(transport.reason).toMatchObject(timeout);
    await expect(response.json()).rejects.toMatchObject(timeout);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('protects a successful replacement from an older body timeout on the same cache entry', async () => {
    const transports: AbortSignal[] = [];
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
      transports.push(init!.signal!);
      return streamingResponse(init!.signal).response;
    }).mockImplementationOnce(async (_input, init) => {
      transports.push(init!.signal!);
      return jsonResponse({ replacement: true });
    });
    await prefetchWorkspace(url);
    jest.setSystemTime(31_000);
    const old = await workspaceFetch(url);
    await prefetchWorkspace(url);
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ replacement: true });
    const settled = jest.fn();
    const body = old.json().then(settled, settled);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining(timeout));
    await body;
    expect(transports[1].aborted).toBe(false);
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ replacement: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evicts a timed-out old body without dropping or aborting a refresh still waiting for headers', async () => {
    const headers = deferred<Response>();
    const transports: AbortSignal[] = [];
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
      transports.push(init!.signal!);
      return streamingResponse(init!.signal).response;
    }).mockImplementationOnce((_input, init) => {
      transports.push(init!.signal!);
      return headers.promise;
    });
    await prefetchWorkspace(url);
    jest.setSystemTime(29_000);
    const old = await workspaceFetch(url);
    const settled = jest.fn();
    const body = old.json().then(settled, settled);
    await jest.advanceTimersByTimeAsync(2_000);
    const refresh = prefetchWorkspace(url);
    await jest.advanceTimersByTimeAsync(13_000);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining(timeout));
    await body;
    expect(transports[0].reason).toMatchObject(timeout);
    expect(transports[1].aborted).toBe(false);
    const retry = workspaceFetch(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    headers.resolve(jsonResponse({ replacement: true }));
    await refresh;
    await expect((await retry).json()).resolves.toEqual({ replacement: true });
    await expect((await workspaceFetch(url)).json()).resolves.toEqual({ replacement: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears the header deadline after a quick network failure', async () => {
    let transport!: AbortSignal;
    jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
      transport = init!.signal!;
      throw new Error('offline');
    });
    await expect(workspaceFetch(url)).rejects.toThrow('offline');
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(15_001);
    expect(transport.aborted).toBe(false);
  });
});
