import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:https';
import { createPinnedHttpsTransport, MENU_URL_RESPONSE_BYTES } from '@/lib/menu/url-import';
import { WEBSITE_HEADERS } from '@/lib/suppliers/website-safety';

it('uses the shared DNS-pinned TLS transport and destroys an oversized streaming response', async () => {
  const requestEvents = new EventEmitter();
  const requestDestroy = jest.fn();
  const responseDestroy = jest.fn();
  const responseEvents = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'text/html' }, destroy: responseDestroy });
  let acceptResponse: ((response: typeof responseEvents) => void) | undefined;
  let options: RequestOptions | undefined;
  const requestFunction = (_url: URL, opts: RequestOptions, callback: typeof acceptResponse) => {
    options = opts; acceptResponse = callback;
    return Object.assign(requestEvents, { destroy: requestDestroy, end: jest.fn() });
  };
  const address = { address: '93.184.216.34', family: 4 as const };
  const pending = createPinnedHttpsTransport(requestFunction as never)({
    url: new URL('https://supplier.com/contact'), address, timeoutMs: 8000, headers: WEBSITE_HEADERS,
  });
  expect(options).toMatchObject({ servername: 'supplier.com', method: 'GET', headers: WEBSITE_HEADERS });
  expect(options).not.toHaveProperty('rejectUnauthorized', false);
  const lookup = options!.lookup!;
  const callback = jest.fn();
  lookup('supplier.com', {}, callback);
  expect(callback).toHaveBeenCalledWith(null, address.address, 4);
  const rejection = expect(pending).rejects.toThrow();
  acceptResponse!(responseEvents);
  responseEvents.emit('data', Buffer.alloc(MENU_URL_RESPONSE_BYTES));
  responseEvents.emit('data', Buffer.from('overflow'));
  await rejection;
  expect(responseDestroy).toHaveBeenCalledTimes(1); expect(requestDestroy).toHaveBeenCalledTimes(1);
});
