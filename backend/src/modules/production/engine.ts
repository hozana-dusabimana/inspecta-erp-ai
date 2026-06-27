import {
  productivity, productivityVariancePct, laborEfficiency, utilization,
  spi, scheduleVariance, extraHours,
} from '../../lib/formulas';

export interface EngineEntry {
  date: string;
  activity: string;
  crew?: string | null;
  trade?: string | null;
  plannedQty: number;
  actualQty: number;
  laborHours: number;
  equipmentHours: number;
  /** Planned productivity standard (units per resource-hour); 0 if none. */
  plannedProductivity: number;
  /** Equipment cost rate per hour (0 if unknown). */
  equipmentRatePerHour: number;
  /** Available equipment hours for the period (0 if unknown). */
  availableEquipmentHours: number;
}

export interface EngineMaterial {
  name: string;
  planned: number;
  used: number;
  unitCost: number;
}

export interface EngineInput {
  entries: EngineEntry[];
  materials: EngineMaterial[];
  laborRatePerHour: number;
  contractValue: number;
  budgetedProfitMarginPct: number;
  /** Budget at completion (BOQ budget or project budget). */
  bac: number;
  /** Actual cost to date (CostEntry sum). */
  actualCost: number;
}

const round = (n: number, d = 2) => Number(n.toFixed(d));

/**
 * Production & Profitability analytics engine (Module 2). Pure & unit-tested.
 * Computes productivity, progress/EVM, resource utilization and the
 * profitability impact (productivity loss → extra cost → profit reduction).
 */
export function analyzeProduction(input: EngineInput) {
  const { entries, materials, laborRatePerHour, contractValue, budgetedProfitMarginPct, bac, actualCost } = input;

  const totalPlanned = entries.reduce((s, e) => s + e.plannedQty, 0);
  const totalActual = entries.reduce((s, e) => s + e.actualQty, 0);
  const totalLabor = entries.reduce((s, e) => s + e.laborHours, 0);
  const totalEquip = entries.reduce((s, e) => s + e.equipmentHours, 0);
  const totalAvailEquip = entries.reduce((s, e) => s + e.availableEquipmentHours, 0);

  const laborProductivity = productivity(totalActual, totalLabor);
  const equipmentProductivity = productivity(totalActual, totalEquip);

  // Weighted planned productivity (by labor hours of entries that have a standard).
  let wStd = 0; let wLabor = 0;
  for (const e of entries) if (e.plannedProductivity > 0) { wStd += e.plannedProductivity * e.laborHours; wLabor += e.laborHours; }
  const plannedProductivity = wLabor > 0 ? wStd / wLabor : 0;

  // Per-entry rollups for cost impact + grouping.
  let extraLaborHours = 0;
  let additionalEquipmentCost = 0;
  for (const e of entries) {
    if (e.plannedProductivity > 0) {
      extraLaborHours += extraHours(e.actualQty, e.laborHours, e.plannedProductivity);
      const xEquip = extraHours(e.actualQty, e.equipmentHours, e.plannedProductivity);
      additionalEquipmentCost += xEquip * e.equipmentRatePerHour;
    }
  }
  const additionalLaborCost = extraLaborHours * laborRatePerHour;

  // Material consumption + wastage.
  const totalMatPlanned = materials.reduce((s, m) => s + m.planned, 0);
  const totalMatUsed = materials.reduce((s, m) => s + m.used, 0);
  const materialWastageCost = materials.reduce((s, m) => s + Math.max(0, m.used - m.planned) * m.unitCost, 0);
  const materialConsumptionRatio = totalMatPlanned > 0 ? totalMatUsed / totalMatPlanned : 0;

  // Progress + simplified EVM (production-driven).
  const actualProgressPct = totalPlanned > 0 ? Math.min(100, (totalActual / totalPlanned) * 100) : 0;
  const plannedProgressPct = totalPlanned > 0 ? 100 : 0; // all planned-to-date should be complete
  const progressVariancePct = actualProgressPct - plannedProgressPct;
  const ev = (actualProgressPct / 100) * bac; // earned value
  const pv = (plannedProgressPct / 100) * bac; // planned value
  const cpi = actualCost > 0 ? ev / actualCost : 0;

  // Profitability impact engine.
  const budgetedProfit = (contractValue * budgetedProfitMarginPct) / 100;
  const profitReduction = additionalLaborCost + additionalEquipmentCost + materialWastageCost;
  const forecastProfit = budgetedProfit - profitReduction;
  const forecastCost = (actualCost || 0) + profitReduction; // best-effort
  const forecastMarginPct = contractValue > 0 ? ((contractValue - Math.max(forecastCost, contractValue - budgetedProfit + profitReduction)) / contractValue) * 100 : 0;

  // Group productivity by crew and by activity.
  const groupBy = (pick: (e: EngineEntry) => string) => {
    const m = new Map<string, { actual: number; labor: number }>();
    for (const e of entries) {
      const k = pick(e) || 'Unassigned';
      const g = m.get(k) ?? { actual: 0, labor: 0 };
      g.actual += e.actualQty; g.labor += e.laborHours; m.set(k, g);
    }
    return [...m.entries()].map(([name, g]) => ({ name, productivity: round(productivity(g.actual, g.labor), 3) }));
  };

  return {
    totals: { entries: entries.length, totalPlanned, totalActual, totalLaborHours: totalLabor, totalEquipmentHours: totalEquip },
    productivity: {
      labor: round(laborProductivity, 3),
      equipment: round(equipmentProductivity, 3),
      plannedStandard: round(plannedProductivity, 3),
      variancePct: round(productivityVariancePct(laborProductivity, plannedProductivity)),
      byCrew: groupBy((e) => e.crew || 'Unassigned'),
      byActivity: groupBy((e) => e.activity),
    },
    progress: {
      plannedProgressPct: round(plannedProgressPct),
      actualProgressPct: round(actualProgressPct),
      progressVariancePct: round(progressVariancePct),
      earnedValue: round(ev),
      plannedValue: round(pv),
      actualCost: round(actualCost),
      spi: round(spi(ev, pv), 3),
      cpi: round(cpi, 3),
      scheduleVariance: round(scheduleVariance(ev, pv)),
    },
    utilization: {
      laborEfficiency: round(laborEfficiency(laborProductivity, plannedProductivity), 3),
      equipmentUtilizationPct: round(utilization(totalEquip, totalAvailEquip) * 100),
      materialConsumptionRatio: round(materialConsumptionRatio, 3),
    },
    profitabilityImpact: {
      extraLaborHours: round(extraLaborHours),
      additionalLaborCost: round(additionalLaborCost),
      additionalEquipmentCost: round(additionalEquipmentCost),
      materialWastageCost: round(materialWastageCost),
      productivityLossPct: round(Math.min(0, productivityVariancePct(laborProductivity, plannedProductivity))),
      budgetedProfit: round(budgetedProfit),
      profitReduction: round(profitReduction),
      forecastProfit: round(forecastProfit),
      forecastMarginPct: round(forecastMarginPct),
    },
  };
}
