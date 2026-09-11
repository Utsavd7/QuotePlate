import type { MenuUrlImportDependencies, MenuUrlTransportResponse } from '@/lib/menu/url-import';
import { robotsAllows, parseWebsiteContacts } from './website-parsing';
import { createWebsiteLoader, unavailable, websiteDependencies, websiteTarget } from './website-safety';
import type { WebsiteContact, WebsiteContactResult } from './website-types';
import { supplierContactKey } from './contact-list';

export class WebsiteInputError extends Error {
  readonly status = 400;
  constructor() { super('Enter a public HTTPS supplier website without a query string.'); }
}

export function validateWebsiteInput(input: unknown): URL {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 1 || !('url' in input) || typeof input.url !== 'string') throw new WebsiteInputError();
  try { return websiteTarget(input.url.trim()); } catch { throw new WebsiteInputError(); }
}

function header(response: MenuUrlTransportResponse, name: string) {
  const value = response.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
function decode(response: MenuUrlTransportResponse, robots = false) {
  const encoding = header(response, 'content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') unavailable();
  const type = (header(response, 'content-type') ?? '').toLowerCase();
  if (!/^(text\/plain|text\/html)(?:;|$)/.test(type) || (robots && !type.startsWith('text/plain'))) unavailable();
  if (/charset\s*=/.test(type) && !/charset\s*=\s*(?:utf-8|us-ascii)(?:;|$)/.test(type)) unavailable();
  if (robots && response.body.byteLength > 64 * 1024) unavailable();
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(response.body), plain: type.startsWith('text/plain') }; }
  catch { unavailable(); }
}

export async function discoverWebsiteContacts(
  url: URL,
  dependencies: MenuUrlImportDependencies = websiteDependencies,
): Promise<WebsiteContactResult> {
  const checkedAt = new Date(dependencies.now()).toISOString();
  const contacts: WebsiteContact[] = [];
  try {
    const start = websiteTarget(url.href);
    const load = createWebsiteLoader(dependencies);
    const robotsResponse = await load(new URL('/robots.txt', start));
    // Fail closed on robots redirects, gating, throttling or server failures.
    const robots = robotsResponse.statusCode === 404 || robotsResponse.statusCode === 410 ? ''
      : robotsResponse.statusCode === 200 ? decode(robotsResponse, true).text : unavailable();
    const pending = [start.href];
    const visited = new Set<string>();
    let pages = 0;
    let redirects = 0;
    while (pending.length && pages < 3) {
      let current = websiteTarget(pending.shift()!, start.origin);
      if (visited.has(current.href)) continue;
      while (true) {
        if (visited.has(current.href) || !robotsAllows(robots, current)) unavailable();
        visited.add(current.href);
        const response = await load(current);
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          if (++redirects > 2) unavailable();
          const location = header(response, 'location');
          if (!location) unavailable();
          current = websiteTarget(new URL(location, current).href, start.origin);
          continue;
        }
        pages += 1;
        if (response.statusCode === 404 || response.statusCode === 410) break;
        if (response.statusCode !== 200) unavailable();
        const body = decode(response);
        const parsed = parseWebsiteContacts(body.text, current, checkedAt, body.plain);
        for (const contact of parsed.contacts) {
          const key = supplierContactKey(contact.kind, contact.value);
          if (key && contacts.length < 20 && !contacts.some(c => supplierContactKey(c.kind, c.value) === key)) contacts.push(contact);
        }
        for (const link of parsed.links) {
          if (!visited.has(link) && !pending.includes(link) && robotsAllows(robots, new URL(link))) pending.push(link);
        }
        break;
      }
    }
    return { status: contacts.length ? 'found' : 'no-public-contacts', contacts, checkedAt };
  } catch {
    // Never disclose internal addresses, DNS errors, upstream bodies or private contacts.
    return { status: 'unavailable', contacts: [], checkedAt };
  }
}
