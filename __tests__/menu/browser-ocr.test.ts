import { recognizeMenuPhotos } from '@/lib/menu/browser-ocr';

type Action = 'load' | 'loadLanguage' | 'initialize' | 'recognize';
type Packet = { workerId: string; jobId: string; action: Action; payload: Record<string, unknown> };

// Model native worker messages. A startup rejection never yields another handle
// or eventual successful initialization, matching the language-404 regression.
class TestWorker {
  static instances: TestWorker[] = [];
  static failAt: Action | null = null;
  static hangAt: Action | null = null;
  static constructorFailure = false;
  static postFailure = false;
  static text = 'Paneer Tikka 240\n';
  static blocks: unknown = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  packets: Packet[] = [];
  constructor(readonly url: string) {
    if (TestWorker.constructorFailure) throw new Error('Worker blocked');
    TestWorker.instances.push(this);
  }
  terminate = jest.fn(() => { this.terminated = true; });
  postMessage = jest.fn((packet: Packet, _transfer: Transferable[]) => {
    void _transfer; // Asserted through the recorded mock call; no transfer in Node.
    if (TestWorker.postFailure) throw new Error('DataCloneError');
    this.packets.push(packet);
    Promise.resolve().then(() => {
      if (this.terminated || TestWorker.hangAt === packet.action) return;
      if (TestWorker.failAt === packet.action) this.reply(packet, 'reject', 'Network error: language response 404');
      else this.reply(packet, 'resolve', packet.action === 'recognize' ? { text: TestWorker.text, confidence: 83, blocks: TestWorker.blocks } : {});
    });
  });
  reply(packet: Packet, status: string, data: unknown) {
    this.onmessage?.({ data: { workerId: packet.workerId, jobId: packet.jobId, action: packet.action, status, data } } as MessageEvent);
  }
  get lastPacket() { return this.packets[this.packets.length - 1]; }
}

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
let controller: AbortController;
let progress: jest.Mock;
const photo = () => new File(['local image bytes'], 'menu.png', { type: 'image/png' });
const read = (photos = [photo()]) => recognizeMenuPhotos(photos, { signal: controller.signal, onProgress: progress });
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
const owner = () => TestWorker.instances.at(-1)!;
function released(worker = owner()) {
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
}

beforeEach(() => {
  controller = new AbortController(); progress = jest.fn();
  TestWorker.instances = []; TestWorker.failAt = null; TestWorker.hangAt = null;
  TestWorker.constructorFailure = false; TestWorker.postFailure = false;
  TestWorker.text = 'Paneer Tikka 240\n'; TestWorker.blocks = null;
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: TestWorker });
});
afterEach(() => {
  jest.restoreAllMocks(); jest.useRealTimers();
  if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
  else Reflect.deleteProperty(globalThis, 'Worker');
});

test('reuses one bundled worker for a batch and retains menu cleaning and confidence', async () => {
  await expect(read([photo(), photo()])).resolves.toEqual({ text: 'Paneer Tikka', confidences: [0.83] });
  expect(TestWorker.instances).toHaveLength(1);
  expect(owner().url).toBe('/ocr/worker.min.js');
  expect(owner().packets.map(packet => packet.action)).toEqual(['load', 'loadLanguage', 'initialize', 'recognize', 'recognize']);
  expect(owner().packets.slice(0, 3).map(packet => packet.payload)).toEqual([
    { options: { lstmOnly: true, corePath: '/ocr/core', logging: false } },
    { langs: 'eng', options: { langPath: '/ocr/lang', gzip: true, lstmOnly: true } },
    { langs: 'eng', oem: 1, config: {} },
  ]);
  expect(owner().lastPacket.payload.output).toEqual({ text: true, blocks: true });
  const last = owner().postMessage.mock.calls.at(-1)!;
  expect(last[1]).toEqual([(last[0].payload.image as Uint8Array).buffer]);
  expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ image: 2, total: 2, progress: 1 });
  released();
});

test.each(['load', 'loadLanguage', 'initialize', 'recognize'] as const)('cancelling during %s settles immediately and releases the worker without waiting for startup', async action => {
  TestWorker.hangAt = action;
  const result = read();
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await flush();
  expect(owner().lastPacket.action).toBe(action);
  const lateHandler = owner().onmessage!;
  const packet = owner().lastPacket;
  const count = progress.mock.calls.length;
  controller.abort();
  await assertion;
  for (const status of ['progress', 'resolve', 'reject']) {
    lateHandler({ data: { ...packet, status, data: { text: 'stale', progress: 1 } } } as MessageEvent);
  }
  expect(progress).toHaveBeenCalledTimes(count);
  expect(owner().lastPacket.action).toBe(action);
  released();
});

test.each(['load', 'loadLanguage', 'initialize', 'recognize'] as const)('%s failure leaves no live reader and gives a manual fallback', async action => {
  TestWorker.failAt = action;
  await expect(read()).rejects.toThrow(/enter.*manually/);
  released();
});

test.each(['loadLanguage', 'recognize'] as const)('a stalled %s times out and removes its listener and timer', async action => {
  jest.useFakeTimers(); TestWorker.hangAt = action;
  const removed = jest.spyOn(controller.signal, 'removeEventListener');
  const result = read();
  const assertion = expect(result).rejects.toThrow(/too long.*manually/);
  await flush();
  jest.advanceTimersByTime(120_000);
  await assertion;
  released();
  expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(jest.getTimerCount()).toBe(0);
});

test('cancelling while file bytes are pending prevents recognition even after bytes arrive', async () => {
  const file = photo();
  let finish!: (bytes: ArrayBuffer) => void;
  jest.spyOn(file, 'arrayBuffer').mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const result = read([file]);
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await flush(); controller.abort(); await assertion;
  finish(new ArrayBuffer(2)); await flush();
  expect(owner().packets.some(packet => packet.action === 'recognize')).toBe(false);
  released();
});

test('abort from initial progress does not start a worker', async () => {
  progress.mockImplementation(() => controller.abort());
  await expect(read()).rejects.toMatchObject({ name: 'AbortError' });
  expect(TestWorker.instances).toHaveLength(0);
});

test('abort from completion progress prevents successful text delivery', async () => {
  progress.mockImplementation(value => { if (value.image === 1 && value.progress === 1) controller.abort(); });
  await expect(read()).rejects.toMatchObject({ name: 'AbortError' });
  released();
});

test('line confidence stays finite and unknown confidence requires review', async () => {
  TestWorker.blocks = [{ paragraphs: [{ lines: [
    { text: 'Paneer Tikka 240', confidence: NaN },
    { text: 'Dal Fry 180', confidence: 92 },
  ] }] }];
  await expect(read()).resolves.toEqual({ text: 'Paneer Tikka\nDal Fry', confidences: [0, 0.92] });
  released();
});

test('broken progress callbacks cannot strand a worker', async () => {
  progress.mockImplementation(() => { throw new Error('unmounted'); });
  await expect(read()).resolves.toMatchObject({ text: 'Paneer Tikka' });
  released();
});

test.each(['constructor', 'postMessage', 'onerror', 'onmessageerror'] as const)('%s failures provide a manual fallback', async phase => {
  TestWorker.constructorFailure = phase === 'constructor';
  TestWorker.postFailure = phase === 'postMessage';
  if (phase.startsWith('on')) TestWorker.hangAt = 'initialize';
  const result = read();
  const assertion = expect(result).rejects.toThrow(/manually/);
  await flush();
  if (phase === 'onerror') owner().onerror?.({ preventDefault: jest.fn() } as unknown as ErrorEvent);
  if (phase === 'onmessageerror') owner().onmessageerror?.();
  await assertion;
  if (phase !== 'constructor') released();
});

test('concurrent reads own separate workers', async () => {
  TestWorker.hangAt = 'loadLanguage';
  const first = read();
  const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = recognizeMenuPhotos([photo()], { signal: new AbortController().signal, onProgress: jest.fn() });
  await flush();
  controller.abort(); await cancelled;
  released(TestWorker.instances[0]);
  expect(owner().terminated).toBe(false);
  owner().reply(owner().lastPacket, 'resolve', {});
  await expect(second).resolves.toMatchObject({ text: 'Paneer Tikka' });
  released();
});

test('empty and already cancelled batches do not start workers', async () => {
  await expect(read([])).resolves.toEqual({ text: '', confidences: [] });
  controller.abort();
  await expect(read()).rejects.toMatchObject({ name: 'AbortError' });
  expect(TestWorker.instances).toHaveLength(0);
});
