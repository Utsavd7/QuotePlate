import { validateAwardDocuments } from '@/lib/awards/award-document';
import { AuthorizationError } from '@/lib/auth/guards';
import {
  type TenantTransactionHost,
  withTenant,
} from '@/lib/db/tenant-transaction';
import type { ProcurementCategory } from '@/lib/domain/procurement-categories';
import { prisma } from '@/lib/prisma';
import { observationsFromAwards } from '@/lib/reporting/supplier-performance-service';
import { buildSupplierPerformance } from '@/lib/reporting/supplier-performance';
import { validateRequestItems } from '@/lib/procurement/request-document';
import {
  type SupplierCapabilitiesV1,
  validateSupplierCapabilities,
} from '@/lib/suppliers/supplier-capabilities';

export const SUPPLIER_SUGGESTION_LIMITS = {
  candidates: 50,
  supplierScan: 500,
  perItem: 5,
  priorAwards: 50,
} as const;

type SuggestionActor = { tenantId: string; userId: string };
type SuggestionItem = { id: string; itemKey: string; category: ProcurementCategory };
type CandidateSupplier = {
  id: string;
  businessName: string;
  capabilities: SupplierCapabilitiesV1;
};

export type SupplierSuggestion = {
  supplierId: string;
  businessName: string;
  reason: string;
  selected: false;
};

export class SupplierSuggestionsNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    super('Procurement request not found.');
    this.name = 'SupplierSuggestionsNotFoundError';
  }
}

export class SupplierSuggestionsCapacityError extends Error {
  readonly status = 409;

  constructor() {
    super(
      `Supplier suggestions support up to ${SUPPLIER_SUGGESTION_LIMITS.supplierScan} active verified suppliers. Archive unused suppliers before trying again.`,
    );
    this.name = 'SupplierSuggestionsCapacityError';
  }
}

function validId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function evidence(
  item: SuggestionItem,
  supplier: CandidateSupplier,
  priorSupplierIds: ReadonlySet<string>,
) {
  const itemTier = supplier.capabilities.items.find(({ itemKey }) =>
    itemKey === item.itemKey)?.tier;
  const categoryTier = supplier.capabilities.categories.find(({ category }) =>
    category === item.category)?.tier;
  const values = [
    itemTier === 'PREFERRED',
    itemTier === 'BACKUP',
    categoryTier === 'PREFERRED',
    categoryTier === 'BACKUP',
    categoryTier === 'CAPABLE',
    priorSupplierIds.has(supplier.id),
  ];
  const reason = [
    'Preferred for this item',
    'Backup for this item',
    'Preferred for this category',
    'Backup for this category',
    'Listed for this category',
    'Supplied this item in a prior award',
  ][values.findIndex(Boolean)];
  return reason ? { values, reason } : null;
}

function compareNames(
  left: Pick<CandidateSupplier, 'businessName' | 'id'>,
  right: Pick<CandidateSupplier, 'businessName' | 'id'>,
) {
  return left.businessName.localeCompare(right.businessName, 'en-IN') ||
    left.id.localeCompare(right.id, 'en-IN');
}

export function rankSupplierSuggestions(input: {
  items: SuggestionItem[];
  suppliers: CandidateSupplier[];
  priorAwardSupplierIdsByItemKey: ReadonlyMap<string, ReadonlySet<string>>;
  deliveryEvidenceBySupplierId?: ReadonlyMap<string, { datedDeliveries: number; onTimeDeliveries: number }>;
}): Record<string, SupplierSuggestion[]> {
  const candidates = [...input.suppliers]
    .sort(compareNames)
    .slice(0, SUPPLIER_SUGGESTION_LIMITS.candidates);
  return Object.fromEntries(input.items.map((item) => {
    const priorSupplierIds = input.priorAwardSupplierIdsByItemKey.get(item.itemKey) ?? new Set();
    const ranked = candidates.flatMap((supplier) => {
      const match = evidence(item, supplier, priorSupplierIds);
      return match ? [{ supplier, ...match }] : [];
    }).sort((left, right) => {
      for (let index = 0; index < left.values.length; index += 1) {
        if (left.values[index] !== right.values[index]) return left.values[index] ? -1 : 1;
      }
      return compareNames(left.supplier, right.supplier);
    });
    // Reorder only measured suppliers inside an equal capability group. Unknown
    // suppliers retain their positions, avoiding both a cold-start penalty and
    // a non-transitive pairwise comparator mixing names with measured rates.
    const groups = new Map<string, number[]>();
    ranked.forEach((entry, index) => {
      const metric = input.deliveryEvidenceBySupplierId?.get(entry.supplier.id);
      if (!metric || metric.datedDeliveries < 3) return;
      const key = entry.values.join(':');
      const positions = groups.get(key) ?? [];
      positions.push(index);
      groups.set(key, positions);
    });
    for (const positions of groups.values()) {
      const measured = positions.map(index => ranked[index]).sort((a, b) => {
        const left = input.deliveryEvidenceBySupplierId!.get(a.supplier.id)!;
        const right = input.deliveryEvidenceBySupplierId!.get(b.supplier.id)!;
        return right.onTimeDeliveries * left.datedDeliveries - left.onTimeDeliveries * right.datedDeliveries || compareNames(a.supplier, b.supplier);
      });
      positions.forEach((position, index) => { ranked[position] = measured[index]; });
    }
    return [item.id, ranked.slice(0, SUPPLIER_SUGGESTION_LIMITS.perItem).map(({ supplier, reason }) => ({
      supplierId: supplier.id,
      businessName: supplier.businessName,
      reason: (() => {
        const metric = input.deliveryEvidenceBySupplierId?.get(supplier.id);
        return metric && metric.datedDeliveries >= 3 ? `${reason}; ${metric.onTimeDeliveries} of ${metric.datedDeliveries} dated deliveries on time (all items)` : reason;
      })(),
      selected: false as const,
    }))];
  }));
}

function priorSupplierIds(awards: Array<{
  allocationLines: unknown;
  supplierSnapshots: unknown;
  deliverySnapshot: unknown;
  totalPaise: bigint;
}>) {
  const byItemKey = new Map<string, Set<string>>();
  for (const award of awards) {
    const documents = validateAwardDocuments(award);
    for (const supplier of documents.supplierSnapshots.suppliers) {
      for (const line of supplier.lines) {
        const suppliers = byItemKey.get(line.itemKey) ?? new Set<string>();
        suppliers.add(supplier.supplierId);
        byItemKey.set(line.itemKey, suppliers);
      }
    }
  }
  return byItemKey;
}

export async function getSupplierSuggestions(
  input: { actor: SuggestionActor; requestId: string },
  client: TenantTransactionHost = prisma,
) {
  if (!validId(input.actor?.tenantId) || !validId(input.actor?.userId)) {
    throw new AuthorizationError();
  }
  if (!validId(input.requestId)) throw new SupplierSuggestionsNotFoundError();
  return withTenant(input.actor.tenantId, async (transaction) => {
    const actor = await transaction.user.findFirst({
      where: {
        id: input.actor.userId,
        tenantId: input.actor.tenantId,
        isActive: true,
        accountState: 'ACTIVE',
        tenant: { isActive: true },
      },
      select: { id: true },
    });
    if (!actor) throw new AuthorizationError();
    const request = await transaction.procurementRequest.findFirst({
      where: { id: input.requestId, tenantId: input.actor.tenantId },
      select: { id: true, version: true, items: true },
    });
    if (!request) throw new SupplierSuggestionsNotFoundError();
    const [suppliers, awards] = await Promise.all([
      transaction.supplier.findMany({
        where: {
          tenantId: input.actor.tenantId,
          isActive: true,
          verificationStatus: 'VERIFIED',
          relationshipType: { in: ['CURRENT', 'SELECTED_NEW'] },
        },
        orderBy: { id: 'asc' },
        take: SUPPLIER_SUGGESTION_LIMITS.supplierScan + 1,
        select: { id: true, businessName: true, capabilities: true },
      }),
      transaction.award.findMany({
        where: { tenantId: input.actor.tenantId, requestId: { not: request.id } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SUPPLIER_SUGGESTION_LIMITS.priorAwards,
        select: {
          id: true,
          requestId: true,
          receiving: true,
          allocationLines: true,
          supplierSnapshots: true,
          deliverySnapshot: true,
          totalPaise: true,
        },
      }),
    ]);
    if (suppliers.length > SUPPLIER_SUGGESTION_LIMITS.supplierScan) {
      throw new SupplierSuggestionsCapacityError();
    }
    const items = validateRequestItems(request.items).items;
    return {
      requestId: request.id,
      requestVersion: request.version,
      suggestionsByItemId: rankSupplierSuggestions({
        items: items.map((item) => ({
          id: item.id,
          itemKey: item.itemKey,
          category: item.specification.category,
        })),
        suppliers: suppliers.map((supplier) => ({
          ...supplier,
          capabilities: validateSupplierCapabilities(supplier.capabilities),
        })),
        priorAwardSupplierIdsByItemKey: priorSupplierIds(awards),
        deliveryEvidenceBySupplierId: new Map(buildSupplierPerformance(observationsFromAwards(awards)).map((supplier) => [supplier.supplierId, supplier])),
      }),
    };
  }, client);
}
