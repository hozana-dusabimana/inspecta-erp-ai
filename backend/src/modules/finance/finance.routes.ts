import { Router, Request } from 'express';
import { z } from 'zod';
import { CostCategory, InvoiceStatus, CashDirection } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter, CrudOptions } from '../../lib/crud';
import { notify } from '../notifications/notify';
import { etc, vac } from '../../lib/formulas';
import { loadProjectMetrics } from '../../lib/project-metrics';
import { costByWbs } from '../../lib/cost-by-wbs';
import { Conflict } from '../../lib/errors';
import { reverseCostEntries, costSourceAlive, costIntegrityReport } from '../../lib/posting';
import { addApprovalRoutes, alertAwaitingApproval } from '../../lib/maker-checker';
import { syncSourceCost } from '../../lib/posting';
import { syncAttendanceCost } from '../fieldops/labour';

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
    filterFields: ['category', 'budgetType'],
    sumFields: ['amount'],
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
// Exported so the AI Copilot write tools reuse the exact cost-entry pipeline.
export const costEntryCrud: CrudOptions = {
    model: 'costEntry',
    entity: 'cost-entry',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: costCreate,
    updateSchema: costCreate.partial(),
    searchField: 'description',
    dateField: 'date',
    filterFields: ['category', 'source'],
    sumFields: ['amount'],
    requireProject: true,
    orderBy: { date: 'desc' },
    refs: [{ field: 'wbsItemId', model: 'wbsItem' }],
    transform: stamp,
    // Posted cost: only the description can change; cancel (reason required) writes a reversal.
    posting: {
      editable: ['description'],
      // Maker-checker: a manually keyed cost is cancelled by someone else, holding a different role.
      checker: (r) => (r.source ?? 'MANUAL') === 'MANUAL',
      onCancel: async (tx, record, actor) => {
        const source = String(record.source ?? 'MANUAL');
        if (source !== 'MANUAL' && (await costSourceAlive(actor.orgId, source, (record.sourceRef as string) ?? null))) {
          throw Conflict(`This cost was posted automatically by a ${source.toLowerCase().replace(/_/g, ' ')} record. Cancel that record instead, so stock and cost are reversed together.`);
        }
        await reverseCostEntries(tx, { id: String(record.id) }, actor);
      },
    },
    // Alert when cumulative actual cost exceeds the project budget.
    afterChange: async (action, record, req) => {
      if (action === 'DELETE') return;
      const projectId = String(record.projectId);
      const m = (await loadProjectMetrics(req.user!.orgId, { projectId })).projects[0];
      const project = { name: m?.name };
      const spent = m?.actualCost ?? 0;
      const budget = m?.budget ?? 0;
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
};
router.use('/costs', createCrudRouter(costEntryCrud));

// ── Client invoices / IPC ─────────────────────────────────────
const invoiceCreate = z.object({
  projectId: z.string(),
  wbsItemId: z.string().optional(),
  number: z.string().min(1).optional(), // auto-generated (INV-####) when omitted
  description: z.string().optional(),
  amount: z.number().nonnegative(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  // IPC fields
  isIpc: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
  certificateNumber: z.string().optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  grossValuation: z.number().nonnegative().optional(),
  previousCertified: z.number().nonnegative().optional(),
  retentionPct: z.number().min(0).max(100).optional(),
  advanceDeduction: z.number().nonnegative().optional(),
  taxPct: z.number().min(0).max(100).optional(),
  certifiedAmount: z.number().nonnegative().optional(),
  submittedDate: z.string().datetime().optional(),
  paidDate: z.string().datetime().optional(),
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
    autoCode: [
      { field: 'number', prefix: 'INV' },
      { field: 'certificateNumber', prefix: 'IPC', when: (d) => d.isIpc === true }, // IPC certificates only
    ],
    searchField: 'number',
    dateField: 'issueDate',
    filterFields: ['status'],
    sumFields: ['amount', 'netAmount'],
    sumWhere: { status: { not: 'CANCELLED' } },
    requireProject: true,
    include: { payments: true },
    refs: [{ field: 'wbsItemId', model: 'wbsItem' }],
    // Once submitted an invoice is posted: amounts are locked, workflow fields may move on, and it is
    // cancelled (not deleted) with a reason. A DRAFT can still be edited or deleted.
    posting: {
      isPosted: (r) => r.status !== 'DRAFT',
      editable: ['status', 'description', 'dueDate', 'submittedDate', 'paidDate', 'certifiedAmount'],
      onCancel: async (tx, record) => {
        const live = await tx.payment.count({ where: { invoiceId: String(record.id), cancelledAt: null, reversalOfId: null } });
        if (live) throw Conflict(`This invoice has ${live} payment(s). Cancel the payments first.`);
        return { status: 'CANCELLED' };
      },
    },
    validate: (data) => {
      if (data.status === 'CANCELLED' && !data.cancelledAt) throw BadRequest('Use Cancel (with a reason) to cancel an invoice.');
    },
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
  wbsItemId: z.string().optional(),
  date: z.string().datetime().optional(),
  direction: z.nativeEnum(CashDirection),
  category: z.string().min(1),
  amount: z.number().nonnegative(),
  isForecast: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
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
    searchField: 'category',
    dateField: 'date',
    filterFields: ['direction', 'category'],
    sumFields: ['amount'],
    orderBy: { date: 'desc' },
    refs: [{ field: 'wbsItemId', model: 'wbsItem' }],
    transform: stamp,
  }),
);

// ── Payments ──────────────────────────────────────────────────
const paymentCreate = z.object({
  projectId: z.string(),
  invoiceId: z.string().optional(),
  reference: z.string().min(1).optional(), // auto-generated (PAY-####) when omitted
  amount: z.number().nonnegative(),
  date: z.string().datetime().optional(),
});
const paymentDecisions = Router();
addApprovalRoutes(paymentDecisions, { model: 'payment', entity: 'payment', label: 'payment', makerField: 'createdBy' });
router.use('/payments', authenticate, paymentDecisions);
router.use(
  '/payments',
  createCrudRouter({
    model: 'payment',
    entity: 'payment',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: paymentCreate,
    updateSchema: paymentCreate.partial(),
    autoCode: { field: 'reference', prefix: 'PAY' },
    searchField: 'reference',
    dateField: 'date',
    sumFields: ['amount'],
    requireProject: true,
    orderBy: { date: 'desc' },
    refs: [{ field: 'invoiceId', model: 'invoice' }],
    // Maker-checker: a payment is recorded PENDING and only counts as received once a different
    // person, holding a different role, approves it (POST /payments/:id/approve).
    transform: (data, req) => {
      if (!('id' in data)) { data.createdBy = req.user!.id; data.approvalStatus = 'PENDING'; }
      return data;
    },
    afterChange: async (action, record, req) => {
      if (action !== 'CREATE') return;
      await alertAwaitingApproval(req.user!.orgId, 'payment', String(record.id), 'Payment awaiting approval',
        `Payment ${record.reference} (${Number(record.amount).toLocaleString()}) is awaiting approval.`, '/approvals');
    },
    // A payment is posted money: cancel (reason required) writes an equal negative payment.
    posting: {
      editable: [],
      onCancel: async (tx, record, actor) => {
        // A payment that was never approved never counted: nothing to reverse.
        if (record.approvalStatus !== 'APPROVED') return { approvalStatus: 'REJECTED' };
        await tx.payment.create({
          data: {
            organizationId: actor.orgId, projectId: String(record.projectId), invoiceId: (record.invoiceId as string) ?? null,
            reference: `REV-${record.reference}`, amount: -Number(record.amount), date: new Date(), reversalOfId: String(record.id),
          },
        });
      },
    },
  }),
);

// ── Cost integrity check (T1-01 e): lists duplicate / orphan postings, never deletes ──
router.get('/cost-integrity', authenticate, requirePermission('finance:read'), asyncHandler(async (req, res) => {
  return ok(res, await costIntegrityReport(req.user!.orgId, (req.query.projectId as string) || undefined));
}));

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
      prisma.costEntry.groupBy({ by: ['category'], where: projectId ? scope : { ...scope, project: { isDemo: false } }, _sum: { amount: true } }),
    ]);

    const pm = await loadProjectMetrics(orgId, { projectId, projectIds: req.user!.projectIds });
    const t = pm.totals;
    const one = projectId ? pm.projects[0] : null;
    void budgetAgg; void costAgg; void invoiceAgg; void paymentAgg;
    const budget = one ? one.budget ?? 0 : t.budget;
    const actual = one ? one.actualCost : t.actualCost;
    const billed = one ? one.billed : t.billed;
    const received = one ? one.received : t.received;

    return ok(res, {
      budget,
      actualCost: actual,
      costVariance: budget - actual,
      costVariancePct: budget > 0 ? Number((((budget - actual) / budget) * 100).toFixed(2)) : 0,
      billed,
      received,
      outstanding: billed - received,
      contractValue: one ? one.contractValue : t.contractValue,
      hasBudget: budget > 0,
      estCostAtCompletion: budget > 0 ? (one ? one.eac : t.eac) : null,
      forecastProfit: one ? one.forecastProfit : t.forecastProfit,
      forecastMarginPct: one ? one.forecastMarginPct : t.forecastMarginPct,
      progressPct: one ? one.progressPct : t.avgProgressPct,
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
    prisma.payment.findMany({ where: { ...scope, approvalStatus: 'APPROVED' }, select: { amount: true, date: true } }),
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
  const m = (await loadProjectMetrics(orgId, { projectId })).projects[0];
  if (!m) throw BadRequest('Project not found');
  const bac = m.budget ?? 0;
  const ac = m.actualCost;
  const eacV = m.eac ?? 0;

  return ok(res, {
    hasData: m.budget != null,
    bac: Number(bac.toFixed(2)), ac: Number(ac.toFixed(2)),
    plannedValue: m.plannedValue ?? 0, earnedValue: m.earnedValue ?? 0,
    cpi: m.cpi, spi: m.spi, spiStatus: m.spiStatus, cpiStatus: m.cpiStatus, costDataIncomplete: m.costDataIncomplete,
    budgetSource: m.budgetSource, budgetLinesTotal: m.budgetLinesTotal,
    eac: Number(eacV.toFixed(2)), etc: m.etc ?? Number(etc(eacV, ac).toFixed(2)), vac: Number(vac(bac, eacV).toFixed(2)),
    forecastProfit: m.forecastProfit, contractValue: m.contractValue,
    actualProgressPct: m.progressPct ?? 0,
    plannedProgressPct: m.plannedProgressPct ?? 0,
  });
}));

// ── Cost rollup by WBS (budget vs actual) ─────────────────────
router.get('/cost-by-wbs', authenticate, requirePermission('finance:read'), asyncHandler(async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  return ok(res, { rows: await costByWbs(req.user!.orgId, projectId) });
}));

// ── Auto-post production labor/equipment cost to the cost ledger ──
/**
 * Posts project labour and equipment cost (T1-05). Labour comes ONLY from attendance
 * (employees at their wage, casual labour at the trade rate) — typed labour hours are
 * never costed at an average rate any more (that produced 80 h = RWF 1,600). Equipment
 * hours on a daily entry are costed at that machine's rate. Idempotent: every source posts
 * one live entry, edits reverse and re-post (lib/posting.syncSourceCost).
 */
export async function postProductionCosts(orgId: string, projectId: string, userId: string) {
  const [entries, equipment, attendance] = await Promise.all([
    prisma.productionEntry.findMany({ where: { organizationId: orgId, projectId, deletedAt: null }, include: { dailyReport: { select: { status: true } } } }),
    prisma.equipment.findMany({ where: { organizationId: orgId } }),
    prisma.attendance.findMany({ where: { organizationId: orgId, projectId }, select: { id: true } }),
  ]);
  const eqRate = new Map(equipment.map((e) => [e.id, num(e.hourlyRate) || num(e.dailyRate) / 8]));
  const actor = { orgId, userId, reason: 'Re-posted from production' };
  let posted = 0;
  for (const a of attendance) { await syncAttendanceCost(orgId, userId, a.id, 'Re-posted from attendance'); posted++; }
  for (const e of entries) {
    if (e.dailyReport && e.dailyReport.status !== 'APPROVED') continue; // report costs post on approval
    const equip = num(e.equipmentHours) * (e.equipmentId ? eqRate.get(e.equipmentId) ?? 0 : 0);
    await prisma.$transaction((tx) => syncSourceCost(tx, 'PRODUCTION', e.id, 'EQUIPMENT', equip > 0 ? {
      projectId, wbsItemId: e.wbsItemId, category: 'EQUIPMENT', amount: equip, date: e.date, description: `Equipment — ${e.wbsActivity}`,
    } : null, actor));
    // Old-style labour postings (hours × average rate) are reversed: labour is costed from attendance only.
    await prisma.$transaction((tx) => syncSourceCost(tx, 'PRODUCTION', e.id, 'LABOR', null, { ...actor, reason: 'Labour is costed from attendance, not typed hours' }));
  }
  const unattended = entries.filter((e) => e.flags.includes('LABOUR_WITHOUT_ATTENDANCE')).length;
  return { posted, entriesProcessed: entries.length, entriesWithLabourButNoAttendance: unattended };
}

router.post('/post-production', authenticate, requirePermission('finance:write'), asyncHandler(async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  return ok(res, await postProductionCosts(req.user!.orgId, projectId, req.user!.id), 201);
}));

export default router;
