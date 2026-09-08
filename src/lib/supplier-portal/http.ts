import { NextResponse } from 'next/server';
import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { readBoundedJson, InvalidJsonBodyError, RequestBodyTooLargeError } from '@/lib/api/read-bounded-json';
import { browserJsonMutationRejection } from '@/lib/security/browser-mutation';
import { publicClientRateLimit, type PublicClientRateLimit } from '@/lib/security/public-client-rate-limit';
import { requireAccountContext } from '@/lib/server-account';
import { createPortalOperations } from './service';
import { exact, PortalError } from './domain';
const COOKIE = 'supplier_portal';
const COOKIE_PATH = '/api/public/supplier-portal';
const BODY_LIMIT = 16384;
type Dependencies = {
 operations: ReturnType<typeof createPortalOperations>;
 limit: PublicClientRateLimit;
 account: () => Promise<{ tenant: { id: string }; user: { id: string } } | null>;
};
function cookie(request: Request) {
 const pairs = request.headers.get('cookie')?.split(';').map(p => p.trim()).filter(p => p.startsWith(COOKIE + '=')) ?? [];
 if (pairs.length !== 1) return undefined;
 const value = pairs[0].slice(COOKIE.length + 1);
 return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
function clearCookie(response: Response, request: Request) {
 response.headers.append('Set-Cookie', `${COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Strict${new URL(request.url).protocol === 'https:' || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
export function createPortalHttp(deps: Dependencies = { operations: createPortalOperations(), limit: publicClientRateLimit('supplier-portal'), account: requireAccountContext }) {
 async function handle(request: Request, isPublic: boolean, run: (body: unknown) => Promise<Response>) {
  try {
   if (request.method !== 'GET') {
    const rejected = browserJsonMutationRejection(request);
    if (rejected) throw new PortalError('Use a same-origin JSON request.', rejected === 'CROSS_ORIGIN' ? 403 : 415);
   }
   if (isPublic) {
    const limit = await deps.limit({ request, now: new Date() });
    if (!limit.allowed) {
     const response = problemResponse(429, 'Too many requests', 'Try again later.');
     response.headers.set('Retry-After', String(limit.retryAfterSeconds));
     if (new URL(request.url).pathname === COOKIE_PATH + '/access') clearCookie(response, request);
     return privateNoStoreResponse(response);
    }
   }
   const body = request.method === 'GET' ? undefined : await readBoundedJson(request, BODY_LIMIT);
   return privateNoStoreResponse(await run(body));
  } catch (error) {
   const status = error instanceof PortalError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : error instanceof InvalidJsonBodyError ? 400 : 500;
   const detail = error instanceof PortalError ? error.message : status === 413 ? 'Request exceeds the size limit.' : status === 400 ? 'Provide valid JSON.' : 'Unable to complete the supplier portal request.';
   const response = problemResponse(status, 'Supplier portal', detail);
   if (isPublic && (status === 410 || new URL(request.url).pathname === COOKIE_PATH + '/access')) {
    clearCookie(response, request);
   }
   if (status === 429) response.headers.set('Retry-After', '60');
   return privateNoStoreResponse(response);
  }
 }
 return {
  access(request: Request) {
   return handle(request, true, async body => {
    const { token } = exact(body, ['token']);
    const result = await deps.operations.exchange(token);
    const response = NextResponse.json(result);
    response.cookies.set(COOKIE, String(token), { httpOnly: true, secure: new URL(request.url).protocol === 'https:' || process.env.NODE_ENV === 'production', sameSite: 'strict', path: COOKIE_PATH, expires: new Date(result.expiresAt) });
    return response;
   });
  },
  public(request: Request) {
   return handle(request, true, async body => Response.json(request.method === 'GET' ? await deps.operations.publicView(cookie(request)) : await deps.operations.act(cookie(request), body)));
  },
  restaurant(request: Request, supplierId: string, demand = false) {
   return handle(request, false, async body => {
    const account = await deps.account();
    if (!account) throw new PortalError('Authentication required.', 401);
    const actor = { tenantId: account.tenant.id, userId: account.user.id };
    let result;
    if (demand) result = request.method === 'DELETE' ? await deps.operations.withdraw(actor, supplierId, body) : await deps.operations.share(actor, supplierId, body);
    else if (request.method === 'GET') result = await deps.operations.restaurantView(actor, supplierId);
    else {
     exact(body, []);
     result = request.method === 'DELETE' ? await deps.operations.revoke(actor, supplierId) : await deps.operations.rotate(actor, supplierId, process.env.NEXTAUTH_URL || new URL(request.url).origin);
    }
    return Response.json(result);
   });
  },
 };
}
