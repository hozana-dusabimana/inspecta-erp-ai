import { productivity, variancePct, riskScore, netStock, costVariance } from '../src/lib/formulas';

describe('ERP formulas', () => {
  it('productivity = output / input (guards divide-by-zero)', () => {
    expect(productivity(100, 50)).toBe(2);
    expect(productivity(100, 0)).toBe(0);
  });

  it('variance % = (actual - planned) / planned * 100', () => {
    expect(variancePct(108, 120)).toBeCloseTo(-10);
    expect(variancePct(120, 100)).toBeCloseTo(20);
    expect(variancePct(10, 0)).toBe(0);
  });

  it('risk score = probability * impact', () => {
    expect(riskScore(4, 4)).toBe(16);
    expect(riskScore(1, 5)).toBe(5);
  });

  it('net stock = opening + receipts - issues + adjustments', () => {
    expect(netStock(0, 1000, 850)).toBe(150);
    expect(netStock(100, 50, 30, 10)).toBe(130);
  });

  it('cost variance = budget - actual', () => {
    expect(costVariance(1000, 600)).toBe(400);
    expect(costVariance(1000, 1200)).toBe(-200);
  });
});
