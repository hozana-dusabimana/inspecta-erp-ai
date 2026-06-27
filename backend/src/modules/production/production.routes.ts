import { Router, Request } from 'express';
import { z } from 'zod';
import { ReportStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';
import { productivity, variancePct } from '../../lib/formulas';
import { analyzeProduction, EngineEntry, EngineMaterial } from './engine';
import { computeCpm } from '../scheduling/cpm';

const num = (v: unknown) => Number(v ?? 0);
const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

// ── Daily production entries (Submodule 1) ────────────────────
const createSchema = z.object({
  projectId: z.string(),
  dailyReportId: z.string().optional(),
  date: z.string().datetime().optional(),
  wbsActivity: z.string().min(1),
  wbsItemId: z.string().optional(),
  equipmentId: z.string().optional(),
  crewId: z.string().optional(),
  productivityStandardId: z.string().optional(),
  unit: z.string().optional(),
  plannedQty: z.number().nonnegative(),
  actualQty: z.number().nonnegative(),
  remainingQty: z.number().optional(),
  laborHours: z.number().nonnegative().optional(),
  equipmentHours: z.number().nonnegative().optional(),
  weatherCondition: z.string().optional(),
  issues: z.string().optional(),
  delays: z.string().optional(),
  remarks: z.string().optional(),
  photos: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
});

const entriesCrud = createCrudRouter({
  model: 'productionEntry',
  entity: 'production-entry',
  readPerm: 'production:read',
  writePerm: 'production:write',
  createSchema,
  updateSchema: createSchema.partial(),
  searchField: 'wbsActivity',
  requireProject: true,
  orderBy: { date: 'desc' },
  refs: [
    { field: 'wbsItemId', model: 'wbsItem' },
    { field: 'equipmentId', model: 'equipment' },
    { field: 'crewId', model: 'crew' },
    { field: 'tradeId', model: 'trade' },
    { field: 'productivityStandardId', model: 'productivityStandard' },
  ],
  transform: (data, req: Request) => {
    if (!('id' in data) && req.user) data.createdById = req.user.id;
    return stamp(data, req);
  },
  afterChange: async (action, record, req) => {
    if (action === 'DELETE') return;
    const planned = num(record.plannedQty);
    const actual = num(record.actualQty);
    if (planned > 0 && (actual - planned) / planned <= -0.1) {
      await notify({
        organizationId: req.user!.orgId,
        type: 'DELAY',
        severity: 'HIGH',
        title: 'Production shortfall detected',
        message: `Activity "${record.wbsActivity}" achieved ${actual} of ${planned} planned units (${(((actual - planned) / planned) * 100).toFixed(1)}% variance).`,
        link: `/projects/${record.projectId}`,
      });
    }
  },
});

// ── Daily Report header + approval workflow ───────────────────
const reportSchema = z.object({
  projectId: z.string(),
  reportNumber: z.string().min(1),
  reportDate: z.string().datetime().optional(),
  shift: z.string().optional(),
  weather: z.string().optional(),
  temperature: z.number().optional(),
  notes: z.string().optional(),
});
const reportsCrud = createCrudRouter({
  model: 'dailyReport',
  entity: 'daily-report',
  readPerm: 'production:read',
  writePerm: 'production:write',
  createSchema: reportSchema,
  updateSchema: reportSchema.partial(),
  searchField: 'reportNumber',
  requireProject: true,
  orderBy: { reportDate: 'desc' },
  include: { _count: { select: { entries: true } } },
  transform: (data, req) => {
    if (!('id' in data)) data.preparedById = req.user!.id;
    return stamp(data, req);
  },
});

const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: ['SUBMITTED'],
};
const reportsRouter = Router();
function reportAction(action: string, to: ReportStatus, perm: 'production:write' | 'approval:write') {
  reportsRouter.post(`/:id/${action}`, authenticate, requirePermission(perm), asyncHandler(async (req, res) => {
    const existing = await prisma.dailyReport.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId } });
    if (!existing) throw NotFound('Daily report not found');
    if (!REPORT_TRANSITIONS[existing.status].includes(to)) throw BadRequest(`Cannot ${action} a report in status ${existing.status}`);
    const data: Record<string, unknown> = { status: to, updatedBy: req.user!.id };
    if (to === 'APPROVED' || to === 'REJECTED') { data.approvedById = req.user!.id; data.approvedAt = new Date(); }
    const report = await prisma.dailyReport.update({ where: { id: existing.id }, data });
    if (to === 'SUBMITTED') {
      await notify({ organizationId: req.user!.orgId, type: 'APPROVAL', severity: 'MEDIUM', title: 'Daily report submitted', message: `Report ${report.reportNumber} awaits approval.`, link: '/production' });
    }
    return ok(res, report);
  }));
}
reportAction('submit', ReportStatus.SUBMITTED, 'production:write');
reportAction('approve', ReportStatus.APPROVED, 'approval:write');
reportAction('reject', ReportStatus.REJECTED, 'approval:write');
reportsRouter.use('/', reportsCrud);

// ── Material consumption per entry ────────────────────────────
const matSchema = z.object({
  productionEntryId: z.string(),
  materialId: z.string(),
  plannedQty: z.number().nonnegative().optional(),
  qtyUsed: z.number().nonnegative().optional(),
});
const materialsCrud = createCrudRouter({
  model: 'productionMaterial',
  entity: 'production-material',
  readPerm: 'production:read',
  writePerm: 'production:write',
  createSchema: matSchema,
  updateSchema: matSchema.partial(),
  refs: [{ field: 'materialId', model: 'material' }],
  transform: stamp,
});

async function resolveLaborRate(orgId: string): Promise<number> {
  const wages = await prisma.wageRate.findMany({ where: { organizationId: orgId } });
  const hourly = wages.map((w) => (w.rateType === 'HOURLY' ? num(w.amount) : num(w.amount) / 8)).filter((x) => x > 0);
  if (hourly.length) return hourly.reduce((s, x) => s + x, 0) / hourly.length;
  const emps = await prisma.employee.findMany({ where: { organizationId: orgId }, select: { dailyWage: true } });
  const ew = emps.map((e) => num(e.dailyWage) / 8).filter((x) => x > 0);
  return ew.length ? ew.reduce((s, x) => s + x, 0) / ew.length : 20; // fallback $20/h
}

// ── Analytics engine endpoint (Submodules 2–5) ────────────────
const analytics = Router();
analytics.get('/analytics', authenticate, requirePermission('production:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');

  const now = Date.now();
  const [entries, standards, equipment, crews, trades, materials, project, boq, costAgg, equipUtil, schedule, openNcr, laborRate] = await Promise.all([
    prisma.productionEntry.findMany({ where: { organizationId: orgId, projectId }, include: { materials: true }, orderBy: { date: 'asc' } }),
    prisma.productivityStandard.findMany({ where: { organizationId: orgId } }),
    prisma.equipment.findMany({ where: { organizationId: orgId } }),
    prisma.crew.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    prisma.trade.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    prisma.material.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, unitCost: true } }),
    prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } }),
    prisma.boqItem.aggregate({ where: { organizationId: orgId, projectId }, _sum: { budget: true } }),
    prisma.costEntry.aggregate({ where: { organizationId: orgId, projectId }, _sum: { amount: true } }),
    prisma.equipmentUtilization.aggregate({ where: { organizationId: orgId }, _sum: { plannedHours: true, availableHours: true } }),
    prisma.scheduleActivity.findMany({ where: { organizationId: orgId, projectId }, select: { finishDate: true, progressPct: true } }),
    prisma.ncr.count({ where: { organizationId: orgId, projectId, status: { not: 'CLOSED' } } }),
    resolveLaborRate(orgId),
  ]);

  const stdById = new Map(standards.map((s) => [s.id, num(s.productivityRate)]));
  const stdByActivity = new Map(standards.map((s) => [s.activity.toLowerCase(), num(s.productivityRate)]));
  const eqRate = new Map(equipment.map((e) => [e.id, num(e.hourlyRate) || num(e.dailyRate) / 8]));
  const crewName = new Map(crews.map((c) => [c.id, c.name]));
  const tradeName = new Map(trades.map((t) => [t.id, t.name]));
  const matInfo = new Map(materials.map((m) => [m.id, { name: m.name, unitCost: num(m.unitCost) }]));

  const engineEntries: EngineEntry[] = entries.map((e) => ({
    date: e.date.toISOString(),
    activity: e.wbsActivity,
    crew: e.crewId ? crewName.get(e.crewId) ?? null : null,
    trade: e.tradeId ? tradeName.get(e.tradeId) ?? null : null,
    plannedQty: num(e.plannedQty),
    actualQty: num(e.actualQty),
    laborHours: num(e.laborHours),
    equipmentHours: num(e.equipmentHours),
    plannedProductivity: (e.productivityStandardId ? stdById.get(e.productivityStandardId) : undefined) ?? stdByActivity.get(e.wbsActivity.toLowerCase()) ?? 0,
    equipmentRatePerHour: e.equipmentId ? eqRate.get(e.equipmentId) ?? 0 : 0,
    availableEquipmentHours: 0,
  }));

  const matAgg = new Map<string, { planned: number; used: number }>();
  for (const e of entries) for (const m of e.materials) {
    const g = matAgg.get(m.materialId) ?? { planned: 0, used: 0 };
    g.planned += num(m.plannedQty); g.used += num(m.qtyUsed); matAgg.set(m.materialId, g);
  }
  const engineMaterials: EngineMaterial[] = [...matAgg.entries()].map(([id, g]) => ({
    name: matInfo.get(id)?.name ?? id, planned: g.planned, used: g.used, unitCost: matInfo.get(id)?.unitCost ?? 0,
  }));

  // Delay / overhead inputs for the impact engine.
  const totalDaysDelayed = schedule
    .filter((a) => a.finishDate && a.finishDate.getTime() < now && a.progressPct < 100)
    .reduce((s, a) => s + Math.ceil((now - a.finishDate!.getTime()) / 86400000), 0);
  const start = project?.startDate?.getTime();
  const end = project?.endDate?.getTime();
  const spanDays = start && end && end > start ? Math.round((end - start) / 86400000) : 180;
  const bac = num(boq._sum.budget) || num(project?.budget);
  const budgetedProfit = (num(project?.budget) * num(project?.plannedProfitMargin)) / 100;

  const result = analyzeProduction({
    entries: engineEntries,
    materials: engineMaterials,
    laborRatePerHour: laborRate,
    contractValue: num(project?.budget),
    budgetedProfitMarginPct: num(project?.plannedProfitMargin),
    bac,
    actualCost: num(costAgg._sum.amount),
    delayDays: totalDaysDelayed,
    dailyOverheadRate: spanDays > 0 ? bac / spanDays : 0,
    dailyProfitRate: spanDays > 0 ? budgetedProfit / spanDays : 0,
    openNcrCount: openNcr,
    reworkHoursPerNcr: 8, // heuristic: ~1 crew-day of rework per open NCR
  });

  const avail = num(equipUtil._sum.availableHours);
  if (avail > 0) result.utilization.equipmentUtilizationPct = Number(((num(equipUtil._sum.plannedHours) / avail) * 100).toFixed(2));

  return ok(res, result);
}));

// ── Delay analysis (Submodule 6) ──────────────────────────────
analytics.get('/delays', authenticate, requirePermission('production:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  const now = Date.now();
  const activities = await prisma.scheduleActivity.findMany({ where: { organizationId: orgId, projectId } });

  let criticalCodes = new Set<string>();
  try {
    const cpm = computeCpm(activities.map((a) => ({ code: a.code, name: a.name, duration: a.durationDays, predecessors: a.predecessors ?? [] })));
    criticalCodes = new Set(cpm.criticalPath);
  } catch { /* circular — skip */ }

  const delayed = activities
    .filter((a) => a.finishDate && a.finishDate.getTime() < now && a.progressPct < 100)
    .map((a) => ({
      code: a.code, name: a.name, finishDate: a.finishDate, progressPct: a.progressPct,
      daysDelayed: Math.ceil((now - a.finishDate!.getTime()) / 86400000),
      critical: criticalCodes.has(a.code),
    }))
    .sort((x, y) => y.daysDelayed - x.daysDelayed);

  return ok(res, {
    delayedCount: delayed.length,
    criticalDelayed: delayed.filter((d) => d.critical).length,
    totalActivities: activities.length,
    maxDaysDelayed: delayed.length ? delayed[0].daysDelayed : 0,
    activities: delayed,
  });
}));

// ── AI-ready insight summary (Submodule 7) ────────────────────
analytics.get('/ai-summary', authenticate, requirePermission('production:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');

  const [entries, standards, crews, project, openNcr] = await Promise.all([
    prisma.productionEntry.findMany({ where: { organizationId: orgId, projectId } }),
    prisma.productivityStandard.findMany({ where: { organizationId: orgId } }),
    prisma.crew.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { name: true, health: true, progressPct: true } }),
    prisma.ncr.count({ where: { organizationId: orgId, projectId, status: { not: 'CLOSED' } } }),
  ]);
  const stdByActivity = new Map(standards.map((s) => [s.activity.toLowerCase(), num(s.productivityRate)]));
  const crewName = new Map(crews.map((c) => [c.id, c.name]));

  const insights: { severity: string; title: string; detail: string; recommendation: string }[] = [];

  // 1. Activities below productivity standard.
  const byAct = new Map<string, { actual: number; labor: number }>();
  for (const e of entries) {
    const g = byAct.get(e.wbsActivity) ?? { actual: 0, labor: 0 };
    g.actual += num(e.actualQty); g.labor += num(e.laborHours); byAct.set(e.wbsActivity, g);
  }
  for (const [act, g] of byAct) {
    const std = stdByActivity.get(act.toLowerCase());
    if (std && g.labor > 0) {
      const v = ((g.actual / g.labor - std) / std) * 100;
      if (v <= -15) insights.push({
        severity: v <= -30 ? 'HIGH' : 'MEDIUM',
        title: `${act} productivity ${v.toFixed(0)}% below standard`,
        detail: `Actual ${(g.actual / g.labor).toFixed(2)} vs standard ${std} units/hour.`,
        recommendation: 'Review crew composition, methods and site constraints for this activity; consider re-sequencing or added supervision.',
      });
    }
  }

  // 2. Underperforming crews (below the project's average productivity).
  const byCrew = new Map<string, { actual: number; labor: number }>();
  for (const e of entries) {
    const k = e.crewId ? crewName.get(e.crewId) ?? 'Unassigned' : 'Unassigned';
    const g = byCrew.get(k) ?? { actual: 0, labor: 0 };
    g.actual += num(e.actualQty); g.labor += num(e.laborHours); byCrew.set(k, g);
  }
  const totalA = entries.reduce((s, e) => s + num(e.actualQty), 0);
  const totalL = entries.reduce((s, e) => s + num(e.laborHours), 0);
  const avgProd = totalL > 0 ? totalA / totalL : 0;
  for (const [crew, g] of byCrew) {
    if (crew !== 'Unassigned' && g.labor > 0 && avgProd > 0) {
      const cp = g.actual / g.labor;
      if (cp < avgProd * 0.8) insights.push({
        severity: 'MEDIUM',
        title: `Crew ${crew} ${(((cp - avgProd) / avgProd) * 100).toFixed(0)}% below project average`,
        detail: `Crew productivity ${cp.toFixed(2)} vs project average ${avgProd.toFixed(2)} units/hour.`,
        recommendation: 'Pair with a higher-performing crew, check tooling/skills, and verify work-front readiness.',
      });
    }
  }

  // 3. Project-level risk.
  if (openNcr > 0) insights.push({ severity: openNcr >= 3 ? 'HIGH' : 'MEDIUM', title: `${openNcr} open NCR(s) — rework risk`, detail: 'Open non-conformances usually translate into rework hours and cost.', recommendation: 'Prioritise closure of open NCRs to limit rework cost erosion of margin.' });
  if (project?.health === 'CRITICAL') insights.push({ severity: 'HIGH', title: `Project "${project.name}" health is CRITICAL`, detail: `Reported progress ${project.progressPct}%.`, recommendation: 'Run a recovery plan: re-baseline critical-path activities and reallocate top crews.' });

  if (insights.length === 0) insights.push({ severity: 'LOW', title: 'Production tracking healthy', detail: 'No activities or crews significantly below standard.', recommendation: 'Maintain current pace; keep capturing daily reports for trend accuracy.' });

  return ok(res, { projectId, insights, generatedFrom: 'production-engine' });
}));

// ── Simple metrics summary (kept for compatibility) ───────────
analytics.get('/summary/metrics', authenticate, requirePermission('production:read'), asyncHandler(async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  const entries = await prisma.productionEntry.findMany({
    where: { organizationId: req.user!.orgId, ...(projectId ? { projectId } : {}) },
    orderBy: { date: 'asc' },
  });
  const totalPlanned = entries.reduce((s, e) => s + num(e.plannedQty), 0);
  const totalActual = entries.reduce((s, e) => s + num(e.actualQty), 0);
  const totalLabor = entries.reduce((s, e) => s + num(e.laborHours), 0);
  const series = entries.map((e) => ({ date: e.date, planned: num(e.plannedQty), actual: num(e.actualQty), productivity: productivity(num(e.actualQty), num(e.laborHours)) }));
  return ok(res, {
    entries: entries.length, totalPlanned, totalActual, totalLaborHours: totalLabor,
    productivityIndex: Number(productivity(totalActual, totalLabor).toFixed(3)),
    variancePct: Number(variancePct(totalActual, totalPlanned).toFixed(2)),
    series,
  });
}));

const router = Router();
router.use('/', analytics); // /production/analytics, /delays, /ai-summary, /summary/metrics
router.use('/daily-reports', reportsRouter);
router.use('/materials', materialsCrud);
router.use('/', entriesCrud); // entry CRUD last (handles /:id)

export default router;
