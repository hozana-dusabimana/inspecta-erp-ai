import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';

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
      prisma.project.findMany({ where: scope, include: { client: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
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

    const rows = projects.map((p) => {
        const budget = Number(p.budget);
        const actualCost = costMap.get(p.id) ?? 0;
        const billed = invMap.get(p.id) ?? 0;
        return {
          projectId: p.id,
          code: p.code,
          name: p.name,
          client: p.client?.name ?? null,
          status: p.status,
          health: p.health,
          progressPct: p.progressPct,
          budget,
          actualCost,
          billed,
          costVariance: budget - actualCost,
          budgetUtilizationPct: budget > 0 ? Number(((actualCost / budget) * 100).toFixed(1)) : 0,
          openNcrs: ncrMap.get(p.id) ?? 0,
          incidents: incMap.get(p.id) ?? 0,
          topRiskScore: topRiskMap.get(p.id) ?? 0,
        };
      });

    const company = {
      totalProjects: rows.length,
      totalBudget: rows.reduce((s, r) => s + r.budget, 0),
      totalActualCost: rows.reduce((s, r) => s + r.actualCost, 0),
      totalBilled: rows.reduce((s, r) => s + r.billed, 0),
      avgProgressPct:
        rows.length === 0 ? 0 : Number((rows.reduce((s, r) => s + r.progressPct, 0) / rows.length).toFixed(1)),
      atRiskProjects: rows.filter((r) => r.health === 'CRITICAL' || r.costVariance < 0).length,
    };

    return ok(res, { projects: rows, company });
  }),
);

export default router;
