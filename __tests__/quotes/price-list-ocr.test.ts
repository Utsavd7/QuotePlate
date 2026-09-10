import { readPriceListPhoto } from '@/lib/quotes/price-list-ocr';
import { MAX_PRICE_LIST_TEXT_LENGTH } from '@/lib/quotes/price-list';

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
  static text = 'Tomato ₹42/kg\n';
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
      else this.reply(packet, 'resolve', packet.action === 'recognize' ? { text: TestWorker.text } : {});
    });
  });
  reply(packet: Packet, status: string, data: unknown) {
    this.onmessage?.({ data: { workerId: packet.workerId, jobId: packet.jobId, action: packet.action, status, data } } as MessageEvent);
  }
  get lastPacket() { return this.packets[this.packets.length - 1]; }
}

class TestImage {
  static instances: TestImage[] = [];
  static width = 1600;
  static height = 1200;
  static autoLoad = true;
  static fail = false;
  naturalWidth = TestImage.width;
  naturalHeight = TestImage.height;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  currentSrc = '';
  constructor() { TestImage.instances.push(this); }
  set src(value: string) {
    this.currentSrc = value;
    if (value && TestImage.autoLoad) {
      Promise.resolve().then(() => TestImage.fail ? this.onerror?.() : this.onload?.());
    }
  }
}

const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
let controller: AbortController;
let progress: jest.Mock;
let createUrl: jest.SpyInstance;
let revokeUrl: jest.SpyInstance;

function photo(type = 'image/jpeg', size = 20) {
  const bytes = new Uint8Array(size);
  const file = new File([bytes], 'price-list.jpg', { type });
  jest.spyOn(file, 'arrayBuffer').mockResolvedValue(bytes.buffer);
  return file;
}
function read(file = photo()) {
  return readPriceListPhoto(file, { signal: controller.signal, onProgress: progress });
}
async function flush() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}
function owner() { return TestWorker.instances[TestWorker.instances.length - 1]; }
function expectReleased(worker = owner()) {
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.terminated).toBe(true);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
}

beforeEach(() => {
  controller = new AbortController();
  progress = jest.fn();
  TestWorker.instances = [];
  TestWorker.failAt = null;
  TestWorker.hangAt = null;
  TestWorker.constructorFailure = false;
  TestWorker.postFailure = false;
  TestWorker.text = 'Tomato ₹42/kg\n';
  TestImage.instances = [];
  TestImage.width = 1600;
  TestImage.height = 1200;
  TestImage.autoLoad = true;
  TestImage.fail = false;
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: TestImage });
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: TestWorker });
  createUrl = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-price-list');
  revokeUrl = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage);
  else Reflect.deleteProperty(globalThis, 'Image');
  if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
  else Reflect.deleteProperty(globalThis, 'Worker');
});

test('starts the bundled worker lazily after dimensions are validated and returns raw prices', async () => {
  TestImage.autoLoad = false;
  const file = photo();
  TestWorker.text = '  PRICE LIST\r\nTomato ₹42/kg\nPaneer 320.50\n';
  const pending = read(file);
  await flush();
  expect(TestWorker.instances).toHaveLength(0);
  TestImage.instances[0].onload?.();
  await expect(pending).resolves.toBe(TestWorker.text);
  expect(owner().url).toBe('/ocr/worker.min.js');
  expect(owner().packets.map((packet) => packet.action)).toEqual(['load', 'loadLanguage', 'initialize', 'recognize']);
  expect(owner().packets.map((packet) => packet.payload)).toEqual([
    { options: { lstmOnly: true, corePath: '/ocr/core', logging: false } },
    { langs: 'eng', options: { langPath: '/ocr/lang', gzip: true, lstmOnly: true } },
    { langs: 'eng', oem: 1, config: {} },
    { image: new Uint8Array(20), options: {}, output: { text: true } },
  ]);
  const lastCall = owner().postMessage.mock.calls.at(-1)!;
  expect(lastCall[1]).toEqual([(lastCall[0].payload.image as Uint8Array).buffer]);
  expect(new Set(owner().packets.map((packet) => packet.jobId)).size).toBe(4);
  expect(globalThis.Worker).toBe(TestWorker);
  expectReleased();
  expect(createUrl).toHaveBeenCalledWith(file);
  expect(revokeUrl).toHaveBeenCalledTimes(1);
  expect(TestImage.instances[0].currentSrc).toBe('');
  expect(progress.mock.calls.at(0)).toEqual([0]);
  expect(progress.mock.calls.at(-1)).toEqual([1]);
});

test.each(['image/jpeg', 'image/png', 'image/webp'])('accepts a bounded %s photo', async (type) => {
  await expect(read(photo(type))).resolves.toContain('₹42/kg');
});

test.each(['image/gif', 'image/svg+xml', 'image/heic', 'application/pdf', '', 'text/plain'])('rejects %s before decoding or creating workers', async (type) => {
  await expect(read(photo(type))).rejects.toThrow(/JPEG.*PNG.*WebP/i);
  expect(createUrl).not.toHaveBeenCalled();
  expect(TestWorker.instances).toHaveLength(0);
});

test.each([0, 8 * 1024 * 1024 + 1])('rejects invalid file size %s before decode', async (size) => {
  await expect(read(photo('image/png', size))).rejects.toThrow(/empty|8\s*MB/i);
  expect(createUrl).not.toHaveBeenCalled();
});

test('accepts the 8 MB, 20 MP and 8000-edge boundaries', async () => {
  TestImage.width = 8000;
  TestImage.height = 2500;
  await expect(read(photo('image/png', 8 * 1024 * 1024))).resolves.toContain('₹42/kg');
});

test.each([[8001, 1], [1, 8001], [5000, 4001], [0, 1200], [1200, 0], [NaN, 1200], [Infinity, 1]])('rejects dimensions %s × %s before OCR and releases the image', async (width, height) => {
  TestImage.width = width;
  TestImage.height = height;
  await expect(read()).rejects.toThrow(/20|8000|8,000|dimensions/i);
  expect(TestWorker.instances).toHaveLength(0);
  expect(revokeUrl).toHaveBeenCalledTimes(1);
  expect(TestImage.instances[0].onload).toBeNull();
  expect(TestImage.instances[0].onerror).toBeNull();
});

test('a corrupt image gives an actionable fallback and releases its URL', async () => {
  TestImage.fail = true;
  await expect(read()).rejects.toThrow(/another.*photo|paste/i);
  expect(revokeUrl).toHaveBeenCalledTimes(1);
  expect(TestWorker.instances).toHaveLength(0);
});

test.each(['Image', 'Worker'])('unavailable browser %s APIs give a paste-text fallback', async (api) => {
  Reflect.deleteProperty(globalThis, api);
  await expect(read()).rejects.toThrow(/browser.*paste|paste.*browser/i);
  expect(TestWorker.instances).toHaveLength(0);
});

test('an already aborted request does no work', async () => {
  controller.abort();
  await expect(read()).rejects.toMatchObject({ name: 'AbortError' });
  expect(createUrl).not.toHaveBeenCalled();
  expect(TestWorker.instances).toHaveLength(0);
  expect(progress).not.toHaveBeenCalled();
});

test('cancels during image loading without waiting for decode or calling OCR', async () => {
  TestImage.autoLoad = false;
  const result = read();
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await flush();
  const image = TestImage.instances[0];
  const lateLoad = image.onload;
  controller.abort();
  await assertion;
  lateLoad?.();
  await flush();
  expect(revokeUrl).toHaveBeenCalledTimes(1);
  expect(image.currentSrc).toBe('');
  expect(TestWorker.instances).toHaveLength(0);
});

test('cancellation while reading file bytes prevents a late worker from being created', async () => {
  const file = photo();
  let resolveBytes!: (bytes: ArrayBuffer) => void;
  jest.spyOn(file, 'arrayBuffer').mockReturnValue(new Promise((resolve) => { resolveBytes = resolve; }));
  const result = read(file);
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await flush();
  controller.abort();
  await assertion;
  resolveBytes(new ArrayBuffer(20));
  await flush();
  expect(TestWorker.instances).toHaveLength(0);
});

test.each(['load', 'loadLanguage', 'initialize', 'recognize'] as const)('cancellation terminates a worker stuck at %s immediately', async (action) => {
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
  expectReleased();
  for (const status of ['progress', 'resolve', 'reject']) {
    lateHandler({ data: { ...packet, status, data: { text: 'stale', progress: 1 } } } as MessageEvent);
  }
  await flush();
  expect(progress).toHaveBeenCalledTimes(count);
  expect(owner().lastPacket.action).toBe(action);
  expectReleased();
});

test.each(['load', 'loadLanguage', 'initialize', 'recognize'] as const)('a %s rejection terminates its owner without waiting for initialization', async (action) => {
  TestWorker.failAt = action;
  await expect(read()).rejects.toThrow(/paste/i);
  expect(owner().lastPacket.action).toBe(action);
  expectReleased();
});

test('repeated language 404 retries never accumulate live workers', async () => {
  TestWorker.failAt = 'loadLanguage';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(read()).rejects.toThrow(/paste/i);
    expectReleased();
    expect(TestWorker.instances.filter((worker) => !worker.terminated)).toHaveLength(0);
  }
  expect(TestWorker.instances).toHaveLength(5);
  expect(TestWorker.instances.every((worker) => worker.packets.length === 2)).toBe(true);
});

test.each(['onerror', 'onmessageerror'] as const)('native %s failures terminate the owner during startup', async (eventName) => {
  TestWorker.hangAt = 'load';
  const result = read();
  const assertion = expect(result).rejects.toThrow(/paste/i);
  await flush();
  if (eventName === 'onerror') owner().onerror?.({ preventDefault: jest.fn() } as unknown as ErrorEvent);
  else owner().onmessageerror?.();
  await assertion;
  expectReleased();
});

test.each(['constructor', 'postMessage'] as const)('%s exceptions provide a fallback without leaving an owned worker', async (phase) => {
  TestWorker.constructorFailure = phase === 'constructor';
  TestWorker.postFailure = phase === 'postMessage';
  await expect(read()).rejects.toThrow(/paste/i);
  if (phase === 'constructor') expect(TestWorker.instances).toHaveLength(0);
  else expectReleased();
  expect(revokeUrl).toHaveBeenCalledTimes(1);
});

test.each(['image', 'load', 'loadLanguage', 'initialize', 'recognize'] as const)('a stuck %s operation times out and releases resources immediately', async (phase) => {
  jest.useFakeTimers();
  if (phase === 'image') TestImage.autoLoad = false;
  else TestWorker.hangAt = phase;
  const result = read();
  const assertion = expect(result).rejects.toThrow(/too long.*paste|paste.*too long/i);
  await flush();
  if (phase !== 'image') expect(owner().lastPacket.action).toBe(phase);
  jest.advanceTimersByTime(120_000);
  await assertion;
  expect(revokeUrl).toHaveBeenCalledTimes(1);
  if (phase !== 'image') expectReleased();
  expect(jest.getTimerCount()).toBe(0);
});

test('late success cannot win over abort before the awaiting continuation', async () => {
  TestWorker.hangAt = 'recognize';
  const result = read();
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await flush();
  owner().reply(owner().lastPacket, 'resolve', { text: 'Tomato 42/kg' });
  controller.abort();
  await assertion;
  expectReleased();
});

test('abort from the final progress callback prevents success', async () => {
  progress.mockImplementation((value: number) => { if (value === 1) controller.abort(); });
  await expect(read()).rejects.toMatchObject({ name: 'AbortError' });
  expectReleased();
});

test('stale or unrelated protocol messages cannot advance startup', async () => {
  TestWorker.hangAt = 'load';
  const result = read();
  await flush();
  const packet = owner().lastPacket;
  for (const override of [{ workerId: 'other' }, { jobId: 'other' }, { action: 'initialize' }]) {
    owner().onmessage?.({ data: { ...packet, ...override, status: 'resolve', data: {} } } as MessageEvent);
  }
  await flush();
  expect(owner().packets).toHaveLength(1);
  owner().reply(packet, 'resolve', {});
  await expect(result).resolves.toContain('₹42/kg');
});

test.each(['', ' \n\t', 'x'.repeat(MAX_PRICE_LIST_TEXT_LENGTH + 1), Array(101).fill('row').join('\n')])('rejects empty or excessive OCR output without truncating', async (text) => {
  TestWorker.text = text;
  await expect(read()).rejects.toThrow(/printed English|12,?000|100/i);
  expectReleased();
});

test('returns raw text at the character boundary', async () => {
  TestWorker.text = 'Tomato 42/kg'.padEnd(MAX_PRICE_LIST_TEXT_LENGTH);
  await expect(read()).resolves.toBe(TestWorker.text);
});

test('progress stays finite, bounded and monotonic and stops after completion', async () => {
  TestWorker.hangAt = 'recognize';
  const result = read();
  await flush();
  const packet = owner().lastPacket;
  const lateHandler = owner().onmessage!;
  for (const value of [0.8, 0.2, -1, 3, NaN, Infinity]) owner().reply(packet, 'progress', { progress: value });
  owner().reply(packet, 'resolve', { text: 'Tomato 42/kg' });
  await result;
  const values = progress.mock.calls.map(([value]) => value);
  expect(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  expect(values).toEqual([...values].sort((a, b) => a - b));
  lateHandler({ data: { ...packet, status: 'progress', data: { progress: 0.5 } } } as MessageEvent);
  expect(progress).toHaveBeenCalledTimes(values.length);
});

test('failing progress callbacks do not mask valid text', async () => {
  progress.mockImplementation(() => { throw new Error('view gone'); });
  await expect(read()).resolves.toContain('₹42/kg');
  expectReleased();
});

test('concurrent reads own separate workers and cancelling one cannot terminate the other', async () => {
  TestWorker.hangAt = 'loadLanguage';
  const first = read();
  const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = readPriceListPhoto(photo(), { signal: new AbortController().signal, onProgress: jest.fn() });
  await flush();
  expect(TestWorker.instances).toHaveLength(2);
  controller.abort();
  await cancelled;
  expectReleased(TestWorker.instances[0]);
  expect(TestWorker.instances[1].terminated).toBe(false);
  const other = TestWorker.instances[1];
  other.reply(other.lastPacket, 'resolve', {});
  await expect(second).resolves.toContain('₹42/kg');
  expectReleased(other);
});

test('completion removes the abort listener and timer; subsequent abort does no work', async () => {
  jest.useFakeTimers();
  const added = jest.spyOn(controller.signal, 'addEventListener');
  const removed = jest.spyOn(controller.signal, 'removeEventListener');
  await read();
  const listener = added.mock.calls.find(([type]) => type === 'abort')?.[1];
  expect(removed).toHaveBeenCalledWith('abort', listener);
  expect(jest.getTimerCount()).toBe(0);
  controller.abort();
  expectReleased();
});
