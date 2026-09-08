import { createPortalHttp } from '@/lib/supplier-portal/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return createPortalHttp().access(request); }
