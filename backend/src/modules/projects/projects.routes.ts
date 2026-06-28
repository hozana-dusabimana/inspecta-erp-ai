import { Router } from 'express';
import { z } from 'zod';
import { ProjectStatus, ProjectHealth } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { NotFound, BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  description: z.string().optional(),
  location: z.string().optional(),
  projectType: z.string().optional(),
  category: z.string().optional(),
  timezone: z.string().optional(),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
  plannedProfitMargin: z.number().min(0).max(100).optional(),
  clientId: z.string().optional(),
  managerId: z.string().optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  health: z.nativeEnum(ProjectHealth).optional(),
  budget: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  progressPct: z.number().min(0).max(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  forecastFinishDate: z.string().datetime().optional(),
  actualEndDate: z.string().datetime().optional(),
});

const updateSchema = createSchema.partial();

async function assertOrgRefs(orgId: string, clientId?: string, managerId?: string) {
  if (clientId) {
    const c = await prisma.client.findFirst({ where: { id: clientId, organizationId: orgId } });
    if (!c) throw BadRequest('clientId does not belong to your organization');
  }
  if (managerId) {
    const m = await prisma.user.findFirst({ where: { id: managerId, organizationId: orgId } });
    if (!m) throw BadRequest('managerId does not belong to your organization');
  }
}

// ── Portfolio summary (real KPIs for the dashboard) ──────────────
router.get(
  '/summary',
  requirePermission('project:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const projects = await prisma.project.findMany({ where: { organizationId: orgId } });

    const total = projects.length;
    const active = projects.filter((p) => p.status === 'ACTIVE').length;
    const completed = projects.filter((p) => p.status === 'COMPLETED').length;
    const totalBudget = projects.reduce((s, p) => s + Number(p.budget), 0);
    const avgProgress =
      total === 0 ? 0 : projects.reduce((s, p) => s + p.progressPct, 0) / total;

    const healthBreakdown = {
      OPTIMAL: projects.filter((p) => p.health === 'OPTIMAL').length,
      WARNING: projects.filter((p) => p.health === 'WARNING').length,
      CRITICAL: projects.filter((p) => p.health === 'CRITICAL').length,
    };

    return ok(res, {
      totalProjects: total,
      activeProjects: active,
      completedProjects: completed,
      totalBudget,
      avgProgressPct: Number(avgProgress.toFixed(1)),
      healthBreakdown,
    });
  }),
);

// LIST
router.get(
  '/',
  requirePermission('project:read'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
    const search = (req.query.search as string)?.trim();
    const status = req.query.status as ProjectStatus | undefined;

    const where = {
      organizationId: req.user!.orgId,
      ...(status ? { status } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    };

    const [data, total] = await Promise.all([
      prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          client: { select: { id: true, name: true } },
          manager: { select: { id: true, fullName: true } },
        },
      }),
      prisma.project.count({ where }),
    ]);

    return paginated(res, data, { page, pageSize, total });
  }),
);

// GET ONE
router.get(
  '/:id',
  requirePermission('project:read'),
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
      include: { client: true, manager: { select: { id: true, fullName: true, email: true } }, contract: true },
    });
    if (!project) throw NotFound('Project not found');
    return ok(res, project);
  }),
);

// CREATE
router.post(
  '/',
  requirePermission('project:write'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    await assertOrgRefs(req.user!.orgId, body.clientId, body.managerId);

    const project = await prisma.project.create({
      data: {
        organizationId: req.user!.orgId,
        code: body.code,
        name: body.name,
        description: body.description,
        location: body.location,
        projectType: body.projectType,
        category: body.category,
        timezone: body.timezone,
        gpsLat: body.gpsLat,
        gpsLng: body.gpsLng,
        plannedProfitMargin: body.plannedProfitMargin,
        clientId: body.clientId,
        managerId: body.managerId,
        status: body.status,
        health: body.health,
        budget: body.budget ?? 0,
        currency: body.currency,
        progressPct: body.progressPct ?? 0,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        forecastFinishDate: body.forecastFinishDate ? new Date(body.forecastFinishDate) : undefined,
        actualEndDate: body.actualEndDate ? new Date(body.actualEndDate) : undefined,
      },
    });
    await auditFromRequest(req, 'CREATE', 'project', project.id, { newValues: project });
    return ok(res, project, 201);
  }),
);

// UPDATE
router.put(
  '/:id',
  requirePermission('project:write'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
    });
    if (!existing) throw NotFound('Project not found');
    await assertOrgRefs(req.user!.orgId, body.clientId, body.managerId);

    const project = await prisma.project.update({
      where: { id: existing.id },
      data: {
        ...body,
        budget: body.budget,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        forecastFinishDate: body.forecastFinishDate ? new Date(body.forecastFinishDate) : undefined,
        actualEndDate: body.actualEndDate ? new Date(body.actualEndDate) : undefined,
      },
    });
    await auditFromRequest(req, 'UPDATE', 'project', project.id, { oldValues: existing, newValues: project });
    return ok(res, project);
  }),
);

// DELETE
router.delete(
  '/:id',
  requirePermission('project:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
    });
    if (!existing) throw NotFound('Project not found');
    await prisma.project.delete({ where: { id: existing.id } });
    await auditFromRequest(req, 'DELETE', 'project', existing.id, { oldValues: existing });
    return ok(res, { deleted: true });
  }),
);

export default router;
