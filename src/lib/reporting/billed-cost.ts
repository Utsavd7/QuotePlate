import { calculateGst } from '@/lib/domain/money';
import { divideHalfUp, MAX_DECIMAL_18_3_SCALED, MAX_SIGNED_BIGINT, parseUnsignedFixed } from '@/lib/domain/validation';

export type BilledCostInput = {
  billedQuantity?: string | null;
  billedUnitRatePaise?: string | null;
  gstBasisPoints?: number;
  taxInclusive?: boolean;
};

// An absent billed line is unknown, never a zero-cost delivery.
export function recordedBilledGross(line: BilledCostInput): bigint | null {
  if (line.billedQuantity == null || line.billedUnitRatePaise == null ||
      line.gstBasisPoints === undefined || line.taxInclusive === undefined) return null;
  const quantity = parseUnsignedFixed(line.billedQuantity, { label: 'Billed quantity', scale: 3, maximumScaled: MAX_DECIMAL_18_3_SCALED, allowZero: true });
  const rate = parseUnsignedFixed(line.billedUnitRatePaise, { label: 'Billed rate', scale: 0, maximumScaled: MAX_SIGNED_BIGINT, allowZero: true });
  return calculateGst({ amountPaise: divideHalfUp(quantity * rate, BigInt(1000)), gstBasisPoints: line.gstBasisPoints, inclusive: line.taxInclusive }).grossPaise;
}

// Quantity is normalized to millionths of kg/litre or of the original count unit.
export function billedCostPerAcceptedUnit(billedPaise: bigint, acceptedMicrounits: bigint): string | null {
  if (acceptedMicrounits <= BigInt(0)) return null;
  const rate = divideHalfUp(billedPaise * BigInt(1_000_000), acceptedMicrounits);
  return rate <= MAX_SIGNED_BIGINT ? rate.toString() : null;
}
