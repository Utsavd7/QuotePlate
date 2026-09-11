import { TextNode } from 'node-html-parser';
import { unavailable } from './website-safety';

const MAX_HTML_BYTES = 1024 * 1024;
const MAX_TAG_LENGTH = 4096;
const MAX_TAGS = 8192;
const MAX_DEPTH = 64;
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const HIDDEN = new Set('head noscript template svg canvas object'.split(' '));
const RAW = new Set('script style textarea title xmp iframe noembed noframes'.split(' '));
const BLOCK = new Set('br hr p div section article header footer main aside nav li ul ol tr td th table h1 h2 h3 h4 h5 h6'.split(' '));
const whitespace = (character: string) => /[\t\n\r\f ]/.test(character);
// Reuse only the installed library's entity decoder, never its markup regex/parser.
const decode = (value: string) => new TextNode(value).text;

type Collector = { chunks: string[]; length: number };
type Frame = { name: string; hidden: boolean; text?: Collector; href?: string; telephone?: boolean; content?: string };
type Tag = { name: string; closing: boolean; selfClosing: boolean; attrs: Map<string, string>; end: number };

function readTag(html: string, start: number): Tag {
  let index = start + 1;
  const advance = () => {
    if (++index - start > MAX_TAG_LENGTH || index > html.length) unavailable();
  };
  const closing = html[index] === '/';
  if (closing) advance();
  const nameStart = index;
  while (index < html.length && /[a-z0-9:-]/i.test(html[index])) advance();
  const name = html.slice(nameStart, index).toLowerCase();
  if (!name || name.length > 64) unavailable();
  const attrs = new Map<string, string>();
  let selfClosing = false;
  while (index < html.length) {
    while (whitespace(html[index])) advance();
    if (html[index] === '>') return { name, closing, selfClosing, attrs, end: index + 1 };
    if (html[index] === '/' && html[index + 1] === '>') { selfClosing = true; advance(); continue; }
    if (closing || attrs.size >= 64) unavailable();
    const attributeStart = index;
    while (index < html.length && !whitespace(html[index]) && !'/=>'.includes(html[index])) {
      if ('<"\'`'.includes(html[index])) unavailable();
      advance();
    }
    if (index === attributeStart) unavailable();
    const attribute = html.slice(attributeStart, index).toLowerCase();
    while (whitespace(html[index])) advance();
    let raw = '';
    if (html[index] === '=') {
      advance();
      while (whitespace(html[index])) advance();
      const quote = html[index] === '"' || html[index] === "'" ? html[index] : '';
      if (quote) advance();
      const valueStart = index;
      while (index < html.length && (quote ? html[index] !== quote : !whitespace(html[index]) && html[index] !== '>')) {
        if (!quote && '<"\'`='.includes(html[index])) unavailable();
        advance();
      }
      raw = html.slice(valueStart, index);
      if (quote) {
        if (html[index] !== quote) unavailable();
        advance();
      }
    }
    if (!attrs.has(attribute)) attrs.set(attribute, decode(raw));
  }
  unavailable();
}

/** Forward-only, bounded HTML scan; malformed/oversized structures fail closed. */
export function scanWebsiteHtml(html: string) {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) unavailable();
  // Preserve offsets: Unicode lowercasing can change a string's length.
  const lower = html.replace(/[A-Z]/g, letter => letter.toLowerCase());
  const stack: Frame[] = [];
  const chunks: string[] = [];
  const anchors: { href: string; text: string }[] = [];
  const telephones: string[] = [];
  const jsonLd: string[] = [];
  let cursor = 0;
  let tags = 0;
  const hidden = () => stack[stack.length - 1]?.hidden ?? false;
  const append = (text: string) => {
    if (hidden()) return;
    chunks.push(text);
    // Depth is capped, and collectors stop storing after their bounded value size.
    for (const frame of stack) if (frame.text && frame.text.length <= 2048) {
      frame.text.length += text.length;
      if (frame.text.length <= 2048) frame.text.chunks.push(text);
    }
  };
  const finish = (frame: Frame) => {
    if (frame.hidden || (frame.text?.length ?? 0) > 2048) return;
    const text = frame.text?.chunks.join('') ?? '';
    if (frame.href !== undefined && anchors.length < 256) anchors.push({ href: frame.href, text });
    if (frame.telephone && telephones.length < 64) telephones.push(frame.content ?? text);
  };
  while (cursor < html.length) {
    if (html[cursor] !== '<') {
      const next = html.indexOf('<', cursor);
      const end = next < 0 ? html.length : next;
      if (!hidden()) append(decode(html.slice(cursor, end)));
      cursor = end;
      continue;
    }
    if (html.startsWith('<!--', cursor)) {
      // Search once and consume the whole comment, including nested openers.
      const end = html.indexOf('-->', cursor + 4);
      if (end < 0) unavailable();
      append('\n'); cursor = end + 3; continue;
    }
    if (html[cursor + 1] === '!' || html[cursor + 1] === '?') {
      const end = html.indexOf('>', cursor + 2);
      if (end < 0 || end - cursor > MAX_TAG_LENGTH) unavailable();
      cursor = end + 1; continue;
    }
    if (!/[a-z/]/i.test(html[cursor + 1] ?? '')) {
      append('<'); cursor += 1; continue;
    }
    if (++tags > MAX_TAGS) unavailable();
    const tag = readTag(html, cursor);
    cursor = tag.end;
    if (tag.closing) {
      let match = stack.length - 1;
      while (match >= 0 && stack[match].name !== tag.name) match -= 1;
      if (match >= 0) while (stack.length > match) finish(stack.pop()!);
      if (BLOCK.has(tag.name)) append('\n');
      continue;
    }
    if (tag.name === 'input' && tag.attrs.get('type')?.toLowerCase() === 'password') unavailable();
    if (RAW.has(tag.name)) {
      let end = lower.indexOf(`</${tag.name}`, cursor);
      while (end >= 0 && !/[\t\n\r\f />]/.test(html[end + tag.name.length + 2] ?? '')) {
        end = lower.indexOf(`</${tag.name}`, end + tag.name.length + 2);
      }
      if (end < 0) unavailable();
      if (tag.name === 'script' && tag.attrs.get('type')?.toLowerCase() === 'application/ld+json' &&
          jsonLd.length < 8 && end - cursor <= 64 * 1024) jsonLd.push(html.slice(cursor, end));
      cursor = readTag(html, end).end;
      append('\n');
      continue;
    }
    const parentHidden = hidden();
    const style = tag.attrs.get('style') ?? '';
    const isHidden = parentHidden || HIDDEN.has(tag.name) || tag.attrs.has('hidden') ||
      tag.attrs.get('aria-hidden')?.toLowerCase() === 'true' ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style);
    if (BLOCK.has(tag.name) || isHidden) append('\n');
    const telephone = (tag.attrs.get('itemprop') ?? '').split(/\s+/).includes('telephone');
    const frame: Frame = { name: tag.name, hidden: isHidden, telephone, content: tag.attrs.get('content') };
    if (tag.name === 'a') frame.href = tag.attrs.get('href');
    if (frame.href !== undefined || telephone) frame.text = { chunks: [], length: 0 };
    if (VOID.has(tag.name)) finish(frame);
    else {
      // HTML self-closing slashes on non-void elements do not end hidden scopes.
      if (stack.length >= MAX_DEPTH) unavailable();
      stack.push(frame);
    }
  }
  while (stack.length) finish(stack.pop()!);
  return { text: chunks.join(''), anchors, telephones, jsonLd };
}
