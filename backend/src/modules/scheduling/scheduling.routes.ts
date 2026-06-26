import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { computeCpm } from './cpm';

const activitySchema = z.object({
  projectId: z.string(),
  code: z.string().min(1),
  name: z.string().min(1),
  durationDays: z.number().int().positive(),
  predecessors: z.array(z.string()).optional(),
  progressPct: z.number().min(0).max(100).optional(),
  startDate: z.string().datetime().optional(),
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
});

// Parent router: register /cpm BEFORE the CRUD `/:id` route so "cpm" is not
// mistaken for an activity id.
const router = Router();

/**
 * Critical Path Method (M13) — delegates to the pure `computeCpm` (unit-tested).
 */
router.get(
  '/cpm',
  authenticate,
  requirePermission('scheduling:read'),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) throw BadRequest('projectId is required');

    const activities = await prisma.scheduleActivity.findMany({
      where: { organizationId: req.user!.orgId, projectId },
    });

    try {
      const result = computeCpm(
        activities.map((a) => ({
          code: a.code,
          name: a.name,
          duration: a.durationDays,
          predecessors: a.predecessors ?? [],
        })),
      );
      return ok(res, result);
    } catch (e) {
      throw BadRequest(e instanceof Error ? e.message : 'Failed to compute critical path');
    }
  }),
);

// CRUD for activities mounted after /cpm.
router.use('/', crud);

export default router;
