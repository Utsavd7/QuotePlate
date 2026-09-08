import type { Prisma } from '@prisma/client';

const auditRules = {
  'portal.trading-profile-updated': { entityType: 'Supplier', metadata: ['revision'] },
  'portal.rotated': { entityType: 'SupplierPortal', metadata: ['supplierId'] },
  'portal.revoked': { entityType: 'SupplierPortal', metadata: ['supplierId'] },
  'portal.responded': { entityType: 'SupplierCollaboration', metadata: ['supplierId', 'requestId', 'version', 'action'] },
  'portal.demand-shared': { entityType: 'SupplierDemandShare', metadata: ['supplierId', 'planId', 'version', 'itemCount'] },
  'portal.demand-withdrawn': { entityType: 'SupplierDemandShare', metadata: ['supplierId'] },
  'service_plan.created': { entityType: 'ServicePlan', metadata: ['version', 'menuId'] },
  'service_plan.updated': { entityType: 'ServicePlan', metadata: ['version', 'menuId'] },
  'service_plan.procurement_drafted': { entityType: 'ServicePlan', metadata: ['version', 'requestId'] },
  'member.invited': { entityType: 'User', metadata: ['role'] },
  'member.invitation-revoked': { entityType: 'User', metadata: [] },
  'member.joined': { entityType: 'User', metadata: ['role'] },
  'member.deactivated': { entityType: 'User', metadata: ['previousRole'] },
  'workspace.updated': { entityType: 'Tenant', metadata: ['fields'] },
  'tutorial.updated': { entityType: 'User', metadata: ['action', 'step'] },
  'menu.approved': { entityType: 'Menu', metadata: ['version'] },
  'menu.deleted': { entityType: 'Menu', metadata: ['version'] },
  'supplier.created': { entityType: 'Supplier', metadata: [] },
  'supplier.applied': {
    entityType: 'Supplier',
    metadata: ['requestId', 'categoryCount'],
  },
  'supplier.verified': { entityType: 'Supplier', metadata: [] },
  'supplier.rejected': { entityType: 'Supplier', metadata: [] },
  'request.opened': {
    entityType: 'ProcurementRequest',
    metadata: ['itemCount', 'supplierCount'],
  },
  'supplier-link.created': { entityType: 'SupplierRequest', metadata: [] },
  'supplier-link.revoked': { entityType: 'SupplierRequest', metadata: [] },
  'quote.submitted': {
    entityType: 'SupplierRequest',
    metadata: ['revision', 'itemCount'],
  },
  'request.awarded': {
    entityType: 'Award',
    metadata: ['lineCount', 'supplierCount', 'splitAward', 'reason'],
  },
  'delivery.checked': {
    entityType: 'Award',
    metadata: ['supplierId', 'outcome', 'issueCodes', 'invoiceDifference'],
  },
  'request.cancelled': {
    entityType: 'ProcurementRequest',
    metadata: ['reason'],
  },
  'request.repeated': {
    entityType: 'ProcurementRequest',
    metadata: ['sourceRequestId'],
  },
  'audit.export': {
    entityType: 'ProcurementRequest',
    metadata: ['kind', 'format', 'byteCount'],
  },
} as const;

export type AuditAction = keyof typeof auditRules;

const workspaceFields = new Set([
  'name',
  'email',
  'addressLine',
  'city',
  'state',
  'pin',
  'phone',
  'timezone',
  'gstin',
]);

export class AuditEventError extends Error {
  readonly code = 'INVALID_AUDIT_METADATA';

  constructor() {
    super('Audit event metadata is not allowed.');
    this.name = 'AuditEventError';
  }
}

function validValue(value: unknown): value is Prisma.InputJsonValue {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  if (typeof value === 'string') return value.length <= 500;
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every((item) => typeof item === 'string' && item.length <= 80)
  );
}

function metadataFor(
  action: AuditAction,
  metadata: Record<string, unknown> | undefined,
) {
  if (!metadata) return undefined;
  const allowed = auditRules[action].metadata as readonly string[];
  const entries = Object.entries(metadata);
  if (
    entries.length > allowed.length ||
    entries.some(([key, value]) => !allowed.includes(key) || !validValue(value))
  ) {
    throw new AuditEventError();
  }
  if (action === 'workspace.updated') {
    const fields = metadata.fields;
    if (
      !Array.isArray(fields) ||
      new Set(fields).size !== fields.length ||
      fields.some(
        (field) => typeof field !== 'string' || !workspaceFields.has(field),
      )
    ) {
      throw new AuditEventError();
    }
  }
  return Object.fromEntries(entries) as Prisma.InputJsonObject;
}

export async function writeAuditEvent(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    actorUserId?: string | null;
    action: AuditAction;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
) {
  const rule = auditRules[input.action];
  if (
    !rule ||
    !input.tenantId ||
    input.tenantId.length > 200 ||
    !input.entityId ||
    input.entityId.length > 200 ||
    (input.actorUserId?.length ?? 0) > 200
  ) {
    throw new AuditEventError();
  }

  return transaction.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: rule.entityType,
      entityId: input.entityId,
      metadata: metadataFor(input.action, input.metadata),
    },
  });
}
