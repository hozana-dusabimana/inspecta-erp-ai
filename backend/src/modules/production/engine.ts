import {
  productivity, productivityVariancePct, laborEfficiency, utilization,
  spi, scheduleVariance, extraHours,
} from '../../lib/formulas';

export interface EngineEntry {
  date: string;
  activity: string;
  crew?: string | null;
  trade?: string | null;
  laborCost?: number;
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
  /** Delay/rework inputs for the impact engine (default 0). */
  delayDays?: number;
  dailyOverheadRate?: number;
  dailyProfitRate?: number;
  openNcrCount?: number;
  reworkHoursPerNcr?: number;
}

/** Bucket a date string into day/week/month keys. */
function bucketKeys(iso: string): { day: string; week: string; month: string } {
  const day = iso.slice(0, 10);
  const d = new Date(iso);
  const month = iso.slice(0, 7);
  // ISO week (year-Www), approximate via Thursday rule.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const week = `${tmp.getUTCFullYear()}-W${String(1 + Math.round(((tmp.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
  return { day, week, month };
}

const round = (n: number, d = 2) => Number(n.toFixed(d));

/**
 * Production & Profitability analytics engine (Module 2). Pure & unit-tested.
 * Computes productivity, progress/EVM, resource utilization and the
 * profitability impact (productivity loss → extra cost → profit reduction).
 */
export function analyzeProduction(input: EngineInput) {
  const {
    entries, materials, laborRatePerHour, contractValue, budgetedProfitMarginPct, bac, actualCost,
    delayDays = 0, dailyOverheadRate = 0, dailyProfitRate = 0, openNcrCount = 0, reworkHoursPerNcr = 0,
  } = input;

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
  const delayCost = delayDays * dailyOverheadRate;
  const reworkCost = openNcrCount * reworkHoursPerNcr * laborRatePerHour;
  const opportunityCost = delayDays * dailyProfitRate;
  const profitReduction = additionalLaborCost + additionalEquipmentCost + materialWastageCost + delayCost + reworkCost + opportunityCost;
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

  // Time-bucketed productivity trends (daily / weekly / monthly).
  const buildTrend = (pick: (k: { day: string; week: string; month: string }) => string) => {
    const m = new Map<string, { planned: number; actual: number; labor: number }>();
    for (const e of entries) {
      const key = pick(bucketKeys(e.date));
      const g = m.get(key) ?? { planned: 0, actual: 0, labor: 0 };
      g.planned += e.plannedQty; g.actual += e.actualQty; g.labor += e.laborHours; m.set(key, g);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, g]) => ({
      label, planned: round(g.planned), actual: round(g.actual), productivity: round(productivity(g.actual, g.labor), 3),
    }));
  };

  // Labor-hours histogram by activity.
  const laborHist = new Map<string, number>();
  for (const e of entries) laborHist.set(e.activity, (laborHist.get(e.activity) ?? 0) + e.laborHours);
  const laborByActivity = [...laborHist.entries()].map(([name, hours]) => ({ name, hours: round(hours) }));

  return {
    totals: { entries: entries.length, totalPlanned, totalActual, totalLaborHours: totalLabor, totalEquipmentHours: totalEquip },
    trends: { daily: buildTrend((k) => k.day), weekly: buildTrend((k) => k.week), monthly: buildTrend((k) => k.month) },
    histograms: { laborByActivity },
    productivity: {
      labor: round(laborProductivity, 3),
      equipment: round(equipmentProductivity, 3),
      plannedStandard: round(plannedProductivity, 3),
      variancePct: round(productivityVariancePct(laborProductivity, plannedProductivity)),
      byCrew: groupBy((e) => e.crew || 'Unassigned'),
      byActivity: groupBy((e) => e.activity),
      byTrade: groupBy((e) => e.trade || 'Unassigned'),
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
      delayCost: round(delayCost),
      reworkCost: round(reworkCost),
      opportunityCost: round(opportunityCost),
      productivityLossPct: round(Math.min(0, productivityVariancePct(laborProductivity, plannedProductivity))),
      budgetedProfit: round(budgetedProfit),
      profitReduction: round(profitReduction),
      forecastProfit: round(forecastProfit),
      forecastMarginPct: round(forecastMarginPct),
    },
  };
}
