import { GET, POST } from '@/app/api/service-planning/route';
import { PUT } from '@/app/api/service-planning/[id]/route';
import { POST as draft } from '@/app/api/service-planning/[id]/procurement/route';
import { requireAccountContext } from '@/lib/server-account';
import { createPlan, updatePlan, draftProcurement } from '@/lib/service-planning/service';
jest.mock('@/lib/server-account', () => ({
  requireAccountContext: jest.fn()
}));
jest.mock('@/lib/service-planning/service', () => ({
  createPlan: jest.fn(),
  updatePlan: jest.fn(),
  getPlan: jest.fn(),
  listPlans: jest.fn(),
  draftProcurement: jest.fn()
}));
const ctx = {
  params: Promise.resolve({
    id: 'p'
  })
};
function request(origin = 'http://localhost', body = '{}') {
  return new Request('http://localhost/api/service-planning', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json'
    },
    body
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAccountContext).mockResolvedValue({
    tenant: {
      id: 't'
    },
    user: {
      id: 'u'
    }
  } as never);
});
it('rejects cross-origin mutations before authentication', async () => {
  for (const fn of [POST, (r: Request) => PUT(r, ctx), (r: Request) => draft(r, ctx)]) expect((await fn(request('https://evil.test'))).status).toBe(403);
  expect(requireAccountContext).not.toHaveBeenCalled();
});
it('requires authentication for reads', async () => {
  jest.mocked(requireAccountContext).mockResolvedValue(null);
  expect((await GET(new Request('http://localhost/api/service-planning'))).status).toBe(401);
});
it('uses authenticated actor and private responses on each mutation', async () => {
  await POST(request());
  await PUT(request(), ctx);
  const response = await draft(request(), ctx);
  expect(createPlan).toHaveBeenCalledWith({
    tenantId: 't',
    userId: 'u'
  }, {});
  expect(updatePlan).toHaveBeenCalledWith({
    tenantId: 't',
    userId: 'u'
  }, 'p', {});
  expect(draftProcurement).toHaveBeenCalledWith({
    tenantId: 't',
    userId: 'u'
  }, 'p', {});
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('bounds malformed and oversized requests', async () => {
  expect((await POST(request('http://localhost', '{'))).status).toBe(400);
  expect((await POST(request('http://localhost', JSON.stringify({
    data: 'x'.repeat(600000)
  })))).status).toBe(413);
  expect(createPlan).not.toHaveBeenCalled();
});
it('does not reveal internal errors', async () => {
  jest.mocked(createPlan).mockRejectedValue(new Error('secret database'));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('secret database');
});
it('maps nested field validation to 422', async () => {
  const { PlanningError, validatePlanInput } = await import('@/lib/service-planning/planning');
  let failure: unknown; try { validatePlanInput({ name: 'Lunch', serviceAt: '2026-09-10T00:00:00Z', dishes: [null], inventory: [] }); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(PlanningError); jest.mocked(createPlan).mockRejectedValue(failure);
  expect((await POST(request())).status).toBe(422);
});
