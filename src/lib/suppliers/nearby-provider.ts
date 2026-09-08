import { NearbyError } from './nearby-types';
/** Hosts and paths are fixed; redirects, credentials and custom ports are forbidden. */
export async function fetchNearbyJson(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch, maxBytes = 512 * 1024, timeoutMs = 20000): Promise<unknown> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.port ||
    !((target.hostname === 'photon.komoot.io' && target.pathname === '/api') ||
      (target.hostname === 'maps.mail.ru' && target.pathname === '/osm/tools/overpass/api/interpreter'))) throw new NearbyError('Unsupported map provider.', 400);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new NearbyError('The map service timed out. Try again later.', 504));
      controller.abort();
      void reader?.cancel().catch(() => {});
    }, timeoutMs);
  });
  const load = async () => {
    const response = await fetcher(target.href, { ...init, signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json', ...init.headers, 'User-Agent': 'QuotePlate/1.0 (nearby supplier discovery; https://quoteplate.netlify.app)' } });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new NearbyError(response.status === 429 ? 'The free map service is busy. Please wait before trying again.' : 'The map service is unavailable. Try again later.', response.status === 429 ? 429 : 502);
    }
    if (!response.body || Number(response.headers.get('content-length')) > maxBytes) {
      void response.body?.cancel().catch(() => {});
      throw new NearbyError('The map response is too large. Try a smaller radius.');
    }
    reader = response.body.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new NearbyError('The map response is too large. Try a smaller radius.');
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  };
  try { return await Promise.race([load(), timeout]); }
  catch (error) { if (error instanceof NearbyError) throw error; throw new NearbyError('The map service returned an unavailable or invalid response. Try again later.'); }
  finally { clearTimeout(timer); controller.abort(); }
}
/** Only public normalized data lives here. Both retained values and in-flight work are bounded. */
export function createNearbyCache<T>(maximum = 100, now = Date.now) {
  const values = new Map<string, { value: T; expires: number }>();
  const pending = new Map<string, Promise<T>>();
  return { async get(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const current = values.get(key);
    if (current && current.expires > now()) return current.value;
    values.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= 8) throw new NearbyError('Nearby search is busy. Try again later.', 429);
    const task = Promise.resolve().then(load).then(value => {
      if (values.size >= maximum) values.delete(values.keys().next().value!);
      values.set(key, { value, expires: now() + ttl });
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  } };
}
