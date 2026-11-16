import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { evidenceRules, EVIDENCE_MODULES } from '../../lib/evidence';
import { asyncHandler, ok } from '../../lib/http';
import { NotFound } from '../../lib/errors';
import { authenticate, requireRole, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';

import { usageFor } from '../platform/plans';

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
  tinNumber: true,
  workingDaysPerWeek: true,
  payrollEnabled: true,
  status: true,
  plan: true,
  maxUsers: true,
  maxProjects: true,
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
    // So a company admin can see their own plan usage without the console.
    const usage = await usageFor(req.user!.orgId);

    return ok(res, { ...org, totalUsers, usersByRole, usage });
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
  // currency is NOT NULL — leave unchanged when blank (never set to null).
  currency: z.string().trim().max(8).optional().transform((v) => (v ? v.toUpperCase() : undefined)),
  phone: optStr,
  address: z.string().trim().max(400).optional().transform((v) => (v === undefined || v === '' ? null : v)),
  logoUrl: optStr,
  tinNumber: optStr,
  workingDaysPerWeek: z.number().int().min(1).max(7).optional(),
  // Payroll stays off until the company admin switches it on.
  payrollEnabled: z.boolean().optional(),
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

// Evidence rules and the daily report cut-off (T2-09, T2-03). Everyone may read them (forms need
// to know what is required); only the System Admin changes them.
router.get('/evidence-rules', asyncHandler(async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.user!.orgId }, select: { dailyReportCutoff: true, poApprovalLimit: true } });
  return ok(res, { rules: await evidenceRules(req.user!.orgId), labels: EVIDENCE_MODULES, dailyReportCutoff: org?.dailyReportCutoff ?? '18:00', poApprovalLimit: Number(org?.poApprovalLimit ?? 10_000_000) });
}));
router.put('/evidence-rules', requirePermission('user:write'), asyncHandler(async (req, res) => {
  const body = z.object({
    rules: z.record(z.boolean()).optional(),
    poApprovalLimit: z.number().positive().optional(),
    dailyReportCutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Cut-off must be HH:MM').optional(),
  }).parse(req.body);
  const before = await prisma.organization.findUnique({ where: { id: req.user!.orgId }, select: { evidenceRules: true, dailyReportCutoff: true } });
  const rules = { ...(await evidenceRules(req.user!.orgId)) } as Record<string, boolean>;
  for (const [k, v] of Object.entries(body.rules ?? {})) if (k in EVIDENCE_MODULES) rules[k] = v;
  const org = await prisma.organization.update({
    where: { id: req.user!.orgId },
    data: { evidenceRules: rules, ...(body.dailyReportCutoff ? { dailyReportCutoff: body.dailyReportCutoff } : {}), ...(body.poApprovalLimit ? { poApprovalLimit: body.poApprovalLimit } : {}) },
    select: { evidenceRules: true, dailyReportCutoff: true, poApprovalLimit: true },
  });
  await auditFromRequest(req, 'UPDATE', 'evidence-rules', req.user!.orgId, { oldValues: before, newValues: org });
  return ok(res, { rules: org.evidenceRules, labels: EVIDENCE_MODULES, dailyReportCutoff: org.dailyReportCutoff, poApprovalLimit: Number(org.poApprovalLimit) });
}));

export default router;
