import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { resolvePermissions } from '../../auth/permissions';
import { notify } from '../notifications/notify';

/**
 * Daily plans: the site manager plans the day's work per WBS item and assigns it
 * to someone who can raise material requisitions (foreman / site engineer), so the
 * materials get requested against the right task.
 */

/** Active members of the company who hold requisition:write (the people who can raise requisitions). */
export async function requisitionRaisers(orgId: string, projectId?: string) {
  const users = await prisma.user.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, fullName: true, email: true, role: true, roleDefinition: { select: { permissions: true } }, projectAssignments: { select: { projectId: true } } },
  });
  return users
    .filter((u) => resolvePermissions(u.role, u.roleDefinition).includes('requisition:write'))
    // Someone limited to other projects cannot raise requisitions on this one.
    .filter((u) => !projectId || u.projectAssignments.length === 0 || u.projectAssignments.some((a) => a.projectId === projectId))
    .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, role: u.role }));
}

const planSchema = z.object({
  projectId: z.string(),
  wbsItemId: z.string().optional(),
  planDate: z.string().datetime().optional(),
  title: z.string().min(1, 'Describe the work planned'),
  plannedQty: z.number().nonnegative().optional(),
  unit: z.string().optional(),
  assigneeId: z.string().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
  note: z.string().optional(),
});

const crud = createCrudRouter({
  model: 'dailyPlan', entity: 'daily-plan',
  readPerm: 'production:read', writePerm: 'production:write',
  createSchema: planSchema, updateSchema: planSchema.partial(),
  searchField: 'title', dateField: 'planDate', filterFields: ['status', 'assigneeId'],
  requireProject: true, orderBy: { planDate: 'desc' },
  include: { assignee: { select: { id: true, fullName: true } }, wbsItem: { select: { id: true, code: true, name: true } } },
  validate: async (data, req: Request) => {
    if (!data.assigneeId) return;
    const eligible = await requisitionRaisers(req.user!.orgId, data.projectId ? String(data.projectId) : undefined);
    if (!eligible.some((u) => u.id === data.assigneeId)) {
      throw BadRequest('Assign the plan to someone who can raise requisitions on this project (for example a foreman or site engineer).');
    }
  },
  transform: (data, req) => {
    if (!('id' in data)) { data.createdBy = req.user!.id; if (!data.planDate) data.planDate = new Date(); }
    data.updatedBy = req.user!.id;
    return data;
  },
  afterChange: async (action, record, req) => {
    if (action === 'DELETE' || !record.assigneeId || record.assigneeId === req.user!.id) return;
    await notify({
      organizationId: req.user!.orgId, userId: String(record.assigneeId), type: 'GENERAL', severity: 'LOW',
      title: 'Daily plan assigned to you',
      message: `${record.title} on ${new Date(record.planDate as Date).toISOString().slice(0, 10)}. Raise the requisition for the materials you need.`,
      link: '/requisitions',
    });
  },
});

export const dailyPlanRouter = Router();
// Who can be assigned (must be registered before the generic /:id route).
dailyPlanRouter.get('/assignees', authenticate, requirePermission('production:read'), asyncHandler(async (req, res) => {
  return ok(res, await requisitionRaisers(req.user!.orgId, typeof req.query.projectId === 'string' ? req.query.projectId : undefined));
}));
dailyPlanRouter.use('/', crud);
