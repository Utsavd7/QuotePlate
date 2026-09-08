import { billedCostPerAcceptedUnit, recordedBilledGross, type BilledCostInput } from './billed-cost';
import type { ProcurementUnit } from '@/lib/domain/quantity';
import { formatScaledDecimal, MAX_DECIMAL_18_3_SCALED, MAX_SIGNED_BIGINT, parseUnsignedFixed } from '@/lib/domain/validation';

export type SupplierObservation = {
  awardId: string; requestId: string; supplierId: string; supplierName: string;
  promisedDate: string; checkedAt: string | null; actualDeliveryDate: string | null;
  complete: boolean; issueCodes: string[]; invoiceDifferencePaise: string;
  creditClaimedPaise: string; creditReceivedPaise: string;
  lines: Array<BilledCostInput & {
    itemKey: string; itemName: string; unit: ProcurementUnit; specificationKey?: string;
    orderedQuantity: string; receivedQuantity: string; rejectedQuantity: string;
  }>;
};

function quantity(value: string) {
  return parseUnsignedFixed(value, { label: 'Measured quantity', scale: 3, maximumScaled: MAX_DECIMAL_18_3_SCALED, allowZero: true });
}
function money(value: string) {
  return parseUnsignedFixed(value, { label: 'Credit', scale: 0, maximumScaled: MAX_SIGNED_BIGINT, allowZero: true });
}
function percent(numerator: bigint, denominator: bigint): string | null {
  return denominator > BigInt(0) ? formatScaledDecimal((numerator * BigInt(1000) + denominator / BigInt(2)) / denominator, 1) : null;
}
function validDate(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type ItemAccumulator = {
  itemKey: string; itemName: string; unit: ProcurementUnit; specificationKey: string;
  ordered: bigint; received: bigint; rejected: bigint; observations: number;
  billed: bigint; costAccepted: bigint; costChecks: number; partialCostChecks: number;
};

export function buildSupplierPerformance(observations: SupplierObservation[]) {
  const suppliers = new Map<string, SupplierObservation[]>();
  const seen = new Set<string>();
  // A later check replaces an older snapshot, rather than manufacturing another delivery.
  const sorted = [...observations].sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''));
  for (const observation of sorted) {
    const key = `${observation.supplierId}\u0000${observation.awardId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = suppliers.get(observation.supplierId) ?? [];
    rows.push(observation);
    suppliers.set(observation.supplierId, rows);
  }

  return [...suppliers.entries()].map(([supplierId, rows]) => {
    let checked = 0, dated = 0, onTime = 0, problems = 0, partial = 0;
    let claimed = BigInt(0), settled = BigInt(0), overbilled = BigInt(0);
    const items = new Map<string, ItemAccumulator>();
    for (const row of rows) {
      if (!row.checkedAt) continue;
      checked++;
      if (!row.complete) partial++;
      if (row.complete && validDate(row.actualDeliveryDate) && validDate(row.promisedDate)) {
        dated++;
        if (row.actualDeliveryDate <= row.promisedDate && !row.issueCodes.includes('LATE')) onTime++;
      }
      const rowClaimed = money(row.creditClaimedPaise);
      const rowSettled = money(row.creditReceivedPaise);
      if (rowSettled > rowClaimed) throw new RangeError('Received credit exceeds claimed credit.');
      claimed += rowClaimed;
      settled += rowSettled;
      const difference = BigInt(row.invoiceDifferencePaise);
      if (difference > BigInt(0)) overbilled += difference;
      if (row.issueCodes.length > 0 || difference !== BigInt(0)) problems++;
      for (const line of row.lines) {
        // Store mass in micro-kilograms and volume in micro-litres, retaining all input precision.
        const unit = line.unit === 'GRAM' ? 'KILOGRAM' : line.unit === 'MILLILITRE' ? 'LITRE' : line.unit;
        const multiplier = line.unit === 'GRAM' || line.unit === 'MILLILITRE' ? BigInt(1) : BigInt(1000);
        const ordered = quantity(line.orderedQuantity) * multiplier;
        const received = quantity(line.receivedQuantity) * multiplier;
        const rejected = quantity(line.rejectedQuantity) * multiplier;
        if (ordered <= BigInt(0) || rejected > received) throw new RangeError('Invalid receiving quantities.');
        const specificationKey = line.specificationKey ?? '';
        const key = `${line.itemKey}\u0000${unit}\u0000${specificationKey}`;
        const item = items.get(key) ?? { itemKey: line.itemKey, itemName: line.itemName, unit, specificationKey, ordered: BigInt(0), received: BigInt(0), rejected: BigInt(0), observations: 0, billed: BigInt(0), costAccepted: BigInt(0), costChecks: 0, partialCostChecks: 0 };
        item.ordered += ordered;
        item.received += received;
        item.rejected += rejected;
        item.observations++;
        const billedGross = recordedBilledGross(line);
        if (billedGross !== null) {
          item.billed += billedGross;
          item.costAccepted += received - rejected;
          item.costChecks++;
          if (!row.complete) item.partialCostChecks++;
        }
        items.set(key, item);
      }
    }
    return {
      supplierId, supplierName: rows[0].supplierName,
      awardedDeliveries: rows.length, checkedDeliveries: checked, datedDeliveries: dated,
      onTimeDeliveries: onTime, onTimePercent: percent(BigInt(onTime), BigInt(dated)),
      problemDeliveries: problems, partialDeliveries: partial,
      evidence: dated >= 3 ? 'ESTABLISHED' as const : 'LIMITED' as const,
      creditClaimedPaise: claimed.toString(), creditReceivedPaise: settled.toString(),
      creditOutstandingPaise: (claimed - settled).toString(), invoiceOveragePaise: overbilled.toString(),
      items: [...items.values()].map((item) => ({
        itemKey: item.itemKey, itemName: item.itemName, unit: item.unit, specificationKey: item.specificationKey,
        orderedQuantity: formatScaledDecimal(item.ordered, 6),
        receivedQuantity: formatScaledDecimal(item.received, 6),
        rejectedQuantity: formatScaledDecimal(item.rejected, 6),
        acceptedQuantity: formatScaledDecimal(item.received - item.rejected, 6),
        fulfillmentPercent: percent(item.received - item.rejected > item.ordered ? item.ordered : item.received - item.rejected, item.ordered),
        rejectionPercent: percent(item.rejected, item.received), observations: item.observations,
        billedCostPerAcceptedUnitPaise: item.costChecks > 0 ? billedCostPerAcceptedUnit(item.billed, item.costAccepted) : null,
        costedChecks: item.costChecks, partialCostChecks: item.partialCostChecks,
        costAcceptedQuantity: formatScaledDecimal(item.costAccepted, 6),
      })).sort((a, b) => a.itemName.localeCompare(b.itemName, 'en-IN') || a.unit.localeCompare(b.unit) || a.specificationKey.localeCompare(b.specificationKey)),
      followUps: rows.flatMap((row) => {
        const creditOutstanding = row.checkedAt ? money(row.creditClaimedPaise) - money(row.creditReceivedPaise) : BigInt(0);
        const reasons: string[] = [];
        if (!row.checkedAt) reasons.push('Delivery not checked');
        else {
          if (!row.lines.length) reasons.push('Delivery quantities not recorded');
          else if (!row.complete) reasons.push('Items still outstanding');
          if (creditOutstanding > BigInt(0)) reasons.push('Credit still owed');
        }
        return reasons.length ? [{ awardId: row.awardId, requestId: row.requestId, promisedDate: row.promisedDate, checkedAt: row.checkedAt, creditOutstandingPaise: creditOutstanding.toString(), reasons }] : [];
      }),
      recentDeliveries: rows.filter((row) => row.checkedAt).slice(0, 10).map((row) => ({
        awardId: row.awardId, requestId: row.requestId, checkedAt: row.checkedAt,
        promisedDate: row.promisedDate, actualDeliveryDate: row.actualDeliveryDate,
        complete: row.complete, issueCodes: row.issueCodes,
      })),
    };
  }).sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'en-IN') || a.supplierId.localeCompare(b.supplierId));
}

export type SupplierPerformance = ReturnType<typeof buildSupplierPerformance>[number];
