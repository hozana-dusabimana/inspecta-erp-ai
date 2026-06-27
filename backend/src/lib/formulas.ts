/**
 * Canonical ERP formulas — single source of truth, unit-tested.
 * Used across Production, Risk, Inventory and Finance modules.
 */

/** Productivity = Output / Input (e.g. units per labor hour). */
export function productivity(output: number, input: number): number {
  return input > 0 ? output / input : 0;
}

/** Variance % = (Actual − Planned) / Planned × 100. */
export function variancePct(actual: number, planned: number): number {
  return planned > 0 ? ((actual - planned) / planned) * 100 : 0;
}

/** Risk score = probability × impact (each 1–5 → 1–25). */
export function riskScore(probability: number, impact: number): number {
  return probability * impact;
}

/** Net stock = opening + Σreceipts − Σissues (+ adjustments). */
export function netStock(opening: number, receipts: number, issues: number, adjustments = 0): number {
  return opening + receipts - issues + adjustments;
}

/** Cost variance = budget − actual (positive = under budget). */
export function costVariance(budget: number, actual: number): number {
  return budget - actual;
}

// ─────────────── Module 2 — Production & Profitability ───────────────

/** Productivity variance % = (Actual productivity − Planned) / Planned × 100. */
export function productivityVariancePct(actualProductivity: number, plannedProductivity: number): number {
  return plannedProductivity > 0 ? ((actualProductivity - plannedProductivity) / plannedProductivity) * 100 : 0;
}

/** Labor efficiency = actual productivity / planned productivity (1.0 = on standard). */
export function laborEfficiency(actualProductivity: number, plannedProductivity: number): number {
  return plannedProductivity > 0 ? actualProductivity / plannedProductivity : 0;
}

/** Utilization = used / available (e.g. equipment hours). */
export function utilization(used: number, available: number): number {
  return available > 0 ? used / available : 0;
}

/** Schedule Performance Index = Earned Value / Planned Value. */
export function spi(earnedValue: number, plannedValue: number): number {
  return plannedValue > 0 ? earnedValue / plannedValue : 0;
}

/** Schedule Variance = Earned Value − Planned Value. */
export function scheduleVariance(earnedValue: number, plannedValue: number): number {
  return earnedValue - plannedValue;
}

/**
 * Extra (wasted) resource hours vs the standard for the achieved output.
 * standardHours = actualQty / plannedProductivity; extra = actualHours − standardHours.
 * Returns 0 when ahead of standard (no loss).
 */
export function extraHours(actualQty: number, actualHours: number, plannedProductivity: number): number {
  if (plannedProductivity <= 0) return 0;
  const standardHours = actualQty / plannedProductivity;
  return Math.max(0, actualHours - standardHours);
}
