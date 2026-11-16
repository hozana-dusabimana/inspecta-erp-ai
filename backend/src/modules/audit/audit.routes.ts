import { Router } from 'express';
import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, paginated, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';

/**
 * Audit trail (T2-01). Read-only by design: there is no route to change or
 * delete a row, and the database itself refuses it (trigger audit_logs_append_only).
 */
const router = Router();
router.use(authenticate);

// Bookkeeping columns that change on every write and say nothing about the business change.
const NOISE = new Set(['updatedAt', 'updatedBy', 'createdAt', 'organizationId', 'id']);

/** Decimals arrive as strings ("30.000") and as numbers (30): compare them as numbers. */
const norm = (v: unknown): string => {
  if (v == null) return 'null';
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()))) return `n:${Number(v)}`;
  return JSON.stringify(v);
};

/** Field-level changes for an UPDATE: [{ field, from, to }] for every value that actually moved. */
export function diff(oldValues: unknown, newValues: unknown): Array<{ field: string; from: unknown; to: unknown }> {
  if (!oldValues || !newValues || typeof oldValues !== 'object' || typeof newValues !== 'object') return [];
  const a = oldValues as Record<string, unknown>;
  const b = newValues as Record<string, unknown>;
  const out: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (NOISE.has(k)) continue;
    const x = a[k] ?? null;
    const y = b[k] ?? null;
    if (typeof y === 'object' && y !== null && !Array.isArray(y)) continue; // nested relations
    if (norm(x) !== norm(y)) out.push({ field: k, from: x, to: y });
  }
  return out;
}

const ACTIONS = new Set(Object.values(AuditAction));

function buildWhere(q: Record<string, unknown>, orgId: string): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = { organizationId: orgId };
  const s = (k: string) => (typeof q[k] === 'string' && (q[k] as string).trim() ? (q[k] as string).trim() : undefined);
  if (s('entity')) where.entity = s('entity');
  if (s('action') && ACTIONS.has(s('action') as AuditAction)) where.action = s('action') as AuditAction;
  if (s('userId')) where.userId = s('userId');
  if (s('recordId')) where.entityId = s('recordId');
  const from = s('dateFrom');
  const to = s('dateTo');
  if (from || to) {
    const end = to ? new Date(to) : undefined;
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(to!)) end.setUTCHours(23, 59, 59, 999);
    where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(end ? { lte: end } : {}) };
  }
  const text = s('q');
  if (text) {
    where.OR = [
      { entity: { contains: text, mode: 'insensitive' } },
      { entityId: { contains: text } },
      { reason: { contains: text, mode: 'insensitive' } },
      { role: { contains: text, mode: 'insensitive' } },
      { user: { fullName: { contains: text, mode: 'insensitive' } } },
      { user: { email: { contains: text, mode: 'insensitive' } } },
    ];
  }
  return where;
}

// LIST audit-trail entries for the caller's organization (searchable).
router.get(
  '/',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 30)));
    const where = buildWhere(req.query as Record<string, unknown>, req.user!.orgId);
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, fullName: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    const data = rows.map((r) => ({ ...r, changes: r.action === 'UPDATE' ? diff(r.oldValues, r.newValues) : [] }));
    return paginated(res, data, { page, pageSize, total });
  }),
);

// Filter options for the Audit page (entities and people that appear in the log).
router.get(
  '/facets',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const [entities, users] = await Promise.all([
      prisma.auditLog.groupBy({ by: ['entity'], where: { organizationId: orgId }, _count: { _all: true }, orderBy: { entity: 'asc' } }),
      prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
    ]);
    return ok(res, { entities: entities.map((e) => ({ entity: e.entity, count: e._count._all })), users, actions: [...ACTIONS] });
  }),
);

export default router;
