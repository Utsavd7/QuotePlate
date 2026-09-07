import { createPortalHttp } from '@/lib/supplier-portal/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return createPortalHttp().restaurant(request, (await context.params).id); }
export const POST = GET;
export const DELETE = GET;
