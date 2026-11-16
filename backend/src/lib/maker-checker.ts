import { Request, Router } from 'express';
import { z } from 'zod';
import { prisma } from './prisma';
import { asyncHandler, ok } from './http';
import { Forbidden, NotFound, Conflict, BadRequest } from './errors';
import { requirePermission } from '../middleware/auth';
import { auditFromRequest } from '../auth/audit';
import { Permission } from '../auth/permissions';
import { notify } from '../modules/notifications/notify';

/**
 * MAKER-CHECKER (T2-02). The person who creates a record cannot approve it, and
 * the approver must hold a different role. Used for payments, wage rates and
 * wage changes, schedule baselines, BOQ budget versions, approval requests,
 * daily reports, manual cost cancellation and NCR closure.
 */

interface Actor { id: string; role: string; roleId?: string | null; roleName?: string | null }

const roleKey = (u: { role: string; roleId?: string | null }) => u.roleId ?? u.role;
const roleLabel = (u: { role: string; roleName?: string | null }) => u.roleName ?? u.role.replace(/_/g, ' ').toLowerCase();

/** Why `checker` may not decide something `makerId` created, or null when they may. */
export async function makerCheckerBlock(checker: Actor, makerId: string | null | undefined, what: string): Promise<string | null> {
  if (!makerId) return null; // created by the system: any authorised approver may decide
  if (makerId === checker.id) return `You created this ${what}. A different person must approve it.`;
  const maker = await prisma.user.findUnique({ where: { id: makerId }, select: { role: true, roleId: true, roleDefinition: { select: { name: true } } } });
  if (!maker) return null;
  if (roleKey(maker) === roleKey(checker)) {
    return `The approver must hold a different role from the person who created this ${what} (both are ${roleLabel({ role: maker.role, roleName: maker.roleDefinition?.name })}).`;
  }
  return null;
}

/** Throws a clear 403 when the current user may not approve what `makerId` created. */
export async function assertMakerChecker(req: Request, makerId: string | null | undefined, what: string): Promise<void> {
  const why = await makerCheckerBlock(req.user! as Actor, makerId, what);
  if (why) {
    await auditFromRequest(req, 'DENIED', what.replace(/\s+/g, '-'), req.params.id ?? null, { newValues: { reason: why, path: req.originalUrl } });
    throw Forbidden(why);
  }
}

/** Remove every open alert about a record once it is decided (the "awaiting approval" item must disappear). */
export async function clearAlerts(orgId: string, refKey: string): Promise<number> {
  const r = await prisma.notification.deleteMany({ where: { organizationId: orgId, refKey } });
  return r.count;
}

export interface ApprovalRouteOptions {
  /** Prisma model accessor with approvalStatus/approvedById/approvedAt/decisionNote columns. */
  model: string;
  /** Audit entity + alert key prefix, e.g. "payment". */
  entity: string;
  /** Human label used in messages, e.g. "payment". */
  label: string;
  /** Field on the record holding the creator's user id. */
  makerField: string;
  perm?: Permission;
  /** Extra work after an approval (inside nothing: keep it idempotent). */
  onDecided?: (record: Record<string, unknown>, status: 'APPROVED' | 'REJECTED', req: Request) => Promise<void>;
}

/** Adds POST /:id/approve and /:id/reject to a router, enforcing maker-checker. */
export function addApprovalRoutes(router: Router, o: ApprovalRouteOptions) {
  const decide = (status: 'APPROVED' | 'REJECTED') => asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});
    if (status === 'REJECTED' && !note?.trim()) throw BadRequest('Give a reason for rejecting.');
    const delegate = (prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<Record<string, unknown> | null>; update: (a: unknown) => Promise<Record<string, unknown>> }>)[o.model];
    const rec = await delegate.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId } });
    if (!rec) throw NotFound(`${o.label} not found`);
    if (rec.cancelledAt) throw Conflict(`This ${o.label} is cancelled.`);
    if (rec.approvalStatus !== 'PENDING') throw Conflict(`This ${o.label} is already ${String(rec.approvalStatus).toLowerCase()}.`);
    await assertMakerChecker(req, rec[o.makerField] as string | null, o.label);
    const updated = await delegate.update({
      where: { id: rec.id },
      data: { approvalStatus: status, approvedById: req.user!.id, approvedAt: new Date(), decisionNote: note ?? null },
    });
    await auditFromRequest(req, status === 'APPROVED' ? 'APPROVE' : 'REJECT', o.entity, String(rec.id), {
      oldValues: { approvalStatus: rec.approvalStatus }, newValues: { approvalStatus: status }, reason: note,
    });
    await clearAlerts(req.user!.orgId, `${o.entity}:${rec.id}`);
    if (o.onDecided) await o.onDecided(updated, status, req);
    return ok(res, updated);
  });
  router.post('/:id/approve', requirePermission(o.perm ?? 'approval:write'), decide('APPROVED'));
  router.post('/:id/reject', requirePermission(o.perm ?? 'approval:write'), decide('REJECTED'));
}

/** Raise the "awaiting approval" alert for a record, keyed so the decision clears it. */
export async function alertAwaitingApproval(orgId: string, entity: string, id: string, title: string, message: string, link: string) {
  await notify({ organizationId: orgId, type: 'APPROVAL', severity: 'MEDIUM', title, message, link, refKey: `${entity}:${id}` }).catch(() => undefined);
}
