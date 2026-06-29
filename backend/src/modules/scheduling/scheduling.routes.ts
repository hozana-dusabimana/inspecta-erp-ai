import { Router } from 'express';
import { z } from 'zod';
import { DependencyType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { computeCpm, DependencyKind } from './cpm';

const DAY_MS = 24 * 60 * 60 * 1000;

// Accept boolean or the string the generic form sends.
const boolish = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

const activitySchema = z.object({
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

const crud = createCrudRouter({
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
  // A linked WBS item must belong to the same project as the activity.
  validate: async (data, req) => {
    const wbsItemId = data.wbsItemId as string | undefined;
    const projectId = data.projectId as string | undefined;
    if (!wbsItemId) return;
    const wbs = await prisma.wbsItem.findFirst({
      where: { id: wbsItemId, organizationId: req.user!.orgId },
      select: { projectId: true },
    });
    if (!wbs) throw BadRequest('wbsItemId does not belong to your organization');
    if (projectId && wbs.projectId !== projectId) throw BadRequest('WBS item must belong to the same project as the activity');
  },
  // Baseline finish = start + duration (calendar days); recomputed on each save.
  transform: (data) => {
    const start = data.startDate as Date | undefined;
    const duration = Number(data.durationDays ?? 0);
    if (start instanceof Date && duration > 0) {
      data.finishDate = new Date(start.getTime() + duration * DAY_MS);
    }
    return data;
  },
});

// ── Typed dependencies (FS/SS/FF/SF + lag) ────────────────────
const dependencySchema = z.object({
  projectId: z.string(),
  activityId: z.string(),
  predecessorId: z.string(),
  type: z.nativeEnum(DependencyType).optional(),
  lagDays: z.number().int().optional(),
});

const dependenciesRouter = createCrudRouter({
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
  },
  transform: (data, req) => {
    if (!('id' in data)) data.createdBy = req.user!.id;
    data.updatedBy = req.user!.id;
    return data;
  },
});

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

router.use('/dependencies', dependenciesRouter);

// CRUD for activities mounted last.
router.use('/', crud);

export default router;
