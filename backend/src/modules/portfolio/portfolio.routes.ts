import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { loadProjectMetrics } from '../../lib/project-metrics';

const router = Router();
router.use(authenticate);

/**
 * Multi-project comparison + company KPIs (M23). One row per project with the
 * headline KPIs needed to rank and compare across the portfolio.
 */
router.get(
  '/comparison',
  requirePermission('portfolio:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const scope = { organizationId: orgId };
    // Batch all per-project aggregates into grouped queries (was 5N+1 → ~6 total).
    const [projects, costByP, invByP, ncrByP, incByP, openRisks] = await Promise.all([
      prisma.project.findMany({ where: { ...scope, ...(req.user!.projectIds ? { id: { in: req.user!.projectIds } } : {}) }, include: { client: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
      prisma.costEntry.groupBy({ by: ['projectId'], where: scope, _sum: { amount: true } }),
      prisma.invoice.groupBy({ by: ['projectId'], where: scope, _sum: { amount: true } }),
      prisma.ncr.groupBy({ by: ['projectId'], where: { ...scope, status: { not: 'CLOSED' } }, _count: { _all: true } }),
      prisma.incident.groupBy({ by: ['projectId'], where: scope, _count: { _all: true } }),
      prisma.risk.findMany({ where: { ...scope, status: { not: 'CLOSED' } }, select: { projectId: true, score: true } }),
    ]);
    const costMap = new Map(costByP.map((c) => [c.projectId, Number(c._sum.amount ?? 0)]));
    const invMap = new Map(invByP.map((c) => [c.projectId, Number(c._sum.amount ?? 0)]));
    const ncrMap = new Map(ncrByP.map((c) => [c.projectId, c._count._all]));
    const incMap = new Map(incByP.map((c) => [c.projectId, c._count._all]));
    const topRiskMap = new Map<string, number>();
    for (const r of openRisks) topRiskMap.set(r.projectId, Math.max(topRiskMap.get(r.projectId) ?? 0, r.score));

    const pm = await loadProjectMetrics(orgId, { includeDemo: true, projectIds: req.user!.projectIds });
    const metricsById = new Map(pm.projects.map((m) => [m.projectId, m]));
    const rows = projects.map((p) => {
        const m = metricsById.get(p.id)!;
        const budget = m.budget ?? 0;
        const actualCost = costMap.get(p.id) ?? 0;
        const billed = invMap.get(p.id) ?? 0;
        return {
          projectId: p.id,
          code: p.code,
          name: p.name,
          client: p.client?.name ?? null,
          status: p.status,
          health: p.health,
          isDemo: p.isDemo,
          progressPct: m.progressPct ?? 0,
          hasProgress: m.progressPct != null,
          contractValue: m.contractValue,
          budget,
          actualCost,
          billed,
          spi: m.spi, cpi: m.cpi, eac: m.eac,
          forecastProfit: m.forecastProfit, forecastMarginPct: m.forecastMarginPct,
          healthStatus: m.health,
          costVariance: budget - actualCost,
          budgetUtilizationPct: budget > 0 ? Number(((actualCost / budget) * 100).toFixed(1)) : null,
          openNcrs: m.openNcrs,
          incidents: incMap.get(p.id) ?? 0,
          topRiskScore: topRiskMap.get(p.id) ?? 0,
        };
      });

    const live = rows.filter((r) => !r.isDemo);
    const t = pm.totals; // excludes demo projects
    const company = {
      totalProjects: live.length,
      totalBudget: t.budget,
      totalActualCost: t.actualCost,
      totalBilled: t.billed,
      avgProgressPct: t.avgProgressPct,
      spi: t.spi, cpi: t.cpi,
      forecastProfit: t.forecastProfit, forecastMarginPct: t.forecastMarginPct,
      atRiskProjects: t.atRisk + t.critical,
      health: t.health,
    };

    return ok(res, { projects: rows, company });
  }),
);

export default router;
