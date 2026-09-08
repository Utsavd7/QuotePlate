import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { readBoundedJson, RequestBodyTooLargeError, InvalidJsonBodyError } from '@/lib/api/read-bounded-json';
import { requireAccountContext } from '@/lib/server-account';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { discoverNearby } from '@/lib/suppliers/nearby-service';
import { NearbyError } from '@/lib/suppliers/nearby-types';
export const runtime = 'nodejs';
function active(account: Awaited<ReturnType<typeof requireAccountContext>>) {
  return account && account.user.isActive && account.user.accountState === 'ACTIVE' && account.tenant.isActive && account.user.tenantId === account.tenant.id ? account : null;
}
export async function GET() {
  const account = active(await requireAccountContext());
  if (!account) return privateNoStoreResponse(problemResponse(401, 'Unauthorized', 'An active restaurant account is required.'));
  // Local profile only; no background geocoding or address sharing on page load.
  return privateNoStoreResponse(Response.json({ area: [account.tenant.city, account.tenant.state, account.tenant.pin].filter(Boolean).join(', ') }));
}
export async function POST(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) return privateNoStoreResponse(problemResponse(rejected === 'CROSS_ORIGIN' ? 403 : 415, 'Request not allowed', 'Search from the restaurant workspace using JSON.'));
  const account = active(await requireAccountContext());
  if (!account) return privateNoStoreResponse(problemResponse(401, 'Unauthorized', 'An active restaurant account is required.'));
  try {
    const input = await readBoundedJson(request, 2048);
    return privateNoStoreResponse(Response.json(await discoverNearby(account.user.id, input)));
  } catch (error) {
    const status = error instanceof NearbyError || error instanceof RequestBodyTooLargeError || error instanceof InvalidJsonBodyError ? error.status : 503;
    const detail = error instanceof NearbyError || error instanceof RequestBodyTooLargeError || error instanceof InvalidJsonBodyError ? error.message : 'Nearby search is temporarily unavailable. Try again later.';
    const response = privateNoStoreResponse(problemResponse(status, 'Nearby search unavailable', detail));
    if (status === 429) response.headers.set('Retry-After', String(error instanceof NearbyError ? error.retryAfterSeconds : 60));
    return response;
  }
}
