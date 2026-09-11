import { normalizeSupplierContactEmail } from '@/lib/suppliers/contact-email';
import type { WebsiteContact } from './website-types';
import { unavailable, websiteTarget } from './website-safety';
import { scanWebsiteHtml } from './website-html';
import { supplierContactKey } from './contact-list';

// A bounded glob matcher avoids regular-expression backtracking on untrusted robots rules.
function robotsPathMatches(rule: string, target: string) {
  const anchored = rule.endsWith('$');
  if (!rule.includes('*')) return anchored ? target === rule.slice(0, -1) : target.startsWith(rule);
  const pattern = anchored ? rule.slice(0, -1) : `${rule}*`;
  let row = new Uint8Array(target.length + 1);
  row[0] = 1;
  for (const character of pattern) {
    const next = new Uint8Array(target.length + 1);
    if (character === '*') next[0] = row[0];
    for (let index = 1; index <= target.length; index += 1) {
      next[index] = character === '*' ? Number(Boolean(row[index] || next[index - 1]))
        : Number(Boolean(row[index - 1]) && character === target[index - 1]);
    }
    row = next;
  }
  return Boolean(row[target.length]);
}

export function robotsAllows(text: string, url: URL): boolean {
  if (text.length > 64 * 1024 || url.pathname.length > 2048) return false;
  const groups: { agents: string[]; rules: { path: string; allow: boolean }[]; delay: boolean }[] = [];
  let group = { agents: [] as string[], rules: [] as { path: string; allow: boolean }[], delay: false };
  let hasDirectives = false;
  for (const line of text.split(/\r\n|[\r\n]/)) {
    const comment = line.indexOf('#');
    const clean = (comment < 0 ? line : line.slice(0, comment)).trim();
    const colon = clean.indexOf(':');
    if (colon < 0) continue;
    const key = clean.slice(0, colon).trim().toLowerCase();
    const value = clean.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (hasDirectives) { groups.push(group); group = { agents: [], rules: [], delay: false }; hasDirectives = false; }
      group.agents.push(value.toLowerCase());
    } else if (group.agents.length) {
      hasDirectives = true;
      if ((key === 'allow' || key === 'disallow') && value) group.rules.push({ path: value, allow: key === 'allow' });
      // Don't crawl sites requesting a delay that this bounded interactive lookup cannot honor.
      if (key === 'crawl-delay' && Number(value) > 0) group.delay = true;
    }
  }
  groups.push(group);
  const applicable = groups.filter(g => g.agents.some(a => a === '*' || (a.length > 0 && 'quoteplatecontactdiscovery'.includes(a))));
  if (applicable.some(g => g.delay)) return false;
  let target: string;
  try { target = decodeURI(url.pathname); } catch { return false; }
  // Honor each applicable group conservatively, including wildcard disallows.
  return applicable.every(group => {
    let best = -1;
    let allowed = true;
    for (const rule of group.rules) {
      let path: string;
      try { path = decodeURI(rule.path); } catch { return false; }
      if (path.length > 2048) return false;
      if (robotsPathMatches(path, target)) {
        const length = path.replace(/[*$]/g, '').length;
        if (length > best || (length === best && rule.allow)) { best = length; allowed = rule.allow; }
      }
    }
    return allowed;
  });
}

function publishedPhone(value: string, explicitTelephone = false): string | null {
  if (value.length > 64 || /\(0\)|[\u0000-\u001f\u007f]/.test(value)) return null;
  const compact = value.trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
  // Local Indian mobiles need explicit telephone evidence. Preserve the published
  // value for review; the existing supplier save path owns phone normalization.
  if (explicitTelephone && /^[6-9]\d{9}$/.test(compact)) return value.trim();
  return /^\+[1-9]\d{7,14}$/.test(compact) ? (explicitTelephone ? value.trim() : compact) : null;
}

function structuredTelephones(json: string): string[] {
  if (json.length > 64 * 1024) return [];
  const types = new Set(['Organization', 'LocalBusiness', 'Corporation', 'Store', 'GroceryStore',
    'WholesaleStore', 'Restaurant', 'FoodEstablishment', 'ContactPoint']);
  let value: unknown;
  try { value = JSON.parse(json); } catch { return []; }
  const pending = [{ value, schema: false, depth: 0 }];
  const phones: string[] = [];
  let visited = 0;
  while (pending.length && visited++ < 200) {
    const item = pending.pop()!;
    if (!item.value || typeof item.value !== 'object' || item.depth > 8) continue;
    if (Array.isArray(item.value)) {
      for (const child of item.value.slice(0, 200 - visited)) pending.push({ ...item, value: child, depth: item.depth + 1 });
      continue;
    }
    const record = item.value as Record<string, unknown>;
    const context = record['@context'];
    const schema = context === undefined ? item.schema
      : typeof context === 'string' && /^https?:\/\/schema\.org\/?$/.test(context);
    const rawTypes = record['@type'];
    const declaredTypes = Array.isArray(rawTypes) ? rawTypes : [rawTypes];
    if (schema && declaredTypes.some(type => typeof type === 'string' && types.has(type.replace(/^https?:\/\/schema\.org\//, '')))) {
      const values = Array.isArray(record.telephone) ? record.telephone : [record.telephone];
      for (const phone of values.slice(0, 20)) if (typeof phone === 'string') phones.push(phone);
    }
    for (const child of Object.values(record).slice(0, 200 - visited)) {
      if (child && typeof child === 'object') pending.push({ value: child, schema, depth: item.depth + 1 });
    }
  }
  return phones.slice(0, 20);
}

export function parseWebsiteContacts(html: string, sourceUrl: URL, checkedAt: string, plain = false) {
  const document = plain ? { text: html, anchors: [], telephones: [], jsonLd: [] } : scanWebsiteHtml(html);
  const structuredPhones = document.jsonLd.flatMap(structuredTelephones);
  const text = document.text;
  if (/\b(?:sign in|log in|login|subscribe)\s+(?:to|for)\s+(?:view|access|see|continue)\b/i.test(text)) unavailable();
  const contacts: WebsiteContact[] = [];
  const add = (kind: WebsiteContact['kind'], value: string | null) => {
    const key = supplierContactKey(kind, value);
    if (value && key && contacts.length < 20 && !contacts.some(c => supplierContactKey(c.kind, c.value) === key)) {
      contacts.push({ kind, value, sourceUrl: sourceUrl.href, checkedAt });
    }
  };
  for (const phone of structuredPhones) add('phone', publishedPhone(phone, true));
  for (const phone of document.telephones) add('phone', publishedPhone(phone, true));
  const links: string[] = [];
  for (const anchor of document.anchors) {
    const href = anchor.href;
    try {
      if (/^mailto:/i.test(href)) add('email', normalizeSupplierContactEmail(decodeURIComponent(href.slice(7).split('?')[0])));
      else if (/^tel:/i.test(href)) add('phone', publishedPhone(decodeURIComponent(href.slice(4)), true));
      else {
        const url = websiteTarget(new URL(href, sourceUrl).href, sourceUrl.origin);
        if (/\b(?:contact|about|reach[- ]?us)\b/i.test(`${url.pathname} ${anchor.text}`) && !links.includes(url.href)) links.push(url.href);
      }
    } catch { /* Unsafe/non-contact links and malformed contact URIs are ignored. */ }
  }
  // Validate whole bounded tokens, avoiding partial/fabricated mailboxes and
  // quadratic regex scanning on a large page containing no @ character.
  for (const token of text.split(/[\s<>"(),;:\[\]]+/)) {
    if (token.length <= 256 && token.includes('@')) {
      add('email', normalizeSupplierContactEmail(token.replace(/[.!?]+$/, '')));
    }
  }
  for (const match of text.matchAll(/\b(?:phone|tel(?:ephone)?|call|mobile|whatsapp)[ \t]{0,16}[:.]?[ \t]{0,16}(?=\+|00)/gi)) {
    const start = match.index + match[0].length;
    let end = start;
    // Parentheses, sentence punctuation and line breaks are boundaries, never
    // characters to strip into a phone. Unseparated prose/numeric tails are omitted.
    while (end < text.length && end - start <= 64 && /[0-9+ \t-]/.test(text[end])) end += 1;
    if (end - start > 64 || (end < text.length && !/[\r\n(.,;!?]/.test(text[end]))) continue;
    const value = text.slice(start, end).trim();
    const phone = publishedPhone(value);
    if (!phone) continue;
    const expectedDigits = phone.startsWith('+91') || phone.startsWith('+44') ? 12
      : phone.startsWith('+1') ? 11 : null;
    // Grouped body text needs a known complete length. Other countries remain
    // supported through explicit tel/schema fields or a contiguous published number.
    if (expectedDigits !== null ? phone.length !== expectedDigits + 1 : /[ \t-]/.test(value)) continue;
    add('phone', phone);
  }
  return { contacts, links: links.slice(0, 2) };
}
