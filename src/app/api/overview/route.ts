import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import { authOptions } from '@/lib/auth';
import { getOverview } from '@/lib/overview/overview-service';

export const dynamic = 'force-dynamic';

function privateResponse<T extends Response>(response: T): T {
  privateNoStoreResponse(response);
  response.headers.set('Vary', 'Cookie');
  return response;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.userId;
  const tenantId = session?.user?.tenantId;
  if (typeof userId !== 'string' || !userId || typeof tenantId !== 'string' || !tenantId) {
    return privateResponse(
      problemResponse(401, 'Unauthorized', 'Authentication is required.'),
    );
  }

  try {
    // Signed IDs identify the actor; the service checks their current access
    // inside the same tenant transaction that reads the overview.
    const overview = await getOverview({ actor: { tenantId, userId } });
    return privateResponse(NextResponse.json({ overview }));
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return privateResponse(
        problemResponse(403, 'Forbidden', 'This workspace is unavailable.'),
      );
    }
    throw error;
  }
}
