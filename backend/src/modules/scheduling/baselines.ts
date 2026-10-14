import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { CrudOptions, runCreate, assertProjectInOrg } from '../../lib/crud';
import { auditFromRequest } from '../../auth/audit';
import {
  xlsxRaw, rowsFromXlsx, sendTemplate, str, numOrU, dateOrU, hasValue, ImportReport, auditImport,
} from '../../lib/xlsx-import';

const DAY_MS = 24 * 60 * 60 * 1000;

export const baselineSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(120).optional(),
  note: z.string().max(500).optional(),
});

/**
 * Create pipeline for a schedule baseline (a frozen copy of the live schedule).
 * Shared by the REST endpoint and the Copilot so both behave identically:
 * `validate` stamps the next version number + default name (and refuses an empty
 * schedule) — it runs for the preview too, so the user sees the real version —
 * and `afterChange` copies the activities in.
 */
export const baselineCrud: CrudOptions = {
  model: 'scheduleBaseline',
  entity: 'schedule-baseline',
  readPerm: 'scheduling:read',
  writePerm: 'scheduling:write',
  createSchema: baselineSchema,
  updateSchema: baselineSchema.partial(),
  requireProject: true,
  validate: async (data, req) => {
    const orgId = req.user!.orgId;
    const projectId = String(data.projectId);
    const activities = await prisma.scheduleActivity.count({ where: { organizationId: orgId, projectId } });
    if (activities === 0) throw BadRequest('This project has no schedule activities yet — add or import activities before taking a baseline.');
    const last = await prisma.scheduleBaseline.findFirst({ where: { organizationId: orgId, projectId }, orderBy: { versionNo: 'desc' }, select: { versionNo: true } });
    const versionNo = (last?.versionNo ?? 0) + 1;
    data.versionNo = versionNo;
    if (!data.name) data.name = `Baseline ${versionNo}`;
    data.source = 'SNAPSHOT';
    data.createdBy = req.user!.id;
    data.updatedBy = req.user!.id;
  },
  afterChange: async (action, record, req) => {
    if (action !== 'CREATE') return;
    const rows = await prisma.scheduleActivity.findMany({
      where: { organizationId: req.user!.orgId, projectId: String(record.projectId) },
      include: { wbsItem: { select: { code: true } } },
      orderBy: { code: 'asc' },
    });
    try {
      await prisma.scheduleBaselineActivity.createMany({
        data: rows.map((a) => ({
          baselineId: String(record.id), activityCode: a.code, activityName: a.name, wbsCode: a.wbsItem?.code ?? null,
          durationDays: a.durationDays, startDate: a.startDate, finishDate: a.finishDate, milestone: a.milestone,
        })),
      });
    } catch (e) {
      // Never leave an empty baseline behind.
      await prisma.scheduleBaseline.delete({ where: { id: String(record.id) } }).catch(() => undefined);
      throw e;
    }
  },
};

const router = Router();
router.use(authenticate);

const projectIdOf = (req: Request): string => {
  const id = (req.query.projectId as string | undefined) ?? (req.body?.projectId as string | undefined);
  if (!id) throw BadRequest('projectId is required');
  return id;
};

// LIST
router.get('/', requirePermission('scheduling:read'), asyncHandler(async (req, res) => {
  const projectId = projectIdOf(req);
  const rows = await prisma.scheduleBaseline.findMany({
    where: { organizationId: req.user!.orgId, projectId },
    orderBy: { versionNo: 'desc' },
    include: { _count: { select: { activities: true } } },
  });
  return ok(res, rows);
}));

// CREATE — snapshot of the live schedule
router.post('/', requirePermission('scheduling:write'), asyncHandler(async (req, res) => {
  const { record } = await runCreate(baselineCrud, req, { ...req.body, projectId: projectIdOf(req) }, true);
  return ok(res, record, 201);
}));

// Excel template + import (a baseline exported from P6 / MS Project / Excel)
router.get('/import-template.xlsx', requirePermission('scheduling:write'), asyncHandler(async (_req, res) => {
  await sendTemplate(res, 'Baseline', [
    { header: 'code', example: 'A10', note: 'Required. Must match an existing schedule activity code in the project.' },
    { header: 'baselineStart', example: '2026-01-05', note: 'Required. Planned start (Excel date or YYYY-MM-DD).' },
    { header: 'baselineFinish', example: '2026-01-19', note: 'Optional. Planned finish; derived from baselineStart + durationDays when blank.' },
    { header: 'durationDays', example: 14, note: 'Optional. Defaults to finish − start, else the activity’s current duration.' },
  ], 'schedule-baseline-template.xlsx',
  'Activities not listed here are simply not part of the baseline (they show as ADDED when compared). Pass name/note as query parameters or leave them for the default "Baseline N".');
}));

router.post('/import', requirePermission('scheduling:write'), xlsxRaw, asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = projectIdOf(req);
  await assertProjectInOrg(orgId, projectId);
  const rows = await rowsFromXlsx(req.body as Buffer);
  const activities = await prisma.scheduleActivity.findMany({
    where: { organizationId: orgId, projectId },
    include: { wbsItem: { select: { code: true } } },
  });
  const byCode = new Map(activities.map((a) => [a.code.toLowerCase(), a]));
  const report = new ImportReport();
  const seen = new Set<string>();
  const data: { activityCode: string; activityName: string; wbsCode: string | null; durationDays: number; startDate: Date; finishDate: Date; milestone: boolean }[] = [];

  for (const { rowNo, cells: r } of rows) {
    const code = str(r.code);
    if (!code) { report.fail(rowNo, 'code is required'); continue; }
    const act = byCode.get(code.toLowerCase());
    if (!act) { report.fail(rowNo, `no schedule activity with code "${code}" in this project`); continue; }
    if (seen.has(code.toLowerCase())) { report.exists(rowNo, `"${code}" appears more than once`); continue; }
    const start = dateOrU(r.baselinestart);
    if (start === undefined) { report.fail(rowNo, 'baselineStart is required'); continue; }
    if (start === null) { report.fail(rowNo, 'baselineStart is not a valid date'); continue; }
    const finishRaw = dateOrU(r.baselinefinish);
    if (finishRaw === null) { report.fail(rowNo, 'baselineFinish is not a valid date'); continue; }
    if (hasValue(r.durationdays) && (numOrU(r.durationdays) === undefined || numOrU(r.durationdays)! < 1)) { report.fail(rowNo, 'durationDays must be a positive number'); continue; }
    if (finishRaw && finishRaw < start) { report.fail(rowNo, 'baselineFinish is before baselineStart'); continue; }
    const given = numOrU(r.durationdays);
    const duration = Math.round(given ?? (finishRaw ? (finishRaw.getTime() - start.getTime()) / DAY_MS : act.durationDays)) || act.durationDays;
    const finish = finishRaw ?? new Date(start.getTime() + duration * DAY_MS);
    seen.add(code.toLowerCase());
    data.push({ activityCode: act.code, activityName: act.name, wbsCode: act.wbsItem?.code ?? null, durationDays: Math.max(1, duration), startDate: start, finishDate: finish, milestone: act.milestone });
  }
  if (data.length === 0) throw BadRequest(`No valid rows to import. ${report.outcome().errors.slice(0, 3).join(' ')}`);

  const last = await prisma.scheduleBaseline.findFirst({ where: { organizationId: orgId, projectId }, orderBy: { versionNo: 'desc' }, select: { versionNo: true } });
  const versionNo = (last?.versionNo ?? 0) + 1;
  const baseline = await prisma.scheduleBaseline.create({
    data: {
      organizationId: orgId, projectId, versionNo, source: 'IMPORT',
      name: str(req.query.name) || `Baseline ${versionNo} (imported)`,
      note: str(req.query.note) || null,
      createdBy: req.user!.id, updatedBy: req.user!.id,
      activities: { create: data },
    },
  });
  report.created = data.length;
  const outcome = report.outcome();
  await auditImport(req, 'schedule-baseline', outcome, { baselineId: baseline.id, projectId });
  return ok(res, { ...outcome, baselineId: baseline.id, versionNo }, 201);
}));

type Snap = { code: string; name: string; start: Date | null; finish: Date | null; duration: number };
const dayDiff = (a: Date | null, b: Date | null) => (a && b ? Math.round((a.getTime() - b.getTime()) / DAY_MS) : null);

// COMPARE a baseline with the live schedule (slippage per activity)
router.get('/compare', requirePermission('scheduling:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = projectIdOf(req);
  const baselineId = req.query.baselineId as string | undefined;
  if (!baselineId) throw BadRequest('baselineId is required');
  const baseline = await prisma.scheduleBaseline.findFirst({ where: { id: baselineId, organizationId: orgId, projectId }, include: { activities: true } });
  if (!baseline) throw NotFound('Baseline not found');
  const current = await prisma.scheduleActivity.findMany({ where: { organizationId: orgId, projectId } });

  const base = new Map<string, Snap>(baseline.activities.map((a) => [a.activityCode, { code: a.activityCode, name: a.activityName, start: a.startDate, finish: a.finishDate, duration: a.durationDays }]));
  const now = new Map<string, Snap>(current.map((a) => [a.code, { code: a.code, name: a.name, start: a.startDate, finish: a.finishDate, duration: a.durationDays }]));
  const codes = [...new Set([...base.keys(), ...now.keys()])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const rows = codes.map((code) => {
    const b = base.get(code); const c = now.get(code);
    const startVariance = b && c ? dayDiff(c.start, b.start) : null;
    const finishVariance = b && c ? dayDiff(c.finish, b.finish) : null;
    const status = !b ? 'ADDED' : !c ? 'REMOVED'
      : finishVariance === null ? 'NO_DATES'
      : finishVariance > 0 ? 'SLIPPED' : finishVariance < 0 ? 'AHEAD' : 'ON_TRACK';
    return {
      code, name: (c ?? b)!.name,
      baselineStart: b?.start ?? null, baselineFinish: b?.finish ?? null, baselineDuration: b?.duration ?? null,
      currentStart: c?.start ?? null, currentFinish: c?.finish ?? null, currentDuration: c?.duration ?? null,
      startVariance, finishVariance, durationDelta: b && c ? c.duration - b.duration : null, status,
    };
  });
  const maxDate = (xs: (Date | null)[]) => { const v = xs.filter((x): x is Date => !!x).map((x) => x.getTime()); return v.length ? new Date(Math.max(...v)) : null; };
  const baselineFinish = maxDate(baseline.activities.map((a) => a.finishDate));
  const currentFinish = maxDate(current.map((a) => a.finishDate));
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return ok(res, {
    baseline: { id: baseline.id, versionNo: baseline.versionNo, name: baseline.name, createdAt: baseline.createdAt },
    projectFinishVariance: dayDiff(currentFinish, baselineFinish),
    baselineFinish, currentFinish,
    slipped: count('SLIPPED'), ahead: count('AHEAD'), onTrack: count('ON_TRACK'), added: count('ADDED'), removed: count('REMOVED'),
    rows,
  });
}));

// DETAIL
router.get('/:id', requirePermission('scheduling:read'), asyncHandler(async (req, res) => {
  const baseline = await prisma.scheduleBaseline.findFirst({
    where: { id: req.params.id, organizationId: req.user!.orgId },
    include: { activities: { orderBy: { activityCode: 'asc' } } },
  });
  if (!baseline) throw NotFound('Baseline not found');
  return ok(res, baseline);
}));

// DELETE
router.delete('/:id', requirePermission('scheduling:write'), asyncHandler(async (req, res) => {
  const existing = await prisma.scheduleBaseline.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId } });
  if (!existing) throw NotFound('Baseline not found');
  await prisma.scheduleBaseline.delete({ where: { id: existing.id } });
  await auditFromRequest(req, 'DELETE', 'schedule-baseline', existing.id, { oldValues: existing });
  return ok(res, { deleted: true });
}));

export default router;
