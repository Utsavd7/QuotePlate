// Account bootstrap is deliberately uncached: it establishes the current workspace.
// Bound both headers and JSON reading, and cancel when its layout is discarded.
export async function readWorkspaceAccount(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  const deadline = new AbortController();
  const cancel = () => deadline.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  const combined = deadline.signal;
  const timer = setTimeout(() => deadline.abort(
    new DOMException('Loading the restaurant account took too long.', 'TimeoutError'),
  ), 15_000);
  try {
    const response = await fetch('/api/account', { cache: 'no-store', signal: combined });
    if (combined.aborted) throw combined.reason;
    if (!response.ok) {
      // The status is enough to redirect or offer retry; stop an unread error body.
      deadline.abort();
      void response.body?.cancel().catch(() => undefined);
      return { status: response.status, data: null };
    }
    const data: unknown = await response.json();
    if (combined.aborted) throw combined.reason;
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
