import { Router, Request } from 'express';
import { z } from 'zod';
import { CostCategory, InvoiceStatus, CashDirection } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';
import { spi, cpi, eac, etc, vac } from '../../lib/formulas';

const router = Router();
const num = (v: unknown) => Number(v ?? 0);
const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

// ── Budget lines (by WBS / cost code) ─────────────────────────
const budgetCreate = z.object({
  projectId: z.string(),
  wbsItemId: z.string().optional(),
  category: z.nativeEnum(CostCategory).optional(),
  budgetType: z.enum(['ORIGINAL', 'REVISED', 'FORECAST', 'CONTINGENCY']).optional(),
  costCode: z.string().optional(),
  description: z.string().min(1),
  amount: z.number().nonnegative(),
});
router.use(
  '/budget',
  createCrudRouter({
    model: 'budgetLine',
    entity: 'budget-line',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: budgetCreate,
    updateSchema: budgetCreate.partial(),
    searchField: 'description',
    requireProject: true,
    refs: [{ field: 'wbsItemId', model: 'wbsItem' }],
    transform: stamp,
  }),
);

// ── Cost entries (actuals) ────────────────────────────────────
const costCreate = z.object({
  projectId: z.string(),
  wbsItemId: z.string().optional(),
  category: z.nativeEnum(CostCategory).optional(),
  description: z.string().min(1),
  amount: z.number().nonnegative(),
  date: z.string().datetime().optional(),
});
router.use(
  '/costs',
  createCrudRouter({
    model: 'costEntry',
    entity: 'cost-entry',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: costCreate,
    updateSchema: costCreate.partial(),
    searchField: 'description',
    requireProject: true,
    orderBy: { date: 'desc' },
    refs: [{ field: 'wbsItemId', model: 'wbsItem' }],
    transform: stamp,
    // Alert when cumulative actual cost exceeds the project budget.
    afterChange: async (action, record, req) => {
      if (action === 'DELETE') return;
      const projectId = String(record.projectId);
      const [project, agg] = await Promise.all([
        prisma.project.findUnique({ where: { id: projectId } }),
        prisma.costEntry.aggregate({ where: { projectId }, _sum: { amount: true } }),
      ]);
      const spent = Number(agg._sum.amount ?? 0);
      const budget = Number(project?.budget ?? 0);
      if (budget > 0 && spent > budget) {
        await notify({
          organizationId: req.user!.orgId,
          type: 'COST_OVERRUN',
          severity: 'CRITICAL',
          title: 'Cost overrun',
          message: `${project?.name ?? 'Project'} actual cost (${spent.toLocaleString()}) has exceeded its budget (${budget.toLocaleString()}).`,
          link: `/projects/${projectId}`,
        });
      }
    },
  }),
);

// ── Client invoices / IPC ─────────────────────────────────────
const invoiceCreate = z.object({
  projectId: z.string(),
  number: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().nonnegative(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  // IPC fields
  isIpc: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
  certificateNumber: z.string().optional(),
  grossValuation: z.number().nonnegative().optional(),
  previousCertified: z.number().nonnegative().optional(),
  retentionPct: z.number().min(0).max(100).optional(),
  advanceDeduction: z.number().nonnegative().optional(),
  taxPct: z.number().min(0).max(100).optional(),
});
router.use(
  '/invoices',
  createCrudRouter({
    model: 'invoice',
    entity: 'invoice',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: invoiceCreate,
    updateSchema: invoiceCreate.partial(),
    searchField: 'number',
    requireProject: true,
    include: { payments: true },
    // IPC net = (gross − previous) − retention − advance + tax. Falls back to amount.
    transform: (data, req) => {
      const gross = num(data.grossValuation);
      if (gross > 0) {
        const thisCert = gross - num(data.previousCertified);
        const retention = (thisCert * num(data.retentionPct)) / 100;
        data.retentionAmount = retention;
        const taxable = thisCert - retention - num(data.advanceDeduction);
        const tax = (taxable * num(data.taxPct)) / 100;
        data.netAmount = taxable + tax;
        data.amount = thisCert; // gross certified this period
      }
      return stamp(data, req);
    },
  }),
);

// ── Cash flow entries (manual inflows/outflows) ───────────────
const cashCreate = z.object({
  projectId: z.string().optional(),
  date: z.string().datetime().optional(),
  direction: z.nativeEnum(CashDirection),
  category: z.string().min(1),
  amount: z.number().nonnegative(),
  reference: z.string().optional(),
  note: z.string().optional(),
});
router.use(
  '/cash-flow-entries',
  createCrudRouter({
    model: 'cashFlowEntry',
    entity: 'cash-flow-entry',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: cashCreate,
    updateSchema: cashCreate.partial(),
    orderBy: { date: 'desc' },
    transform: stamp,
  }),
);

// ── Payments ──────────────────────────────────────────────────
const paymentCreate = z.object({
  projectId: z.string(),
  invoiceId: z.string().optional(),
  reference: z.string().min(1),
  amount: z.number().nonnegative(),
  date: z.string().datetime().optional(),
});
router.use(
  '/payments',
  createCrudRouter({
    model: 'payment',
    entity: 'payment',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: paymentCreate,
    updateSchema: paymentCreate.partial(),
    searchField: 'reference',
    requireProject: true,
    orderBy: { date: 'desc' },
  }),
);

// ── Financial summary (budget vs actual, billing, cash) ───────
router.get(
  '/summary',
  authenticate,
  requirePermission('finance:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const projectId = req.query.projectId as string | undefined;
    const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };

    const [budgetAgg, costAgg, invoiceAgg, paymentAgg, costByCat] = await Promise.all([
      prisma.budgetLine.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.costEntry.groupBy({ by: ['category'], where: scope, _sum: { amount: true } }),
    ]);

    const budget = Number(budgetAgg._sum.amount ?? 0);
    const actual = Number(costAgg._sum.amount ?? 0);
    const billed = Number(invoiceAgg._sum.amount ?? 0);
    const received = Number(paymentAgg._sum.amount ?? 0);

    return ok(res, {
      budget,
      actualCost: actual,
      costVariance: budget - actual,
      costVariancePct: budget > 0 ? Number((((budget - actual) / budget) * 100).toFixed(2)) : 0,
      billed,
      received,
      outstanding: billed - received,
      forecastProfit: billed - actual,
      costByCategory: costByCat.map((c) => ({
        category: c.category,
        amount: Number(c._sum.amount ?? 0),
      })),
    });
  }),
);

// ── Cash Flow engine (inflows/outflows/position + monthly curve) ──
router.get('/cash-flow', authenticate, requirePermission('finance:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };

  const [payments, costs, manual] = await Promise.all([
    prisma.payment.findMany({ where: scope, select: { amount: true, date: true } }),
    prisma.costEntry.findMany({ where: scope, select: { amount: true, date: true, category: true } }),
    prisma.cashFlowEntry.findMany({ where: scope, select: { amount: true, date: true, direction: true } }),
  ]);

  const monthly = new Map<string, { in: number; out: number }>();
  const addM = (date: Date, dir: 'in' | 'out', amt: number) => {
    const k = date.toISOString().slice(0, 7);
    const g = monthly.get(k) ?? { in: 0, out: 0 }; g[dir] += amt; monthly.set(k, g);
  };
  let inflows = 0; let outflows = 0;
  for (const p of payments) { inflows += num(p.amount); addM(p.date, 'in', num(p.amount)); }
  for (const m of manual) { const a = num(m.amount); if (m.direction === 'IN') { inflows += a; addM(m.date, 'in', a); } else { outflows += a; addM(m.date, 'out', a); } }
  for (const c of costs) { outflows += num(c.amount); addM(c.date, 'out', num(c.amount)); }

  let cum = 0;
  const curve = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, g]) => {
    const net = g.in - g.out; cum += net;
    return { month, inflows: Number(g.in.toFixed(2)), outflows: Number(g.out.toFixed(2)), net: Number(net.toFixed(2)), cumulative: Number(cum.toFixed(2)) };
  });
  const deficitMonths = curve.filter((c) => c.cumulative < 0).map((c) => c.month);

  return ok(res, {
    inflows: Number(inflows.toFixed(2)),
    outflows: Number(outflows.toFixed(2)),
    cashPosition: Number((inflows - outflows).toFixed(2)),
    curve,
    deficitMonths,
    hasDeficit: deficitMonths.length > 0,
  });
}));

// ── Earned Value Management (CPI/SPI/EAC/ETC/VAC) ──────────────
router.get('/evm', authenticate, requirePermission('finance:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  const scope = { organizationId: orgId, projectId };

  const [budgetAgg, costAgg, prod, project] = await Promise.all([
    prisma.budgetLine.aggregate({ where: scope, _sum: { amount: true } }),
    prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
    prisma.productionEntry.aggregate({ where: scope, _sum: { plannedQty: true, actualQty: true } }),
    prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } }),
  ]);

  const bac = num(budgetAgg._sum.amount) || num(project?.budget);
  const ac = num(costAgg._sum.amount);
  const planned = num(prod._sum.plannedQty);
  const actual = num(prod._sum.actualQty);
  const actualProgress = planned > 0 ? Math.min(1, actual / planned) : num(project?.progressPct) / 100;

  // Planned progress from elapsed schedule time, else equal to actual (SPI=1).
  const start = project?.startDate?.getTime();
  const end = project?.endDate?.getTime();
  const nowT = Date.now();
  const plannedProgress = start && end && end > start ? Math.min(1, Math.max(0, (nowT - start) / (end - start))) : actualProgress;

  const ev = actualProgress * bac;
  const pv = plannedProgress * bac;
  const cpiV = cpi(ev, ac);
  const eacV = eac(bac, cpiV);

  return ok(res, {
    bac: Number(bac.toFixed(2)), ac: Number(ac.toFixed(2)),
    plannedValue: Number(pv.toFixed(2)), earnedValue: Number(ev.toFixed(2)),
    cpi: Number(cpiV.toFixed(3)), spi: Number(spi(ev, pv).toFixed(3)),
    eac: Number(eacV.toFixed(2)), etc: Number(etc(eacV, ac).toFixed(2)), vac: Number(vac(bac, eacV).toFixed(2)),
    actualProgressPct: Number((actualProgress * 100).toFixed(1)),
    plannedProgressPct: Number((plannedProgress * 100).toFixed(1)),
  });
}));

// ── Cost rollup by WBS (budget vs actual) ─────────────────────
router.get('/cost-by-wbs', authenticate, requirePermission('finance:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  const scope = { organizationId: orgId, projectId };

  const [wbs, budgets, costs] = await Promise.all([
    prisma.wbsItem.findMany({ where: scope, select: { id: true, code: true, name: true } }),
    prisma.budgetLine.groupBy({ by: ['wbsItemId'], where: scope, _sum: { amount: true } }),
    prisma.costEntry.groupBy({ by: ['wbsItemId'], where: scope, _sum: { amount: true } }),
  ]);
  const bMap = new Map(budgets.map((b) => [b.wbsItemId ?? 'none', num(b._sum.amount)]));
  const cMap = new Map(costs.map((c) => [c.wbsItemId ?? 'none', num(c._sum.amount)]));
  const rows = wbs.map((w) => {
    const budget = bMap.get(w.id) ?? 0; const actual = cMap.get(w.id) ?? 0;
    return { wbsItemId: w.id, code: w.code, name: w.name, budget, actual, variance: budget - actual };
  });
  rows.push({ wbsItemId: 'none', code: '—', name: 'Unassigned', budget: bMap.get('none') ?? 0, actual: cMap.get('none') ?? 0, variance: (bMap.get('none') ?? 0) - (cMap.get('none') ?? 0) });
  return ok(res, { rows: rows.filter((r) => r.budget || r.actual) });
}));

// ── Auto-post production labor/equipment cost to the cost ledger ──
router.post('/post-production', authenticate, requirePermission('finance:write'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');

  const [entries, posted, equipment, wages] = await Promise.all([
    prisma.productionEntry.findMany({ where: { organizationId: orgId, projectId } }),
    prisma.costEntry.findMany({ where: { organizationId: orgId, projectId, source: 'PRODUCTION' }, select: { sourceRef: true } }),
    prisma.equipment.findMany({ where: { organizationId: orgId } }),
    prisma.wageRate.findMany({ where: { organizationId: orgId } }),
  ]);
  const eqRate = new Map(equipment.map((e) => [e.id, num(e.hourlyRate) || num(e.dailyRate) / 8]));
  const hourly = wages.map((w) => (w.rateType === 'HOURLY' ? num(w.amount) : num(w.amount) / 8)).filter((x) => x > 0);
  const laborRate = hourly.length ? hourly.reduce((s, x) => s + x, 0) / hourly.length : 20;
  const alreadyPosted = new Set(posted.map((p) => p.sourceRef));

  const toCreate: any[] = [];
  for (const e of entries) {
    if (alreadyPosted.has(e.id)) continue;
    const labor = num(e.laborHours) * laborRate;
    const equip = num(e.equipmentHours) * (e.equipmentId ? eqRate.get(e.equipmentId) ?? 0 : 0);
    if (labor > 0) toCreate.push({ organizationId: orgId, projectId, wbsItemId: e.wbsItemId, category: 'LABOR', source: 'PRODUCTION', sourceRef: e.id, description: `Labor — ${e.wbsActivity}`, amount: labor, date: e.date, createdBy: req.user!.id });
    if (equip > 0) toCreate.push({ organizationId: orgId, projectId, wbsItemId: e.wbsItemId, category: 'EQUIPMENT', source: 'PRODUCTION', sourceRef: e.id, description: `Equipment — ${e.wbsActivity}`, amount: equip, date: e.date, createdBy: req.user!.id });
  }
  if (toCreate.length) await prisma.costEntry.createMany({ data: toCreate });
  return ok(res, { posted: toCreate.length, entriesProcessed: entries.length, laborRate: Number(laborRate.toFixed(2)) }, 201);
}));

export default router;
