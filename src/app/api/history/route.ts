import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  listProcurementHistory,
  ReportingValidationError,
} from '@/lib/reporting/reporting-service';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.userId;
  const tenantId = session?.user?.tenantId;
  if (typeof userId !== 'string' || !userId || typeof tenantId !== 'string' || !tenantId) return privateResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  const url = new URL(request.url);
  const limit = url.searchParams.get('limit');
  try {
    const history = await listProcurementHistory({
      actor: { tenantId, userId },
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: limit === null ? undefined : Number(limit),
    });
    return privateResponse(NextResponse.json(history));
  } catch (error) {
    if (error instanceof ReportingValidationError) {
      return privateResponse(problemResponse(422, 'Invalid history request', error.message, { errors: error.errors }));
    }
    if (error instanceof AuthorizationError) {
      return privateResponse(problemResponse(403, 'Forbidden', 'You cannot view this history.'));
    }
    throw error;
  }
}
