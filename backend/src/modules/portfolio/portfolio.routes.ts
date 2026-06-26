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
    const projects = await prisma.project.findMany({
      where: { organizationId: orgId },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const rows = await Promise.all(
      projects.map(async (p) => {
        const [costAgg, invoiceAgg, openNcrs, incidents, topRisk] = await Promise.all([
          prisma.costEntry.aggregate({ where: { projectId: p.id }, _sum: { amount: true } }),
          prisma.invoice.aggregate({ where: { projectId: p.id }, _sum: { amount: true } }),
          prisma.ncr.count({ where: { projectId: p.id, status: { not: 'CLOSED' } } }),
          prisma.incident.count({ where: { projectId: p.id } }),
          prisma.risk.findFirst({ where: { projectId: p.id, status: { not: 'CLOSED' } }, orderBy: { score: 'desc' } }),
        ]);
        const budget = Number(p.budget);
        const actualCost = Number(costAgg._sum.amount ?? 0);
        const billed = Number(invoiceAgg._sum.amount ?? 0);
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
          openNcrs,
          incidents,
          topRiskScore: topRisk?.score ?? 0,
        };
      }),
    );

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
