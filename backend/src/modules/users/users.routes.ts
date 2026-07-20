import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { NotFound, Conflict, BadRequest, Forbidden } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { isPlatformRole } from '../../auth/permissions';
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
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

// LIST users in the caller's organization
router.get(
  '/',
  requirePermission('user:read'),
  asyncHandler(async (req, res) => {
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
  role: tenantRole,
});

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

    const user = await prisma.user.create({
      data: {
        organizationId: req.user!.orgId,
        email,
        fullName: body.fullName,
        role: body.role,
        passwordHash: await hashPassword(body.password),
        // Vouched for by an admin — no self-service email verification needed.
        emailVerified: true,
      },
      select: selectPublic,
    });
    await auditFromRequest(req, 'CREATE', 'user', user.id, { newValues: { email, role: body.role } });
    return ok(res, user, 201);
  }),
);

const updateSchema = z.object({
  fullName: z.string().min(2).optional(),
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
      if (body.role && body.role !== existing.role) {
        throw BadRequest('You cannot change your own role');
      }
    }

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: body,
      select: selectPublic,
    });
    await auditFromRequest(req, 'UPDATE', 'user', user.id, {
      oldValues: { role: existing.role, isActive: existing.isActive },
      newValues: body,
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
