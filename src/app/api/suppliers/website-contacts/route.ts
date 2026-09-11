import { createHash } from 'node:crypto';
import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { readBoundedJson, RequestBodyTooLargeError, InvalidJsonBodyError } from '@/lib/api/read-bounded-json';
import { requireAccountContext } from '@/lib/server-account';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { consumeDigestRateLimit } from '@/lib/security/rate-limit';
import { discoverWebsiteContacts, validateWebsiteInput, WebsiteInputError } from '@/lib/suppliers/website-discovery';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) return privateNoStoreResponse(problemResponse(rejected === 'CROSS_ORIGIN' ? 403 : 415,
    'Request not allowed', 'Check supplier websites from the restaurant workspace using JSON.'));
  const account = await requireAccountContext();
  if (!account || !account.user.isActive || account.user.accountState !== 'ACTIVE' ||
      !account.tenant.isActive || account.user.tenantId !== account.tenant.id) {
    return privateNoStoreResponse(problemResponse(401, 'Unauthorized', 'An active restaurant account is required.'));
  }
  try {
    const url = validateWebsiteInput(await readBoundedJson(request, 4096));
    // Shared DB-backed limits, isolated from existing supplier-request subjects.
    for (const [subject, limit, windowMs] of [
      [`tenant:${account.tenant.id}:user:${account.user.id}`, 10, 3_600_000],
      [`tenant:${account.tenant.id}`, 30, 3_600_000],
      [`host:${url.hostname}`, 1, 10_000],
    ] as const) {
      const rate = await consumeDigestRateLimit({
        scope: 'supplier-request',
        subjectDigest: createHash('sha256').update(`website-contacts:v1:${subject}`).digest('hex'),
        limit, windowMs, now: new Date(),
      });
      if (!rate.allowed) {
        const response = privateNoStoreResponse(problemResponse(429, 'Please try later', 'Website contact checks are temporarily limited.'));
        response.headers.set('Retry-After', String(rate.retryAfterSeconds));
        return response;
      }
    }
    return privateNoStoreResponse(Response.json(await discoverWebsiteContacts(url)));
  } catch (error) {
    const known = error instanceof WebsiteInputError || error instanceof RequestBodyTooLargeError || error instanceof InvalidJsonBodyError;
    return privateNoStoreResponse(problemResponse(known ? error.status : 503, 'Website check unavailable',
      known ? error.message : 'Website contact checks are temporarily unavailable. Try again later.'));
  }
}
