export const WORKSPACE_FIRST_REQUESTS = {
  '/dashboard': '/api/overview',
  '/service-planning': '/api/service-planning',
  '/supplier-collaboration': '/api/suppliers?active=true&limit=50',
  '/supplier-performance': '/api/supplier-performance',
  '/procurement': '/api/requests?limit=50',
  '/menus': '/api/menus?limit=50',
  '/suppliers': '/api/suppliers?active=true&limit=50',
  '/insights': '/api/insights',
  '/history': '/api/history?limit=25',
  '/settings': '/api/settings',
} as const;

type WorkspaceRequest = (typeof WORKSPACE_FIRST_REQUESTS)[keyof typeof WORKSPACE_FIRST_REQUESTS];
type CacheEntry = {
  controller: AbortController;
  expiresAt: number;
  response: Response | null;
  refresh: Promise<Response> | null;
};

// Fixed first-page allowlist bounds entry count. No localStorage, disk or global fetch patch.
const TTL_MS = 30_000;
// Keep the existing instant stale-while-revalidate path, but never extend it on failure.
const STALE_GRACE_MS = 30_000;
const READ_DEADLINE_MS = 15_000;
const cacheableRequests = new Set<string>(Object.values(WORKSPACE_FIRST_REQUESTS));
const responseCache = new Map<string, CacheEntry>();
const mutations = new Set<Promise<void>>();
const evictFailedBodies = new WeakMap<Response, (timeout?: DOMException) => void>();
let activeWorkspaceScope: string | null = null;
let cacheGeneration = 0;
let sessionGeneration = 0;
let authorizationGeneration = 0;
let authorizationDenial: Response | null = null;
let readerLifetime = new AbortController();
let sessionLifetime = new AbortController();

function revokeReaders() {
  readerLifetime.abort();
  readerLifetime = new AbortController();
}

export function setWorkspacePrefetchScope(scope: string | null) {
  if (activeWorkspaceScope === scope) return;
  sessionGeneration += 1;
  sessionLifetime.abort();
  sessionLifetime = new AbortController();
  revokeReaders();
  authorizationDenial = null;
  clearWorkspacePrefetch();
  mutations.clear();
  activeWorkspaceScope = scope;
}

function aborted(signal?: AbortSignal | null) {
  return signal?.reason ?? new DOMException('Workspace read cancelled.', 'AbortError');
}

function loadingTimeout() {
  return new DOMException('Loading took too long. Please try again.', 'TimeoutError');
}

// A component's cancellation ends only its wait, not another component's/prefetch's fetch.
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(aborted(signal)); };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(value => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(aborted(signal));
      else resolve(value);
    }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}

function cloneForReader(response: Response, callerSignal?: AbortSignal | null): Response {
  const copy = response.clone();
  if (!copy.body) return copy;
  const deadline = new AbortController();
  const signal = AbortSignal.any([
    deadline.signal, readerLifetime.signal, ...(callerSignal ? [callerSignal] : []),
  ]);
  const reader = copy.body.getReader();
  const timer = setTimeout(() => deadline.abort(loadingTimeout()), READ_DEADLINE_MS);
  let finished = false;
  let cancel: () => void;
  const cleanup = () => {
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  };
  // Preserve fetch's body-level cancellation while leaving the shared cache branch intact.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      cancel = () => {
        cleanup();
        controller.error(aborted(signal));
        void reader.cancel().catch(() => undefined);
        // Only our deadline cancels transport; caller/session cancellation remains separate.
        if (deadline.signal.aborted) evictFailedBodies.get(response)?.(deadline.signal.reason);
      };
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (finished) return;
        if (chunk.done) { cleanup(); controller.close(); }
        else controller.enqueue(chunk.value);
      } catch (error) {
        if (finished) return;
        cleanup();
        // A broken transport poisons all clones, but cancelling this reader does not.
        if (!signal.aborted) evictFailedBodies.get(response)?.();
        controller.error(error);
      }
    },
    cancel() { cleanup(); void reader.cancel().catch(() => undefined); },
  });
  const result = new Response(body, { status: copy.status, statusText: copy.statusText, headers: copy.headers });
  Object.defineProperties(result, {
    url: { value: copy.url }, redirected: { value: copy.redirected }, type: { value: copy.type },
  });
  return result;
}

function canShare(init?: RequestInit) {
  // The URL-only cache must not mix authorization headers, credentials or other variants.
  return !init || (Object.keys(init).every(key => ['method', 'cache', 'signal'].includes(key)) &&
    (!init.cache || init.cache === 'default' || init.cache === 'no-store'));
}

function startWorkspaceRefresh(url: WorkspaceRequest, init?: RequestInit): Promise<Response> {
  const current = responseCache.get(url);
  if (current?.refresh) return current.refresh;
  const entry: CacheEntry = current ?? { controller: new AbortController(), expiresAt: 0, response: null, refresh: null };
  const transport = new AbortController();
  entry.controller = transport;
  responseCache.set(url, entry);
  const headerTimer = setTimeout(() => transport.abort(loadingTimeout()), READ_DEADLINE_MS);
  const refresh = fetch(url, { ...init, signal: transport.signal })
    .then(response => {
      let cached: Response | null = null;
      const evict = (timeout?: DOMException) => {
        // An old body cannot evict a replacement or discard a newer in-flight refresh.
        if (cached && responseCache.get(url) === entry && entry.response === cached) {
          if (entry.controller === transport) responseCache.delete(url);
          else { entry.response = null; entry.expiresAt = 0; }
        }
        if (timeout) transport.abort(timeout);
      };
      evictFailedBodies.set(response, evict);
      if (responseCache.get(url) === entry) {
        if (response.ok && !response.redirected) {
          cached = response.clone();
          entry.response = cached;
          evictFailedBodies.set(cached, evict);
          entry.expiresAt = Date.now() + TTL_MS;
        } else {
          if (!entry.response || response.redirected || (response.status >= 400 && response.status < 500)) responseCache.delete(url);
          // An auth denial applies to all prefetched private first pages, not just this URL.
          if (response.status === 401 || response.status === 403) {
            authorizationGeneration += 1;
            revokeReaders();
            authorizationDenial = response.clone();
            evictFailedBodies.set(authorizationDenial, evict);
            for (const other of responseCache.values()) other.controller.abort();
            responseCache.clear();
          }
        }
      }
      return response;
    })
    .catch((error: unknown) => {
      if (!entry.response && responseCache.get(url) === entry) responseCache.delete(url);
      throw error;
    })
    .finally(() => { clearTimeout(headerTimer); entry.refresh = null; });
  entry.refresh = refresh;
  return refresh;
}

export async function prefetchWorkspace(url: WorkspaceRequest): Promise<void> {
  if (!activeWorkspaceScope || !cacheableRequests.has(url) || mutations.size) return;
  const current = responseCache.get(url);
  if (current?.response && current.expiresAt > Date.now()) return;
  try { await startWorkspaceRefresh(url, { cache: 'no-store' }); }
  catch { /* Navigation prefetch is opportunistic; foreground reads retain normal errors. */ }
}

export async function workspaceFetch(url: WorkspaceRequest, init?: RequestInit): Promise<Response> {
  const signal = init?.signal;
  if (signal?.aborted) throw aborted(signal);
  const method = init?.method?.toUpperCase() ?? 'GET';
  const scope = activeWorkspaceScope;
  if (!scope || method !== 'GET' || !cacheableRequests.has(url) || !canShare(init)) return fetch(url, init);
  const session = sessionGeneration;
  const authorization = authorizationGeneration;
  const waitSignal = signal
    ? AbortSignal.any([signal, sessionLifetime.signal])
    : sessionLifetime.signal;

  for (;;) {
    if (signal?.aborted) throw aborted(signal);
    if (session !== sessionGeneration) throw aborted();
    if (authorization !== authorizationGeneration && authorizationDenial) return cloneForReader(authorizationDenial, signal);
    // Reads started during a write cannot resurrect pre-write data after invalidation.
    if (mutations.size) {
      await waitFor(Promise.all([...mutations]), waitSignal);
      continue;
    }
    const generation = cacheGeneration;
    const current = responseCache.get(url);
    // Retain fast repeat navigation; failures cannot keep an old snapshot alive indefinitely.
    if (current?.response && current.expiresAt > Date.now()) return cloneForReader(current.response, signal);
    if (current?.response && current.expiresAt + STALE_GRACE_MS > Date.now()) {
      void startWorkspaceRefresh(url, init).catch(() => undefined);
      return cloneForReader(current.response, signal);
    }
    let response: Response;
    try { response = await waitFor(startWorkspaceRefresh(url, init), waitSignal); }
    catch (error) {
      if (signal?.aborted) throw aborted(signal);
      if (session !== sessionGeneration) throw aborted();
      if (authorization !== authorizationGeneration && authorizationDenial) return cloneForReader(authorizationDenial, signal);
      if (generation !== cacheGeneration) continue;
      throw error;
    }
    if (signal?.aborted) throw aborted(signal);
    if (session !== sessionGeneration) throw aborted();
    // Aborting transport alone cannot revoke an already queued successful resolution.
    if (authorization !== authorizationGeneration && authorizationDenial) return cloneForReader(authorizationDenial, signal);
    if (generation !== cacheGeneration) continue;
    return cloneForReader(response, signal);
  }
}

export function clearWorkspacePrefetch() {
  for (const entry of responseCache.values()) entry.controller.abort();
  responseCache.clear();
  cacheGeneration += 1;
}

export async function workspaceMutationFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' || method === 'HEAD') return fetch(input, init);
  const session = sessionGeneration;
  let settled!: () => void;
  const pending = new Promise<void>(resolve => { settled = resolve; });
  mutations.add(pending);
  clearWorkspacePrefetch();
  try { return await fetch(input, init); }
  finally {
    // A lost/error response may follow a successful server commit; never trust the old cache.
    if (session === sessionGeneration) clearWorkspacePrefetch();
    mutations.delete(pending);
    settled();
  }
}
