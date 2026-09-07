import { planningHttp } from '@/lib/service-planning/http';
import { createPlan, listPlans } from '@/lib/service-planning/service';
export const GET = (request: Request) => planningHttp(request, false, actor => listPlans(actor));
export const POST = (request: Request) => planningHttp(request, true, (actor, body) => createPlan(actor, body));
