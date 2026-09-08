import { createPortalHttp } from '@/lib/supplier-portal/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return createPortalHttp().public(request); }
export const POST = GET;
