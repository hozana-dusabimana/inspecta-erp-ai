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
