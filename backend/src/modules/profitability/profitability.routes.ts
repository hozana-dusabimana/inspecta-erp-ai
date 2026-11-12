import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { loadProjectMetrics, ProjectMetrics } from '../../lib/project-metrics';

const router = Router();
router.use(authenticate);

interface ProjectProfit {
  projectId: string;
  code: string;
  name: string;
  revenue: number;
  budget: number;
  actualCost: number;
  billed: number;
  progressPct: number;
  earnedValue: number;
  estCostAtCompletion: number;
  forecastMargin: number;
  forecastMarginPct: number;
  leakage: string[];
}

/**
 * Activity-level / project-level profitability with leakage detection (M14).
 * Revenue is taken from the contract value, else the BOQ total, else the budget.
 * Forecast cost at completion extrapolates actual cost by progress, flagging
 * margin erosion, cost-burn-ahead-of-progress, and quality rework risk.
 */
function toProfit(m: ProjectMetrics, openNcrs: number): ProjectProfit & { hasBudget: boolean; contractValue: number | null; isDemo: boolean; status: string } {
  const revenue = m.contractValue ?? 0;
  const leakage: string[] = [];
  if (m.budget != null && m.actualCost > m.budget) leakage.push('Actual cost has exceeded budget.');
  if (m.budget != null && m.progressPct != null && m.actualCost / m.budget > m.progressPct / 100 + 0.1) leakage.push('Cost burn is running ahead of physical progress.');
  if (m.forecastMarginPct != null && m.forecastMarginPct < 5) leakage.push('Forecast margin is below a 5% safety threshold.');
  if (openNcrs > 0) leakage.push(`${openNcrs} open NCR(s) may drive rework cost.`);
  if (m.earnedValue != null && m.billed < m.earnedValue * 0.8) leakage.push('Billing is lagging earned value (cash-flow risk).');
  return {
    projectId: m.projectId, code: m.code, name: m.name, revenue, budget: m.budget ?? 0, actualCost: m.actualCost, billed: m.billed,
    progressPct: m.progressPct ?? 0, earnedValue: m.earnedValue ?? 0,
    // No budget => no forecast. Never echo actual cost back as the "estimate".
    estCostAtCompletion: m.eac ?? 0, forecastMargin: m.forecastProfit ?? 0, forecastMarginPct: m.forecastMarginPct ?? 0,
    leakage, hasBudget: m.budget != null && m.forecastProfit != null, contractValue: m.contractValue, isDemo: m.isDemo, status: m.health,
  };
}

router.get(
  '/analysis',
  requirePermission('profitability:read'),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    const pm = await loadProjectMetrics(req.user!.orgId, { projectId, projectIds: req.user!.projectIds });
    const analyses = pm.projects.map((m) => toProfit(m, m.openNcrs));
    const t = pm.totals;
    return ok(res, {
      projects: analyses,
      totals: {
        revenue: analyses.filter((a) => a.hasBudget).reduce((s, a) => s + a.revenue, 0),
        actualCost: t.actualCost,
        forecastMargin: t.forecastProfit,
        forecastMarginPct: t.forecastMarginPct,
        atRisk: analyses.filter((a) => a.leakage.length > 0).length,
        projectsWithoutBudget: analyses.filter((a) => !a.hasBudget).length,
      },
    });
  }),
);

export default router;
