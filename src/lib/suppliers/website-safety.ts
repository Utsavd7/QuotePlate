import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import {
  createPinnedHttpsTransport,
  MENU_URL_RESPONSE_BYTES,
  type MenuUrlImportDependencies,
  type ResolvedAddress,
} from '@/lib/menu/url-import';

export const WEBSITE_TIMEOUT_MS = 8_000;
export const WEBSITE_MAX_REQUESTS = 6; // robots + three pages + at most two redirects
export const WEBSITE_HEADERS = Object.freeze({
  accept: 'text/html,text/plain;q=0.9',
  'accept-encoding': 'identity',
  'user-agent': 'QuotePlateContactDiscovery/1.0',
});

export class WebsiteUnavailableError extends Error {
  constructor() { super('Public website contacts are unavailable.'); }
}
export function unavailable(): never { throw new WebsiteUnavailableError(); }

// Keep stricter discovery policy local; the shared menu transport owns DNS pinning,
// TLS hostname verification, socket deadlines and streaming byte limits.
const blocked4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.175.48.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked4.addSubnet(network, prefix, 'ipv4');
const global6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
const blocked6 = new BlockList();
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['2620:4f:8000::', 48],
] as const) blocked6.addSubnet(network, prefix, 'ipv6');

export function publicWebsiteAddress(answer: ResolvedAddress) {
  if (!answer || isIP(answer.address) !== answer.family) return false;
  return answer.family === 4 ? !blocked4.check(answer.address, 'ipv4')
    : global6.check(answer.address, 'ipv6') && !blocked6.check(answer.address, 'ipv6');
}

export function websiteTarget(value: string, origin?: string): URL {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) unavailable();
  let url: URL;
  try { url = new URL(value); } catch { unavailable(); }
  // Public contact discovery never accepts credentials embedded in the URL.
  if (url.username || url.password) unavailable();
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.port ||
      (origin && url.origin !== origin) || !host.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|home|lan|onion|test|invalid|example|arpa)$/.test(host) ||
      /(?:^|\.)example\.(?:com|net|org)$/.test(host)) unavailable();
  const family = isIP(host);
  if (family && !publicWebsiteAddress({ address: host, family: family as 4 | 6 })) unavailable();
  // Queries can contain private tokens; discovery only visits public, query-free pages.
  if (url.search) unavailable();
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { unavailable(); }
  if (/(?:^|\/)(?:login|log-in|signin|sign-in|auth|oauth|account|admin|member|members|dashboard|checkout|private)(?:[/.\-_]|$)/i.test(path)) unavailable();
  url.hash = '';
  return url;
}

export const websiteDependencies: MenuUrlImportDependencies = {
  resolve: async hostname => (await dns.lookup(hostname, { all: true, verbatim: true }))
    .map(answer => ({ ...answer, family: answer.family as 4 | 6 })),
  request: createPinnedHttpsTransport(),
  now: Date.now,
};

export async function withWebsiteDeadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  if (milliseconds <= 0) unavailable();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new WebsiteUnavailableError()), milliseconds);
    work.then(value => { clearTimeout(timer); resolve(value); }, () => {
      clearTimeout(timer); reject(new WebsiteUnavailableError());
    });
  });
}

export function createWebsiteLoader(dependencies = websiteDependencies) {
  const deadline = dependencies.now() + WEBSITE_TIMEOUT_MS;
  let count = 0;
  let bytes = 0;
  return async (url: URL) => {
    url = websiteTarget(url.href);
    if (++count > WEBSITE_MAX_REQUESTS) unavailable();
    const remaining = () => deadline - dependencies.now();
    if (remaining() <= 0) unavailable();
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    const family = isIP(host);
    const answers = family ? [{ address: host, family: family as 4 | 6 }]
      : await withWebsiteDeadline(dependencies.resolve(host), remaining());
    if (!answers.length || answers.length > 8 || answers.some(answer => !publicWebsiteAddress(answer))) unavailable();
    if (remaining() <= 0) unavailable();
    const response = await withWebsiteDeadline(dependencies.request({
      url, address: answers[0], timeoutMs: remaining(), headers: WEBSITE_HEADERS,
    }), remaining());
    bytes += response.body.byteLength;
    if (response.body.byteLength > MENU_URL_RESPONSE_BYTES || bytes > 3 * MENU_URL_RESPONSE_BYTES) unavailable();
    return response;
  };
}
