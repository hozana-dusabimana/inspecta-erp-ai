import { Router } from 'express';
import { z } from 'zod';
import { Prisma, Role, AuditAction, OrgStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { sendTabularExport, exportFormat } from '../../lib/export';
import { BadRequest, NotFound, Forbidden } from '../../lib/errors';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { hashPassword } from '../../lib/password';
import { platformOverview } from './platform.service';

/**
 * The cross-tenant superadmin console. Every route here deliberately escapes the
 * `organizationId` scoping that the rest of the API enforces, so the whole
 * router sits behind `requirePlatformAdmin` — never a mere permission check.
 */
const router = Router();
router.use(authenticate, requirePlatformAdmin);

const EXPORT_CAP = 10_000; // matches the CRUD factory's export cap

function pageParams(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? 25)));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/** Inclusive `createdAt` range from `?dateFrom` / `?dateTo` (yyyy-mm-dd or ISO). */
function dateRange(query: Record<string, unknown>): Prisma.DateTimeFilter | undefined {
  const from = query.dateFrom as string | undefined;
  const to = query.dateTo as string | undefined;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = new Date(from);
  if (to) {
    const end = new Date(to);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) end.setUTCHours(23, 59, 59, 999);
    range.lte = end;
  }
  return Object.keys(range).length ? range : undefined;
}

// ─────────────────────────── Overview ───────────────────────────

router.get('/overview', asyncHandler(async (_req, res) => ok(res, await platformOverview())));

// ─────────────────────────── Companies ──────────────────────────

function companyWhere(query: Record<string, unknown>): Prisma.OrganizationWhereInput {
  const where: Prisma.OrganizationWhereInput = {};
  const search = (query.search as string)?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
      { legalName: { contains: search, mode: 'insensitive' } },
      { tinNumber: { contains: search, mode: 'insensitive' } },
    ];
  }
  const status = (query.status as string)?.trim();
  if (status === 'ACTIVE' || status === 'SUSPENDED') where.status = status;
  const country = (query.country as string)?.trim();
  if (country) where.country = country;
  const created = dateRange(query);
  if (created) where.createdAt = created;
  return where;
}

const companySelect = {
  id: true,
  name: true,
  slug: true,
  legalName: true,
  industry: true,
  country: true,
  currency: true,
  phone: true,
  tinNumber: true,
  status: true,
  suspendedAt: true,
  suspendedReason: true,
  createdAt: true,
  _count: { select: { users: true, projects: true, clients: true, contracts: true } },
} satisfies Prisma.OrganizationSelect;

router.get(
  '/companies/export',
  asyncHandler(async (req, res) => {
    const rows = await prisma.organization.findMany({
      where: companyWhere(req.query as Record<string, unknown>),
      orderBy: { createdAt: 'desc' },
      take: EXPORT_CAP,
      select: {
        name: true, slug: true, legalName: true, industry: true, country: true,
        currency: true, tinNumber: true, status: true, suspendedAt: true,
        suspendedReason: true, createdAt: true,
      },
    });
    return sendTabularExport(res, rows, 'companies', exportFormat(req.query.format));
  }),
);

router.get(
  '/companies',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = pageParams(req.query as Record<string, unknown>);
    const where = companyWhere(req.query as Record<string, unknown>);
    const [rows, total] = await Promise.all([
      prisma.organization.findMany({ where, select: companySelect, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      prisma.organization.count({ where }),
    ]);
    return paginated(res, rows, { page, pageSize, total });
  }),
);

router.get(
  '/companies/:id',
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: companySelect });
    if (!org) throw NotFound('Company not found');

    const [users, recentActivity, projects] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId: org.id },
        select: { id: true, fullName: true, email: true, role: true, isActive: true, emailVerified: true, lastLoginAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.auditLog.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { user: { select: { id: true, fullName: true, email: true } } },
      }),
      prisma.project.findMany({
        where: { organizationId: org.id },
        select: { id: true, code: true, name: true, status: true, health: true, budget: true, progressPct: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return ok(res, { ...org, users, projects, recentActivity });
  }),
);

const statusSchema = z.object({
  status: z.nativeEnum(OrgStatus),
  reason: z.string().trim().max(500).optional(),
});

router.patch(
  '/companies/:id/status',
  asyncHandler(async (req, res) => {
    const { status, reason } = statusSchema.parse(req.body);
    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) throw NotFound('Company not found');

    // Guard rail: suspending your own tenant would lock you out of the console.
    if (status === 'SUSPENDED' && org.id === req.user!.orgId) {
      throw Forbidden('You cannot suspend the company your own account belongs to');
    }
    if (status === 'SUSPENDED' && !reason) {
      throw BadRequest('A reason is required when suspending a company');
    }

    const updated = await prisma.organization.update({
      where: { id: org.id },
      data:
        status === 'SUSPENDED'
          ? { status, suspendedAt: new Date(), suspendedReason: reason ?? null, suspendedById: req.user!.id }
          : { status, suspendedAt: null, suspendedReason: null, suspendedById: null },
      select: companySelect,
    });

    // Kill every live session in the tenant so the suspension bites right away
    // (the per-request check already blocks them; this stops silent refreshes).
    if (status === 'SUSPENDED') {
      await prisma.refreshToken.updateMany({
        where: { revokedAt: null, user: { organizationId: org.id, role: { not: Role.PLATFORM_ADMIN } } },
        data: { revokedAt: new Date() },
      });
    }

    await auditFromRequest(req, AuditAction.UPDATE, 'organization', org.id, {
      oldValues: { status: org.status },
      newValues: { status, reason: reason ?? null, by: req.user!.email },
    });
    return ok(res, updated);
  }),
);

// ───────────────────────── Cross-org users ──────────────────────

function userWhere(query: Record<string, unknown>): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  const search = (query.search as string)?.trim();
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  const orgId = (query.organizationId as string)?.trim();
  if (orgId) where.organizationId = orgId;
  const role = (query.role as string)?.trim();
  if (role && role in Role) where.role = role as Role;
  const status = (query.status as string)?.trim();
  if (status === 'active') where.isActive = true;
  if (status === 'blocked') where.isActive = false;
  const created = dateRange(query);
  if (created) where.createdAt = created;
  return where;
}

const userSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  isActive: true,
  emailVerified: true,
  lastLoginAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true, slug: true, status: true } },
} satisfies Prisma.UserSelect;

router.get(
  '/users/export',
  asyncHandler(async (req, res) => {
    const rows = await prisma.user.findMany({
      where: userWhere(req.query as Record<string, unknown>),
      orderBy: { createdAt: 'desc' },
      take: EXPORT_CAP,
      select: {
        fullName: true, email: true, role: true, isActive: true, emailVerified: true,
        lastLoginAt: true, createdAt: true,
        organization: { select: { name: true } },
      },
    });
    // Flatten the relation so the sheet gets a plain "company" column.
    const flat = rows.map(({ organization, ...u }) => ({ company: organization.name, ...u }));
    return sendTabularExport(res, flat, 'platform-users', exportFormat(req.query.format));
  }),
);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = pageParams(req.query as Record<string, unknown>);
    const where = userWhere(req.query as Record<string, unknown>);
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      prisma.user.count({ where }),
    ]);
    return paginated(res, rows, { page, pageSize, total });
  }),
);

/** Loads a user for mutation and refuses self-targeting (lockout protection). */
async function targetUser(id: string, actorId: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw NotFound('User not found');
  if (user.id === actorId) throw Forbidden('You cannot perform this action on your own account');
  return user;
}

const blockSchema = z.object({ isActive: z.boolean(), reason: z.string().trim().max(500).optional() });

router.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const { isActive, reason } = blockSchema.parse(req.body);
    const user = await targetUser(req.params.id, req.user!.id);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive },
      select: userSelect,
    });

    // Blocking must end existing sessions, not just future logins.
    if (!isActive) {
      await prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await auditFromRequest(req, AuditAction.UPDATE, 'user', user.id, {
      oldValues: { isActive: user.isActive },
      newValues: { isActive, reason: reason ?? null, by: req.user!.email },
    });
    return ok(res, updated);
  }),
);

const roleSchema = z.object({ role: z.nativeEnum(Role) });

router.patch(
  '/users/:id/role',
  asyncHandler(async (req, res) => {
    const { role } = roleSchema.parse(req.body);
    const user = await targetUser(req.params.id, req.user!.id);

    // Never leave the platform without an administrator.
    if (user.role === Role.PLATFORM_ADMIN && role !== Role.PLATFORM_ADMIN) {
      const remaining = await prisma.user.count({
        where: { role: Role.PLATFORM_ADMIN, isActive: true, id: { not: user.id } },
      });
      if (remaining === 0) throw Forbidden('Cannot demote the last active platform administrator');
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data: { role }, select: userSelect });
    await auditFromRequest(req, AuditAction.UPDATE, 'user', user.id, {
      oldValues: { role: user.role },
      newValues: { role, by: req.user!.email },
    });
    return ok(res, updated);
  }),
);

const resetSchema = z.object({ password: z.string().min(8) });

router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { password } = resetSchema.parse(req.body);
    const user = await targetUser(req.params.id, req.user!.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
    // Force a fresh sign-in everywhere with the new credentials.
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    await auditFromRequest(req, AuditAction.UPDATE, 'user', user.id, {
      newValues: { passwordReset: true, by: req.user!.email },
    });
    return ok(res, { id: user.id, reset: true });
  }),
);

// ─────────────────────── Cross-org audit trail ──────────────────

function auditWhere(query: Record<string, unknown>): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  const orgId = (query.organizationId as string)?.trim();
  if (orgId) where.organizationId = orgId;
  const action = (query.action as string)?.trim();
  if (action && action in AuditAction) where.action = action as AuditAction;
  const entity = (query.entity as string)?.trim();
  if (entity) where.entity = entity;
  const created = dateRange(query);
  if (created) where.createdAt = created;
  return where;
}

router.get(
  '/audit/export',
  asyncHandler(async (req, res) => {
    const rows = await prisma.auditLog.findMany({
      where: auditWhere(req.query as Record<string, unknown>),
      orderBy: { createdAt: 'desc' },
      take: EXPORT_CAP,
      select: {
        createdAt: true, action: true, entity: true, entityId: true, ipAddress: true,
        organization: { select: { name: true } },
        user: { select: { email: true } },
      },
    });
    const flat = rows.map(({ organization, user, ...a }) => ({
      company: organization.name,
      actor: user?.email ?? '(deleted user)',
      ...a,
    }));
    return sendTabularExport(res, flat, 'platform-audit', exportFormat(req.query.format));
  }),
);

router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = pageParams(req.query as Record<string, unknown>);
    const where = auditWhere(req.query as Record<string, unknown>);
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          organization: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return paginated(res, rows, { page, pageSize, total });
  }),
);

export default router;
