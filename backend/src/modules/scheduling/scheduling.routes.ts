import { Router } from 'express';
import { z } from 'zod';
import { DependencyType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter, CrudOptions, assertProjectInOrg } from '../../lib/crud';
import { computeCpm, DependencyKind } from './cpm';
import { wouldCreateCycle, Edge } from './graph';
import baselinesRouter from './baselines';
import {
  xlsxRaw, rowsFromXlsx, sendTemplate, str, numOrU, dateOrU, boolOrU, hasValue, splitList, ImportReport, auditImport,
} from '../../lib/xlsx-import';

const DAY_MS = 24 * 60 * 60 * 1000;

// Accept boolean or the string the generic form sends.
const boolish = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

export const activitySchema = z.object({
  projectId: z.string(),
  wbsItemId: z.string().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  durationDays: z.number().int().positive(),
  predecessors: z.array(z.string()).optional(),
  progressPct: z.number().min(0).max(100).optional(),
  startDate: z.string().datetime().optional(),
  actualStart: z.string().datetime().optional(),
  actualFinish: z.string().datetime().optional(),
  milestone: boolish.optional(),
});

/**
 * Activity integrity shared by the UI, the Excel importer and the Copilot:
 * the linked WBS item must be in the same project, a NEW activity may not reuse
 * a code that is already in the project (the CPM keys on codes), and an
 * activity cannot list itself as a predecessor. `strictPredecessors` (Copilot)
 * additionally requires every predecessor code to exist already — the UI stays
 * lenient so activities can be entered in any order.
 */
export function activityValidator(strictPredecessors: boolean): NonNullable<CrudOptions['validate']> {
  return async (data, req) => {
    const orgId = req.user!.orgId;
    const wbsItemId = data.wbsItemId as string | undefined;
    const projectId = data.projectId as string | undefined;
    if (wbsItemId) {
      const wbs = await prisma.wbsItem.findFirst({ where: { id: wbsItemId, organizationId: orgId }, select: { projectId: true } });
      if (!wbs) throw BadRequest('wbsItemId does not belong to your organization');
      if (projectId && wbs.projectId !== projectId) throw BadRequest('WBS item must belong to the same project as the activity');
    }
    const code = String(data.code ?? '');
    const preds = ((data.predecessors as string[] | undefined) ?? []).map((p) => p.trim()).filter(Boolean);
    if (preds.some((p) => p.toLowerCase() === code.toLowerCase())) throw BadRequest('An activity cannot be its own predecessor');
    if (!data.id && projectId && code) {
      const dup = await prisma.scheduleActivity.findFirst({
        where: { organizationId: orgId, projectId, code: { equals: code, mode: 'insensitive' } }, select: { id: true },
      });
      if (dup) throw BadRequest(`An activity with code "${code}" already exists in this project`);
    }
    if (strictPredecessors && projectId && preds.length) {
      const found = await prisma.scheduleActivity.findMany({ where: { organizationId: orgId, projectId, code: { in: preds } }, select: { code: true } });
      const have = new Set(found.map((a) => a.code));
      const missing = preds.filter((p) => !have.has(p));
      if (missing.length) throw BadRequest(`Predecessor activit${missing.length === 1 ? 'y' : 'ies'} not found in this project: ${missing.join(', ')}`);
    }
  };
}

/** Baseline finish = start + duration (calendar days); recomputed on each save. */
export function activityTransform(data: Record<string, unknown>) {
  const start = data.startDate as Date | undefined;
  const duration = Number(data.durationDays ?? 0);
  if (start instanceof Date && duration > 0) {
    data.finishDate = new Date(start.getTime() + duration * DAY_MS);
  }
  return data;
}

export const activityOpts: CrudOptions = {
  model: 'scheduleActivity',
  entity: 'schedule-activity',
  readPerm: 'scheduling:read',
  writePerm: 'scheduling:write',
  createSchema: activitySchema,
  updateSchema: activitySchema.partial(),
  searchField: 'name',
  requireProject: true,
  orderBy: { code: 'asc' },
  include: { wbsItem: { select: { id: true, code: true, name: true } } },
  refs: [{ field: 'wbsItemId', model: 'wbsItem' }],
  validate: activityValidator(false),
  transform: activityTransform,
};

const crud = createCrudRouter(activityOpts);

// ── Typed dependencies (FS/SS/FF/SF + lag) ────────────────────
/** Every predecessor→activity link of a project (typed + legacy code lists), keyed by activity id. */
async function projectEdges(orgId: string, projectId: string): Promise<Edge[]> {
  const [acts, deps] = await Promise.all([
    prisma.scheduleActivity.findMany({ where: { organizationId: orgId, projectId }, select: { id: true, code: true, predecessors: true } }),
    prisma.scheduleDependency.findMany({ where: { organizationId: orgId, projectId }, select: { activityId: true, predecessorId: true } }),
  ]);
  const idByCode = new Map(acts.map((a) => [a.code, a.id]));
  const edges: Edge[] = deps.map((d) => [d.predecessorId, d.activityId] as const);
  for (const a of acts) for (const p of a.predecessors ?? []) { const pid = idByCode.get(p); if (pid) edges.push([pid, a.id] as const); }
  return edges;
}

const dependencySchema = z.object({
  projectId: z.string(),
  activityId: z.string(),
  predecessorId: z.string(),
  type: z.nativeEnum(DependencyType).optional(),
  lagDays: z.number().int().optional(),
});

export const dependencyOpts: CrudOptions = {
  model: 'scheduleDependency',
  entity: 'schedule-dependency',
  readPerm: 'scheduling:read',
  writePerm: 'scheduling:write',
  createSchema: dependencySchema,
  updateSchema: dependencySchema.partial(),
  requireProject: true,
  include: {
    activity: { select: { id: true, code: true, name: true } },
    predecessor: { select: { id: true, code: true, name: true } },
  },
  refs: [
    { field: 'activityId', model: 'scheduleActivity' },
    { field: 'predecessorId', model: 'scheduleActivity' },
  ],
  // Integrity: a dependency must connect two activities of the SAME project
  // (and that project must match the body), and cannot be self-referential.
  // `refs` already proved both ids are in the caller's org.
  validate: async (data, req) => {
    const activityId = data.activityId as string | undefined;
    const predecessorId = data.predecessorId as string | undefined;
    const projectId = data.projectId as string | undefined;
    if (activityId && predecessorId && activityId === predecessorId) {
      throw BadRequest('An activity cannot depend on itself');
    }
    const ids = [activityId, predecessorId].filter(Boolean) as string[];
    if (ids.length === 0) return;
    const acts = await prisma.scheduleActivity.findMany({
      where: { id: { in: ids }, organizationId: req.user!.orgId },
      select: { id: true, projectId: true },
    });
    const projectById = new Map(acts.map((a) => [a.id, a.projectId]));
    for (const id of ids) {
      const pid = projectById.get(id);
      if (pid === undefined) throw BadRequest('Dependency references an unknown activity');
      if (projectId && pid !== projectId) throw BadRequest('Dependency activities must belong to the dependency project');
    }
    if (activityId && predecessorId && projectById.get(activityId) !== projectById.get(predecessorId)) {
      throw BadRequest('Activity and predecessor must belong to the same project');
    }
    // A new link may not close a loop (the critical path cannot be computed on a cycle).
    if (activityId && predecessorId && !data.id) {
      const pid = projectById.get(activityId)!;
      const edges = await projectEdges(req.user!.orgId, pid);
      if (wouldCreateCycle(edges, predecessorId, activityId)) {
        throw BadRequest('That dependency would create a circular schedule (the predecessor already depends on this activity)');
      }
      const dup = await prisma.scheduleDependency.findFirst({ where: { organizationId: req.user!.orgId, activityId, predecessorId }, select: { id: true } });
      if (dup) throw BadRequest('This dependency already exists');
    }
  },
  transform: (data, req) => {
    if (!('id' in data)) data.createdBy = req.user!.id;
    data.updatedBy = req.user!.id;
    return data;
  },
};

const dependenciesRouter = createCrudRouter(dependencyOpts);

// Parent router: register /cpm and /dependencies BEFORE the CRUD `/:id` route
// so those path segments aren't mistaken for an activity id.
const router = Router();

/**
 * Critical Path Method (M13) — merges legacy FS predecessors with typed
 * ScheduleDependency links, then delegates to the pure `computeCpm`.
 */
router.get(
  '/cpm',
  authenticate,
  requirePermission('scheduling:read'),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) throw BadRequest('projectId is required');

    const orgId = req.user!.orgId;
    const [activities, deps] = await Promise.all([
      prisma.scheduleActivity.findMany({ where: { organizationId: orgId, projectId } }),
      prisma.scheduleDependency.findMany({ where: { organizationId: orgId, projectId } }),
    ]);

    const codeById = new Map(activities.map((a) => [a.id, a.code]));
    const typedByActivity = new Map<string, { predecessor: string; type: DependencyKind; lag: number }[]>();
    for (const d of deps) {
      const predCode = codeById.get(d.predecessorId);
      if (!predCode) continue;
      const list = typedByActivity.get(d.activityId) ?? [];
      list.push({ predecessor: predCode, type: d.type as DependencyKind, lag: d.lagDays });
      typedByActivity.set(d.activityId, list);
    }

    try {
      const result = computeCpm(
        activities.map((a) => {
          const legacy = (a.predecessors ?? []).map((p) => ({ predecessor: p, type: 'FS' as DependencyKind, lag: 0 }));
          const typed = typedByActivity.get(a.id) ?? [];
          return {
            code: a.code,
            name: a.name,
            duration: a.durationDays,
            predecessors: a.predecessors ?? [],
            deps: [...legacy, ...typed],
          };
        }),
      );
      return ok(res, result);
    } catch (e) {
      throw BadRequest(e instanceof Error ? e.message : 'Failed to compute critical path');
    }
  }),
);


// ── Excel import (activities, dependencies) ───────────────────
const projectIdQuery = (req: import('express').Request): string => {
  const id = req.query.projectId as string | undefined;
  if (!id) throw BadRequest('projectId is required');
  return id;
};

router.get('/template.xlsx', authenticate, requirePermission('scheduling:write'), asyncHandler(async (_req, res) => {
  await sendTemplate(res, 'Activities', [
    { header: 'code', example: 'A10', note: 'Required. Unique within the project.' },
    { header: 'name', example: 'Excavation', note: 'Required.' },
    { header: 'durationDays', example: 5, note: 'Required. Whole days ≥ 1 (a milestone may be left blank = 1).' },
    { header: 'wbsCode', example: '1.1', note: 'Optional but recommended. Must match a WBS code already in the project.' },
    { header: 'startDate', example: '2026-01-05', note: 'Optional. Excel date or YYYY-MM-DD. Finish is computed from start + duration.' },
    { header: 'milestone', example: 'no', note: 'Optional. yes / no.' },
    { header: 'progressPct', example: 0, note: 'Optional. 0–100.' },
    { header: 'predecessors', example: '', note: 'Optional. Activity codes, comma-separated (finish-to-start). Use the Dependencies import for SS/FF/SF and lags.' },
    { header: 'actualStart', example: '', note: 'Optional date.' },
    { header: 'actualFinish', example: '', note: 'Optional date.' },
  ], 'schedule-activities-template.xlsx', 'Import the WBS first so wbsCode can be linked. Rows whose code already exists in the project are skipped.');
}));

router.post('/import', authenticate, requirePermission('scheduling:write'), xlsxRaw, asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = projectIdQuery(req);
  await assertProjectInOrg(orgId, projectId);
  const rows = await rowsFromXlsx(req.body as Buffer);
  const [existing, wbs] = await Promise.all([
    prisma.scheduleActivity.findMany({ where: { organizationId: orgId, projectId }, select: { code: true } }),
    prisma.wbsItem.findMany({ where: { organizationId: orgId, projectId }, select: { id: true, code: true } }),
  ]);
  const known = new Set(existing.map((a) => a.code.toLowerCase()));
  const wbsByCode = new Map(wbs.map((w) => [w.code.toLowerCase(), w.id]));
  // Codes available as predecessors: already in the project or defined anywhere in this file.
  const fileCodes = new Set(rows.map((r) => str(r.cells.code).toLowerCase()).filter(Boolean));
  const report = new ImportReport();
  const seen = new Set<string>();
  const data: Record<string, unknown>[] = [];

  for (const { rowNo, cells: r } of rows) {
    const code = str(r.code); const name = str(r.name);
    if (!code || !name) { report.fail(rowNo, 'code and name are required'); continue; }
    if (known.has(code.toLowerCase())) { report.exists(rowNo, `activity "${code}" already exists`); continue; }
    if (seen.has(code.toLowerCase())) { report.exists(rowNo, `"${code}" appears more than once in the file`); continue; }
    const milestone = hasValue(r.milestone) ? boolOrU(r.milestone) : false;
    if (milestone === undefined) { report.fail(rowNo, 'milestone must be yes or no'); continue; }
    let duration = numOrU(r.durationdays);
    if (duration === undefined) {
      if (hasValue(r.durationdays)) { report.fail(rowNo, 'durationDays must be a number'); continue; }
      if (!milestone) { report.fail(rowNo, 'durationDays is required'); continue; }
      duration = 1;
    }
    if (!Number.isInteger(duration) || duration < 1) { report.fail(rowNo, 'durationDays must be a whole number ≥ 1'); continue; }
    const progress = numOrU(r.progresspct);
    if (hasValue(r.progresspct) && (progress === undefined || progress < 0 || progress > 100)) { report.fail(rowNo, 'progressPct must be between 0 and 100'); continue; }
    const start = dateOrU(r.startdate); const aStart = dateOrU(r.actualstart); const aFinish = dateOrU(r.actualfinish);
    if (start === null) { report.fail(rowNo, 'startDate is not a valid date'); continue; }
    if (aStart === null || aFinish === null) { report.fail(rowNo, 'actualStart/actualFinish is not a valid date'); continue; }
    let wbsItemId: string | undefined;
    if (hasValue(r.wbscode)) {
      wbsItemId = wbsByCode.get(str(r.wbscode).toLowerCase());
      if (!wbsItemId) { report.fail(rowNo, `no WBS item with code "${str(r.wbscode)}" in this project (import the WBS first)`); continue; }
    }
    const preds = splitList(r.predecessors);
    if (preds.some((p) => p.toLowerCase() === code.toLowerCase())) { report.fail(rowNo, 'an activity cannot be its own predecessor'); continue; }
    const missing = preds.filter((p) => !known.has(p.toLowerCase()) && !fileCodes.has(p.toLowerCase()));
    if (missing.length) { report.fail(rowNo, `unknown predecessor code(s): ${missing.join(', ')}`); continue; }
    seen.add(code.toLowerCase());
    data.push({
      organizationId: orgId, projectId, wbsItemId, code, name, durationDays: duration, predecessors: preds,
      progressPct: progress ?? 0, milestone, startDate: start, actualStart: aStart, actualFinish: aFinish,
      finishDate: start ? new Date(start.getTime() + duration * DAY_MS) : undefined,
    });
  }
  if (data.length) await prisma.scheduleActivity.createMany({ data: data as never });
  report.created = data.length;
  const outcome = report.outcome();
  await auditImport(req, 'schedule-activity', outcome, { projectId });
  return ok(res, outcome, 201);
}));

router.get('/dependencies/template.xlsx', authenticate, requirePermission('scheduling:write'), asyncHandler(async (_req, res) => {
  await sendTemplate(res, 'Dependencies', [
    { header: 'activityCode', example: 'A20', note: 'Required. The activity that depends on the predecessor.' },
    { header: 'predecessorCode', example: 'A10', note: 'Required. Must be a different activity in the same project.' },
    { header: 'type', example: 'FS', note: 'Optional, default FS. FS finish→start, SS start→start, FF finish→finish, SF start→finish.' },
    { header: 'lagDays', example: 0, note: 'Optional whole days (negative = lead). Default 0.' },
  ], 'schedule-dependencies-template.xlsx', 'Import the activities first. Links that already exist, or that would create a circular schedule, are skipped and reported.');
}));

router.post('/dependencies/import', authenticate, requirePermission('scheduling:write'), xlsxRaw, asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = projectIdQuery(req);
  await assertProjectInOrg(orgId, projectId);
  const rows = await rowsFromXlsx(req.body as Buffer);
  const [acts, deps, edges] = await Promise.all([
    prisma.scheduleActivity.findMany({ where: { organizationId: orgId, projectId }, select: { id: true, code: true } }),
    prisma.scheduleDependency.findMany({ where: { organizationId: orgId, projectId }, select: { activityId: true, predecessorId: true } }),
    projectEdges(orgId, projectId),
  ]);
  const idByCode = new Map(acts.map((a) => [a.code.toLowerCase(), a.id]));
  const pairs = new Set(deps.map((d) => `${d.predecessorId}>${d.activityId}`));
  const report = new ImportReport();
  const data: Record<string, unknown>[] = [];

  for (const { rowNo, cells: r } of rows) {
    const aCode = str(r.activitycode); const pCode = str(r.predecessorcode);
    if (!aCode || !pCode) { report.fail(rowNo, 'activityCode and predecessorCode are required'); continue; }
    const activityId = idByCode.get(aCode.toLowerCase()); const predecessorId = idByCode.get(pCode.toLowerCase());
    if (!activityId) { report.fail(rowNo, `no activity with code "${aCode}" in this project`); continue; }
    if (!predecessorId) { report.fail(rowNo, `no activity with code "${pCode}" in this project`); continue; }
    if (activityId === predecessorId) { report.fail(rowNo, 'an activity cannot depend on itself'); continue; }
    const type = (str(r.type) || 'FS').toUpperCase();
    if (!(type in DependencyType)) { report.fail(rowNo, `type must be FS, SS, FF or SF (got "${str(r.type)}")`); continue; }
    const lag = hasValue(r.lagdays) ? numOrU(r.lagdays) : 0;
    if (lag === undefined || !Number.isInteger(lag)) { report.fail(rowNo, 'lagDays must be a whole number'); continue; }
    if (pairs.has(`${predecessorId}>${activityId}`)) { report.exists(rowNo, `${pCode} → ${aCode} already exists`); continue; }
    if (wouldCreateCycle(edges, predecessorId, activityId)) { report.fail(rowNo, `${pCode} → ${aCode} would create a circular schedule`); continue; }
    pairs.add(`${predecessorId}>${activityId}`);
    edges.push([predecessorId, activityId]);
    data.push({ organizationId: orgId, projectId, activityId, predecessorId, type: type as DependencyType, lagDays: lag, createdBy: req.user!.id, updatedBy: req.user!.id });
  }
  if (data.length) await prisma.scheduleDependency.createMany({ data: data as never });
  report.created = data.length;
  const outcome = report.outcome();
  await auditImport(req, 'schedule-dependency', outcome, { projectId });
  return ok(res, outcome, 201);
}));

router.use('/baselines', baselinesRouter);

router.use('/dependencies', dependenciesRouter);

// CRUD for activities mounted last.
router.use('/', crud);

export default router;
