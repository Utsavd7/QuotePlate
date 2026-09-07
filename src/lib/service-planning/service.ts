import { Prisma, type ServicePlan } from '@prisma/client';
import { withTenant } from '@/lib/db/tenant-transaction';
import { writeAuditEvent } from '@/lib/audit/write-event';
import { validateMenuDocument } from '@/lib/menu/menu-document';
import { validateProcurementRequestDraftInput } from '@/lib/procurement/request-service';
import { validateRequestDocuments, type RequestItemsV1 } from '@/lib/procurement/request-document';
import { validateSupplierCapabilities } from '@/lib/suppliers/supplier-capabilities';
import { computePlan, PlanningError, validatePlanInput } from './planning';
export type Actor = {
  tenantId: string;
  userId: string;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlanningError('Provide a JSON object.');
  return value as Record<string, unknown>;
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new PlanningError('A positive expectedVersion is required.');
  return Number(value);
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new PlanningError('A valid ID is required.');
  return value;
}
async function auth(tx: Prisma.TransactionClient, actor: Actor) {
  if (!(await tx.user.findFirst({
    where: {
      tenantId: actor.tenantId,
      id: actor.userId,
      isActive: true,
      accountState: 'ACTIVE',
      tenant: {
        isActive: true
      }
    },
    select: {
      id: true
    }
  }))) throw new PlanningError('Access denied.', 403);
}
async function find(tx: Prisma.TransactionClient, actor: Actor, planId: string) {
  const plan = await tx.servicePlan.findFirst({
    where: {
      id: id(planId),
      tenantId: actor.tenantId
    }
  });
  if (!plan) throw new PlanningError('Plan not found.', 404);
  return plan;
}
function view(plan: ServicePlan) {
  const document = validatePlanInput(plan.document),
    menuSnapshot = validateMenuDocument(plan.menuSnapshot);
  return {
    ...plan,
    document,
    menuSnapshot,
    readiness: computePlan(menuSnapshot, document)
  };
}
async function revision(tx: Prisma.TransactionClient, plan: ServicePlan, document: unknown, nextVersion: number) {
  await tx.servicePlanRevision.create({
    data: {
      tenantId: plan.tenantId,
      planId: plan.id,
      version: nextVersion,
      document: json(document)
    }
  });
}
export async function listPlans(actor: Actor) {
  return withTenant(actor.tenantId, async tx => {
    await auth(tx, actor);
    const [plans, menus, tenant] = await Promise.all([tx.servicePlan.findMany({
      where: {
        tenantId: actor.tenantId
      },
      select: {
        id: true,
        name: true,
        version: true,
        serviceAt: true,
        requestId: true
      },
      orderBy: {
        serviceAt: 'desc'
      },
      take: 100
    }), tx.menu.findMany({
      where: {
        tenantId: actor.tenantId,
        status: 'APPROVED'
      },
      select: {
        id: true,
        name: true,
        version: true,
        document: true
      },
      orderBy: {
        updatedAt: 'desc'
      },
      take: 100
    }), tx.tenant.findFirst({
      where: {
        id: actor.tenantId
      },
      select: {
        addressLine: true,
        city: true,
        state: true,
        pin: true
      }
    })]);
    return {
      plans,
      menus,
      deliveryDetails: tenant
    };
  });
}
export async function createPlan(actor: Actor, value: unknown) {
  const b = body(value),
    document = validatePlanInput(b.document);
  return withTenant(actor.tenantId, async tx => {
    await auth(tx, actor);
    const menu = await tx.menu.findFirst({
      where: {
        id: id(b.menuId),
        tenantId: actor.tenantId,
        status: 'APPROVED'
      },
      select: {
        id: true,
        version: true,
        document: true
      }
    });
    if (!menu) throw new PlanningError('Approved menu not found.', 404);
    const menuSnapshot = validateMenuDocument(menu.document);
    computePlan(menuSnapshot, document);
    const plan = await tx.servicePlan.create({
      data: {
        tenantId: actor.tenantId,
        name: document.name,
        serviceAt: new Date(document.serviceAt),
        menuId: menu.id,
        menuVersion: menu.version,
        menuSnapshot: json(menuSnapshot),
        document: json(document),
        createdByUserId: actor.userId
      }
    });
    await revision(tx, plan, document, 1);
    await writeAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'service_plan.created',
      entityId: plan.id,
      metadata: {
        version: 1,
        menuId: menu.id
      }
    });
    return view(plan);
  });
}
export async function getPlan(actor: Actor, planId: string) {
  return withTenant(actor.tenantId, async tx => {
    await auth(tx, actor);
    const plan = view(await find(tx, actor, planId));
    const suppliers = await tx.supplier.findMany({
      where: {
        tenantId: actor.tenantId,
        isActive: true,
        OR: plan.readiness.ingredients.flatMap(i => [{
          capabilities: {
            path: ['items'],
            array_contains: [{
              itemKey: i.itemKey
            }]
          }
        }, {
          capabilities: {
            path: ['categories'],
            array_contains: [{
              category: i.specification.category
            }]
          }
        }])
      },
      select: {
        id: true,
        businessName: true,
        capabilities: true,
        relationshipType: true
      },
      orderBy: {
        businessName: 'asc'
      },
      take: 100
    });
    return {
      ...plan,
      supplierOptions: suppliers.flatMap(s => {
        let capabilities;
        try {
          capabilities = validateSupplierCapabilities(s.capabilities);
        } catch {
          return [];
        }
        const matching = plan.readiness.ingredients.filter(i => capabilities.items.some(c => c.itemKey === i.itemKey) || capabilities.categories.some(c => c.category === i.specification.category));
        return matching.length ? [{
          id: s.id,
          businessName: s.businessName,
          itemKeys: matching.map(i => i.itemKey),
          evidence: `Saved capability matches ${matching.map(i => i.name).join(', ')}. Availability, exact specifications, price and arrival time are unconfirmed; obtain a fresh quote.`
        }] : [];
      })
    };
  });
}
export async function updatePlan(actor: Actor, planId: string, value: unknown) {
  const b = body(value),
    expectedVersion = version(b.expectedVersion),
    document = validatePlanInput(b.document);
  return withTenant(actor.tenantId, async tx => {
    await auth(tx, actor);
    const plan = await find(tx, actor, planId);
    computePlan(validateMenuDocument(plan.menuSnapshot), document);
    if (plan.requestId) throw new PlanningError('This plan has a procurement draft. Create a new daily plan to change requirements.', 409);
    const updated = await tx.servicePlan.updateMany({
      where: {
        id: plan.id,
        tenantId: actor.tenantId,
        version: expectedVersion,
        requestId: null
      },
      data: {
        version: {
          increment: 1
        },
        name: document.name,
        serviceAt: new Date(document.serviceAt),
        document: json(document)
      }
    });
    if (updated.count !== 1) throw new PlanningError('Plan changed. Reload before saving.', 409);
    await revision(tx, plan, document, expectedVersion + 1);
    await writeAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'service_plan.updated',
      entityId: plan.id,
      metadata: {
        version: expectedVersion + 1,
        menuId: plan.menuId
      }
    });
    return view({
      ...plan,
      name: document.name,
      serviceAt: new Date(document.serviceAt),
      document: JSON.parse(JSON.stringify(document)) as Prisma.JsonValue,
      version: expectedVersion + 1
    });
  });
}
// This uses the existing request validators and document contract. A draft has no
// invitations until the user reviews sourcing and opens it in the request flow.
export async function draftProcurement(actor: Actor, planId: string, value: unknown, now = new Date()) {
  const b = body(value),
    expectedVersion = version(b.expectedVersion);
  return withTenant(actor.tenantId, async tx => {
    await auth(tx, actor);
    const plan = await find(tx, actor, planId);
    if (plan.requestId || plan.version !== expectedVersion) throw new PlanningError('Plan changed or already has a procurement draft. Reload it.', 409);
    const computed = view(plan).readiness;
    if (computed.warnings.some(w => w.includes('recipe has no ingredients')) || computed.ingredients.some(i => i.blocked)) throw new PlanningError('Resolve incompatible units or ingredient specifications before procurement.');
    const missing = computed.ingredients.filter(i => i.deficit !== '0');
    if (!missing.length) throw new PlanningError('No missing ingredients to procure.');
    const sourcing = {
      v: 1 as const,
      modes: ['VERIFIED_NEW' as const],
      currentSupplierIds: [],
      selectedNewSupplierIds: [],
      acceptVerifiedApplications: true
    };
    const validated = validateProcurementRequestDraftInput({
      title: plan.name.slice(0, 130) + ' — service stock',
      menuId: plan.menuId,
      selectedItemIds: missing.map((_, i) => `sp${i}`),
      defaultSourcing: sourcing,
      sourcingOverrides: {},
      deliveryDate: b.deliveryDate,
      quoteDeadline: b.quoteDeadline,
      deliveryDetails: b.deliveryDetails
    }, now);
    const serviceAt = new Date(view(plan).document.serviceAt);
    const serviceDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(serviceAt);
    if (String(b.deliveryDate) > serviceDay) throw new PlanningError('Required delivery date must be on or before the service date.');
    if (validated.quoteDeadline >= serviceAt) throw new PlanningError('Quote deadline must be before service.');
    const items: RequestItemsV1 = {
      v: 1,
      items: missing.map((i, n) => ({
        id: `sp${n}`,
        itemKey: i.itemKey,
        name: i.name,
        quantity: i.deficit,
        unit: i.unit,
        specification: i.specification,
        sourcingOverride: null
      }))
    };
    validateRequestDocuments(items, {
      v: 1,
      default: sourcing
    });
    const claimed = await tx.servicePlan.updateMany({
      where: {
        id: plan.id,
        tenantId: actor.tenantId,
        version: expectedVersion,
        requestId: null
      },
      data: {
        version: {
          increment: 1
        }
      }
    });
    if (claimed.count !== 1) throw new PlanningError('Plan changed. Reload it.', 409);
    const request = await tx.procurementRequest.create({
      data: {
        tenantId: actor.tenantId,
        title: validated.title,
        status: 'DRAFT',
        version: 1,
        menuId: plan.menuId,
        items: json(items),
        sourcing: json({
          v: 1,
          default: sourcing
        }),
        deliveryDetails: json(validated.deliveryDetails),
        deliveryDate: validated.deliveryDate,
        quoteDeadline: validated.quoteDeadline,
        createdByUserId: actor.userId,
        commercialTerms: `Service planning ${plan.id}, version ${expectedVersion}. Confirm arrival before ${serviceAt.toISOString()}.`
      },
      select: {
        id: true
      }
    });
    await tx.servicePlan.updateMany({
      where: {
        id: plan.id,
        tenantId: actor.tenantId,
        version: expectedVersion + 1
      },
      data: {
        requestId: request.id
      }
    });
    await revision(tx, plan, plan.document, expectedVersion + 1);
    await writeAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'service_plan.procurement_drafted',
      entityId: plan.id,
      metadata: {
        version: expectedVersion + 1,
        requestId: request.id
      }
    });
    return {
      requestId: request.id,
      reviewUrl: `/procurement/${request.id}`,
      version: expectedVersion + 1
    };
  });
}
export async function repeatPlan(actor: Actor, planId: string, value: unknown) {
  const b = body(value),
    expectedVersion = version(b.expectedVersion);
  return withTenant(actor.tenantId, async tx => {
    await auth(tx, actor);
    const source = await find(tx, actor, planId);
    if (source.version !== expectedVersion) throw new PlanningError('Plan changed. Reload before repeating.', 409);
    const document = validatePlanInput({
      ...validatePlanInput(source.document),
      serviceAt: b.serviceAt,
      inventory: []
    });
    const plan = await tx.servicePlan.create({
      data: {
        tenantId: actor.tenantId,
        name: document.name,
        serviceAt: new Date(document.serviceAt),
        menuId: source.menuId,
        menuVersion: source.menuVersion,
        menuSnapshot: json(source.menuSnapshot),
        document: json(document),
        createdByUserId: actor.userId
      }
    });
    await revision(tx, plan, document, 1);
    await writeAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'service_plan.created',
      entityId: plan.id,
      metadata: {
        version: 1,
        menuId: source.menuId
      }
    });
    return view(plan);
  });
}
