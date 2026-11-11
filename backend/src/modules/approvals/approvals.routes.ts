import { z } from 'zod';
import { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { NotFound, Forbidden } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';

const createSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1),
  // Type is a fixed list, never free text; entityId links the request to the record it is about.
  entityType: z.enum(['PURCHASE_ORDER', 'INVOICE', 'VARIATION', 'PURCHASE_REQUEST', 'REQUISITION', 'DAILY_REPORT', 'PAYROLL', 'OTHER']).optional(),
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

/** Approval level by value: who must sign. A single documented policy, shown in the inbox. */
export function approvalLevel(amount: number): { level: 1 | 2 | 3; approverRole: string } {
  if (amount >= 50_000_000) return { level: 3, approverRole: 'Director / Admin' };
  if (amount >= 5_000_000) return { level: 2, approverRole: 'Project Manager' };
  return { level: 1, approverRole: 'Site Engineer / Manager' };
}

// ── One inbox: everything awaiting a decision, wherever it was raised ──
router.get('/inbox', requirePermission('approval:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };
  const [requests, reports, prs, reqs, invoices] = await Promise.all([
    prisma.approvalRequest.findMany({ where: { ...scope, status: 'PENDING' }, include: { project: { select: { code: true, name: true } } } }),
    prisma.dailyReport.findMany({ where: { ...scope, status: 'SUBMITTED' }, include: { project: { select: { code: true, name: true } } } }),
    prisma.purchaseRequest.findMany({ where: { ...scope, status: 'SUBMITTED' } }),
    prisma.materialRequisition.findMany({ where: { ...scope, status: 'SUBMITTED' } }),
    prisma.invoice.findMany({ where: { ...scope, status: 'SUBMITTED' } }),
  ]);
  const projectIds = [...new Set([...prs, ...reqs, ...invoices].map((r) => r.projectId).filter(Boolean) as string[])];
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true } });
  const pName = new Map(projects.map((p) => [p.id, `${p.code} — ${p.name}`]));
  const userIds = [...new Set([
    ...requests.map((r) => r.requestedById), ...reports.map((r) => r.preparedById),
    ...prs.map((r) => r.requestedById), ...reqs.map((r) => r.requestedById), ...invoices.map((r) => r.createdBy),
  ].filter(Boolean) as string[])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
  const uName = new Map(users.map((u) => [u.id, u.fullName]));
  const row = (type: string, id: string, ref: string, title: string, project: string | null, by: string | null | undefined, amount: number, date: Date, link: string, decideVia: string) => ({
    type, id, reference: ref, title, project, requestedBy: by ? uName.get(by) ?? null : null, amount, date,
    ...approvalLevel(amount), link, decideVia,
  });
  const items = [
    ...requests.map((r) => row(r.entityType.toUpperCase(), r.id, r.entityId ?? '', r.title, r.project ? `${r.project.code} — ${r.project.name}` : null, r.requestedById, Number(r.amount), r.createdAt, '/approvals', 'approval')),
    ...reports.map((r) => row('DAILY_REPORT', r.id, r.reportNumber, `Daily report ${r.reportNumber}`, r.project ? `${r.project.code} — ${r.project.name}` : null, r.preparedById, 0, r.reportDate, '/production', 'daily-report')),
    ...prs.map((r) => row('PURCHASE_REQUEST', r.id, r.number, r.title ?? r.number, r.projectId ? pName.get(r.projectId) ?? null : null, r.requestedById, Number(r.total), r.createdAt, '/procurement', 'purchase-request')),
    ...reqs.map((r) => row('REQUISITION', r.id, r.number, r.title ?? r.number, r.projectId ? pName.get(r.projectId) ?? null : null, r.requestedById, 0, r.createdAt, '/requisitions', 'requisition')),
    ...invoices.map((r) => row('INVOICE', r.id, r.number, r.description ?? `Invoice ${r.number}`, pName.get(r.projectId) ?? null, r.createdBy, Number(r.amount), r.createdAt, '/finance', 'invoice')),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const byType: Record<string, number> = {};
  for (const i of items) byType[i.type] = (byType[i.type] ?? 0) + 1;
  return ok(res, { total: items.length, byType, items });
}));

const decisionSchema = z.object({ note: z.string().optional() });

async function decide(req: Request, status: 'APPROVED' | 'REJECTED') {
  const existing = await prisma.approvalRequest.findFirst({
    where: { id: req.params.id, organizationId: req.user!.orgId },
  });
  if (!existing) throw NotFound('Approval request not found');
  if (existing.requestedById && existing.requestedById === req.user!.id) throw Forbidden('You cannot decide a request you raised yourself.');
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
