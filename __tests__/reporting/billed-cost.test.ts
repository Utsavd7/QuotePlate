import { billedCostPerAcceptedUnit, recordedBilledGross } from '@/lib/reporting/billed-cost';

describe('recorded invoice cost without invented settlement', () => {
  it('exposes rejected quantity impact without calling it cash paid', () => {
    const gross = recordedBilledGross({ billedQuantity: '100', billedUnitRatePaise: '4000', gstBasisPoints: 0, taxInclusive: false });
    expect(gross).toBe(BigInt(400000));
    expect(billedCostPerAcceptedUnit(gross!, BigInt(90000000))).toBe('4444');
  });
  it('uses order tax terms with exact rounding', () => {
    expect(recordedBilledGross({ billedQuantity: '2.5', billedUnitRatePaise: '101', gstBasisPoints: 500, taxInclusive: false })).toBe(BigInt(266));
    expect(recordedBilledGross({ billedQuantity: '2.5', billedUnitRatePaise: '101', gstBasisPoints: 500, taxInclusive: true })).toBe(BigInt(253));
  });
  it('does not invent a rate for unknown billing or zero accepted stock', () => {
    expect(recordedBilledGross({})).toBeNull();
    expect(recordedBilledGross({ billedQuantity: null, billedUnitRatePaise: null })).toBeNull();
    expect(billedCostPerAcceptedUnit(BigInt(500), BigInt(0))).toBeNull();
  });
  it('supports a recorded zero bill and bounds impossible displayed rates', () => {
    expect(recordedBilledGross({ billedQuantity: '0', billedUnitRatePaise: '100', gstBasisPoints: 0, taxInclusive: false })).toBe(BigInt(0));
    expect(billedCostPerAcceptedUnit(BigInt('9223372036854775807'), BigInt(1))).toBeNull();
    expect(() => recordedBilledGross({ billedQuantity: '-1', billedUnitRatePaise: '100', gstBasisPoints: 0, taxInclusive: false })).toThrow();
  });
});
