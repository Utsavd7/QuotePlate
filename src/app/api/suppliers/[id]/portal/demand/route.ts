import { createPortalHttp } from '@/lib/supplier-portal/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) { return createPortalHttp().restaurant(request, (await context.params).id, true); }
export const DELETE = POST;
