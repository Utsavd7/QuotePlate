import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

import { privateNoStoreResponse as privateResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import { getFactualInsights } from '@/lib/reporting/reporting-service';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.userId;
  const tenantId = session?.user?.tenantId;
  if (typeof userId !== 'string' || !userId || typeof tenantId !== 'string' || !tenantId) return privateResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  try {
    const insights = await getFactualInsights({
      actor: { tenantId, userId },
    });
    return privateResponse(NextResponse.json(insights));
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return privateResponse(problemResponse(403, 'Forbidden', 'You cannot view these insights.'));
    }
    throw error;
  }
}
