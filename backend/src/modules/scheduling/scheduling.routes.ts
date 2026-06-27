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
  code: z.string().min(1),
  name: z.string().min(1),
  durationDays: z.number().int().positive(),
  predecessors: z.array(z.string()).optional(),
  progressPct: z.number().min(0).max(100).optional(),
  startDate: z.string().datetime().optional(),
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
