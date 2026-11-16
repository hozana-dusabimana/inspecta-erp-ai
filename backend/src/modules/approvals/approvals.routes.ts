import { Router } from 'express';
import { z } from 'zod';
import { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { NotFound, Forbidden } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';
import { assertMakerChecker, makerCheckerBlock, clearAlerts } from '../../lib/maker-checker';

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
        refKey: `approval:${record.id}`,
      });
    }
  },
});

const inboxRouter = Router(); // mounted before the generic CRUD router so /inbox is not read as an :id

/** Approval level by value: who must sign. A single documented policy, shown in the inbox. */
export function approvalLevel(amount: number): { level: 1 | 2 | 3; approverRole: string } {
  if (amount >= 50_000_000) return { level: 3, approverRole: 'Director / Admin' };
  if (amount >= 5_000_000) return { level: 2, approverRole: 'Project Manager' };
  return { level: 1, approverRole: 'Site Engineer / Manager' };
}

// ── One inbox: everything awaiting a decision, wherever it was raised ──
inboxRouter.get('/inbox', authenticate, requirePermission('approval:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };
  const [requests, reports, prs, reqs, invoices, payments, wageRates, baselines, boqVersions, pendingPos, supplierPays] = await Promise.all([
    prisma.approvalRequest.findMany({ where: { ...scope, status: 'PENDING' }, include: { project: { select: { code: true, name: true } } } }),
    prisma.dailyReport.findMany({ where: { ...scope, status: 'SUBMITTED' }, include: { project: { select: { code: true, name: true } } } }),
    prisma.purchaseRequest.findMany({ where: { ...scope, status: 'SUBMITTED' } }),
    prisma.materialRequisition.findMany({ where: { ...scope, status: 'SUBMITTED' } }),
    prisma.invoice.findMany({ where: { ...scope, status: 'SUBMITTED' } }),
    prisma.payment.findMany({ where: { ...scope, approvalStatus: 'PENDING', cancelledAt: null } }),
    projectId ? Promise.resolve([]) : prisma.wageRate.findMany({ where: { organizationId: orgId, approvalStatus: 'PENDING' }, include: { trade: { select: { name: true } } } }),
    prisma.scheduleBaseline.findMany({ where: { ...scope, approvalStatus: 'PENDING' } }),
    prisma.boqVersion.findMany({ where: { ...scope, approvalStatus: 'PENDING' } }),
    prisma.purchaseOrder.findMany({ where: { ...scope, approvalStatus: 'PENDING', status: { not: 'CANCELLED' } }, include: { supplier: { select: { name: true } } } }),
    prisma.supplierPayment.findMany({ where: { ...scope, approvalStatus: 'PENDING', cancelledAt: null }, include: { invoice: { select: { number: true } } } }),
  ]);
  const projectIds = [...new Set([...prs, ...reqs, ...invoices, ...payments, ...baselines, ...boqVersions, ...pendingPos, ...supplierPays].map((r) => r.projectId).filter(Boolean) as string[])];
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true } });
  const pName = new Map(projects.map((p) => [p.id, `${p.code} — ${p.name}`]));
  const userIds = [...new Set([
    ...requests.map((r) => r.requestedById), ...reports.map((r) => r.preparedById),
    ...prs.map((r) => r.requestedById), ...reqs.map((r) => r.requestedById), ...invoices.map((r) => r.createdBy),
    ...payments.map((r) => r.createdBy), ...(wageRates as Array<{ createdBy: string | null }>).map((r) => r.createdBy), ...baselines.map((r) => r.createdBy), ...boqVersions.map((r) => r.createdBy), ...pendingPos.map((r) => r.createdBy), ...supplierPays.map((r) => r.createdBy),
  ].filter(Boolean) as string[])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
  const uName = new Map(users.map((u) => [u.id, u.fullName]));
  // decideUrl: where Approve/Reject post to (null = decide on the record's own page).
  const DECIDE: Record<string, string> = { approval: '/approvals', payment: '/finance/payments', 'wage-rate': '/hr/wage-rates', baseline: '/scheduling/baselines', 'boq-version': '/planning/boq-versions', 'purchase-order': '/procurement/purchase-orders', 'supplier-payment': '/procurement/supplier-payments' };
  const row = (type: string, id: string, ref: string, title: string, project: string | null, by: string | null | undefined, amount: number, date: Date, link: string, decideVia: string) => ({
    type, id, reference: ref, title, project, requestedBy: by ? uName.get(by) ?? null : null, requestedById: by ?? null, amount, date,
    ...approvalLevel(amount), link, decideVia, decideUrl: DECIDE[decideVia] ? `${DECIDE[decideVia]}/${id}` : null,
  });
  const items = [
    ...requests.map((r) => row(r.entityType.toUpperCase(), r.id, r.entityId ?? '', r.title, r.project ? `${r.project.code} — ${r.project.name}` : null, r.requestedById, Number(r.amount), r.createdAt, '/approvals', 'approval')),
    ...reports.map((r) => row('DAILY_REPORT', r.id, r.reportNumber, `Daily report ${r.reportNumber}`, r.project ? `${r.project.code} — ${r.project.name}` : null, r.preparedById, 0, r.reportDate, '/production', 'daily-report')),
    ...prs.map((r) => row('PURCHASE_REQUEST', r.id, r.number, r.title ?? r.number, r.projectId ? pName.get(r.projectId) ?? null : null, r.requestedById, Number(r.total), r.createdAt, '/procurement', 'purchase-request')),
    ...reqs.map((r) => row('REQUISITION', r.id, r.number, r.title ?? r.number, r.projectId ? pName.get(r.projectId) ?? null : null, r.requestedById, 0, r.createdAt, '/requisitions', 'requisition')),
    ...invoices.map((r) => row('INVOICE', r.id, r.number, r.description ?? `Invoice ${r.number}`, pName.get(r.projectId) ?? null, r.createdBy, Number(r.amount), r.createdAt, '/finance', 'invoice')),
    ...payments.map((r) => row('PAYMENT', r.id, r.reference, `Payment ${r.reference}`, pName.get(r.projectId) ?? null, r.createdBy, Number(r.amount), r.createdAt, '/finance', 'payment')),
    ...(wageRates as Array<{ id: string; amount: unknown; currency: string; rateType: string; createdBy: string | null; createdAt: Date; trade: { name: string } | null }>).map((r) => row('WAGE_RATE', r.id, r.trade?.name ?? '', `Wage rate ${r.trade?.name ?? ''}: ${Number(r.amount).toLocaleString()} ${r.currency} per ${r.rateType === 'HOURLY' ? 'hour' : 'day'}`, null, r.createdBy, 0, r.createdAt, '/hr', 'wage-rate')),
    ...baselines.map((r) => row('BASELINE', r.id, `v${r.versionNo}`, `Schedule baseline v${r.versionNo}: ${r.name}`, pName.get(r.projectId) ?? null, r.createdBy, 0, r.createdAt, '/scheduling', 'baseline')),
    ...boqVersions.map((r) => row('BUDGET', r.id, `v${r.versionNo}`, `BOQ budget v${r.versionNo}${r.label ? `: ${r.label}` : ''}`, pName.get(r.projectId) ?? null, r.createdBy, Number(r.totalBudget), r.createdAt, '/planning', 'boq-version')),
    ...pendingPos.map((r) => ({ ...row('PURCHASE_ORDER', r.id, r.number, `${r.number} to ${r.supplier.name} (above the order limit)`, r.projectId ? pName.get(r.projectId) ?? null : null, r.createdBy, Number(r.total), r.createdAt, '/procurement', 'purchase-order'), level: 3 as const, approverRole: 'CEO (company administrator)' })),
    ...supplierPays.map((r) => row('SUPPLIER_PAYMENT', r.id, r.reference, `Supplier payment ${r.reference} for ${r.invoice.number}`, r.projectId ? pName.get(r.projectId) ?? null : null, r.createdBy, Number(r.amount), r.createdAt, '/procurement', 'supplier-payment')),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  // Tell the screen up front whether THIS user may decide each item (no Approve button on your own request).
  const withRights = await Promise.all(items.map(async (i) => {
    const blockedReason = await makerCheckerBlock(req.user!, i.requestedById, 'request');
    const ceoOnly = i.decideVia === 'purchase-order' && req.user!.role !== 'SYSTEM_ADMIN' && !req.user!.isPlatformAdmin;
    const why = blockedReason ?? (ceoOnly ? 'Above the order limit: the CEO (company administrator) approves it.' : null);
    return { ...i, canDecide: !why && req.user!.permissions.includes('approval:write'), blockedReason: why };
  }));
  const byType: Record<string, number> = {};
  for (const i of items) byType[i.type] = (byType[i.type] ?? 0) + 1;
  return ok(res, { total: items.length, byType, items: withRights });
}));

const decisionSchema = z.object({ note: z.string().optional() });

async function decide(req: Request, status: 'APPROVED' | 'REJECTED') {
  const existing = await prisma.approvalRequest.findFirst({
    where: { id: req.params.id, organizationId: req.user!.orgId },
  });
  if (!existing) throw NotFound('Approval request not found');
  if (existing.status !== 'PENDING') throw Forbidden(`This request is already ${existing.status.toLowerCase()}.`);
  if (existing.requestedById && existing.requestedById === req.user!.id) throw Forbidden('You cannot decide a request you raised yourself.');
  await assertMakerChecker(req, existing.requestedById, 'request');
  const { note } = decisionSchema.parse(req.body ?? {});
  // A proposed change (e.g. a new wage) is applied only now, by the approver, and audited old -> new.
  if (status === 'APPROVED' && existing.entityType === 'WAGE_CHANGE' && existing.entityId && existing.payload) {
    const emp = await prisma.employee.findFirst({ where: { id: existing.entityId, organizationId: req.user!.orgId } });
    if (emp) {
      const p = existing.payload as Record<string, number | null>;
      const data: Record<string, unknown> = {};
      if ('dailyWage' in p) data.dailyWage = p.dailyWage;
      if ('grossMonthlySalary' in p) data.grossMonthlySalary = p.grossMonthlySalary;
      await prisma.employee.update({ where: { id: emp.id }, data: { ...data, updatedBy: req.user!.id } });
      await auditFromRequest(req, 'UPDATE', 'employee-wage', emp.id, {
        oldValues: { dailyWage: emp.dailyWage, grossMonthlySalary: emp.grossMonthlySalary }, newValues: data, reason: note ?? existing.title,
      });
    }
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: existing.id },
    data: { status, decidedById: req.user!.id, decisionNote: note ?? null, decidedAt: new Date() },
  });
  await auditFromRequest(req, status === 'APPROVED' ? 'APPROVE' : 'REJECT', 'approval-request', existing.id, {
    oldValues: { status: existing.status },
    newValues: { status },
    reason: note ?? null,
  });
  await clearAlerts(req.user!.orgId, `approval:${existing.id}`);
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

// Specific routes first, then the generic CRUD + decision routes.
const root = Router();
root.use(inboxRouter);
root.use(router);
export default root;
