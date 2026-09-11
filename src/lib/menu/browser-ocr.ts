import type { Page } from 'tesseract.js';
import {
  cleanRecognizedMenuLines,
  type RecognizedMenuLine,
} from './photo-intake';

type OcrProgress = {
  image: number;
  total: number;
  progress: number;
  status: string;
};

function abortError() {
  return new DOMException('Photo reading was cancelled.', 'AbortError');
}

function checkedSignal(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

function confidence(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : 0;
}

function resultLines(result: Page): RecognizedMenuLine[] {
  const lines = result.blocks?.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines),
  ) ?? [];
  if (lines.length > 0) {
    return lines
      .map((line) => ({
        text: line.text.trim(),
        confidence: confidence(line.confidence),
      }))
      .filter((line) => line.text.length > 0);
  }
  const pageConfidence = confidence(result.confidence);
  return result.text
    .split(/\r?\n/)
    .map((text) => ({ text: text.trim(), confidence: pageConfidence }))
    .filter((line) => line.text.length > 0);
}

export async function recognizeMenuPhotos(
  photos: readonly File[],
  options: {
    signal: AbortSignal;
    onProgress: (progress: OcrProgress) => void;
  },
) {
  checkedSignal(options.signal);
  if (!photos.length) return { text: '', confidences: [] as number[] };
  const fallback = 'Could not read the menu photo. Try a clearer photo of printed English, or enter the dish names manually.';
  let worker: Worker | null = null;
  let activeImage = 0;
  let active = true;
  let stopReason: Error | null = null;
  type Action = 'load' | 'loadLanguage' | 'initialize' | 'recognize';
  let pending: { id: string; action: Action; resolve: (data: unknown) => void; reject: (error: Error) => void } | null = null;
  let sequence = 0;
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  void stopped.catch(() => undefined);
  const terminate = () => {
    const target = worker;
    worker = null;
    const job = pending;
    pending = null;
    job?.reject(stopReason ?? new Error(fallback));
    if (!target) return;
    target.onmessage = null;
    target.onerror = null;
    target.onmessageerror = null;
    try { target.terminate(); } catch { /* Already unavailable. */ }
  };
  const stop = (error: Error) => {
    if (!active || stopReason) return;
    stopReason = error;
    terminate();
    rejectStopped(error);
  };
  const check = () => {
    checkedSignal(options.signal);
    if (stopReason) throw stopReason;
  };
  const onAbort = () => stop(abortError());
  options.signal.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stop(new Error('Photo reading took too long. Try a smaller, clearer photo or enter the dish names manually.')), 120_000);
  };
  let lastProgress = 0;
  const report = (value: number) => {
    if (!active || stopReason || options.signal.aborted || !Number.isFinite(value)) return;
    lastProgress = Math.max(lastProgress, Math.min(1, Math.max(0, value)));
    try {
      options.onProgress({ image: activeImage, total: photos.length, progress: lastProgress,
        status: activeImage > 0 ? 'Reading menu photo' : 'Preparing the photo reader' });
    } catch { /* A disposed view must not break the worker event handler. */ }
  };
  const runJob = (action: Action, payload: object, transfer: Transferable[] = []) => {
    check();
    return new Promise<unknown>((resolve, reject) => {
      const id = `menu-photo-${++sequence}`;
      pending = { id, action, resolve, reject };
      try { worker!.postMessage({ workerId: 'menu-photos', jobId: id, action, payload }, transfer); }
      catch { stop(new Error(fallback)); }
    });
  };

  try {
    resetTimeout();
    report(0);
    check();
    // Own the native worker before startup. Tesseract 7 createWorker() hides its
    // handle until initialization and can stay pending after language failures.
    // This is the same pinned protocol used by the price-list reader; recheck
    // src/createWorker.js and worker-script/index.js when upgrading Tesseract.
    worker = new Worker('/ocr/worker.min.js');
    worker.onerror = event => { event.preventDefault(); stop(new Error(fallback)); };
    worker.onmessageerror = () => stop(new Error(fallback));
    worker.onmessage = ({ data }: MessageEvent) => {
      const job = pending;
      if (!active || stopReason || !job || !data || data.workerId !== 'menu-photos' || data.jobId !== job.id || data.action !== job.action) return;
      if (data.status === 'progress') report(data.data?.progress);
      else if (data.status === 'reject') stop(new Error(fallback));
      else if (data.status === 'resolve') { pending = null; job.resolve(data.data); }
    };
    await runJob('load', { options: { lstmOnly: true, corePath: '/ocr/core', logging: false } });
    await runJob('loadLanguage', { langs: 'eng', options: { langPath: '/ocr/lang', gzip: true, lstmOnly: true } });
    await runJob('initialize', { langs: 'eng', oem: 1, config: {} });

    const recognized: RecognizedMenuLine[] = [];
    for (const [index, photo] of photos.entries()) {
      check();
      activeImage = index + 1;
      lastProgress = 0;
      resetTimeout();
      report(0);
      check();
      const bytes = await Promise.race([photo.arrayBuffer(), stopped]);
      check();
      const result = await runJob('recognize', {
        image: new Uint8Array(bytes), options: {}, output: { text: true, blocks: true },
      }, [bytes]);
      check();
      recognized.push(...resultLines(result as Page));
      report(1);
      check();
    }

    const cleaned = cleanRecognizedMenuLines(recognized);
    return {
      text: cleaned.map((line) => line.text).join('\n'),
      confidences: cleaned.map((line) => line.confidence),
    };
  } catch (error) {
    if (options.signal.aborted) throw abortError();
    throw stopReason ?? new Error(fallback, { cause: error });
  } finally {
    active = false;
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
    terminate();
  }
}
