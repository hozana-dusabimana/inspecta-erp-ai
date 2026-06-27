import { analyzeProduction, EngineEntry } from '../src/modules/production/engine';

function entry(p: Partial<EngineEntry>): EngineEntry {
  return {
    date: '2026-07-01T00:00:00.000Z', activity: 'Excavation', crew: 'Crew A', trade: null,
    plannedQty: 0, actualQty: 0, laborHours: 0, equipmentHours: 0,
    plannedProductivity: 0, equipmentRatePerHour: 0, availableEquipmentHours: 0, ...p,
  };
}

describe('Production analytics engine', () => {
  it('computes labor & equipment productivity', () => {
    const r = analyzeProduction({
      entries: [entry({ actualQty: 100, laborHours: 50, equipmentHours: 25 })],
      materials: [], laborRatePerHour: 20, contractValue: 0, budgetedProfitMarginPct: 0, bac: 0, actualCost: 0,
    });
    expect(r.productivity.labor).toBe(2); // 100/50
    expect(r.productivity.equipment).toBe(4); // 100/25
  });

  it('computes productivity variance vs the planned standard', () => {
    // actual productivity 2.0 vs standard 2.5 → -20%
    const r = analyzeProduction({
      entries: [entry({ actualQty: 100, laborHours: 50, plannedProductivity: 2.5 })],
      materials: [], laborRatePerHour: 20, contractValue: 0, budgetedProfitMarginPct: 0, bac: 0, actualCost: 0,
    });
    expect(r.productivity.variancePct).toBe(-20);
    expect(r.utilization.laborEfficiency).toBe(0.8);
  });

  it('quantifies profitability impact from productivity loss', () => {
    // standard 2.5 u/h → 100 units should take 40h; actual 50h → 10 extra h × $20 = $200.
    const r = analyzeProduction({
      entries: [entry({ actualQty: 100, laborHours: 50, equipmentHours: 0, plannedProductivity: 2.5 })],
      materials: [{ name: 'Cement', planned: 100, used: 120, unitCost: 5 }], // 20 over × $5 = $100 wastage
      laborRatePerHour: 20, contractValue: 100000, budgetedProfitMarginPct: 10, bac: 100000, actualCost: 0,
    });
    expect(r.profitabilityImpact.extraLaborHours).toBe(10);
    expect(r.profitabilityImpact.additionalLaborCost).toBe(200);
    expect(r.profitabilityImpact.materialWastageCost).toBe(100);
    expect(r.profitabilityImpact.budgetedProfit).toBe(10000);
    expect(r.profitabilityImpact.profitReduction).toBe(300); // 200 + 0 + 100
    expect(r.profitabilityImpact.forecastProfit).toBe(9700);
    expect(r.utilization.materialConsumptionRatio).toBe(1.2);
  });

  it('computes progress + simplified EVM/SPI', () => {
    const r = analyzeProduction({
      entries: [entry({ plannedQty: 200, actualQty: 150, laborHours: 10 })],
      materials: [], laborRatePerHour: 20, contractValue: 0, budgetedProfitMarginPct: 0, bac: 1000, actualCost: 0,
    });
    expect(r.progress.actualProgressPct).toBe(75); // 150/200
    expect(r.progress.earnedValue).toBe(750); // 75% × 1000
    expect(r.progress.spi).toBe(0.75);
  });
});
