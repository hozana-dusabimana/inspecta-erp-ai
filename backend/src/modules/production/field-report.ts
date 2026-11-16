import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { assertProjectInOrg } from '../../lib/crud';
import { notify } from '../notifications/notify';
import { labourCost } from '../../lib/formulas';
import { resolveDailyRate, workingDaysPerMonth, employeeDayRate } from '../fieldops/labour';
import { evidenceFromBody, assertEvidence, saveEvidence } from '../../lib/evidence';
import { stampReport, daySummary } from './report-checks';
import { postProductionCosts } from '../finance/finance.routes';
import { syncProjectProgress } from '../../lib/project-metrics';

const num = (v: unknown) => Number(v ?? 0);
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);

const labourLine = z.object({ trade: z.string().min(1), headcount: z.number().int().min(1).max(10000), hours: z.number().min(0).max(24) });

export const fieldReportSchema = z.object({
  projectId: z.string(),
  /** Client-generated id so a retry after a dropped connection can never double-post. */
  clientRef: z.string().min(8).max(80).optional(),
  date: z.string().min(10),
  weather: z.string().optional(),
  temperature: z.number().optional(),
  note: z.string().max(4000).optional(),
  photos: z.array(z.string()).max(20).optional(),
  signedSheetUrl: z.string().optional(),
  activities: z.array(z.object({
    wbsItemId: z.string().optional(),
    name: z.string().min(1),
    unit: z.string().optional(),
    plannedQty: z.number().nonnegative().optional(),
    actualQty: z.number().nonnegative(),
    remarks: z.string().max(2000).optional(),
    labour: z.array(labourLine).max(30).default([]),
    /** Named employees who worked on this activity today (T2-04): costed at their own wage. */
    workers: z.array(z.object({ employeeId: z.string(), hours: z.number().positive().max(24) })).max(200).default([]),
    crewId: z.string().optional(),
  })).min(1, 'Add at least one activity').max(60),
  materials: z.array(z.object({
    materialId: z.string(),
    qtyUsed: z.number().nonnegative(),
    wasteQty: z.number().nonnegative().optional(),
    /** Index into `activities`; defaults to the first activity. */
    activityIndex: z.number().int().min(0).optional(),
  })).max(100).default([]),
  equipment: z.array(z.object({
    equipmentId: z.string(),
    hours: z.number().positive().max(24),
    wbsItemId: z.string().optional(),
    note: z.string().max(500).optional(),
  })).max(30).default([]),
});

export type FieldReportInput = z.infer<typeof fieldReportSchema>;

/** Counts read back from the database for a report: what is really saved. */
async function readBack(reportId: string) {
  const report = await prisma.dailyReport.findUnique({ where: { id: reportId } });
  const entryIds = (await prisma.productionEntry.findMany({ where: { dailyReportId: reportId }, select: { id: true } })).map((e) => e.id);
  const [attendance, materials, equipmentLogs] = await Promise.all([
    prisma.attendance.count({ where: { productionEntryId: { in: entryIds } } }),
    prisma.productionMaterial.count({ where: { productionEntryId: { in: entryIds } } }),
    prisma.equipmentUsageLog.count({ where: { sourceRef: reportId } }),
  ]);
  return { reportId, reportNumber: report?.reportNumber, status: report?.status, entries: entryIds.length, attendance, materials, equipmentLogs };
}

export const fieldReportRouter = Router();
fieldReportRouter.use(authenticate);

// Activities scheduled for a date: what the form lists for the site manager.
fieldReportRouter.get('/field-report/today', requirePermission('production:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = String(req.query.projectId ?? '');
  if (!projectId) throw BadRequest('projectId is required');
  await assertProjectInOrg(orgId, projectId);
  const d = day(String(req.query.date ?? new Date().toISOString()));
  const [activities, standards] = await Promise.all([
    prisma.scheduleActivity.findMany({
      where: { organizationId: orgId, projectId, milestone: false, progressPct: { lt: 100 }, startDate: { lte: d }, finishDate: { gte: d } },
      include: { wbsItem: { select: { id: true, code: true, name: true, unit: true, quantity: true } } },
      orderBy: { startDate: 'asc' },
    }),
    prisma.productivityStandard.findMany({ where: { organizationId: orgId }, select: { activity: true, unit: true, productivityRate: true, standardCrewSize: true, ratePerWorkerDay: true } }),
  ]);
  const std = (name: string) => standards.find((s) => s.activity.toLowerCase() === name.toLowerCase());
  return ok(res, activities.map((a) => {
    const unit = a.wbsItem?.unit ?? std(a.name)?.unit ?? '';
    const planned = a.wbsItem?.quantity && a.durationDays > 0 ? Number(num(a.wbsItem.quantity) / a.durationDays) : 0;
    const s = std(a.name);
    return {
      activityId: a.id, code: a.code, name: a.name, wbsItemId: a.wbsItemId, wbsCode: a.wbsItem?.code ?? null, unit,
      plannedQty: Number(planned.toFixed(3)),
      ratePerWorkerDay: s ? (s.ratePerWorkerDay ? num(s.ratePerWorkerDay) : num(s.productivityRate) / Math.max(1, s.standardCrewSize)) : null,
    };
  }));
}));

// What the day already holds, from the people who own each record (Foreman, Store, QC, HSE).
fieldReportRouter.get('/field-report/day', requirePermission('production:read'), asyncHandler(async (req, res) => {
  const projectId = String(req.query.projectId ?? '');
  if (!projectId) throw BadRequest('projectId is required');
  await assertProjectInOrg(req.user!.orgId, projectId);
  return ok(res, await daySummary(req.user!.orgId, projectId, String(req.query.date ?? new Date().toISOString())));
}));

// One submit writes the whole day: report header, entries, headcount, materials, equipment.
fieldReportRouter.post('/field-report', requirePermission('production:write'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const userId = req.user!.id;
  const body = fieldReportSchema.parse(req.body);
  await assertProjectInOrg(orgId, body.projectId);
  // Evidence (T2-09): a report is refused without at least one site photo, and the message says so.
  const evidence = evidenceFromBody(req.body);
  await assertEvidence(req, 'daily_report', evidence, (body.photos ?? []).length + (body.signedSheetUrl ? 1 : 0));

  if (body.clientRef) {
    const dup = await prisma.dailyReport.findFirst({ where: { organizationId: orgId, clientRef: body.clientRef } });
    if (dup) return ok(res, { duplicate: true, ...(await readBack(dup.id)) }, 200);
  }

  // Everything referenced must belong to this company, and WBS items to this project.
  const wbsIds = [...new Set([...body.activities.map((a) => a.wbsItemId), ...body.equipment.map((e) => e.wbsItemId)].filter(Boolean) as string[])];
  const wbs = await prisma.wbsItem.findMany({ where: { id: { in: wbsIds }, organizationId: orgId, projectId: body.projectId }, select: { id: true, code: true } });
  if (wbs.length !== wbsIds.length) throw BadRequest('A WBS item does not belong to this project');
  const wbsCode = new Map(wbs.map((w) => [w.id, w.code]));
  const matIds = [...new Set(body.materials.map((m) => m.materialId))];
  if (matIds.length && (await prisma.material.count({ where: { id: { in: matIds }, organizationId: orgId } })) !== matIds.length) throw BadRequest('A material was not found');
  const eqIds = [...new Set(body.equipment.map((e) => e.equipmentId))];
  if (eqIds.length && (await prisma.equipment.count({ where: { id: { in: eqIds }, organizationId: orgId } })) !== eqIds.length) throw BadRequest('A piece of equipment was not found');
  body.materials.forEach((m) => { if ((m.activityIndex ?? 0) >= body.activities.length) throw BadRequest('A material points at an activity that is not in the report'); });

  // Named employees: must belong to the company, and one attendance per person per day.
  const workerIds = [...new Set(body.activities.flatMap((a) => a.workers.map((w) => w.employeeId)))];
  const employees = workerIds.length ? await prisma.employee.findMany({ where: { id: { in: workerIds }, organizationId: orgId } }) : [];
  if (employees.length !== workerIds.length) throw BadRequest('An employee in the report was not found');
  const dup = body.activities.flatMap((a) => a.workers.map((w) => w.employeeId)).find((id, i, all) => all.indexOf(id) !== i);
  if (dup) throw BadRequest(`${employees.find((e) => e.id === dup)?.fullName ?? 'An employee'} is listed twice: record one attendance per person per day.`);
  const dayStart = day(body.date);
  const already = workerIds.length ? await prisma.attendance.findMany({ where: { employeeId: { in: workerIds }, date: dayStart }, select: { employeeId: true } }) : [];
  if (already.length) throw BadRequest(`${employees.find((e) => e.id === already[0].employeeId)?.fullName} already has attendance on ${body.date.slice(0, 10)}.`);
  const daysPerMonth = await workingDaysPerMonth(orgId);
  const empRate = new Map(employees.map((e) => [e.id, employeeDayRate(e, daysPerMonth)]));
  const empName = new Map(employees.map((e) => [e.id, e.fullName]));
  const crewIds = [...new Set(body.activities.map((a) => a.crewId).filter(Boolean) as string[])];
  if (crewIds.length && (await prisma.crew.count({ where: { id: { in: crewIds }, organizationId: orgId } })) !== crewIds.length) throw BadRequest('A crew was not found');

  // Casual labour is costed from the company wage rate for the trade.
  const rates = new Map<string, number | null>();
  for (const t of new Set(body.activities.flatMap((a) => a.labour.map((l) => l.trade.toLowerCase())))) rates.set(t, await resolveDailyRate(orgId, t));

  const date = day(body.date);
  const next = new Date(date.getTime() + 86400000);
  const reportId = await prisma.$transaction(async (tx) => {
    const sameDay = await tx.dailyReport.count({ where: { organizationId: orgId, projectId: body.projectId, reportDate: { gte: date, lt: next } } });
    const report = await tx.dailyReport.create({
      data: {
        organizationId: orgId, projectId: body.projectId, clientRef: body.clientRef,
        reportNumber: `DR-${body.date.slice(0, 10).replace(/-/g, '')}-${String(sameDay + 1).padStart(2, '0')}`,
        reportDate: date, weather: body.weather, temperature: body.temperature, notes: body.note,
        status: 'SUBMITTED', preparedById: userId, createdBy: userId, updatedBy: userId,
      },
    });
    const entryIds: string[] = [];
    for (const a of body.activities) {
      // Labour hours are the sum of the attendance written below, never typed (T1-05 c).
      const laborHours = a.labour.reduce((s, l) => s + l.headcount * l.hours, 0) + a.workers.reduce((s, w) => s + w.hours, 0);
      const code = a.wbsItemId ? wbsCode.get(a.wbsItemId) : undefined;
      const equipmentHours = body.equipment.filter((e) => a.wbsItemId && e.wbsItemId === a.wbsItemId).reduce((s, e) => s + e.hours, 0);
      const entry = await tx.productionEntry.create({
        data: {
          organizationId: orgId, projectId: body.projectId, dailyReportId: report.id, date,
          wbsActivity: code ? `${code} - ${a.name}` : a.name, wbsItemId: a.wbsItemId, unit: a.unit || 'unit', crewId: a.crewId,
          plannedQty: a.plannedQty ?? 0, actualQty: a.actualQty, laborHours, equipmentHours,
          weatherCondition: body.weather, remarks: a.remarks ?? body.note, photos: body.photos ?? [],
          createdById: userId, createdBy: userId, updatedBy: userId,
        },
      });
      entryIds.push(entry.id);
      for (const w of a.workers) {
        const rate = empRate.get(w.employeeId) ?? null;
        await tx.attendance.create({
          data: {
            organizationId: orgId, projectId: body.projectId, employeeId: w.employeeId, wbsItemId: a.wbsItemId, productionEntryId: entry.id, date,
            workerName: empName.get(w.employeeId) ?? 'Employee', headcount: 1, hoursWorked: w.hours,
            status: 'present', present: true, ratePerDay: rate, cost: rate ? labourCost(1, w.hours, rate) : 0, evidenceUrl: body.signedSheetUrl,
          },
        });
      }
      for (const l of a.labour) {
        const rate = rates.get(l.trade.toLowerCase()) ?? null;
        await tx.attendance.create({
          data: {
            organizationId: orgId, projectId: body.projectId, wbsItemId: a.wbsItemId, productionEntryId: entry.id, date,
            workerName: `${l.trade} ×${l.headcount}`, trade: l.trade, headcount: l.headcount, hoursWorked: l.hours,
            status: 'present', present: true, ratePerDay: rate, cost: rate ? labourCost(l.headcount, l.hours, rate) : 0,
            evidenceUrl: body.signedSheetUrl,
          },
        });
      }
    }
    for (const m of body.materials) {
      await tx.productionMaterial.create({
        data: { organizationId: orgId, productionEntryId: entryIds[m.activityIndex ?? 0], materialId: m.materialId, qtyUsed: m.qtyUsed, wasteQty: m.wasteQty ?? 0, createdBy: userId, updatedBy: userId },
      });
    }
    for (const e of body.equipment) {
      await tx.equipmentUsageLog.create({
        data: { organizationId: orgId, equipmentId: e.equipmentId, projectId: body.projectId, wbsItemId: e.wbsItemId, date, hoursUsed: e.hours, note: e.note, sourceRef: report.id, createdBy: userId, updatedBy: userId },
      });
    }
    return report.id;
  }, { timeout: 30000 });

  if (evidence.length || body.photos?.length) {
    // Stamped evidence (with location) wins; plain photo URLs are stored when no stamp came with them.
    const items = evidence.length ? evidence : (body.photos ?? []).filter((u) => /^https?:\/\//i.test(u)).map((url) => ({ url, sourceType: 'LINK' as const }));
    await saveEvidence(orgId, userId, 'daily_report', reportId, body.projectId, items).catch(() => undefined);
  }
  // Cross-checks + lateness are stamped on the report; the approver must answer any flag in writing.
  const stamped = await stampReport(orgId, reportId);
  await syncProjectProgress(orgId, body.projectId).catch(() => undefined);
  // Labour and equipment cost flow to the ledger (cost by WBS, CPI); a failure here must not lose the report.
  let costPosted: number | null = null;
  try { costPosted = (await postProductionCosts(orgId, body.projectId, userId)).posted; } catch { /* retried by the next post-production run */ }
  await notify({ organizationId: orgId, type: 'APPROVAL', severity: 'MEDIUM', title: 'Daily report submitted', message: `A daily report for ${body.date.slice(0, 10)} awaits approval.`, link: '/production', refKey: `daily-report:${reportId}` }).catch(() => undefined);

  // Report what is really in the database, not what we meant to write.
  return ok(res, { duplicate: false, costPosted, flags: stamped.flags, late: stamped.late, ...(await readBack(reportId)) }, 201);
}));
