import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

import { privateNoStoreResponse } from '@/lib/api/private-response';
import { problemResponse } from '@/lib/api/problem';
import { requireAccountContext } from '@/lib/server-account';
import {
  browserJsonMutationRejection,
  privateMutationResponse,
} from '@/lib/security/browser-mutation';
import {
  createSupplier,
  listSuppliers,
} from '@/lib/suppliers/supplier-service';
import {
  isProblemResponse,
  readSupplierJson,
  supplierActor,
  supplierError,
} from '@/lib/suppliers/supplier-http';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.userId;
  const tenantId = session?.user?.tenantId;
  if (typeof userId !== 'string' || !userId || typeof tenantId !== 'string' || !tenantId) {
    return privateNoStoreResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const url = new URL(request.url);
  try {
    const result = await listSuppliers({
      actor: { tenantId, userId },
      active: url.searchParams.get('active') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    });
    return privateNoStoreResponse(NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    }));
  } catch (error) {
    return supplierError(error);
  }
}

export async function POST(request: Request) {
  const rejected = browserJsonMutationRejection(request);
  if (rejected) {
    return privateMutationResponse(rejected === 'CROSS_ORIGIN'
      ? problemResponse(403, 'Request not allowed', 'Manage suppliers from the QuotePlate workspace page.')
      : problemResponse(415, 'Unsupported media type', 'Send this request as application/json.'));
  }
  const account = await requireAccountContext();
  if (!account) {
    return privateMutationResponse(problemResponse(401, 'Unauthorized', 'Authentication is required.'));
  }
  const supplier = await readSupplierJson(request);
  if (isProblemResponse(supplier)) return privateMutationResponse(supplier);
  try {
    const created = await createSupplier({
      actor: supplierActor(account),
      supplier,
    });
    return privateMutationResponse(NextResponse.json(
      { supplier: created },
      { status: 201 },
    ));
  } catch (error) {
    return privateMutationResponse(supplierError(error));
  }
}
