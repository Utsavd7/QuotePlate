// Publish the authenticated request before its optional comparison finishes.
// No responses are retained between loads or shared between workspaces.
export async function loadPurchase<T extends { status: string }, C>(
  requestId: string,
  onRequest: (request: T, needsComparison: boolean) => void,
  onComparison: (comparison: C | null) => void,
  signal?: AbortSignal,
) {
  async function read<R>(url: string, fallback: string): Promise<R> {
    signal?.throwIfAborted();
    const response = await fetch(url, { cache: 'no-store', ...(signal ? { signal } : {}) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || body.error || fallback);
    }
    const result = await response.json() as R;
    signal?.throwIfAborted();
    return result;
  }

  const url = `/api/requests/${encodeURIComponent(requestId)}`;
  const { request } = await read<{ request: T }>(url, 'We could not load this request.');
  const needsComparison = request.status === 'OPEN' || request.status === 'AWARDED';
  onComparison(null);
  onRequest(request, needsComparison);
  if (needsComparison) onComparison(await read<C>(`${url}/comparison`, 'We could not load supplier quotes.'));
}
