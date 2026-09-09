import type { TutorialAction, TutorialStateDto } from '@/lib/tutorial/tutorial-state';

type PendingAction = { action: TutorialAction; at: string };
export type TutorialProgressSnapshot = {
  confirmed: TutorialStateDto | null;
  tutorial: TutorialStateDto | null;
  pending: number;
  error: string;
  needsReconciliation: boolean;
};

// Client projection only. Keep the server's bounded transition semantics; never
// import its Prisma-backed module into the client bundle.
export function projectTutorial(state: TutorialStateDto, { action, at }: PendingAction): TutorialStateDto {
  const next = { ...state, version: state.version + 1 };
  switch (action) {
    case 'NEXT': return { ...next, step: Math.min(state.step + 1, state.lastStep) };
    case 'BACK': return { ...next, step: Math.max(0, state.step - 1) };
    case 'SKIP': return { ...next, skippedAt: at };
    case 'RESUME': return { ...next, skippedAt: null };
    case 'COMPLETE': return { ...next, step: state.lastStep, completedAt: at };
    case 'RESTART': return { ...next, step: 0, skippedAt: null, completedAt: null };
  }
}

function parseState(value: unknown): TutorialStateDto {
  const state = value as TutorialStateDto | undefined;
  if (!state || !Number.isSafeInteger(state.version) || state.version < 1 || state.lastStep !== 5
    || !Number.isInteger(state.step) || state.step < 0 || state.step > state.lastStep
    || !(state.skippedAt === null || typeof state.skippedAt === 'string')
    || !(state.completedAt === null || typeof state.completedAt === 'string')) throw new Error('Invalid tutorial response');
  return state;
}

function sameEffect(actual: TutorialStateDto, expected: TutorialStateDto) {
  return actual.version === expected.version && actual.step === expected.step && actual.lastStep === expected.lastStep
    && Boolean(actual.skippedAt) === Boolean(expected.skippedAt) && Boolean(actual.completedAt) === Boolean(expected.completedAt);
}

export function createTutorialProgress(initial?: TutorialStateDto, options: { fetch?: typeof fetch; timeoutMs?: number; now?: () => string } = {}) {
  let confirmed = initial ?? null;
  let queue: PendingAction[] = [];
  let attempt: { base: TutorialStateDto; item: PendingAction; uncertain: boolean } | null = null;
  let error = '';
  let needsReconciliation = false;
  let active = false;
  let running = false;
  let epoch = 0;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const fetcher: typeof fetch = options.fetch ?? ((...args) => fetch(...args));
  let snapshot: TutorialProgressSnapshot = { confirmed, tutorial: confirmed, pending: 0, error: '', needsReconciliation: false };

  function publish() {
    snapshot = { confirmed, tutorial: confirmed ? queue.reduce(projectTutorial, confirmed) : null, pending: queue.length, error, needsReconciliation };
    listeners.forEach(listener => listener());
  }

  async function request(body?: { expectedVersion: number; action: TutorialAction }) {
    const abort = new AbortController();
    controller = abort;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher('/api/tutorial', body ? {
            method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal,
          } : { cache: 'no-store', signal: abort.signal });
          if (!response.ok) return { status: response.status, state: null };
          const data = await response.json() as { tutorial?: unknown };
          return { status: response.status, state: parseState(data.tutorial) };
        })(),
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener('abort', () => reject(new Error('Tutorial request cancelled')), { once: true });
          timer = setTimeout(() => { abort.abort(); reject(new Error('Tutorial save timed out')); }, options.timeoutMs ?? 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (controller === abort) controller = null;
    }
  }

  async function read() {
    const response = await request();
    if (!response.state) throw new Error('Could not load tutorial');
    return response.state;
  }

  async function drain() {
    if (!active || running || error || !confirmed || !queue.length) return;
    running = true;
    const generation = epoch;
    let conflicts = 0;
    const current = () => active && epoch === generation;
    try {
      while (current() && queue.length && !error) {
        attempt ??= { base: confirmed!, item: queue[0], uncertain: false };
        const sent = attempt;
        let mayHaveApplied = true;
        try {
          const response = await request({ expectedVersion: sent.base.version, action: sent.item.action });
          if (!current()) return;
          if (response.status === 409) {
            mayHaveApplied = false;
            // A 409 definitively did not apply this attempt. A previous transport
            // failure may have applied it, so never blindly replay that action.
            const fresh = await read();
            if (!current()) return;
            if (fresh.version < sent.base.version) throw new Error('Stale tutorial response');
            if (sent.uncertain && fresh.version > sent.base.version) {
              if (!sameEffect(fresh, projectTutorial(sent.base, sent.item))) {
                needsReconciliation = true;
                error = 'Could not confirm your last save. Use saved progress to continue safely.';
                publish();
                return;
              }
              confirmed = fresh;
              queue.shift();
              attempt = null;
              conflicts = 0;
            } else {
              confirmed = fresh;
              attempt = sent.uncertain && fresh.version === sent.base.version ? sent : null;
              if (++conflicts >= 2) error = 'Progress changed in another session. Your changes are not saved. Retry when ready.';
            }
          } else {
            if (!response.state || !sameEffect(response.state, projectTutorial(sent.base, sent.item))) throw new Error('Save was not confirmed');
            confirmed = response.state;
            queue.shift();
            attempt = null;
            conflicts = 0;
          }
          publish();
        } catch {
          if (!current()) return;
          // Keep the exact expectedVersion for retry: CAS prevents a lost
          // successful response from applying NEXT/BACK a second time.
          if (attempt && mayHaveApplied) attempt.uncertain = true;
          error = 'Progress not saved. Your changes are kept here. Retry to save them.';
          publish();
        }
      }
    } finally {
      if (current()) running = false;
    }
  }

  async function load(discardPending = false) {
    if (!active || running) return null;
    running = true;
    const generation = epoch;
    const discarded = new Set(discardPending ? queue : []);
    try {
      const fresh = await read();
      if (!active || generation !== epoch) return null;
      confirmed = fresh;
      if (discardPending) { queue = queue.filter(item => !discarded.has(item)); attempt = null; }
      error = '';
      needsReconciliation = false;
      publish();
      return fresh;
    } catch {
      if (!active || generation !== epoch) return null;
      error = 'Could not load saved progress. Please retry.';
      publish();
      return null;
    } finally {
      if (active && generation === epoch) { running = false; void drain(); }
    }
  }

  async function recover() {
    if (!active || running || !attempt) return;
    running = true;
    const generation = epoch;
    const sent = attempt;
    try {
      // Read canonical state first after an ambiguous transport failure. With
      // no idempotency key in this protocol, an uncertain advance cannot be
      // replayed against a newer version unless its previous effect is known.
      const fresh = await read();
      if (!active || generation !== epoch) return;
      if (fresh.version < sent.base.version) throw new Error('Stale tutorial response');
      if (sent.uncertain && fresh.version > sent.base.version) {
        if (!sameEffect(fresh, projectTutorial(sent.base, sent.item))) {
          needsReconciliation = true;
          error = 'Could not confirm your last save. Use saved progress to continue safely.';
          publish();
          return;
        }
        queue.shift();
      }
      confirmed = fresh;
      // The original request may commit just after this GET. Preserve its
      // uncertainty and CAS version so the retry's 409 acknowledges that effect.
      attempt = sent.uncertain && fresh.version === sent.base.version ? sent : null;
      error = '';
      publish();
    } catch {
      if (active && generation === epoch) {
        error = 'Progress not saved. Could not check the last save. Please retry.';
        publish();
      }
    } finally {
      if (active && generation === epoch) { running = false; void drain(); }
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      active = true;
      epoch++;
      if (!confirmed) void load();
      else void drain();
    },
    stop() {
      active = false;
      epoch++;
      controller?.abort();
      if (attempt) attempt.uncertain = true;
      running = false;
    },
    dispatch(action: TutorialAction) {
      if (!confirmed || !active) return false;
      queue.push({ action, at: options.now?.() ?? new Date().toISOString() });
      publish();
      void drain();
      return true;
    },
    retry() {
      if (running || needsReconciliation) return;
      if (attempt) { void recover(); return; }
      error = '';
      publish();
      if (!confirmed) void load();
      else void drain();
    },
    useSavedProgress() { return load(true); },
  };
}
