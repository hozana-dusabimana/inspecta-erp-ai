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

// Helper: count rows grouped by a status-like field into a plain object.
function tally<T extends { status?: string }>(rows: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = (r.status as string) ?? 'UNKNOWN';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const num = (v: unknown) => Number(v ?? 0);

// ── 1. Project Baseline Dashboard ─────────────────────────────
router.get(
  '/baseline',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const projectId = req.query.projectId as string | undefined;
    const scope = projectId ? { organizationId: orgId, projectId } : { organizationId: orgId };

    const [wbsCount, boq, activities, project] = await Promise.all([
      prisma.wbsItem.count({ where: scope }),
      prisma.boqItem.findMany({ where: scope, select: { amount: true, budget: true } }),
      prisma.scheduleActivity.findMany({ where: scope, select: { durationDays: true, milestone: true, startDate: true, finishDate: true } }),
      projectId ? prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } }) : null,
    ]);

    const boqCost = boq.reduce((s, b) => s + num(b.amount), 0);
    const boqBudget = boq.reduce((s, b) => s + num(b.budget), 0);
    const starts = activities.map((a) => a.startDate).filter(Boolean) as Date[];
    const finishes = activities.map((a) => a.finishDate).filter(Boolean) as Date[];
    const minStart = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
    const maxFinish = finishes.length ? new Date(Math.max(...finishes.map((d) => d.getTime()))) : null;
    const plannedSpanDays = minStart && maxFinish ? Math.round((maxFinish.getTime() - minStart.getTime()) / 86400000) : 0;

    return ok(res, {
      project: project ? { code: project.code, name: project.name, contractValue: num(project.budget), startDate: project.startDate, endDate: project.endDate } : null,
      wbsCount,
      boqCount: boq.length,
      boqCost,
      boqBudget,
      activitiesCount: activities.length,
      milestonesCount: activities.filter((a) => a.milestone).length,
      totalDurationDays: activities.reduce((s, a) => s + a.durationDays, 0),
      scheduleStart: minStart,
      scheduleFinish: maxFinish,
      plannedSpanDays,
    });
  }),
);

// ── 2. Resource Planning Dashboard ────────────────────────────
router.get(
  '/resources',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const scope = { organizationId: orgId };

    const [employees, trades, crews, equipment, util, productivity, availability] = await Promise.all([
      prisma.employee.findMany({ where: scope, select: { id: true, status: true, tradeId: true } }),
      prisma.trade.findMany({ where: scope, select: { id: true, name: true } }),
      prisma.crew.count({ where: scope }),
      prisma.equipment.findMany({ where: scope, select: { ownershipStatus: true, status: true } }),
      prisma.equipmentUtilization.aggregate({ where: scope, _avg: { utilizationPct: true } }),
      prisma.productivityStandard.count({ where: scope }),
      prisma.laborAvailability.findMany({ where: scope, select: { available: true } }),
    ]);

    const tradeName = new Map(trades.map((t) => [t.id, t.name]));
    const byTrade: Record<string, number> = {};
    for (const e of employees) {
      const k = e.tradeId ? tradeName.get(e.tradeId) ?? 'Unassigned' : 'Unassigned';
      byTrade[k] = (byTrade[k] ?? 0) + 1;
    }
    const ownership: Record<string, number> = {};
    for (const eq of equipment) ownership[eq.ownershipStatus] = (ownership[eq.ownershipStatus] ?? 0) + 1;

    return ok(res, {
      employeesCount: employees.length,
      activeEmployees: employees.filter((e) => e.status === 'ACTIVE').length,
      tradesCount: trades.length,
      crewsCount: crews,
      equipmentCount: equipment.length,
      productivityStandards: productivity,
      avgEquipmentUtilizationPct: Number(num(util._avg.utilizationPct).toFixed(1)),
      avgUtilizationLight: trafficLight(num(util._avg.utilizationPct), 75, 50),
      employeesByTrade: byTrade,
      equipmentByOwnership: ownership,
      availabilityDays: availability.length,
      availableDays: availability.filter((a) => a.available).length,
    });
  }),
);

// ── 3. Procurement Dashboard ──────────────────────────────────
router.get(
  '/procurement',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const projectId = req.query.projectId as string | undefined;
    const scope = projectId ? { organizationId: orgId, projectId } : { organizationId: orgId };
    const orgScope = { organizationId: orgId };

    const [prs, pos, rfqs, quotes, deliveries, suppliers] = await Promise.all([
      prisma.purchaseRequest.findMany({ where: scope, select: { status: true, total: true } }),
      prisma.purchaseOrder.findMany({ where: scope, select: { status: true, total: true } }),
      prisma.rfq.count({ where: orgScope }),
      prisma.rfqQuote.findMany({ where: orgScope, select: { awarded: true } }),
      prisma.delivery.findMany({ where: scope, select: { status: true } }),
      prisma.supplier.count({ where: orgScope }),
    ]);

    return ok(res, {
      purchaseRequests: { count: prs.length, byStatus: tally(prs), totalValue: prs.reduce((s, p) => s + num(p.total), 0) },
      purchaseOrders: { count: pos.length, byStatus: tally(pos), totalValue: pos.reduce((s, p) => s + num(p.total), 0) },
      rfqsCount: rfqs,
      quotesCount: quotes.length,
      awardedQuotes: quotes.filter((q) => q.awarded).length,
      deliveries: { count: deliveries.length, byStatus: tally(deliveries) },
      suppliersCount: suppliers,
      pendingApprovals: prs.filter((p) => p.status === 'SUBMITTED').length,
    });
  }),
);

// ── 4. Budget Dashboard ───────────────────────────────────────
router.get(
  '/budget',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const projectId = req.query.projectId as string | undefined;
    const scope = projectId ? { organizationId: orgId, projectId } : { organizationId: orgId };

    const [boq, budgetAgg, costAgg, project] = await Promise.all([
      prisma.boqItem.findMany({ where: scope, select: { amount: true, budget: true } }),
      prisma.budgetLine.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
      projectId ? prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } }) : null,
    ]);

    const boqCost = boq.reduce((s, b) => s + num(b.amount), 0);
    const boqBudget = boq.reduce((s, b) => s + num(b.budget), 0);
    const plannedCost = boqBudget || Number(budgetAgg._sum.amount ?? 0);
    const actualCost = Number(costAgg._sum.amount ?? 0);
    const contractValue = project ? num(project.budget) : 0;
    const utilizationPct = plannedCost > 0 ? (actualCost / plannedCost) * 100 : 0;

    return ok(res, {
      contractValue,
      plannedProfitMargin: project ? num(project.plannedProfitMargin) : null,
      boqCost,
      boqBudget,
      markupAndContingency: boqBudget - boqCost,
      plannedCost,
      actualCost,
      costVariance: plannedCost - actualCost,
      budgetUtilizationPct: Number(utilizationPct.toFixed(1)),
      budgetLight: trafficLight(100 - utilizationPct, 20, 0), // healthy when under budget
      forecastProfit: contractValue > 0 ? contractValue - (actualCost || plannedCost) : boqBudget - boqCost,
    });
  }),
);

// ── 5. Inventory Dashboard ────────────────────────────────────
router.get(
  '/inventory',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const scope = { organizationId: orgId };

    const [materials, groups, waste, lastMoves] = await Promise.all([
      prisma.material.findMany({ where: scope }),
      prisma.stockMovement.groupBy({ by: ['materialId', 'type'], where: scope, _sum: { quantity: true } }),
      prisma.productionMaterial.aggregate({ where: scope, _sum: { wasteQty: true, qtyUsed: true } }),
      prisma.stockMovement.groupBy({ by: ['materialId'], where: scope, _max: { date: true } }),
    ]);

    const stockBy = new Map<string, number>();
    for (const g of groups) {
      const q = num(g._sum.quantity);
      const d = g.type === 'ISSUE' || g.type === 'WASTE' ? -q : g.type === 'TRANSFER' ? 0 : q;
      stockBy.set(g.materialId, (stockBy.get(g.materialId) ?? 0) + d);
    }
    const lastMove = new Map(lastMoves.map((m) => [m.materialId, m._max.date?.getTime() ?? 0]));
    const now = Date.now();
    const DEAD_MS = 90 * 86400000;

    let totalValue = 0; let reorderCount = 0; let deadStock = 0;
    for (const m of materials) {
      const stock = stockBy.get(m.id) ?? 0;
      totalValue += stock * num(m.unitCost);
      if (num(m.reorderLevel) > 0 && stock <= num(m.reorderLevel)) reorderCount++;
      const lm = lastMove.get(m.id) ?? 0;
      if (stock > 0 && (lm === 0 || now - lm > DEAD_MS)) deadStock++;
    }
    const usedTotal = num(waste._sum.qtyUsed);
    const wasteTotal = num(waste._sum.wasteQty);

    return ok(res, {
      materialsCount: materials.length,
      totalStockValue: Number(totalValue.toFixed(2)),
      reorderCount,
      deadStockCount: deadStock,
      materialConsumed: usedTotal,
      materialWaste: wasteTotal,
      wastePct: usedTotal > 0 ? Number(((wasteTotal / usedTotal) * 100).toFixed(1)) : 0,
    });
  }),
);

export default router;
