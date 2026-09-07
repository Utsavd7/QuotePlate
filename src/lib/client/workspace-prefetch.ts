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
  controller: AbortController | null;
  expiresAt: number;
  response: Response | null;
  refresh: Promise<Response> | null;
  scope: string;
};

const TTL_MS = 30_000;
const cacheableRequests = new Set<string>(Object.values(WORKSPACE_FIRST_REQUESTS));
const responseCache = new Map<string, CacheEntry>();
let activeWorkspaceScope: string | null = null;
let cacheGeneration = 0;

export function setWorkspacePrefetchScope(scope: string | null) {
  if (activeWorkspaceScope === scope) return;
  clearWorkspacePrefetch();
  activeWorkspaceScope = scope;
}

// Keep stale data only for transient network and server failures; every 4xx is terminal.
function isTerminalWorkspaceResponse(response: Response) {
  return response.status >= 400 && response.status < 500;
}

function startWorkspaceRefresh(
  url: WorkspaceRequest,
  scope: string,
  init?: RequestInit,
): Promise<Response> {
  const current = responseCache.get(url);
  const entry = current?.scope === scope
    ? current
    : {
        controller: null,
        expiresAt: 0,
        response: null,
        refresh: null,
        scope,
      };

  if (entry.refresh) return entry.refresh;
  if (entry !== current) responseCache.set(url, entry);

  const controller = new AbortController();
  entry.controller = controller;
  const refresh = fetch(url, { ...init, signal: controller.signal })
    .then((response) => {
      if (
        response.ok &&
        activeWorkspaceScope === scope &&
        responseCache.get(url) === entry
      ) {
        entry.response = response.clone();
        entry.expiresAt = Date.now() + TTL_MS;
      } else if (
        (!entry.response || isTerminalWorkspaceResponse(response)) &&
        responseCache.get(url) === entry
      ) {
        responseCache.delete(url);
      }
      return response;
    })
    .catch((error: unknown) => {
      if (!entry.response && responseCache.get(url) === entry) {
        responseCache.delete(url);
      }
      throw error;
    })
    .finally(() => {
      if (entry.refresh === refresh && entry.controller === controller) {
        entry.refresh = null;
        entry.controller = null;
      }
    });
  entry.refresh = refresh;
  return refresh;
}

export async function prefetchWorkspace(url: WorkspaceRequest): Promise<void> {
  const scope = activeWorkspaceScope;
  if (!scope || !cacheableRequests.has(url)) return;

  const current = responseCache.get(url);
  if (current?.scope === scope && current.response && current.expiresAt > Date.now()) return;

  try {
    await startWorkspaceRefresh(url, scope, { cache: 'no-store' });
  } catch {
    // Prefetching is opportunistic; the normal request path may retry.
  }
}

export async function workspaceFetch(
  url: WorkspaceRequest,
  init?: RequestInit,
): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const scope = activeWorkspaceScope;
  if (init?.signal || !scope || method !== 'GET' || !cacheableRequests.has(url)) {
    return fetch(url, init);
  }
  const generation = cacheGeneration;

  const current = responseCache.get(url);
  if (current?.scope === scope && current.response) {
    if (current.expiresAt > Date.now()) return current.response.clone();

    void startWorkspaceRefresh(url, scope, init).catch(() => undefined);
    return current.response.clone();
  }

  let response: Response;
  try {
    response = await startWorkspaceRefresh(url, scope, init);
  } catch (error) {
    if (activeWorkspaceScope !== scope || cacheGeneration !== generation) {
      return workspaceFetch(url, init);
    }
    throw error;
  }
  if (activeWorkspaceScope !== scope || cacheGeneration !== generation) {
    return workspaceFetch(url, init);
  }
  return response.clone();
}

export function clearWorkspacePrefetch() {
  for (const entry of responseCache.values()) {
    entry.controller?.abort();
  }
  responseCache.clear();
  cacheGeneration += 1;
}

export async function workspaceMutationFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET' && response.ok) clearWorkspacePrefetch();
  return response;
}
