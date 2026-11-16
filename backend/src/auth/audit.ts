import { Request } from 'express';
import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

interface AuditInput {
  organizationId: string;
  userId?: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Role the actor held at the time (name of the tenant role, else the built-in role). */
  role?: string | null;
  /** Why: required for cancellations/rejections, optional on edits. */
  reason?: string | null;
}

/**
 * Records an audit-trail entry. Best-effort: a logging failure must never break
 * the underlying business operation, so errors are swallowed (and surfaced to
 * the console) rather than propagated.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        oldValues: (input.oldValues as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        newValues: (input.newValues as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        role: input.role ?? null,
        reason: input.reason ? String(input.reason).slice(0, 2000) : null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to write audit log:', err);
  }
}

/** Convenience helper that pulls actor + request metadata from an Express req. */
export async function auditFromRequest(
  req: Request,
  action: AuditAction,
  entity: string,
  entityId?: string | null,
  changes?: { oldValues?: unknown; newValues?: unknown; reason?: string | null },
): Promise<void> {
  if (!req.user) return;
  await recordAudit({
    organizationId: req.user.orgId,
    userId: req.user.id,
    action,
    entity,
    entityId,
    oldValues: changes?.oldValues,
    newValues: changes?.newValues,
    reason: changes?.reason ?? null,
    role: req.user.roleName ?? req.user.role,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
  });
}
