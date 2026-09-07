import { planningHttp } from '@/lib/service-planning/http';
import { getPlan, updatePlan } from '@/lib/service-planning/service';
type Context = {
  params: Promise<{
    id: string;
  }>;
};
export const GET = (request: Request, ctx: Context) => planningHttp(request, false, async actor => getPlan(actor, (await ctx.params).id));
export const PUT = (request: Request, ctx: Context) => planningHttp(request, true, async (actor, body) => updatePlan(actor, (await ctx.params).id, body));
