import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { readBoundedJson, InvalidJsonBodyError, RequestBodyTooLargeError } from '@/lib/api/read-bounded-json';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { requireAccountContext } from '@/lib/server-account';
import { ProcurementRequestValidationError } from '@/lib/procurement/request-service';
import { PlanningError } from './planning';
import type { Actor } from './service';
export async function planningHttp(request: Request, mutation: boolean, run: (actor: Actor, body: unknown) => Promise<unknown>) {
  const respond = privateNoStoreResponse;
  try {
    if (mutation) {
      const rejected = browserJsonMutationRejection(request);
      if (rejected) return respond(problemResponse(rejected === 'CROSS_ORIGIN' ? 403 : 415, 'Request rejected', 'Use a same-origin JSON request.'));
    }
    const account = await requireAccountContext();
    if (!account) return respond(problemResponse(401, 'Unauthorized', 'Authentication required.'));
    const body = mutation ? await readBoundedJson(request, 524288) : undefined;
    return respond(Response.json((await run({
      tenantId: account.tenant.id,
      userId: account.user.id
    }, body)) ?? {}, {
      status: mutation && request.method === 'POST' ? 201 : 200
    }));
  } catch (error) {
    if (error instanceof PlanningError) return respond(problemResponse(error.status, 'Service planning', error.message));
    if (error instanceof ProcurementRequestValidationError) return respond(problemResponse(422, 'Invalid procurement details', error.message, {
      errors: error.errors
    }));
    if (error instanceof RequestBodyTooLargeError) return respond(problemResponse(413, 'Request too large', 'Plan exceeds the size limit.'));
    if (error instanceof InvalidJsonBodyError) return respond(problemResponse(400, 'Invalid JSON', 'Provide valid JSON.'));
    return respond(problemResponse(500, 'Service planning unavailable', 'Unable to complete the request.'));
  }
}
