import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { NotFound, Conflict, BadRequest, Forbidden } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { isPlatformRole } from '../../auth/permissions';
import { assertAdminCoverage, ensureDefaultRoles } from '../roles/roles.service';
import { assertSeatAvailable } from '../platform/plans';
import { hashPassword } from '../../lib/password';
import { auditFromRequest } from '../../auth/audit';

const router = Router();
router.use(authenticate);

const selectPublic = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  roleId: true,
  roleDefinition: { select: { id: true, name: true, key: true } },
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

// LIST users in the caller's organization
router.get(
  '/',
  requirePermission('user:read'),
  asyncHandler(async (req, res) => {
    await ensureDefaultRoles(req.user!.orgId);
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.orgId },
      select: selectPublic,
      orderBy: { createdAt: 'asc' },
    });
    return ok(res, users);
  }),
);

/**
 * Roles a tenant admin may assign. PLATFORM_ADMIN is deliberately excluded:
 * this endpoint is reachable by any SYSTEM_ADMIN, so accepting it would let a
 * single company mint itself cross-tenant access. Only the platform console
 * (/api/platform, requirePlatformAdmin) can grant that role.
 */
const tenantRole = z
  .nativeEnum(Role)
  .refine((r) => !isPlatformRole(r), { message: 'This role can only be assigned from the platform console' });

const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
  // Either shape works: `roleId` picks one of the company's own roles (the
  // normal path now), `role` still accepts the built-in enum for API clients
  // written before tenant roles existed.
  roleId: z.string().optional(),
  role: tenantRole.optional(),
});

/**
 * Resolves the role to store on a user row. A tenant role is authoritative and
 * also stamps its `baseRole` onto the enum column, so the platform console and
 * notification targeting keep working off a single coarse label.
 */
async function resolveRoleAssignment(
  organizationId: string,
  input: { roleId?: string; role?: Role },
): Promise<{ roleId: string | null; role: Role } | null> {
  if (input.roleId) {
    const def = await prisma.roleDefinition.findFirst({
      where: { id: input.roleId, organizationId },
      select: { id: true, baseRole: true },
    });
    if (!def) throw BadRequest('Unknown role for this company');
    return { roleId: def.id, role: def.baseRole };
  }
  if (input.role) {
    // Enum given explicitly: mirror it onto the matching seeded role so the
    // account still shows up under a role in the admin screen.
    const def = await prisma.roleDefinition.findFirst({
      where: { organizationId, baseRole: input.role, isSystem: true },
      select: { id: true },
    });
    return { roleId: def?.id ?? null, role: input.role };
  }
  return null;
}

// INVITE a user into the caller's organization (admin only)
router.post(
  '/',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const body = inviteSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();
    const dup = await prisma.user.findFirst({
      where: { organizationId: req.user!.orgId, email },
    });
    if (dup) throw Conflict('A user with this email already exists in your organization');
    await assertSeatAvailable(req.user!.orgId);
    await ensureDefaultRoles(req.user!.orgId);

    let assigned = await resolveRoleAssignment(req.user!.orgId, body);
    if (!assigned) {
      // No role given — fall back to whichever role the company marked default.
      const fallback = await prisma.roleDefinition.findFirst({
        where: { organizationId: req.user!.orgId, isDefault: true },
        select: { id: true, baseRole: true },
      });
      assigned = fallback
        ? { roleId: fallback.id, role: fallback.baseRole }
        : { roleId: null, role: Role.SITE_ENGINEER };
    }

    const user = await prisma.user.create({
      data: {
        organizationId: req.user!.orgId,
        email,
        fullName: body.fullName,
        role: assigned.role,
        roleId: assigned.roleId,
        passwordHash: await hashPassword(body.password),
        // Vouched for by an admin — no self-service email verification needed.
        emailVerified: true,
      },
      select: selectPublic,
    });
    await auditFromRequest(req, 'CREATE', 'user', user.id, {
      newValues: { email, role: assigned.role, roleId: assigned.roleId },
    });
    return ok(res, user, 201);
  }),
);

const updateSchema = z.object({
  fullName: z.string().min(2).optional(),
  roleId: z.string().optional(),
  role: tenantRole.optional(),
  isActive: z.boolean().optional(),
});

// UPDATE a user (admin only)
router.put(
  '/:id',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
    });
    if (!existing) throw NotFound('User not found');
    // A platform admin may sit inside this org, but a tenant admin must not be
    // able to demote or block them out of the console.
    if (isPlatformRole(existing.role)) {
      throw Forbidden('This account is managed from the platform console');
    }

    // Guard against an admin locking themselves out of their own account.
    if (existing.id === req.user!.id) {
      if (body.isActive === false) throw BadRequest('You cannot deactivate your own account');
      if ((body.role && body.role !== existing.role) || (body.roleId && body.roleId !== existing.roleId)) {
        throw BadRequest('You cannot change your own role');
      }
    }

    const assigned = await resolveRoleAssignment(req.user!.orgId, body);
    // Moving someone off an administrating role, or blocking them, must not
    // leave the company with nobody who can manage users.
    if ((assigned && assigned.roleId !== existing.roleId) || body.isActive === false) {
      await assertAdminCoverage(req.user!.orgId, {
        roleId: assigned?.roleId ?? existing.roleId ?? '',
        losingUserId: existing.id,
      });
    }

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName: body.fullName,
        isActive: body.isActive,
        ...(assigned ? { role: assigned.role, roleId: assigned.roleId } : {}),
      },
      select: selectPublic,
    });
    await auditFromRequest(req, 'UPDATE', 'user', user.id, {
      oldValues: { role: existing.role, roleId: existing.roleId, isActive: existing.isActive },
      newValues: { ...body, ...(assigned ?? {}) },
    });
    return ok(res, user);
  }),
);

const resetPasswordSchema = z.object({
  password: z.string().min(8),
});

// RESET a user's password (admin only)
router.post(
  '/:id/reset-password',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const body = resetPasswordSchema.parse(req.body);
    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
      select: selectPublic,
    });
    if (!existing) throw NotFound('User not found');
    if (isPlatformRole(existing.role)) {
      throw Forbidden('This account is managed from the platform console');
    }

    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: await hashPassword(body.password) },
    });
    // Invalidate any active sessions for the affected user.
    await prisma.refreshToken.deleteMany({ where: { userId: existing.id } });
    await auditFromRequest(req, 'UPDATE', 'user', existing.id, {
      newValues: { passwordReset: true },
    });
    return ok(res, { id: existing.id });
  }),
);

export default router;
