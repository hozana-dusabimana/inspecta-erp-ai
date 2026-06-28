import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';

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
interface ProfitInputs { contractValue: number; boqTotal: number; actualCost: number; billed: number; openNcrs: number }

function computeProfit(project: { id: string; code: string; name: string; budget: unknown; progressPct: number }, d: ProfitInputs): ProjectProfit {
  const budget = Number(project.budget);
  const boqTotal = d.boqTotal;
  const revenue = d.contractValue || boqTotal || budget;
  const actualCost = d.actualCost;
  const billed = d.billed;
  const openNcrs = d.openNcrs;
  const progress = project.progressPct;

  const earnedValue = revenue * (progress / 100);
  const estCostAtCompletion = progress > 0 ? actualCost / (progress / 100) : actualCost;
  const forecastMargin = revenue - estCostAtCompletion;
  const forecastMarginPct = revenue > 0 ? (forecastMargin / revenue) * 100 : 0;

  const leakage: string[] = [];
  if (budget > 0 && actualCost > budget) leakage.push('Actual cost has exceeded budget.');
  if (progress > 0 && actualCost / budget > progress / 100 + 0.1)
    leakage.push('Cost burn is running ahead of physical progress.');
  if (forecastMarginPct < 5) leakage.push('Forecast margin is below a 5% safety threshold.');
  if (openNcrs > 0) leakage.push(`${openNcrs} open NCR(s) may drive rework cost.`);
  if (billed < earnedValue * 0.8) leakage.push('Billing is lagging earned value (cash-flow risk).');

  return {
    projectId: project.id,
    code: project.code,
    name: project.name,
    revenue,
    budget,
    actualCost,
    billed,
    progressPct: progress,
    earnedValue: Number(earnedValue.toFixed(2)),
    estCostAtCompletion: Number(estCostAtCompletion.toFixed(2)),
    forecastMargin: Number(forecastMargin.toFixed(2)),
    forecastMarginPct: Number(forecastMarginPct.toFixed(2)),
    leakage,
  };
}

router.get(
  '/analysis',
  requirePermission('profitability:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const projectId = req.query.projectId as string | undefined;
    const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };
    // Batch per-project aggregates into grouped queries (was 5N → ~6 total).
    const [projects, contracts, boqByP, costByP, invByP, ncrByP] = await Promise.all([
      prisma.project.findMany({ where: { organizationId: orgId, ...(projectId ? { id: projectId } : {}) }, orderBy: { createdAt: 'desc' } }),
      prisma.contract.findMany({ where: { organizationId: orgId }, select: { projectId: true, value: true } }),
      prisma.boqItem.groupBy({ by: ['projectId'], where: scope, _sum: { amount: true } }),
      prisma.costEntry.groupBy({ by: ['projectId'], where: scope, _sum: { amount: true } }),
      prisma.invoice.groupBy({ by: ['projectId'], where: scope, _sum: { amount: true } }),
      prisma.ncr.groupBy({ by: ['projectId'], where: { ...scope, status: { not: 'CLOSED' } }, _count: { _all: true } }),
    ]);
    const num = (v: unknown) => Number(v ?? 0);
    const contractMap = new Map(contracts.filter((c) => c.projectId).map((c) => [c.projectId as string, num(c.value)]));
    const boqMap = new Map(boqByP.map((c) => [c.projectId, num(c._sum.amount)]));
    const costMap = new Map(costByP.map((c) => [c.projectId, num(c._sum.amount)]));
    const invMap = new Map(invByP.map((c) => [c.projectId, num(c._sum.amount)]));
    const ncrMap = new Map(ncrByP.map((c) => [c.projectId, c._count._all]));

    const analyses = projects.map((p) => computeProfit(p, {
      contractValue: contractMap.get(p.id) ?? 0,
      boqTotal: boqMap.get(p.id) ?? 0,
      actualCost: costMap.get(p.id) ?? 0,
      billed: invMap.get(p.id) ?? 0,
      openNcrs: ncrMap.get(p.id) ?? 0,
    }));
    const totals = analyses.reduce(
      (acc, a) => {
        acc.revenue += a.revenue;
        acc.actualCost += a.actualCost;
        acc.forecastMargin += a.forecastMargin;
        return acc;
      },
      { revenue: 0, actualCost: 0, forecastMargin: 0 },
    );

    return ok(res, {
      projects: analyses,
      totals: {
        ...totals,
        forecastMarginPct: totals.revenue > 0 ? Number(((totals.forecastMargin / totals.revenue) * 100).toFixed(2)) : 0,
        atRisk: analyses.filter((a) => a.leakage.length > 0).length,
      },
    });
  }),
);

export default router;
