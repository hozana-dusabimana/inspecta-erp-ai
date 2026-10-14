import { Router } from 'express';
import { z } from 'zod';
import { ProjectStatus, ProjectHealth } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { NotFound, BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { assertProjectQuotaAvailable } from '../platform/plans';
import { xlsxRaw, rowsFromXlsx, sendTemplate, str, numOrU, dateOrU, hasValue, ImportReport, auditImport } from '../../lib/xlsx-import';

const router = Router();
router.use(authenticate);

// Exported so the AI Copilot write tools validate project creation identically.
export const createSchema = z.object({
  code: z.string().min(2).optional(), // auto-generated when omitted
  name: z.string().min(2),
  description: z.string().optional(),
  location: z.string().optional(),
  projectType: z.string().optional(),
  category: z.string().optional(),
  applicationNumber: z.string().optional(),
  permitNumber: z.string().optional(),
  groundSurface: z.number().nonnegative().optional(),
  groundSurfaceUnit: z.string().optional(),
  buildingSurface: z.number().nonnegative().optional(),
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

/**
 * Auto-generate a sequential, org-scoped project code (PRJ-0001, PRJ-0002, …).
 * Skips codes already taken (handles gaps left by deleted projects).
 */
async function generateProjectCode(orgId: string): Promise<string> {
  let n = (await prisma.project.count({ where: { organizationId: orgId } })) + 1;
  for (let i = 0; i < 10000; i++) {
    const code = `PRJ-${String(n).padStart(4, '0')}`;
    const taken = await prisma.project.findFirst({ where: { organizationId: orgId, code }, select: { id: true } });
    if (!taken) return code;
    n++;
  }
  return `PRJ-${Date.now()}`;
}

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

// Excel template + import. Registered before `/:id` so these paths are not read as an id.
router.get(
  '/template.xlsx',
  requirePermission('project:write'),
  asyncHandler(async (_req, res) => {
    await sendTemplate(res, 'Projects', [
      { header: 'name', example: 'Kigali Heights Tower', note: 'Required, at least 2 characters.' },
      { header: 'code', example: '', note: 'Optional. Auto-generated (PRJ-0001, …) when blank. A code that already exists is skipped.' },
      { header: 'clientName', example: 'Kigali Heights Ltd', note: 'Optional. Must match a client already on file (import Clients first).' },
      { header: 'location', example: 'Rwanda, Kigali, Gasabo', note: 'Optional free text.' },
      { header: 'projectType', example: 'Building', note: 'Optional.' },
      { header: 'category', example: 'Commercial', note: 'Optional.' },
      { header: 'status', example: 'PLANNING', note: 'Optional: PLANNING, ACTIVE, ON_HOLD, AT_RISK, COMPLETED or CANCELLED. Default PLANNING.' },
      { header: 'budget', example: 250000000, note: 'Optional contract value ≥ 0.' },
      { header: 'currency', example: 'RWF', note: 'Optional 3-letter ISO code. Default RWF.' },
      { header: 'startDate', example: '2026-01-05', note: 'Optional Excel date or YYYY-MM-DD.' },
      { header: 'endDate', example: '2027-06-30', note: 'Optional; not before startDate.' },
      { header: 'plannedProfitMargin', example: 12, note: 'Optional 0–100.' },
      { header: 'managerEmail', example: 'pm@company.com', note: 'Optional. Must be an existing user of your company.' },
      { header: 'description', example: '', note: 'Optional.' },
    ], 'projects-template.xlsx', 'Your plan’s project limit applies: rows beyond the limit are rejected.');
  }),
);

router.post(
  '/import',
  requirePermission('project:write'),
  xlsxRaw,
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const rows = await rowsFromXlsx(req.body as Buffer);
    const [org, projects, clients, users] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { maxProjects: true } }),
      prisma.project.findMany({ where: { organizationId: orgId }, select: { code: true, name: true } }),
      prisma.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, email: true } }),
    ]);
    const codes = new Set(projects.map((p) => p.code.toLowerCase()));
    const names = new Set(projects.map((p) => p.name.trim().toLowerCase()));
    const clientsByName = new Map<string, string[]>();
    for (const c of clients) { const k = c.name.trim().toLowerCase(); clientsByName.set(k, [...(clientsByName.get(k) ?? []), c.id]); }
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    let room = org?.maxProjects == null ? Infinity : Math.max(0, org.maxProjects - projects.length);
    let seq = projects.length + 1;
    const nextCode = () => {
      for (;;) { const c = `PRJ-${String(seq++).padStart(4, '0')}`; if (!codes.has(c.toLowerCase())) return c; }
    };

    const report = new ImportReport();
    const data: Record<string, unknown>[] = [];
    for (const { rowNo, cells: r } of rows) {
      const name = str(r.name);
      if (name.length < 2) { report.fail(rowNo, 'name is required (at least 2 characters)'); continue; }
      const givenCode = str(r.code);
      if (givenCode) {
        if (givenCode.length < 2) { report.fail(rowNo, 'code must be at least 2 characters'); continue; }
        if (codes.has(givenCode.toLowerCase())) { report.exists(rowNo, `project code "${givenCode}" already exists`); continue; }
      } else if (names.has(name.toLowerCase())) {
        report.exists(rowNo, `project "${name}" already exists`); continue;
      }
      const statusRaw = str(r.status).toUpperCase().replace(/[\s-]+/g, '_');
      if (statusRaw && !(statusRaw in ProjectStatus)) { report.fail(rowNo, `status "${str(r.status)}" is not one of ${Object.keys(ProjectStatus).join(', ')}`); continue; }
      const budget = hasValue(r.budget) ? numOrU(r.budget) : 0;
      if (budget === undefined || budget < 0) { report.fail(rowNo, 'budget must be a number ≥ 0'); continue; }
      const currency = str(r.currency).toUpperCase();
      if (currency && !/^[A-Z]{3}$/.test(currency)) { report.fail(rowNo, 'currency must be a 3-letter code such as RWF'); continue; }
      const margin = numOrU(r.plannedprofitmargin);
      if (hasValue(r.plannedprofitmargin) && (margin === undefined || margin < 0 || margin > 100)) { report.fail(rowNo, 'plannedProfitMargin must be between 0 and 100'); continue; }
      const start = dateOrU(r.startdate); const end = dateOrU(r.enddate);
      if (start === null || end === null) { report.fail(rowNo, 'startDate/endDate is not a valid date'); continue; }
      if (start && end && end < start) { report.fail(rowNo, 'endDate is before startDate'); continue; }
      let clientId: string | undefined;
      if (hasValue(r.clientname)) {
        const matches = clientsByName.get(str(r.clientname).toLowerCase()) ?? [];
        if (matches.length === 0) { report.fail(rowNo, `client "${str(r.clientname)}" not found (import or add the client first)`); continue; }
        if (matches.length > 1) { report.fail(rowNo, `several clients are named "${str(r.clientname)}" — rename one so the match is unambiguous`); continue; }
        clientId = matches[0];
      }
      let managerId: string | undefined;
      if (hasValue(r.manageremail)) {
        managerId = userByEmail.get(str(r.manageremail).toLowerCase());
        if (!managerId) { report.fail(rowNo, `no user with email "${str(r.manageremail)}" in your company`); continue; }
      }
      if (room <= 0) { report.fail(rowNo, 'project limit of your plan reached — contact your administrator to upgrade'); continue; }
      room--;
      const code = givenCode || nextCode();
      codes.add(code.toLowerCase());
      names.add(name.toLowerCase());
      data.push({
        organizationId: orgId, code, name, clientId, managerId,
        description: str(r.description) || undefined, location: str(r.location) || undefined,
        projectType: str(r.projecttype) || undefined, category: str(r.category) || undefined,
        status: statusRaw ? (statusRaw as ProjectStatus) : undefined, budget, currency: currency || undefined,
        plannedProfitMargin: margin, startDate: start ?? undefined, endDate: end ?? undefined,
      });
    }
    if (data.length) await prisma.project.createMany({ data: data as never });
    report.created = data.length;
    const outcome = report.outcome();
    await auditImport(req, 'project', outcome);
    return ok(res, outcome, 201);
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
    await assertProjectQuotaAvailable(req.user!.orgId);
    await assertOrgRefs(req.user!.orgId, body.clientId, body.managerId);
    const code = body.code?.trim() || (await generateProjectCode(req.user!.orgId));

    const project = await prisma.project.create({
      data: {
        organizationId: req.user!.orgId,
        code,
        name: body.name,
        description: body.description,
        location: body.location,
        projectType: body.projectType,
        category: body.category,
        applicationNumber: body.applicationNumber,
        permitNumber: body.permitNumber,
        groundSurface: body.groundSurface,
        groundSurfaceUnit: body.groundSurfaceUnit,
        buildingSurface: body.buildingSurface,
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
