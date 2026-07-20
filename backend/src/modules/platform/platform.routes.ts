import { Router, Request } from 'express';
import { z } from 'zod';
import { Prisma, Role, AuditAction, OrgStatus, OrgPlan, PaymentAccountType, SubscriptionRequestStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { sendTabularExport, exportFormat } from '../../lib/export';
import { BadRequest, NotFound, Forbidden, Conflict } from '../../lib/errors';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth';
import { recordAudit } from '../../auth/audit';
import { hashPassword } from '../../lib/password';
import { platformOverview } from './platform.service';
import { PLAN_DEFAULTS, PLAN_LABELS, usageFor } from './plans';
import { getPlatformSettings, updatePlatformSettings } from './settings';
import { notify } from '../notifications/notify';
import { projectWhere, projectSelect, projectTotals, deliveryWatchlist, financeOverview, adoptionReport } from './insights';
import { planPrices, addPeriod, trialEndFrom } from '../billing/billing.service';
import { ensureDefaultRoles, attachAdminRole } from '../roles/roles.service';

/**
 * The cross-tenant superadmin console. Every route here deliberately escapes the
 * `organizationId` scoping that the rest of the API enforces, so the whole
 * router sits behind `requirePlatformAdmin` — never a mere permission check.
 */
const router = Router();
router.use(authenticate, requirePlatformAdmin);

const EXPORT_CAP = 10_000; // matches the CRUD factory's export cap

/**
 * Audits a platform action against the tenant it AFFECTS, not against the
 * superadmin's own company — so a customer's audit trail shows "your company
 * was suspended" rather than the event vanishing into another org's log.
 */
function auditPlatform(
  req: Request,
  organizationId: string,
  action: AuditAction,
  entity: string,
  entityId: string | null,
  changes?: { oldValues?: unknown; newValues?: unknown },
) {
  return recordAudit({
    organizationId,
    userId: req.user!.id,
    action,
    entity,
    entityId,
    oldValues: changes?.oldValues,
    newValues: { ...(changes?.newValues as object), by: req.user!.email, viaPlatformConsole: true },
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  });
}

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
  plan: true,
  maxUsers: true,
  maxProjects: true,
  trialEndsAt: true,
  subscriptionEndsAt: true,
  billingExempt: true,
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
        suspendedReason: true, plan: true, maxUsers: true, maxProjects: true, createdAt: true,
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

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'org';
}

const provisionSchema = z.object({
  name: z.string().trim().min(2),
  country: z.string().trim().optional(),
  currency: z.string().trim().length(3).optional(),
  industry: z.string().trim().optional(),
  plan: z.nativeEnum(OrgPlan).optional(),
  adminFullName: z.string().trim().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
});

// PROVISION a tenant plus its first SYSTEM_ADMIN.
router.post(
  '/companies',
  asyncHandler(async (req, res) => {
    const body = provisionSchema.parse(req.body);
    const email = body.adminEmail.toLowerCase().trim();

    // Email uniqueness is per-org in the schema, but login resolves globally,
    // so a duplicate across tenants would make sign-in ambiguous.
    if (await prisma.user.findFirst({ where: { email }, select: { id: true } })) {
      throw Conflict('A user with this email already exists');
    }

    let slug = slugify(body.name);
    if (await prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const plan = body.plan ?? OrgPlan.TRIAL;
    const limits = PLAN_DEFAULTS[plan];
    const settings = await getPlatformSettings();
    const passwordHash = await hashPassword(body.adminPassword);

    const { org, admin } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: body.name,
          slug,
          country: body.country ?? null,
          industry: body.industry ?? null,
          currency: (body.currency ?? settings.defaultCurrency).toUpperCase(),
          timezone: settings.defaultTimezone,
          plan,
          maxUsers: limits.maxUsers,
          maxProjects: limits.maxProjects,
          // Provisioned tenants get the same trial clock as self-signup.
          trialEndsAt: trialEndFrom(),
        },
      });
      const admin = await tx.user.create({
        data: {
          organizationId: org.id,
          email,
          fullName: body.adminFullName,
          role: Role.SYSTEM_ADMIN,
          passwordHash,
          // Provisioned by a platform admin — no self-service verification needed.
          emailVerified: true,
        },
        select: { id: true, email: true, fullName: true, role: true },
      });
      return { org, admin };
    });

    // Give the new tenant its starter org chart and put its first admin on the
    // administrator role, so the Roles screen is usable from day one.
    await ensureDefaultRoles(org.id);
    await attachAdminRole(org.id, admin.id);

    await auditPlatform(req, org.id, AuditAction.CREATE, 'organization', org.id, {
      newValues: { name: org.name, slug: org.slug, plan, adminEmail: admin.email },
    });
    return ok(res, { ...org, admin }, 201);
  }),
);

const planSchema = z.object({
  plan: z.nativeEnum(OrgPlan),
  // Omit to take the plan's defaults; null means explicitly unlimited.
  maxUsers: z.number().int().min(0).nullable().optional(),
  maxProjects: z.number().int().min(0).nullable().optional(),
});

router.patch(
  '/companies/:id/plan',
  asyncHandler(async (req, res) => {
    const body = planSchema.parse(req.body);
    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) throw NotFound('Company not found');

    const defaults = PLAN_DEFAULTS[body.plan];
    const maxUsers = body.maxUsers === undefined ? defaults.maxUsers : body.maxUsers;
    const maxProjects = body.maxProjects === undefined ? defaults.maxProjects : body.maxProjects;

    // Refuse a limit the tenant is already over — it would not delete anything,
    // but it would silently put them in a permanently blocked state.
    const [users, projects] = await Promise.all([
      prisma.user.count({ where: { organizationId: org.id } }),
      prisma.project.count({ where: { organizationId: org.id } }),
    ]);
    if (maxUsers !== null && users > maxUsers) {
      throw BadRequest(`${org.name} already has ${users} users — the seat limit cannot be set below that.`);
    }
    if (maxProjects !== null && projects > maxProjects) {
      throw BadRequest(`${org.name} already has ${projects} projects — the project limit cannot be set below that.`);
    }

    const updated = await prisma.organization.update({
      where: { id: org.id },
      data: { plan: body.plan, maxUsers, maxProjects },
      select: companySelect,
    });

    await auditPlatform(req, org.id, AuditAction.UPDATE, 'organization', org.id, {
      oldValues: { plan: org.plan, maxUsers: org.maxUsers, maxProjects: org.maxProjects },
      newValues: { plan: body.plan, maxUsers, maxProjects },
    });

    // Tell the tenant their plan changed — it affects what they can create.
    await notify({
      organizationId: org.id,
      type: 'GENERAL',
      severity: 'MEDIUM',
      title: `Plan updated to ${PLAN_LABELS[body.plan]}`,
      message: `Your workspace is now on the ${PLAN_LABELS[body.plan]} plan (${maxUsers ?? 'unlimited'} users, ${maxProjects ?? 'unlimited'} projects).`,
    });

    return ok(res, updated);
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
    if (status === 'SUSPENDED' && org.id === req.user!.homeOrgId) {
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

    await auditPlatform(req, org.id, AuditAction.UPDATE, 'organization', org.id, {
      oldValues: { status: org.status },
      newValues: { status, reason: reason ?? null },
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

    await auditPlatform(req, user.organizationId, AuditAction.UPDATE, 'user', user.id, {
      oldValues: { isActive: user.isActive },
      newValues: { isActive, reason: reason ?? null },
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

    // The account's tenant role, if it has one, is what actually decides its
    // permissions — so move it onto the matching built-in role of its company.
    // Leaving a stale `roleId` behind would silently ignore this change.
    const tenantRole =
      role === Role.PLATFORM_ADMIN
        ? null
        : await prisma.roleDefinition.findFirst({
            where: { organizationId: user.organizationId, baseRole: role, isSystem: true },
            select: { id: true },
          });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role, roleId: tenantRole?.id ?? null },
      select: userSelect,
    });
    await auditPlatform(req, user.organizationId, AuditAction.UPDATE, 'user', user.id, {
      oldValues: { role: user.role, roleId: user.roleId },
      newValues: { role, roleId: tenantRole?.id ?? null },
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

    await auditPlatform(req, user.organizationId, AuditAction.UPDATE, 'user', user.id, {
      newValues: { passwordReset: true },
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

// ──────────────── Cross-tenant ERP: projects register ────────────────

router.get(
  '/projects/export',
  asyncHandler(async (req, res) => {
    const rows = await prisma.project.findMany({
      where: projectWhere(req.query as Record<string, unknown>),
      orderBy: { createdAt: 'desc' },
      take: EXPORT_CAP,
      select: projectSelect,
    });
    // Flatten the relations so the sheet gets plain columns.
    const flat = rows.map(({ organization, client, manager, ...p }) => ({
      company: organization.name,
      ...p,
      client: client?.name ?? '',
      manager: manager?.fullName ?? '',
    }));
    return sendTabularExport(res, flat, 'platform-projects', exportFormat(req.query.format));
  }),
);

router.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = pageParams(req.query as Record<string, unknown>);
    const where = projectWhere(req.query as Record<string, unknown>);
    const sortBy = (req.query.sortBy as string) ?? 'createdAt';
    const sortDir = (req.query.sortDir as string) === 'asc' ? 'asc' : 'desc';
    // Whitelisted so a caller cannot sort by an arbitrary column.
    const sortable = new Set(['createdAt', 'name', 'code', 'budget', 'progressPct', 'startDate', 'endDate']);
    const orderBy = { [sortable.has(sortBy) ? sortBy : 'createdAt']: sortDir };

    const [rows, total, totals] = await Promise.all([
      prisma.project.findMany({ where, select: projectSelect, orderBy, skip, take: pageSize }),
      prisma.project.count({ where }),
      projectTotals(where),
    ]);
    return res.json({ success: true, data: rows, meta: { page, pageSize, total, totals } });
  }),
);

// ──────────────── Cross-tenant ERP: watchlist / finance / adoption ────────────────

router.get('/watchlist', asyncHandler(async (_req, res) => ok(res, await deliveryWatchlist())));

router.get('/finance', asyncHandler(async (_req, res) => ok(res, await financeOverview())));

router.get(
  '/finance/export',
  asyncHandler(async (req, res) => {
    const { companies } = await financeOverview();
    return sendTabularExport(res, companies, 'platform-finance', exportFormat(req.query.format));
  }),
);

router.get('/adoption', asyncHandler(async (_req, res) => ok(res, await adoptionReport())));

router.get(
  '/adoption/export',
  asyncHandler(async (req, res) => {
    const { companies } = await adoptionReport();
    const flat = companies.map(({ modules, ...c }) => ({ ...c, ...modules }));
    return sendTabularExport(res, flat, 'platform-adoption', exportFormat(req.query.format));
  }),
);

// ─────────────────────── Plans & usage ──────────────────────────

router.get(
  '/plans',
  asyncHandler(async (_req, res) =>
    ok(res, {
      plans: (Object.keys(PLAN_DEFAULTS) as OrgPlan[]).map((plan) => ({
        plan,
        label: PLAN_LABELS[plan],
        ...PLAN_DEFAULTS[plan],
      })),
    }),
  ),
);

router.get(
  '/companies/:id/usage',
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!org) throw NotFound('Company not found');
    return ok(res, await usageFor(org.id));
  }),
);

// ─────────────────── Billing: pricing & payment accounts ───────────────────

router.get(
  '/pricing',
  asyncHandler(async (_req, res) => ok(res, await planPrices())),
);

const pricingSchema = z.object({
  prices: z.array(
    z.object({
      plan: z.nativeEnum(OrgPlan),
      monthlyPrice: z.number().min(0),
      annualPrice: z.number().min(0),
      currency: z.string().trim().length(3).optional(),
      description: z.string().trim().max(300).nullable().optional(),
      isPublic: z.boolean().optional(),
    }),
  ).min(1),
});

router.put(
  '/pricing',
  asyncHandler(async (req, res) => {
    const { prices } = pricingSchema.parse(req.body);
    await prisma.$transaction(
      prices.map((p) =>
        prisma.planPrice.upsert({
          where: { plan: p.plan },
          update: {
            monthlyPrice: p.monthlyPrice,
            annualPrice: p.annualPrice,
            currency: p.currency?.toUpperCase() ?? 'RWF',
            description: p.description ?? null,
            isPublic: p.isPublic ?? true,
          },
          create: {
            plan: p.plan,
            monthlyPrice: p.monthlyPrice,
            annualPrice: p.annualPrice,
            currency: p.currency?.toUpperCase() ?? 'RWF',
            description: p.description ?? null,
            isPublic: p.isPublic ?? true,
          },
        }),
      ),
    );
    await auditPlatform(req, req.user!.homeOrgId, AuditAction.UPDATE, 'plan-pricing', null, { newValues: { prices } });
    return ok(res, await planPrices());
  }),
);

const accountSchema = z.object({
  type: z.nativeEnum(PaymentAccountType),
  label: z.string().trim().min(2).max(60),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().min(3).max(60),
  bankName: z.string().trim().max(120).nullable().optional(),
  instructions: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

router.get(
  '/payment-accounts',
  asyncHandler(async (_req, res) =>
    ok(res, await prisma.paymentAccount.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })),
  ),
);

router.post(
  '/payment-accounts',
  asyncHandler(async (req, res) => {
    const body = accountSchema.parse(req.body);
    const created = await prisma.paymentAccount.create({ data: body });
    await auditPlatform(req, req.user!.homeOrgId, AuditAction.CREATE, 'payment-account', created.id, { newValues: body });
    return ok(res, created, 201);
  }),
);

router.put(
  '/payment-accounts/:id',
  asyncHandler(async (req, res) => {
    const body = accountSchema.partial().parse(req.body);
    const existing = await prisma.paymentAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) throw NotFound('Payment account not found');
    const updated = await prisma.paymentAccount.update({ where: { id: existing.id }, data: body });
    await auditPlatform(req, req.user!.homeOrgId, AuditAction.UPDATE, 'payment-account', existing.id, { newValues: body });
    return ok(res, updated);
  }),
);

router.delete(
  '/payment-accounts/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.paymentAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) throw NotFound('Payment account not found');
    await prisma.paymentAccount.delete({ where: { id: existing.id } });
    await auditPlatform(req, req.user!.homeOrgId, AuditAction.DELETE, 'payment-account', existing.id, {
      oldValues: { label: existing.label, accountNumber: existing.accountNumber },
    });
    return ok(res, { id: existing.id, deleted: true });
  }),
);

// ─────────────────── Billing: subscription requests ───────────────────

const subRequestInclude = {
  organization: { select: { id: true, name: true, slug: true, plan: true, trialEndsAt: true, subscriptionEndsAt: true, billingExempt: true } },
  paymentAccount: { select: { id: true, label: true, accountNumber: true } },
} as const;

router.get(
  '/subscription-requests',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = pageParams(req.query as Record<string, unknown>);
    const where: Prisma.SubscriptionRequestWhereInput = {};
    const status = (req.query.status as string)?.trim();
    if (status && status in SubscriptionRequestStatus) where.status = status as SubscriptionRequestStatus;
    const orgId = (req.query.organizationId as string)?.trim();
    if (orgId) where.organizationId = orgId;

    const [rows, total, pending] = await Promise.all([
      prisma.subscriptionRequest.findMany({ where, include: subRequestInclude, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      prisma.subscriptionRequest.count({ where }),
      prisma.subscriptionRequest.count({ where: { status: 'PENDING' } }),
    ]);
    return res.json({ success: true, data: rows, meta: { page, pageSize, total, pending } });
  }),
);

const approveSchema = z.object({
  note: z.string().trim().max(500).optional(),
  /** Override the granted end date; otherwise the period is added automatically. */
  activateUntil: z.string().datetime().optional(),
});

router.post(
  '/subscription-requests/:id/approve',
  asyncHandler(async (req, res) => {
    const body = approveSchema.parse(req.body);
    const request = await prisma.subscriptionRequest.findUnique({
      where: { id: req.params.id },
      include: { organization: true },
    });
    if (!request) throw NotFound('Payment request not found');
    if (request.status !== 'PENDING') throw BadRequest(`This request was already ${request.status.toLowerCase()}`);

    // Extend from whichever is later: now, or their existing paid-through date —
    // so paying early adds time rather than throwing the remainder away.
    const now = new Date();
    const current = request.organization.subscriptionEndsAt;
    const from = current && current > now ? current : now;
    const until = body.activateUntil ? new Date(body.activateUntil) : addPeriod(from, request.period);
    const limits = PLAN_DEFAULTS[request.plan];

    const [updatedRequest, org] = await prisma.$transaction([
      prisma.subscriptionRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          reviewedById: req.user!.id,
          reviewedAt: now,
          reviewNote: body.note ?? null,
          activatedFrom: from,
          activatedUntil: until,
        },
        include: subRequestInclude,
      }),
      prisma.organization.update({
        where: { id: request.organizationId },
        data: {
          plan: request.plan,
          maxUsers: limits.maxUsers,
          maxProjects: limits.maxProjects,
          subscriptionEndsAt: until,
        },
      }),
    ]);

    await auditPlatform(req, org.id, AuditAction.APPROVE, 'subscription-request', request.id, {
      oldValues: { plan: request.organization.plan, subscriptionEndsAt: current },
      newValues: { plan: request.plan, subscriptionEndsAt: until, amount: request.amount, reference: request.reference },
    });
    await notify({
      organizationId: org.id,
      type: 'GENERAL',
      severity: 'MEDIUM',
      title: 'Payment approved — subscription active',
      message: `Your ${PLAN_LABELS[request.plan]} plan is active until ${until.toDateString()}. Thank you.`,
      link: '/billing',
    });
    return ok(res, updatedRequest);
  }),
);

const rejectSchema = z.object({ note: z.string().trim().min(3).max(500) });

router.post(
  '/subscription-requests/:id/reject',
  asyncHandler(async (req, res) => {
    const { note } = rejectSchema.parse(req.body);
    const request = await prisma.subscriptionRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw NotFound('Payment request not found');
    if (request.status !== 'PENDING') throw BadRequest(`This request was already ${request.status.toLowerCase()}`);

    const updated = await prisma.subscriptionRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', reviewedById: req.user!.id, reviewedAt: new Date(), reviewNote: note },
      include: subRequestInclude,
    });

    await auditPlatform(req, request.organizationId, AuditAction.REJECT, 'subscription-request', request.id, {
      newValues: { reason: note, reference: request.reference },
    });
    await notify({
      organizationId: request.organizationId,
      type: 'GENERAL',
      severity: 'HIGH',
      title: 'Payment could not be verified',
      message: `We could not verify payment reference ${request.reference}. ${note}`,
      link: '/billing',
    });
    return ok(res, updated);
  }),
);

// Manual override — grant time, put a tenant on trial, or exempt them entirely.
const subscriptionSchema = z.object({
  trialEndsAt: z.string().datetime().nullable().optional(),
  subscriptionEndsAt: z.string().datetime().nullable().optional(),
  billingExempt: z.boolean().optional(),
});

router.patch(
  '/companies/:id/subscription',
  asyncHandler(async (req, res) => {
    const body = subscriptionSchema.parse(req.body);
    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) throw NotFound('Company not found');

    const updated = await prisma.organization.update({
      where: { id: org.id },
      data: {
        ...(body.trialEndsAt !== undefined ? { trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : null } : {}),
        ...(body.subscriptionEndsAt !== undefined ? { subscriptionEndsAt: body.subscriptionEndsAt ? new Date(body.subscriptionEndsAt) : null } : {}),
        ...(body.billingExempt !== undefined ? { billingExempt: body.billingExempt } : {}),
      },
      select: companySelect,
    });
    await auditPlatform(req, org.id, AuditAction.UPDATE, 'organization', org.id, {
      oldValues: { trialEndsAt: org.trialEndsAt, subscriptionEndsAt: org.subscriptionEndsAt, billingExempt: org.billingExempt },
      newValues: body,
    });
    return ok(res, updated);
  }),
);

// ─────────────────────── Platform settings ──────────────────────

const settingsSchema = z.object({
  allowSelfSignup: z.boolean().optional(),
  defaultCurrency: z.string().trim().length(3).optional(),
  defaultTimezone: z.string().trim().nullable().optional(),
  supportEmail: z.string().email().nullable().optional(),
  maintenanceMessage: z.string().trim().max(500).nullable().optional(),
});

router.get('/settings', asyncHandler(async (_req, res) => ok(res, await getPlatformSettings())));

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    const before = await getPlatformSettings();
    const updated = await updatePlatformSettings(
      { ...body, defaultCurrency: body.defaultCurrency?.toUpperCase() },
      req.user!.id,
    );
    await auditPlatform(req, req.user!.homeOrgId, AuditAction.UPDATE, 'platform-settings', updated.id, {
      oldValues: before,
      newValues: body,
    });
    return ok(res, updated);
  }),
);

// ───────────────────────── Announcements ────────────────────────

const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  message: z.string().trim().min(3).max(2000),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  // Omit to broadcast to every tenant.
  organizationId: z.string().trim().optional(),
});

router.post(
  '/announcements',
  asyncHandler(async (req, res) => {
    const body = announcementSchema.parse(req.body);

    const targets = body.organizationId
      ? await prisma.organization.findMany({ where: { id: body.organizationId }, select: { id: true, name: true } })
      : await prisma.organization.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } });
    if (targets.length === 0) throw NotFound('No matching company to announce to');

    // Sequential rather than Promise.all: notify() also fans out email, and a
    // broadcast across many tenants should not open one connection per org at once.
    for (const target of targets) {
      await notify({
        organizationId: target.id,
        type: 'GENERAL',
        severity: body.severity ?? 'MEDIUM',
        title: body.title,
        message: body.message,
      });
      await auditPlatform(req, target.id, AuditAction.CREATE, 'announcement', null, {
        newValues: { title: body.title, severity: body.severity ?? 'MEDIUM' },
      });
    }

    return ok(res, { delivered: targets.length, companies: targets.map((t) => t.name) }, 201);
  }),
);

export default router;
