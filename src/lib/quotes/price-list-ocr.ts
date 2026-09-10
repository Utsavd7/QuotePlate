import { MAX_PRICE_LIST_LINES, MAX_PRICE_LIST_TEXT_LENGTH } from './price-list';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_PIXELS = 20_000_000;
const MAX_PHOTO_EDGE = 8000;
const READ_TIMEOUT_MS = 120_000;
const FALLBACK = 'Could not read this photo. Try a clearer photo of printed English, or paste the price list text and enter prices manually.';

class PhotoReadError extends Error {}

type OcrAction = 'load' | 'loadLanguage' | 'initialize' | 'recognize';
type PendingJob = {
  jobId: string;
  action: OcrAction;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function abortError(): DOMException {
  return new DOMException('Price list photo reading was cancelled.', 'AbortError');
}

/**
 * Read printed English entirely in the browser using the bundled OCR assets.
 * Progress is monotonic, from 0 to 1. The original text (including prices and
 * whitespace) is returned for review; it never passes through the menu cleaner.
 */
export async function readPriceListPhoto(
  file: File,
  options: { signal: AbortSignal; onProgress: (progress: number) => void },
): Promise<string> {
  const { signal, onProgress } = options;
  if (signal.aborted) throw abortError();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new PhotoReadError('Choose a JPEG, PNG or WebP photo, or paste the price list text.');
  }
  if (!file.size) throw new PhotoReadError('This photo is empty. Choose another photo or paste the price list text.');
  if (file.size > MAX_PHOTO_BYTES) {
    throw new PhotoReadError('Choose a photo of 8 MB or less, or paste the price list text.');
  }
  if (typeof Image === 'undefined' || typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new PhotoReadError('Photo reading is unavailable in this browser. Paste the price list text or enter prices manually.');
  }

  let active = true;
  let worker: Worker | null = null;
  let pendingJob: PendingJob | null = null;
  let cleanupImage = () => {};
  let stopReason: Error | null = null;
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  // Cancellation can be triggered by onProgress before the first awaited stage.
  void stopped.catch(() => undefined);
  const terminate = () => {
    const target = worker;
    worker = null;
    const job = pendingJob;
    pendingJob = null;
    job?.reject(stopReason ?? new PhotoReadError(FALLBACK));
    if (!target) return;
    target.onmessage = null;
    target.onerror = null;
    target.onmessageerror = null;
    // Native termination is synchronous and independent of OCR initialization.
    try { target.terminate(); } catch { /* Already unavailable. */ }
  };
  const stop = (error: Error) => {
    if (!active || stopReason) return;
    stopReason = error;
    cleanupImage();
    terminate();
    rejectStopped(error);
  };
  const check = () => {
    if (signal.aborted) throw abortError();
    if (stopReason) throw stopReason;
  };
  const onAbort = () => stop(abortError());
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop(new PhotoReadError(
    'Photo reading took too long. Try a smaller, clearer photo or paste the price list text.',
  )), READ_TIMEOUT_MS);

  let lastProgress = 0;
  const reportProgress = (value: number) => {
    if (!active || stopReason || signal.aborted || !Number.isFinite(value)) return;
    lastProgress = Math.max(lastProgress, Math.min(1, Math.max(0, value)));
    // UI callbacks must not throw out of Tesseract's worker event handler.
    try { onProgress(lastProgress); } catch { /* The caller may have unmounted. */ }
  };

  // Minimal adapter for the pinned Tesseract.js 7 worker protocol, mirrored from
  // src/createWorker.js and src/worker-script/index.js. Own the native worker
  // before sending any job: createWorker() hides its handle and can stay pending
  // forever after a loadLanguage/initialize rejection. Recheck this protocol when
  // upgrading Tesseract; no coordinator, blob script, or global patch is needed.
  const workerId = 'quote-price-list';
  let jobSequence = 0;
  const runJob = (action: OcrAction, payload: object, transfer: Transferable[] = []) => {
    check();
    return new Promise<unknown>((resolve, reject) => {
      const jobId = `price-list-${++jobSequence}`;
      pendingJob = { jobId, action, resolve, reject };
      try {
        worker!.postMessage({ workerId, jobId, action, payload }, transfer);
      } catch {
        stop(new PhotoReadError(FALLBACK));
      }
    });
  };
  const readDimensions = () => new Promise<void>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    let released = false;
    cleanupImage = () => {
      if (released) return;
      released = true;
      image.onload = null;
      image.onerror = null;
      image.src = '';
      URL.revokeObjectURL(url);
    };
    image.onload = () => {
      if (!active || stopReason || signal.aborted) return;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      cleanupImage();
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
        reject(new PhotoReadError('Could not read the photo dimensions. Choose another photo or paste the price list text.'));
      } else if (width > MAX_PHOTO_EDGE || height > MAX_PHOTO_EDGE || width * height > MAX_PHOTO_PIXELS) {
        reject(new PhotoReadError('Use a photo of at most 20 megapixels and 8,000 pixels per edge. Crop or resize it, or paste the price list text.'));
      } else {
        resolve();
      }
    };
    image.onerror = () => {
      cleanupImage();
      reject(new PhotoReadError('Could not open this image. Choose another JPEG, PNG or WebP photo, or paste the price list text.'));
    };
    image.src = url;
  });

  try {
    reportProgress(0);
    check();
    await Promise.race([readDimensions(), stopped]);
    check();
    const bytes = await Promise.race([file.arrayBuffer(), stopped]);
    check();
    worker = new Worker('/ocr/worker.min.js');
    worker.onerror = (event) => {
      event.preventDefault();
      stop(new PhotoReadError(FALLBACK));
    };
    worker.onmessageerror = () => stop(new PhotoReadError(FALLBACK));
    worker.onmessage = ({ data }: MessageEvent<unknown>) => {
      const job = pendingJob;
      if (!active || stopReason || !job || !isRecord(data) ||
        data.workerId !== workerId || data.jobId !== job.jobId || data.action !== job.action) return;
      if (data.status === 'progress') {
        const message = data.data;
        if (!isRecord(message) || typeof message.progress !== 'number' || !Number.isFinite(message.progress)) return;
        const value = Math.min(1, Math.max(0, message.progress));
        reportProgress(job.action === 'recognize' ? 0.2 + value * 0.75 : value * 0.2);
      } else if (data.status === 'reject') {
        stop(new PhotoReadError(FALLBACK));
      } else if (data.status === 'resolve') {
        pendingJob = null;
        job.resolve(data.data);
      }
    };
    await runJob('load', { options: { lstmOnly: true, corePath: '/ocr/core', logging: false } });
    await runJob('loadLanguage', { langs: 'eng', options: { langPath: '/ocr/lang', gzip: true, lstmOnly: true } });
    await runJob('initialize', { langs: 'eng', oem: 1, config: {} }); // OEM.LSTM_ONLY
    const result = await runJob('recognize', { image: new Uint8Array(bytes), options: {}, output: { text: true } }, [bytes]);
    check();
    const text = isRecord(result) ? result.text : null;
    if (typeof text !== 'string' || !text.trim()) {
      throw new PhotoReadError('No readable printed English was found. Try a clearer photo or paste the price list text.');
    }
    if (text.length > MAX_PRICE_LIST_TEXT_LENGTH) {
      throw new PhotoReadError('The photo contains more than 12,000 characters. Crop it into smaller parts or paste a shorter price list.');
    }
    if (text.split(/\r\n|[\n\r\u2028\u2029]/).filter((line) => line.trim()).length > MAX_PRICE_LIST_LINES) {
      throw new PhotoReadError('The photo contains more than 100 nonempty lines. Crop it into smaller parts or paste a shorter price list.');
    }
    reportProgress(1);
    check();
    return text;
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (error instanceof PhotoReadError) throw error;
    throw new PhotoReadError(FALLBACK);
  } finally {
    active = false;
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    cleanupImage();
    terminate();
  }
}
