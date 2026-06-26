import { z } from 'zod';
import { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { NotFound } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';

const createSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  amount: z.number().nonnegative().optional(),
});

const router = createCrudRouter({
  model: 'approvalRequest',
  entity: 'approval-request',
  readPerm: 'approval:read',
  writePerm: 'approval:write',
  createSchema,
  updateSchema: createSchema.partial(),
  searchField: 'title',
  include: { project: { select: { id: true, name: true } } },
  orderBy: { createdAt: 'desc' },
  transform: (data, req: Request) => {
    if (!data.requestedById && req.user) data.requestedById = req.user.id;
    return data;
  },
  afterChange: async (action, record, req) => {
    if (action === 'CREATE') {
      await notify({
        organizationId: req.user!.orgId,
        type: 'APPROVAL',
        severity: 'MEDIUM',
        title: 'Approval requested',
        message: `${record.title} is awaiting approval${record.amount ? ` (${Number(record.amount).toLocaleString()})` : ''}.`,
        link: '/approvals',
      });
    }
  },
});

const decisionSchema = z.object({ note: z.string().optional() });

async function decide(req: Request, status: 'APPROVED' | 'REJECTED') {
  const existing = await prisma.approvalRequest.findFirst({
    where: { id: req.params.id, organizationId: req.user!.orgId },
  });
  if (!existing) throw NotFound('Approval request not found');
  const { note } = decisionSchema.parse(req.body ?? {});

  const updated = await prisma.approvalRequest.update({
    where: { id: existing.id },
    data: { status, decidedById: req.user!.id, decisionNote: note ?? null, decidedAt: new Date() },
  });
  await auditFromRequest(req, status === 'APPROVED' ? 'APPROVE' : 'REJECT', 'approval-request', existing.id, {
    oldValues: { status: existing.status },
    newValues: { status },
  });
  await notify({
    organizationId: req.user!.orgId,
    userId: existing.requestedById,
    type: 'APPROVAL',
    severity: status === 'REJECTED' ? 'HIGH' : 'LOW',
    title: `Request ${status.toLowerCase()}`,
    message: `"${existing.title}" was ${status.toLowerCase()}${note ? `: ${note}` : ''}.`,
    link: '/approvals',
  });
  return updated;
}

router.post(
  '/:id/approve',
  requirePermission('approval:write'),
  asyncHandler(async (req, res) => ok(res, await decide(req, 'APPROVED'))),
);

router.post(
  '/:id/reject',
  requirePermission('approval:write'),
  asyncHandler(async (req, res) => ok(res, await decide(req, 'REJECTED'))),
);

export default router;
