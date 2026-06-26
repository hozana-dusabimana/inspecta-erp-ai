import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { NotFound, Conflict, BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
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

const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
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

    const user = await prisma.user.create({
      data: {
        organizationId: req.user!.orgId,
        email,
        fullName: body.fullName,
        role: body.role,
        passwordHash: await hashPassword(body.password),
      },
      select: selectPublic,
    });
    await auditFromRequest(req, 'CREATE', 'user', user.id, { newValues: { email, role: body.role } });
    return ok(res, user, 201);
  }),
);

const updateSchema = z.object({
  fullName: z.string().min(2).optional(),
  role: z.nativeEnum(Role).optional(),
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
