import { createHash, randomBytes } from 'node:crypto';

export type TokenPurpose =
  | 'supplier-portal'
  | 'member-invitation'
  | 'supplier-request'
  | 'supplier-application';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function digestOpaqueToken(purpose: TokenPurpose, raw: string) {
  if (!TOKEN_PATTERN.test(raw)) throw new TypeError('Invalid token.');

  return createHash('sha256')
    .update(`quoteplate:v1:${purpose}:`, 'utf8')
    .update(raw, 'ascii')
    .digest('hex');
}

export function createOpaqueToken(purpose: TokenPurpose) {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  return { raw, digest: digestOpaqueToken(purpose, raw) };
}
