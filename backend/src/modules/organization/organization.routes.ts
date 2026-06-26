import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { NotFound } from '../../lib/errors';
import { authenticate, requireRole } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';

const router = Router();
router.use(authenticate);

const selectOrg = {
  id: true,
  name: true,
  slug: true,
  legalName: true,
  industry: true,
  country: true,
  timezone: true,
  currency: true,
  phone: true,
  address: true,
  logoUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

// GET the caller's organization profile + headcount summary.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.orgId },
      select: selectOrg,
    });
    if (!org) throw NotFound('Organization not found');

    const grouped = await prisma.user.groupBy({
      by: ['role'],
      where: { organizationId: req.user!.orgId },
      _count: { _all: true },
    });
    const usersByRole = Object.fromEntries(
      grouped.map((g) => [g.role, g._count._all]),
    ) as Record<Role, number>;
    const totalUsers = grouped.reduce((sum, g) => sum + g._count._all, 0);

    return ok(res, { ...org, totalUsers, usersByRole });
  }),
);

// Optional, nullable string field (empty string clears it).
const optStr = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v));

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: optStr,
  industry: optStr,
  country: optStr,
  timezone: optStr,
  currency: optStr.transform((v) => (v ? v.toUpperCase().slice(0, 8) : v)),
  phone: optStr,
  address: z.string().trim().max(400).optional().transform((v) => (v === undefined || v === '' ? null : v)),
  logoUrl: optStr,
});

// UPDATE company settings (SYSTEM_ADMIN only).
router.put(
  '/',
  requireRole(Role.SYSTEM_ADMIN),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const existing = await prisma.organization.findUnique({
      where: { id: req.user!.orgId },
      select: selectOrg,
    });
    if (!existing) throw NotFound('Organization not found');

    const org = await prisma.organization.update({
      where: { id: req.user!.orgId },
      data: body,
      select: selectOrg,
    });
    await auditFromRequest(req, 'UPDATE', 'organization', org.id, {
      oldValues: existing,
      newValues: body,
    });
    return ok(res, org);
  }),
);

export default router;
