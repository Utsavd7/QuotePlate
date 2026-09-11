import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

import { problemResponse } from '@/lib/api/problem';
import { privateNoStoreResponse } from '@/lib/api/private-response';
import {
  createProcurementRequestDraft,
  listProcurementRequests,
} from '@/lib/procurement/request-service';
import {
  readRequestBody,
  requestActor,
  requestServiceError,
} from '@/lib/procurement/request-http';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.userId;
  const tenantId = session?.user?.tenantId;
  if (typeof userId !== 'string' || !userId || typeof tenantId !== 'string' || !tenantId) {
    return privateNoStoreResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }

  const url = new URL(request.url);
  const limitText = url.searchParams.get('limit');
  try {
    const result = await listProcurementRequests({
      actor: { tenantId, userId },
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: limitText === null ? undefined : Number(limitText),
    });
    return privateNoStoreResponse(NextResponse.json(result));
  } catch (error) {
    return requestServiceError(error);
  }
}

export async function POST(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Create procurement requests from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const body = await readRequestBody(request);
  if (body instanceof Response) return privateMutationResponse(body);

  try {
    const created = await createProcurementRequestDraft({
      actor: requestActor(account),
      draft: body,
    });
    return privateMutationResponse(NextResponse.json({ request: created }, { status: 201 }));
  } catch (error) {
    return privateMutationResponse(requestServiceError(error));
  }
}
