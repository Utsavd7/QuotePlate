import { loadPurchase } from '@/lib/client/load-purchase';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('progressive purchase loading', () => {
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it('shows request facts at 100ms while a 900ms comparison is still pending', async () => {
    jest.useFakeTimers();
    const started = Date.now();
    const milestones: { stage: string; elapsed: number }[] = [];
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(response({ request: { status: 'OPEN', title: 'Lunch' } })), 100)))
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(response({ quotes: [] })), 900)));
    const work = loadPurchase('request/1',
      () => milestones.push({ stage: 'request', elapsed: Date.now() - started }),
      value => { if (value !== null) milestones.push({ stage: 'comparison', elapsed: Date.now() - started }); });
    await jest.advanceTimersByTimeAsync(100);
    expect(milestones).toEqual([{ stage: 'request', elapsed: 100 }]);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/requests/request%2F1/comparison', { cache: 'no-store' });
    await jest.advanceTimersByTimeAsync(900);
    await work;
    expect(milestones).toEqual([{ stage: 'request', elapsed: 100 }, { stage: 'comparison', elapsed: 1000 }]);
  });

  it.each(['DRAFT', 'CANCELLED'])('does not issue a comparison request for %s', async status => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ request: { status } }));
    const onComparison = jest.fn();
    await loadPurchase('one', jest.fn(), onComparison);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onComparison).toHaveBeenCalledWith(null);
  });

  it('keeps request facts available if comparison fails, without inventing an empty comparison', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ request: { status: 'AWARDED' } }))
      .mockResolvedValueOnce(response({ detail: 'Comparison unavailable' }, 503));
    const onRequest = jest.fn(), onComparison = jest.fn();
    await expect(loadPurchase('one', onRequest, onComparison)).rejects.toThrow('Comparison unavailable');
    expect(onRequest).toHaveBeenCalledWith({ status: 'AWARDED' }, true);
    expect(onComparison).toHaveBeenCalledTimes(1);
    expect(onComparison).toHaveBeenCalledWith(null);
  });

  it.each([401, 403, 404])('publishes no private facts and makes no secondary request after %s', async status => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: 'Unavailable' }, status));
    const onRequest = jest.fn(), onComparison = jest.fn();
    await expect(loadPurchase('one', onRequest, onComparison)).rejects.toThrow('Unavailable');
    expect(onRequest).not.toHaveBeenCalled();
    expect(onComparison).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('performs fresh authenticated reads on every load', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ request: { status: 'DRAFT' } }));
    await loadPurchase('one', jest.fn(), jest.fn());
    await loadPurchase('one', jest.fn(), jest.fn());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/requests/one', { cache: 'no-store' });
  });

  it('clears an old comparison before publishing new request facts', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ request: { status: 'OPEN' } }))
      .mockResolvedValueOnce(response({}, 503));
    let comparison: unknown = { requestId: 'previous' };
    await expect(loadPurchase('new', () => expect(comparison).toBeNull(), value => { comparison = value; }))
      .rejects.toThrow('We could not load supplier quotes.');
    expect(comparison).toBeNull();
  });

  it.each(['request', 'comparison'])('does not publish a superseded %s body even if fetch ignores abort', async stage => {
    const controller = new AbortController();
    let finishBody!: (value: unknown) => void;
    let bodyStarted!: () => void;
    const reading = new Promise<void>(resolve => { bodyStarted = resolve; });
    const delayed = { ok: true, json: () => { bodyStarted(); return new Promise(resolve => { finishBody = resolve; }); } } as Response;
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    if (stage === 'comparison') fetchMock.mockResolvedValueOnce(response({ request: { status: 'OPEN' } }));
    fetchMock.mockResolvedValueOnce(delayed);
    const onRequest = jest.fn(), onComparison = jest.fn();
    const pending = loadPurchase('old', onRequest, onComparison, controller.signal);
    await reading;
    controller.abort();
    finishBody(stage === 'request' ? { request: { status: 'OPEN' } } : { quotes: ['stale'] });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    if (stage === 'request') {
      expect(onRequest).not.toHaveBeenCalled();
      expect(onComparison).not.toHaveBeenCalled();
    } else {
      expect(onComparison).toHaveBeenCalledTimes(1);
    expect(onComparison).toHaveBeenCalledWith(null);
    }
  });
});
