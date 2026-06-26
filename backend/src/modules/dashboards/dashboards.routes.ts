import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';

const router = Router();
router.use(authenticate);

function trafficLight(value: number, green: number, amber: number): 'GREEN' | 'AMBER' | 'RED' {
  if (value >= green) return 'GREEN';
  if (value >= amber) return 'AMBER';
  return 'RED';
}

// ── Executive dashboard (M12) + KPI system (M15) ──────────────
router.get(
  '/executive',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const scope = { organizationId: orgId };

    const [
      projects,
      budgetAgg,
      costAgg,
      invoiceAgg,
      paymentAgg,
      prodAgg,
      laborAgg,
      openNcrs,
      incidents,
      openRisks,
      lowStock,
      unreadNotifs,
    ] = await Promise.all([
      prisma.project.findMany({ where: scope }),
      prisma.budgetLine.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.productionEntry.aggregate({ where: scope, _sum: { plannedQty: true, actualQty: true } }),
      prisma.productionEntry.aggregate({ where: scope, _sum: { laborHours: true } }),
      prisma.ncr.count({ where: { ...scope, status: { not: 'CLOSED' } } }),
      prisma.incident.count({ where: scope }),
      prisma.risk.count({ where: { ...scope, status: { not: 'CLOSED' } } }),
      prisma.material.findMany({ where: scope, select: { id: true, reorderLevel: true } }),
      prisma.notification.count({ where: { ...scope, isRead: false } }),
    ]);

    const totalBudget = Number(budgetAgg._sum.amount ?? 0) || projects.reduce((s, p) => s + Number(p.budget), 0);
    const actualCost = Number(costAgg._sum.amount ?? 0);
    const billed = Number(invoiceAgg._sum.amount ?? 0);
    const received = Number(paymentAgg._sum.amount ?? 0);
    const planned = Number(prodAgg._sum.plannedQty ?? 0);
    const actual = Number(prodAgg._sum.actualQty ?? 0);
    const labor = Number(laborAgg._sum.laborHours ?? 0);

    // KPI metrics (CPI/SPI-style + indices).
    const cpi = actualCost > 0 ? (billed || totalBudget) / actualCost : 1; // cost performance proxy
    const spi = planned > 0 ? actual / planned : 1; // schedule/output performance
    const productivityIndex = labor > 0 ? actual / labor : 0;
    const avgProgress =
      projects.length === 0 ? 0 : projects.reduce((s, p) => s + p.progressPct, 0) / projects.length;

    // Low-stock count requires per-material netting.
    let reorderCount = 0;
    if (lowStock.length) {
      const groups = await prisma.stockMovement.groupBy({
        by: ['materialId', 'type'],
        where: scope,
        _sum: { quantity: true },
      });
      const stockBy = new Map<string, number>();
      for (const g of groups) {
        const qty = Number(g._sum.quantity ?? 0);
        stockBy.set(g.materialId, (stockBy.get(g.materialId) ?? 0) + (g.type === 'ISSUE' ? -qty : qty));
      }
      reorderCount = lowStock.filter(
        (m) => Number(m.reorderLevel) > 0 && (stockBy.get(m.id) ?? 0) <= Number(m.reorderLevel),
      ).length;
    }

    return ok(res, {
      portfolio: {
        totalProjects: projects.length,
        activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
        completedProjects: projects.filter((p) => p.status === 'COMPLETED').length,
        avgProgressPct: Number(avgProgress.toFixed(1)),
        health: {
          OPTIMAL: projects.filter((p) => p.health === 'OPTIMAL').length,
          WARNING: projects.filter((p) => p.health === 'WARNING').length,
          CRITICAL: projects.filter((p) => p.health === 'CRITICAL').length,
        },
      },
      finance: {
        totalBudget,
        actualCost,
        costVariance: totalBudget - actualCost,
        billed,
        received,
        outstanding: billed - received,
        forecastProfit: (billed || totalBudget) - actualCost,
      },
      kpis: {
        cpi: Number(cpi.toFixed(2)),
        cpiLight: trafficLight(cpi, 1, 0.9),
        spi: Number(spi.toFixed(2)),
        spiLight: trafficLight(spi, 1, 0.9),
        productivityIndex: Number(productivityIndex.toFixed(3)),
        budgetUtilizationPct: totalBudget > 0 ? Number(((actualCost / totalBudget) * 100).toFixed(1)) : 0,
      },
      compliance: {
        openNcrs,
        incidents,
        openRisks,
        reorderAlerts: reorderCount,
        unreadNotifications: unreadNotifs,
      },
    });
  }),
);

export default router;
