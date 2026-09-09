import { createTutorialProgress, projectTutorial } from '@/components/tutorial/tutorial-progress';
import { transitionTutorialState, type TutorialAction, type TutorialStateDto } from '@/lib/tutorial/tutorial-state';

const initial: TutorialStateDto = { version: 1, step: 0, lastStep: 5, skippedAt: null, completedAt: null };
const at = '2026-09-09T10:00:00.000Z';
const response = (tutorial: TutorialStateDto) => new Response(JSON.stringify({ tutorial }), { status: 200 });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function setup(fetcher: jest.Mock, start = initial, timeoutMs = 10000) {
  const store = createTutorialProgress(start, { fetch: fetcher as typeof fetch, now: () => at, timeoutMs });
  store.start();
  return store;
}
function command(fetcher: jest.Mock, index: number) { return JSON.parse(fetcher.mock.calls[index][1].body); }

describe('optimistic tutorial progress', () => {
  it.each<TutorialAction>(['NEXT', 'BACK', 'SKIP', 'RESUME', 'COMPLETE', 'RESTART'])('projects %s with the same semantics as the server', action => {
    const state = { ...initial, step: 2, skippedAt: at, completedAt: at };
    const server = transitionTutorialState({ ...state, skippedAt: new Date(at), completedAt: new Date(at) }, action, new Date(at));
    expect(projectTutorial(state, { action, at })).toEqual({ ...server, lastStep: 5, skippedAt: server.skippedAt?.toISOString() ?? null, completedAt: server.completedAt?.toISOString() ?? null });
  });

  it('renders rapid NEXT/NEXT/BACK immediately while saving one ordered command at a time', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const third = deferred<Response>();
    const fetcher = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const store = setup(fetcher);
    try {
      store.dispatch('NEXT'); store.dispatch('NEXT'); store.dispatch('BACK');
      expect(store.getSnapshot()).toMatchObject({ tutorial: { step: 1 }, confirmed: { step: 0 }, pending: 3 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      first.resolve(response({ ...initial, step: 1, version: 2 })); await tick();
      expect(store.getSnapshot()).toMatchObject({ tutorial: { step: 1 }, pending: 2 });
      expect(command(fetcher, 1)).toEqual({ expectedVersion: 2, action: 'NEXT' });
      second.resolve(response({ ...initial, step: 2, version: 3 })); await tick();
      expect(command(fetcher, 2)).toEqual({ expectedVersion: 3, action: 'BACK' });
      third.resolve(response({ ...initial, step: 1, version: 4 })); await tick();
      expect(store.getSnapshot()).toMatchObject({ confirmed: { step: 1, version: 4 }, pending: 0, error: '' });
    } finally { store.stop(); }
  });

  it('keeps finish/restart and skip/resume in order without waiting for their saves', async () => {
    const first = deferred<Response>();
    let canonical = { ...initial, step: 5 };
    const fetcher = jest.fn().mockImplementation(async (_url, init) => {
      const action = JSON.parse(init.body).action;
      canonical = projectTutorial(canonical, { action, at });
      if (fetcher.mock.calls.length === 1) return first.promise;
      return response(canonical);
    });
    const store = setup(fetcher, canonical);
    try {
      store.dispatch('COMPLETE');
      expect(store.getSnapshot()).toMatchObject({ tutorial: { completedAt: at }, confirmed: { completedAt: null }, pending: 1 });
      store.dispatch('RESTART'); store.dispatch('SKIP'); store.dispatch('RESUME');
      expect(store.getSnapshot()).toMatchObject({ tutorial: { step: 0, skippedAt: null, completedAt: null }, pending: 4 });
      first.resolve(response(canonical)); await tick(); await tick();
      expect(store.getSnapshot()).toMatchObject({ tutorial: { step: 0, skippedAt: null, completedAt: null }, pending: 0 });
      expect(fetcher.mock.calls.map((_, index) => command(fetcher, index).action)).toEqual(['COMPLETE', 'RESTART', 'SKIP', 'RESUME']);
    } finally { store.stop(); }
  });

  it('refreshes a definite 409 and rebases every still-pending action on the canonical version', async () => {
    const conflict = deferred<Response>();
    const fetcher = jest.fn().mockReturnValueOnce(conflict.promise)
      .mockResolvedValueOnce(response({ ...initial, version: 8, step: 2 }))
      .mockResolvedValueOnce(response({ ...initial, version: 9, step: 3 }))
      .mockResolvedValueOnce(response({ ...initial, version: 10, step: 2 }));
    const store = setup(fetcher);
    try {
      store.dispatch('NEXT'); store.dispatch('BACK');
      conflict.resolve(new Response('{}', { status: 409 })); await tick(); await tick();
      expect(fetcher.mock.calls[1][1].body).toBeUndefined();
      expect(command(fetcher, 2)).toEqual({ expectedVersion: 8, action: 'NEXT' });
      expect(command(fetcher, 3)).toEqual({ expectedVersion: 9, action: 'BACK' });
      expect(store.getSnapshot()).toMatchObject({ tutorial: { step: 2, version: 10 }, pending: 0, error: '' });
    } finally { store.stop(); }
  });

  it('bounds repeated conflicts instead of retrying forever or claiming saved progress', async () => {
    const fetcher = jest.fn().mockImplementation(async (_url, init) => init.method === 'PATCH'
      ? new Response('{}', { status: 409 }) : response({ ...initial, version: 8, step: 2 }));
    const store = setup(fetcher);
    try {
      store.dispatch('NEXT'); await tick(); await tick();
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(store.getSnapshot()).toMatchObject({ tutorial: { step: 3 }, pending: 1 });
      expect(store.getSnapshot().error).toContain('not saved');
    } finally { store.stop(); }
  });

  it('reads before retry and does not send NEXT twice when the first response was lost after commit', async () => {
    const fetcher = jest.fn().mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(response({ ...initial, version: 2, step: 1 }))
      .mockResolvedValueOnce(response({ ...initial, version: 3, step: 2 }));
    const store = setup(fetcher);
    try {
      store.dispatch('NEXT'); await tick();
      store.dispatch('NEXT');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot()).toMatchObject({ tutorial: { step: 2 }, pending: 2 });
      store.retry(); await tick(); await tick();
      expect(fetcher.mock.calls[1][1].body).toBeUndefined();
      expect(command(fetcher, 2)).toEqual({ expectedVersion: 2, action: 'NEXT' });
      expect(store.getSnapshot()).toMatchObject({ pending: 0, error: '', confirmed: { step: 2, version: 3 } });
    } finally { store.stop(); }
  });

  it('retries the same version only after confirming the failed save did not commit', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(response(initial)).mockResolvedValueOnce(response({ ...initial, version: 2, step: 1 }));
    const store = setup(fetcher);
    try {
      store.dispatch('NEXT'); await tick(); store.retry(); await tick();
      expect(fetcher.mock.calls[1][1].body).toBeUndefined();
      expect(command(fetcher, 2)).toEqual(command(fetcher, 0));
      expect(store.getSnapshot().pending).toBe(0);
    } finally { store.stop(); }
  });

  it('does not double NEXT if the original request commits after recovery GET but before retry CAS', async () => {
    const committed = { ...initial, version: 2, step: 1 };
    const fetcher = jest.fn().mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(response(committed));
    const store = setup(fetcher);
    try {
      store.dispatch('NEXT'); await tick(); store.retry(); await tick(); await tick();
      expect(command(fetcher, 0)).toEqual({ expectedVersion: 1, action: 'NEXT' });
      expect(command(fetcher, 2)).toEqual({ expectedVersion: 1, action: 'NEXT' });
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(store.getSnapshot()).toMatchObject({ confirmed: committed, tutorial: committed, pending: 0, error: '' });
    } finally { store.stop(); }
  });

  it.each(['skippedAt', 'completedAt'] as const)('returns canonical %s only after successful reconciliation', async field => {
    const saved = { ...initial, version: 8, step: 5, [field]: at };
    const fetcher = jest.fn().mockRejectedValueOnce(new Error('lost response'))
      .mockImplementation(async () => response(saved));
    const store = setup(fetcher);
    try {
      store.dispatch('NEXT'); await tick(); store.retry(); await tick();
      expect(store.getSnapshot().needsReconciliation).toBe(true);
      await expect(store.useSavedProgress()).resolves.toEqual(saved);
      expect(store.getSnapshot()).toMatchObject({ tutorial: saved, pending: 0, needsReconciliation: false });
    } finally { store.stop(); }
  });

  it('keeps ambiguous progress unsaved until the user explicitly chooses canonical state', async () => {
    const fetcher = jest.fn().mockRejectedValueOnce(new Error('lost response'))
      .mockImplementation(async () => response({ ...initial, version: 6, step: 4 }));
    const store = setup(fetcher);
    try {
      store.dispatch('NEXT'); await tick(); store.retry(); await tick();
      expect(store.getSnapshot()).toMatchObject({ tutorial: { step: 1 }, pending: 1, needsReconciliation: true });
      expect(fetcher).toHaveBeenCalledTimes(2);
      store.retry(); await tick(); expect(fetcher).toHaveBeenCalledTimes(2);
      store.useSavedProgress(); await tick();
      expect(store.getSnapshot()).toMatchObject({ tutorial: { step: 4 }, pending: 0, needsReconciliation: false });
    } finally { store.stop(); }
  });

  it('ignores a late successful response after timeout and resolves it through canonical retry', async () => {
    const late = deferred<Response>();
    const fetcher = jest.fn().mockReturnValueOnce(late.promise).mockResolvedValueOnce(response({ ...initial, version: 2, step: 1 }));
    const store = setup(fetcher, initial, 5);
    try {
      store.dispatch('NEXT'); await new Promise(resolve => setTimeout(resolve, 20));
      expect(store.getSnapshot().error).toContain('not saved');
      late.resolve(response({ ...initial, version: 2, step: 1 })); await tick();
      expect(store.getSnapshot()).toMatchObject({ pending: 1, confirmed: initial });
      store.retry(); await tick();
      expect(store.getSnapshot()).toMatchObject({ pending: 0, confirmed: { version: 2, step: 1 } });
    } finally { store.stop(); }
  });

  it('does not publish stale responses or drain more commands after unmount', async () => {
    const late = deferred<Response>();
    const fetcher = jest.fn().mockReturnValue(late.promise);
    const store = setup(fetcher);
    store.dispatch('NEXT'); store.dispatch('NEXT');
    const notify = jest.fn(); store.subscribe(notify);
    store.stop(); late.resolve(response({ ...initial, version: 2, step: 1 })); await tick();
    expect(notify).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().confirmed).toEqual(initial);
  });
});
