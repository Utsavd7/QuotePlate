import { createHash } from 'node:crypto';

import { consumeDigestRateLimit } from '@/lib/security/rate-limit';

export type PublicClientLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type PublicClientRateLimit = (input: {
  request: Request;
  now: Date;
}) => Promise<PublicClientLimitResult>;

export type PublicClientOperation =
  | 'supplier-portal'
  | 'invitation-accept'
  | 'quote-access'
  | 'quote-submit'
  | 'supplier-application';

const limits = {
  'supplier-portal': { scope: 'supplier-portal-client', limit: 120 },
  'invitation-accept': {
    scope: 'member-invitation-accept-client',
    limit: 30,
  },
  'quote-access': {
    scope: 'supplier-quote-access-client',
    limit: 60,
  },
  'quote-submit': {
    scope: 'supplier-quote-submit-client',
    limit: 30,
  },
  'supplier-application': {
    scope: 'supplier-application-client',
    limit: 30,
  },
} as const;

const WINDOW_MS = 15 * 60 * 1_000;

function normalizedHeader(value: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function clientIdentifier(
  headers: Headers,
  environment: {
    NODE_ENV?: string;
    VERCEL?: string;
    NETLIFY?: string;
    SITE_ID?: string;
    URL?: string;
  } = process.env,
) {
  if (environment.NODE_ENV === 'production') {
    if (environment.VERCEL === '1') {
      return normalizedHeader(
        headers.get('x-vercel-forwarded-for')?.split(',')[0] ?? null,
      ) ?? 'production-unidentified';
    }
    if (
      normalizedHeader(environment.SITE_ID ?? null) &&
      normalizedHeader(environment.URL ?? null)
    ) {
      return normalizedHeader(
        headers.get('x-nf-client-connection-ip'),
      ) ?? 'production-unidentified';
    }
    return 'production-unidentified';
  }
  const direct =
    normalizedHeader(headers.get('cf-connecting-ip')) ??
    normalizedHeader(headers.get('x-real-ip'));
  if (direct) return direct;

  const forwarded = headers.get('x-forwarded-for');
  return normalizedHeader(forwarded?.split(',').at(-1) ?? null) ?? 'unidentified';
}

export function publicClientRateLimitDigest(
  operation: PublicClientOperation,
  headers: Headers,
  environment: {
    NODE_ENV?: string;
    VERCEL?: string;
    NETLIFY?: string;
    SITE_ID?: string;
    URL?: string;
  } = process.env,
) {
  return createHash('sha256')
    .update(`quoteplate:v1:public-client:${operation}:`, 'utf8')
    .update(clientIdentifier(headers, environment), 'utf8')
    .digest('hex');
}

export function publicClientRateLimit(operation: PublicClientOperation) {
  const configuration = limits[operation];
  return ({ request, now }: Parameters<PublicClientRateLimit>[0]) =>
    consumeDigestRateLimit({
      scope: configuration.scope,
      subjectDigest: publicClientRateLimitDigest(operation, request.headers),
      limit: configuration.limit,
      windowMs: WINDOW_MS,
      now,
    });
}
