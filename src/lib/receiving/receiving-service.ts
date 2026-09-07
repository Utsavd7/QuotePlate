import { calculateReceivingDetails, RECEIVING_JSON_BYTES, type ReceivingCalculatedDetails } from './receiving-details';
import { Prisma } from '@prisma/client';

import { writeAuditEvent } from '@/lib/audit/write-event';
import { validateAwardDocuments } from '@/lib/awards/award-document';
import { AuthorizationError } from '@/lib/auth/guards';
import { withTenant } from '@/lib/db/tenant-transaction';
import { assertBoundedJson } from '@/lib/domain/postgres-json';
import { MAX_SIGNED_BIGINT } from '@/lib/domain/validation';
import { prisma } from '@/lib/prisma';
import {
  ReceivingValidationError,
  type AwardReceivingV1,
  type ValidReceivingInput,
  buildReceivingSummary,
  validateReceivingInput,
  validateStoredReceiving,
} from '@/lib/receiving/receiving-document';

export const RECEIVING_BODY_BYTES = 128 * 1024;

export class ReceivingNotFoundError extends Error {
  readonly code = 'AWARD_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Award not found.');
    this.name = 'ReceivingNotFoundError';
  }
}

export class ReceivingSupplierError extends Error {
  readonly code = 'SUPPLIER_NOT_AWARDED';
  readonly status = 409;

  constructor() {
    super('This supplier is not part of the recorded award.');
    this.name = 'ReceivingSupplierError';
  }
}

export class ReceivingConflictError extends Error {
  readonly code = 'DELIVERY_CHECK_CHANGED';
  readonly status = 409;

  constructor() {
    super('This delivery check changed. Refresh the request before saving again.');
    this.name = 'ReceivingConflictError';
  }
}

export type DeliveryCheckResult = Omit<ValidReceivingInput, 'expectedCheckedAt'> & Partial<ReceivingCalculatedDetails> & {
  expectedTotalPaise: string;
  differencePaise: string;
  checkedAt: string;
  hasProblem: boolean;
};

type ReceivingDependencies = {
  transact: <T>(
    tenantId: string,
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T>;
  now: () => Date;
};

const defaultDependencies: ReceivingDependencies = {
  transact: (tenantId, callback) => withTenant(tenantId, callback, prisma),
  now: () => new Date(),
};

function validId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validClock(now: Date) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('A valid receiving clock is required.');
  }
  return now.toISOString();
}

export function createReceivingOperations(
  dependencies: ReceivingDependencies = defaultDependencies,
) {
  return {
    async record(input: {
      actor: { tenantId: string; userId: string };
      awardId: string;
      check: unknown;
    }): Promise<DeliveryCheckResult> {
      if (
        !validId(input.actor?.tenantId) ||
        !validId(input.actor?.userId) ||
        !validId(input.awardId)
      ) throw new ReceivingNotFoundError();
      const check = validateReceivingInput(input.check);
      const { expectedCheckedAt, ...deliveryCheck } = check;

      return dependencies.transact(input.actor.tenantId, async (transaction) => {
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

        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "Award"
          WHERE "tenantId" = ${input.actor.tenantId}
            AND "id" = ${input.awardId}
          FOR UPDATE
        `;
        if (!locked[0]) throw new ReceivingNotFoundError();

        const award = await transaction.award.findFirst({
          where: { tenantId: input.actor.tenantId, id: input.awardId },
          select: {
            id: true,
            requestId: true,
            allocationLines: true,
            supplierSnapshots: true,
            deliverySnapshot: true,
            totalPaise: true,
            receiving: true,
          },
        });
        if (!award) throw new ReceivingNotFoundError();

        const documents = validateAwardDocuments(award);
        const receivingBefore = validateStoredReceiving(award.receiving);
        const supplierSummary = buildReceivingSummary({
          allocationLines: documents.allocationLines,
          supplierSnapshots: documents.supplierSnapshots,
          receiving: receivingBefore,
        }).suppliers.find((supplier) => supplier.supplierId === deliveryCheck.supplierId);
        if (!supplierSummary) throw new ReceivingSupplierError();
        const currentCheck = receivingBefore.suppliers.find(
          (supplier) => supplier.supplierId === deliveryCheck.supplierId,
        );
        if ((currentCheck?.checkedAt ?? null) !== expectedCheckedAt) {
          throw new ReceivingConflictError();
        }
        if (currentCheck?.details && !deliveryCheck.details) throw new ReceivingConflictError();
        let calculated: ReceivingCalculatedDetails | undefined;
        try { if (deliveryCheck.details) calculated = calculateReceivingDetails(supplierSummary.items ?? [], deliveryCheck.details); }
        catch { throw new ReceivingValidationError(); }
        const expectedTotal = BigInt(supplierSummary.expectedTotalPaise);
        if (expectedTotal > MAX_SIGNED_BIGINT) throw new ReceivingSupplierError();
        const invoiceTotal = BigInt(deliveryCheck.invoiceTotalPaise);
        const difference = invoiceTotal - expectedTotal;
        const clock = validClock(dependencies.now());
        const checkedAt = currentCheck && clock <= currentCheck.checkedAt
          ? new Date(Date.parse(currentCheck.checkedAt) + 1).toISOString() : clock;
        const invoiceDiffers = difference !== BigInt(0);
        const normalizedCheck = invoiceDiffers ? {
          ...deliveryCheck,
          outcome: 'ISSUES' as const,
          issueCodes: deliveryCheck.issueCodes.includes('PRICE_DIFFERENCE')
            ? deliveryCheck.issueCodes
            : [...deliveryCheck.issueCodes, 'PRICE_DIFFERENCE' as const],
        } : deliveryCheck;
        if (calculated) {
          const codes = new Set(normalizedCheck.issueCodes);
          if (!calculated.deliveryComplete) codes.add('MISSING_QUANTITY');
          if (calculated.itemDetails.some(i => i.rejectedQuantity !== '0')) codes.add('QUALITY');
          if (calculated.discrepancyPaise !== '0') codes.add('PRICE_DIFFERENCE');
          if (deliveryCheck.details!.actualDeliveryDate && deliveryCheck.details!.actualDeliveryDate > supplierSummary.deliveryDate) codes.add('LATE');
          if (calculated.creditRemainingPaise !== '0' && codes.size === 0) codes.add('OTHER');
          normalizedCheck.issueCodes = [...codes];
          if (codes.size) normalizedCheck.outcome = 'ISSUES';
        }
        const entry = { ...normalizedCheck, checkedAt };
        const receiving: AwardReceivingV1 = {
          v: 1,
          suppliers: [
            ...receivingBefore.suppliers.filter(
              (supplier) => supplier.supplierId !== check.supplierId,
            ),
            entry,
          ].sort((left, right) => left.supplierId.localeCompare(right.supplierId)),
        };
        try { assertBoundedJson(receiving, RECEIVING_JSON_BYTES, 'Delivery checks'); } catch { throw new ReceivingValidationError(); }

        const updated = await transaction.award.updateMany({
          where: { tenantId: input.actor.tenantId, id: input.awardId },
          data: { receiving: receiving as Prisma.InputJsonValue },
        });
        if (updated.count !== 1) throw new ReceivingNotFoundError();

        const hasProblem = normalizedCheck.outcome === 'ISSUES';
        await writeAuditEvent(transaction, {
          tenantId: input.actor.tenantId,
          actorUserId: actor.id,
          action: 'delivery.checked',
          entityId: award.id,
          metadata: {
            supplierId: deliveryCheck.supplierId,
            outcome: normalizedCheck.outcome,
            issueCodes: normalizedCheck.issueCodes,
            invoiceDifference: invoiceDiffers,
          },
        });

        return {
          ...normalizedCheck,
          ...(calculated ?? {}),
          expectedTotalPaise: expectedTotal.toString(),
          differencePaise: difference.toString(),
          checkedAt,
          hasProblem,
        };
      });
    },
  };
}

const receivingOperations = createReceivingOperations();

export function recordDeliveryCheck(input: {
  actor: { tenantId: string; userId: string };
  awardId: string;
  check: unknown;
}) {
  return receivingOperations.record(input);
}
