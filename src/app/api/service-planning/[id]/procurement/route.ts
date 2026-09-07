import { planningHttp } from '@/lib/service-planning/http';
import { draftProcurement } from '@/lib/service-planning/service';
export const POST = (request: Request, ctx: {
  params: Promise<{
    id: string;
  }>;
}) => planningHttp(request, true, async (actor, body) => draftProcurement(actor, (await ctx.params).id, body));
