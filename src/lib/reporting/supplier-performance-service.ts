import type { Prisma } from '@prisma/client';
import { AuthorizationError } from '@/lib/auth/guards';
import { validateAwardDocuments } from '@/lib/awards/award-document';
import { withTenant } from '@/lib/db/tenant-transaction';
import { buildReceivingSummary, validateStoredReceiving } from '@/lib/receiving/receiving-document';
import { buildSupplierPerformance, type SupplierObservation } from './supplier-performance';
import type { ProcurementUnit } from '@/lib/domain/quantity';

export const PERFORMANCE_AWARD_LIMIT = 100;
type AwardEvidence = {
  id: string; requestId: string; allocationLines: unknown; supplierSnapshots: unknown;
  deliverySnapshot: unknown; totalPaise: bigint; receiving: unknown;
};

export function observationsFromAwards(awards: AwardEvidence[]): SupplierObservation[] {
  return awards.flatMap((award) => {
    const documents = validateAwardDocuments(award);
    const summary = buildReceivingSummary({ ...documents, receiving: validateStoredReceiving(award.receiving) });
    return summary.suppliers.map((supplier) => ({
      awardId: award.id, requestId: award.requestId,
      supplierId: supplier.supplierId, supplierName: supplier.supplierName,
      promisedDate: supplier.deliveryDate, checkedAt: supplier.check?.checkedAt ?? null,
      // Legacy invoice-only checks never imply measured quantities or a confirmed arrival date.
      actualDeliveryDate: supplier.check?.details?.actualDeliveryDate ?? null,
      complete: supplier.check?.deliveryComplete ?? Boolean(supplier.check),
      issueCodes: supplier.check?.issueCodes ?? [],
      invoiceDifferencePaise: supplier.check?.differencePaise ?? '0',
      creditClaimedPaise: supplier.check?.details?.creditClaimedPaise ?? '0',
      creditReceivedPaise: supplier.check?.details?.creditReceivedPaise ?? '0',
      lines: (supplier.check?.itemDetails ?? []).map((line) => {
        const snapshot = documents.supplierSnapshots.suppliers.find((entry) => entry.supplierId === supplier.supplierId)?.lines.find((entry) => entry.requestItemId === line.requestItemId);
        return {
          itemKey: line.itemKey, itemName: line.itemName, unit: line.unit as ProcurementUnit,
          specificationKey: JSON.stringify(snapshot?.requestedSpecification ?? null),
          orderedQuantity: line.orderedQuantity, receivedQuantity: line.receivedQuantity, rejectedQuantity: line.rejectedQuantity,
          billedQuantity: line.billedQuantity, billedUnitRatePaise: line.billedUnitRatePaise,
          gstBasisPoints: line.gstBasisPoints, taxInclusive: line.taxInclusive,
        };
      }),
    }));
  });
}

type Dependencies = {
  transact: <T>(tenantId: string, callback: (transaction: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  now: () => Date;
};

export function createSupplierPerformanceOperations(dependencies: Dependencies = {
  transact: (tenantId, callback) => withTenant(tenantId, callback), now: () => new Date(),
}) {
  return {
    async read(input: { actor: { tenantId: string; userId: string } }) {
      const { actor } = input;
      if (!actor || ![actor.tenantId, actor.userId].every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200 && id.trim() === id && !/[\u0000-\u001f\u007f]/.test(id))) throw new AuthorizationError();
      return dependencies.transact(actor.tenantId, async (transaction) => {
        const user = await transaction.user.findFirst({
          where: { id: actor.userId, tenantId: actor.tenantId, isActive: true, accountState: 'ACTIVE', tenant: { isActive: true } }, select: { id: true },
        });
        if (!user) throw new AuthorizationError();
        const awards = await transaction.award.findMany({
          where: { tenantId: actor.tenantId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PERFORMANCE_AWARD_LIMIT + 1,
          select: { id: true, requestId: true, allocationLines: true, supplierSnapshots: true, deliverySnapshot: true, totalPaise: true, receiving: true },
        });
        return {
          suppliers: buildSupplierPerformance(observationsFromAwards(awards.slice(0, PERFORMANCE_AWARD_LIMIT))),
          generatedAt: dependencies.now().toISOString(), capped: awards.length > PERFORMANCE_AWARD_LIMIT,
          awardSampleSize: Math.min(awards.length, PERFORMANCE_AWARD_LIMIT),
          notes: [
            'Evidence comes from saved restaurant delivery checks. Missing checks are not successful deliveries.',
            'On-time performance uses completed deliveries with an explicitly recorded arrival date; three dated deliveries are required for established evidence.',
            'Item fulfilment is accepted quantity divided by ordered quantity. Rejection is rejected quantity divided by received quantity. Different specifications and incompatible units stay separate.',
            'Billed cost per accepted unit uses only checks with entered billed quantity and rate. GST follows the accepted order tax terms; freight and order-level credits are excluded. This is not cash paid. Partial receipts are provisional; missing billed inputs are not counted as zero.',
            'Follow-ups list unchecked deliveries, outstanding quantities and unsettled credits within this report sample. The promised date is not a credit payment due date.',
            'Credits received are recorded settlements, not bank-verified payments or savings. Invoice overages compare entered totals with the accepted order total.',
          ],
        };
      });
    },
  };
}

export const getSupplierPerformance = createSupplierPerformanceOperations().read;
export type SupplierPerformanceReport = Awaited<ReturnType<typeof getSupplierPerformance>>;
