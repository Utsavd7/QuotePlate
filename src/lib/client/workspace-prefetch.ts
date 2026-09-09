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
const cacheableRequests = new Set<string>(Object.values(WORKSPACE_FIRST_REQUESTS));
const responseCache = new Map<string, CacheEntry>();
const mutations = new Set<Promise<void>>();
let activeWorkspaceScope: string | null = null;
let cacheGeneration = 0;
let sessionGeneration = 0;
let authorizationGeneration = 0;
let authorizationDenial: Response | null = null;

export function setWorkspacePrefetchScope(scope: string | null) {
  if (activeWorkspaceScope === scope) return;
  sessionGeneration += 1;
  authorizationDenial = null;
  clearWorkspacePrefetch();
  mutations.clear();
  activeWorkspaceScope = scope;
}

function aborted(signal?: AbortSignal | null) {
  return signal?.reason ?? new DOMException('Workspace read cancelled.', 'AbortError');
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

function cloneForReader(response: Response, signal?: AbortSignal | null): Response {
  const copy = response.clone();
  if (!signal || !copy.body) return copy;
  const reader = copy.body.getReader();
  let cancel: () => void;
  const cleanup = () => signal.removeEventListener('abort', cancel);
  // Preserve fetch's body-level cancellation while leaving the shared cache branch intact.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      cancel = () => {
        cleanup();
        controller.error(aborted(signal));
        void reader.cancel().catch(() => undefined);
      };
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (signal.aborted) return;
        if (chunk.done) { cleanup(); controller.close(); }
        else controller.enqueue(chunk.value);
      } catch (error) { cleanup(); controller.error(error); }
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
  entry.controller = new AbortController();
  responseCache.set(url, entry);
  const refresh = fetch(url, { ...init, signal: entry.controller.signal })
    .then(response => {
      if (responseCache.get(url) === entry) {
        if (response.ok && !response.redirected) {
          entry.response = response.clone();
          entry.expiresAt = Date.now() + TTL_MS;
        } else {
          if (!entry.response || response.redirected || (response.status >= 400 && response.status < 500)) responseCache.delete(url);
          // An auth denial applies to all prefetched private first pages, not just this URL.
          if (response.status === 401 || response.status === 403) {
            authorizationGeneration += 1;
            authorizationDenial = response.clone();
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
    .finally(() => { entry.refresh = null; });
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

  for (;;) {
    if (signal?.aborted) throw aborted(signal);
    if (session !== sessionGeneration) throw aborted();
    if (authorization !== authorizationGeneration && authorizationDenial) return cloneForReader(authorizationDenial, signal);
    // Reads started during a write cannot resurrect pre-write data after invalidation.
    if (mutations.size) {
      await waitFor(Promise.all([...mutations]), signal);
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
    try { response = await waitFor(startWorkspaceRefresh(url, init), signal); }
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
