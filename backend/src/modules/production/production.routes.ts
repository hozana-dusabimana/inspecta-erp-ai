import { Router, Request } from 'express';
import { z } from 'zod';
import { ReportStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound, Conflict, Forbidden } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { assertMakerChecker } from '../../lib/maker-checker';
import { auditFromRequest } from '../../auth/audit';
import { postApprovedReportCosts } from './report-costs';
import { notify } from '../notifications/notify';
import { productivity, variancePct, ratePerWorkerDay } from '../../lib/formulas';
import { analyzeProduction, EngineEntry, EngineMaterial } from './engine';
import { computeCpm } from '../scheduling/cpm';
import { fieldReportRouter } from './field-report';
import { dailyPlanRouter } from './daily-plans';
import { loadProjectMetrics } from '../../lib/project-metrics';
import { syncProjectProgress } from '../../lib/project-metrics';
import { qualityHolds } from '../../lib/safety';

const num = (v: unknown) => Number(v ?? 0);
const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

// ── Daily production entries (Submodule 1) ────────────────────
export const createSchema = z.object({
  projectId: z.string(),
  dailyReportId: z.string().optional(),
  date: z.string().datetime().optional(),
  // The activity name is taken from the linked WBS item (plan); free text only as a fallback.
  wbsActivity: z.string().optional(),
  wbsItemId: z.string().optional(),
  equipmentId: z.string().optional(),
  crewId: z.string().optional(),
  productivityStandardId: z.string().optional(),
  unit: z.string().optional(),
  // Optional: defaults from the plan (WBS quantity / scheduled duration) when left empty.
  plannedQty: z.number().nonnegative().optional(),
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
  dateField: 'date',
  sumFields: ['plannedQty', 'actualQty', 'laborHours', 'equipmentHours'],
  requireProject: true,
  orderBy: { date: 'desc' },
  refs: [
    { field: 'wbsItemId', model: 'wbsItem' },
    { field: 'equipmentId', model: 'equipment' },
    { field: 'crewId', model: 'crew' },
    { field: 'tradeId', model: 'trade' },
    { field: 'productivityStandardId', model: 'productivityStandard' },
  ],
  validate: async (data, req: Request) => {
    if (!data.id) return;
    if (data.dailyReportId) {
      const rep = await prisma.dailyReport.findUnique({ where: { id: String(data.dailyReportId) }, select: { status: true, reportNumber: true } });
      if (rep?.status === 'APPROVED') throw Conflict(`This entry belongs to approved report ${rep.reportNumber} and is locked. Use Correct, with a reason, instead.`);
    }
    if (data.createdById && data.createdById !== req.user!.id) {
      throw Forbidden('Only the person who entered this record can change it. Approvers approve or reject; they do not edit what others entered.');
    }
  },
  onDelete: async (tx, record, req) => {
    if (record.dailyReportId) {
      const rep = await tx.dailyReport.findUnique({ where: { id: String(record.dailyReportId) }, select: { status: true, reportNumber: true } });
      if (rep?.status === 'APPROVED') throw Conflict(`This entry belongs to approved report ${rep.reportNumber} and cannot be deleted.`);
    }
    if (record.createdById && record.createdById !== req.user!.id) throw Forbidden('Only the person who entered this record can delete it.');
  },
  transform: async (data, req: Request) => {
    if (!('id' in data) && req.user) data.createdById = req.user.id;
    if (data.wbsItemId) {
      const w = await prisma.wbsItem.findFirst({ where: { id: String(data.wbsItemId), organizationId: req.user!.orgId }, select: { code: true, name: true } });
      if (w && !data.wbsActivity) data.wbsActivity = `${w.code} - ${w.name}`;
    }
    if (!data.wbsActivity) throw BadRequest('Select the WBS activity this production belongs to');
    // Labour hours come from attendance (T1-05 c). Hours typed with no named workers are kept but
    // flagged and never costed, so 80 hours can no longer turn into RWF 1,600 of "labour".
    if (data.id) {
      const att = await prisma.attendance.findMany({ where: { productionEntryId: String(data.id), present: true }, select: { headcount: true, hoursWorked: true } });
      if (att.length) data.laborHours = att.reduce((s, r) => s + r.headcount * Number(r.hoursWorked), 0);
    }
    const flags = new Set(((data.flags as string[] | undefined) ?? []).filter((f) => f !== 'LABOUR_WITHOUT_ATTENDANCE'));
    if (Number(data.laborHours ?? 0) > 0) {
      const has = data.id ? await prisma.attendance.count({ where: { productionEntryId: String(data.id) } }) : 0;
      if (!has) flags.add('LABOUR_WITHOUT_ATTENDANCE');
    }
    flags.delete('QUALITY_HOLD');
    if (data.wbsItemId && data.projectId && (await qualityHolds(req.user!.orgId, String(data.projectId), String(data.wbsItemId))).length) flags.add('QUALITY_HOLD');
    data.flags = [...flags];
    if (data.plannedQty == null || Number(data.plannedQty) === 0) {
      let planned = 0;
      if (data.wbsItemId) {
        const [w, act] = await Promise.all([
          prisma.wbsItem.findFirst({ where: { id: String(data.wbsItemId), organizationId: req.user!.orgId }, select: { quantity: true } }),
          prisma.scheduleActivity.findFirst({ where: { organizationId: req.user!.orgId, wbsItemId: String(data.wbsItemId), milestone: false }, select: { durationDays: true } }),
        ]);
        if (w?.quantity && act && act.durationDays > 0) planned = Number((Number(w.quantity) / act.durationDays).toFixed(3));
        else if (w?.quantity) planned = Number(w.quantity);
      }
      data.plannedQty = planned;
    }
    return stamp(data, req);
  },
  afterChange: async (action, record, req) => {
    await syncProjectProgress(req.user!.orgId, String(record.projectId));
    if (action === 'DELETE') return;
    if ((record.flags as string[] | undefined)?.includes('LABOUR_WITHOUT_ATTENDANCE')) {
      await notify({
        organizationId: req.user!.orgId, type: 'GENERAL', severity: 'MEDIUM', title: 'Labour hours without attendance',
        message: `"${record.wbsActivity}" reports ${num(record.laborHours)} labour hours but no named workers. Record attendance so the hours are verified and costed.`,
        link: '/production', refKey: `entry-flag:${record.id}`,
      });
    }
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
  dateField: 'reportDate',
  filterFields: ['status'],
  requireProject: true,
  orderBy: { reportDate: 'desc' },
  include: { _count: { select: { entries: true } } },
  validate: (data, req) => {
    if (data.id && data.status === 'APPROVED') throw Conflict('An approved report is locked. Use Correct on an entry, with a reason.');
    if (data.id && data.preparedById && data.preparedById !== req.user!.id) throw Forbidden('Only the person who prepared this report can change it.');
  },
  transform: (data, req) => {
    if (!('id' in data)) data.preparedById = req.user!.id;
    return stamp(data, req);
  },
});

/**
 * After approval a change is a CORRECTION: who, when, why, old -> new, kept in the audit log and
 * counted on the report. Only the person who entered the figure may correct it.
 */
const correctionRouter = Router();
correctionRouter.post('/:id/correct', authenticate, requirePermission('production:write'), asyncHandler(async (req, res) => {
  const body = z.object({
    actualQty: z.number().nonnegative().optional(), plannedQty: z.number().nonnegative().optional(), remarks: z.string().max(2000).optional(),
    reason: z.string().trim().min(5, 'Give the reason for the correction (at least 5 characters)'),
  }).parse(req.body);
  const entry = await prisma.productionEntry.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId } });
  if (!entry) throw NotFound('Entry not found');
  if (entry.createdById && entry.createdById !== req.user!.id) throw Forbidden('Only the person who entered this figure can correct it.');
  const data: Record<string, unknown> = {};
  if (body.actualQty !== undefined) data.actualQty = body.actualQty;
  if (body.plannedQty !== undefined) data.plannedQty = body.plannedQty;
  if (body.remarks !== undefined) data.remarks = body.remarks;
  if (!Object.keys(data).length) throw BadRequest('Nothing to correct');
  const updated = await prisma.productionEntry.update({ where: { id: entry.id }, data: { ...data, updatedBy: req.user!.id } });
  if (entry.dailyReportId) await prisma.dailyReport.update({ where: { id: entry.dailyReportId }, data: { correctionCount: { increment: 1 } } });
  await auditFromRequest(req, 'UPDATE', 'production-entry', entry.id, { oldValues: entry, newValues: updated, reason: `Correction: ${body.reason}` });
  await syncProjectProgress(req.user!.orgId, entry.projectId);
  return ok(res, updated);
}));

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
    if (to === 'APPROVED' || to === 'REJECTED') await assertMakerChecker(req, existing.preparedById, 'daily report');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (to === 'APPROVED' && existing.flags.length && reason.length < 5) {
      throw BadRequest(`This report has ${existing.flags.length} flagged cross-check(s): ${existing.flags.map((f) => f.split(':')[0]).join(', ')}. Write the reason it is still correct to approve it.`);
    }
    if (to === 'REJECTED' && reason.length < 5) throw BadRequest('Give the reason for rejecting the report.');
    const data: Record<string, unknown> = { status: to, updatedBy: req.user!.id, ...(to === 'APPROVED' && existing.flags.length ? { flagReason: reason } : {}) };
    if (to === 'APPROVED' || to === 'REJECTED') { data.approvedById = req.user!.id; data.approvedAt = new Date(); }
    const report = await prisma.dailyReport.update({ where: { id: existing.id }, data });
    await auditFromRequest(req, to === 'APPROVED' ? 'APPROVE' : to === 'REJECTED' ? 'REJECT' : 'UPDATE', 'daily-report', report.id, {
      oldValues: { status: existing.status }, newValues: { status: to, flags: existing.flags }, reason: reason || null,
    });
    if (to === 'APPROVED') {
      // Only approved reports feed cost, progress, SPI and CPI (T2-03 f).
      await postApprovedReportCosts(req.user!.orgId, req.user!.id, report.id);
      await syncProjectProgress(req.user!.orgId, report.projectId);
    }
    if (to === 'SUBMITTED') {
      await notify({ organizationId: req.user!.orgId, type: 'APPROVAL', severity: 'MEDIUM', title: 'Daily report submitted', message: `Report ${report.reportNumber} awaits approval.`, link: '/production' });
    }
    // A decided report no longer "awaits approval": clear its stale notification(s).
    if (to === 'APPROVED' || to === 'REJECTED') {
      await prisma.notification.deleteMany({ where: { organizationId: req.user!.orgId, type: 'APPROVAL', OR: [{ refKey: `daily-report:${report.id}` }, { message: { contains: report.reportNumber } }] } });
    }
    return ok(res, report);
  }));
}
reportsRouter.get('/:id/detail', authenticate, requirePermission('production:read'), asyncHandler(async (req, res) => {
  const report = await prisma.dailyReport.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId } });
  if (!report) throw NotFound('Daily report not found');
  const entries = await prisma.productionEntry.findMany({ where: { dailyReportId: report.id }, include: { materials: true } });
  const att = await prisma.attendance.findMany({ where: { productionEntryId: { in: entries.map((e) => e.id) } }, include: { employee: { select: { employeeNo: true, fullName: true } } } });
  const logs = await prisma.equipmentUsageLog.findMany({ where: { sourceRef: report.id }, include: { equipment: { select: { code: true, name: true } } } });
  const users = await prisma.user.findMany({ where: { id: { in: [report.preparedById, report.approvedById].filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
  const who = new Map(users.map((u) => [u.id, u.fullName]));
  return ok(res, {
    ...report, preparedBy: report.preparedById ? who.get(report.preparedById) ?? null : null, approvedBy: report.approvedById ? who.get(report.approvedById) ?? null : null,
    entries: entries.map((e) => ({
      id: e.id, activity: e.wbsActivity, unit: e.unit, plannedQty: num(e.plannedQty), actualQty: num(e.actualQty), laborHours: num(e.laborHours), flags: e.flags,
      workers: att.filter((a) => a.productionEntryId === e.id).map((a) => ({
        name: a.employee ? `${a.employee.employeeNo ?? ''} ${a.employee.fullName}`.trim() : a.workerName, employee: !!a.employeeId,
        headcount: a.headcount, hours: num(a.hoursWorked), cost: num(a.cost),
      })),
    })),
    equipment: logs.map((l) => ({ equipment: `${l.equipment.code ?? ''} ${l.equipment.name}`.trim(), hours: num(l.hoursUsed), cost: num(l.cost) })),
  });
}));
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
  wasteQty: z.number().nonnegative().optional(),
});
const materialsCrud = createCrudRouter({
  model: 'productionMaterial',
  entity: 'production-material',
  readPerm: 'production:read',
  writePerm: 'production:write',
  createSchema: matSchema,
  updateSchema: matSchema.partial(),
  refs: [{ field: 'materialId', model: 'material' }, { field: 'productionEntryId', model: 'productionEntry' }],
  transform: stamp,
});

/** Entries are saved as "1.1 - Block laying"; the standard is just "Block laying". */
const baseName = (activity: string) => (activity.includes(' - ') ? activity.slice(activity.indexOf(' - ') + 3) : activity).trim().toLowerCase();
const lookupStd = (m: Map<string, number>, activity: string) => m.get(activity.toLowerCase()) ?? m.get(baseName(activity));

const hourlyStd = (s: { productivityRate: unknown; standardCrewSize: number; ratePerWorkerDay: unknown }) =>
  ratePerWorkerDay({ productivityRate: num(s.productivityRate), standardCrewSize: s.standardCrewSize, ratePerWorkerDay: s.ratePerWorkerDay == null ? null : num(s.ratePerWorkerDay) }) / 8;

async function resolveLaborRate(orgId: string): Promise<number> {
  const wages = await prisma.wageRate.findMany({ where: { organizationId: orgId, approvalStatus: 'APPROVED' } });
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

  // The engine works in units per labour-hour; standards are stored per worker-day (8 h).
  const stdById = new Map(standards.map((s) => [s.id, hourlyStd(s)]));
  const stdByActivity = new Map(standards.map((s) => [s.activity.toLowerCase(), hourlyStd(s)]));
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
    plannedProductivity: (e.productivityStandardId ? stdById.get(e.productivityStandardId) : undefined) ?? lookupStd(stdByActivity, e.wbsActivity) ?? 0,
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

  // Progress, EVM and profit are overridden with the shared calculation so this screen
  // agrees with Dashboard, Finance and Profitability.
  const m = (await loadProjectMetrics(orgId, { projectId })).projects[0];
  if (m) {
    Object.assign(result.progress, {
      actualProgressPct: m.progressPct ?? 0, plannedProgressPct: m.plannedProgressPct ?? 0,
      earnedValue: m.earnedValue ?? 0, plannedValue: m.plannedValue ?? 0, actualCost: m.actualCost,
      spi: m.spi, cpi: m.cpi, spiStatus: m.spiStatus, cpiStatus: m.cpiStatus,
      hasBudget: m.budget != null,
    });
    Object.assign(result.profitabilityImpact, {
      budgetedProfit: m.budgetedProfit ?? 0,
      forecastProfit: m.forecastProfit ?? 0,
      forecastMarginPct: m.forecastMarginPct ?? 0,
      hasForecast: m.forecastProfit != null,
      contractValue: m.contractValue,
    });
  }

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
  const stdByActivity = new Map(standards.map((s) => [s.activity.toLowerCase(), hourlyStd(s) * 8])); // per worker-day
  const crewName = new Map(crews.map((c) => [c.id, c.name]));

  const insights: { severity: string; title: string; detail: string; recommendation: string }[] = [];

  // 1. Activities below productivity standard.
  const byAct = new Map<string, { actual: number; labor: number }>();
  for (const e of entries) {
    const g = byAct.get(e.wbsActivity) ?? { actual: 0, labor: 0 };
    g.actual += num(e.actualQty); g.labor += num(e.laborHours); byAct.set(e.wbsActivity, g);
  }
  for (const [act, g] of byAct) {
    const std = lookupStd(stdByActivity, act);
    if (std && g.labor > 0) {
      const perWd = g.actual / (g.labor / 8);
      const v = ((perWd - std) / std) * 100;
      if (v <= -15) insights.push({
        severity: v <= -30 ? 'HIGH' : 'MEDIUM',
        title: `${act} productivity ${v.toFixed(0)}% below standard`,
        detail: `Actual ${perWd.toFixed(2)} vs standard ${std.toFixed(2)} units per worker-day.`,
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

  // 4. Schedule/output performance from the shared metrics: a low SPI is never "healthy".
  const mm = (await loadProjectMetrics(orgId, { projectId })).projects[0];
  if (mm?.spi != null && mm.spi < 0.95) insights.push({
    severity: mm.spi < 0.85 ? 'HIGH' : 'MEDIUM',
    title: `Output is at ${(mm.spi * 100).toFixed(0)}% of plan (SPI ${mm.spi})`,
    detail: `Actual quantity is ${mm.progressPct}% of what the plan expected to date.`,
    recommendation: 'Find the activities behind the gap, add crews or hours where the work front allows, and re-forecast the finish date.',
  });
  if (mm?.cpi != null && mm.cpi < 0.95) insights.push({
    severity: mm.cpi < 0.85 ? 'HIGH' : 'MEDIUM', title: `Cost performance is weak (CPI ${mm.cpi})`,
    detail: 'Earned value is lower than the cost spent so far.', recommendation: 'Review cost drivers and unit rates before more work is committed.',
  });

  if (entries.length === 0 && insights.length === 0) insights.push({ severity: 'LOW', title: 'No data yet', detail: 'No activities or daily entries have been recorded for this project, so productivity cannot be assessed.', recommendation: 'Submit daily reports with quantities and headcount to start tracking productivity.' });
  else if (insights.length === 0 && mm?.spi != null) insights.push({ severity: 'LOW', title: 'Production on plan', detail: `Output is at plan (SPI ${mm.spi}) with no activity or crew significantly below standard.`, recommendation: 'Maintain the pace and keep capturing daily reports.' });
  else if (insights.length === 0) insights.push({ severity: 'LOW', title: 'Not enough data to judge', detail: 'There are entries, but no plan quantities or standards to compare them with, so health cannot be judged.', recommendation: 'Enter planned quantities and productivity standards.' });

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
router.use('/', fieldReportRouter); // /production/field-report (+ /today)
router.use('/daily-reports', reportsRouter);
router.use('/daily-plans', dailyPlanRouter);
router.use('/materials', materialsCrud);
router.use('/', correctionRouter); // /production/:id/correct
router.use('/', entriesCrud); // entry CRUD last (handles /:id)

export default router;
