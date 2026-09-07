import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { AuthorizationError } from '@/lib/auth/guards';
import { getSupplierPerformance } from '@/lib/reporting/supplier-performance-service';
import { requireAccountContext } from '@/lib/server-account';

export async function GET() {
  const account = await requireAccountContext();
  if (!account) return privateNoStoreResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  try {
    const report = await getSupplierPerformance({ actor: { tenantId: account.tenant.id, userId: account.user.id } });
    return privateNoStoreResponse(Response.json(report));
  } catch (error) {
    if (error instanceof AuthorizationError) return privateNoStoreResponse(problemResponse(403, 'Forbidden', 'You cannot view supplier performance.'));
    throw error;
  }
}
