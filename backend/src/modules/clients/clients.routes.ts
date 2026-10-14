import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { xlsxRaw, rowsFromXlsx, sendTemplate, str, ImportReport, auditImport } from '../../lib/xlsx-import';

const router = Router();
router.use(authenticate);

// Exported so the AI Copilot write tools validate client creation identically.
export const upsertSchema = z.object({
  name: z.string().min(2),
  // private | government | individual — drives the billing workflow
  clientType: z.enum(['private', 'government', 'individual']).optional(),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  taxNumber: z.string().optional(),
});

// LIST
router.get(
  '/',
  requirePermission('client:read'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
    const search = (req.query.search as string)?.trim();

    const where = {
      organizationId: req.user!.orgId,
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    };

    const [data, total] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { projects: true } } },
      }),
      prisma.client.count({ where }),
    ]);

    return paginated(res, data, { page, pageSize, total });
  }),
);

// Excel template + import. Registered before `/:id` so these paths are not read as an id.
router.get(
  '/template.xlsx',
  requirePermission('client:write'),
  asyncHandler(async (_req, res) => {
    await sendTemplate(res, 'Clients', [
      { header: 'name', example: 'Kigali Heights Ltd', note: 'Required, at least 2 characters. Clients already on file with the same name are skipped.' },
      { header: 'clientType', example: 'private', note: 'Optional: private, government or individual.' },
      { header: 'contactName', example: 'Jean Mugisha', note: 'Optional.' },
      { header: 'email', example: 'jean@example.com', note: 'Optional, must be a valid email.' },
      { header: 'phone', example: '+250 788 000 000', note: 'Optional.' },
      { header: 'address', example: 'KG 7 Ave, Kigali', note: 'Optional.' },
      { header: 'taxNumber', example: '123456789', note: 'Optional TIN.' },
    ], 'clients-template.xlsx');
  }),
);

router.post(
  '/import',
  requirePermission('client:write'),
  xlsxRaw,
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const rows = await rowsFromXlsx(req.body as Buffer);
    const existing = await prisma.client.findMany({ where: { organizationId: orgId }, select: { name: true } });
    const known = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    const report = new ImportReport();
    const data: Record<string, unknown>[] = [];
    for (const { rowNo, cells: r } of rows) {
      const parsed = upsertSchema.safeParse({
        name: str(r.name),
        clientType: str(r.clienttype).toLowerCase() || undefined,
        contactName: str(r.contactname) || undefined,
        email: str(r.email) || undefined,
        phone: str(r.phone) || undefined,
        address: str(r.address) || undefined,
        taxNumber: str(r.taxnumber) || undefined,
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        report.fail(rowNo, `${issue.path.join('.') || 'row'}: ${issue.message}`);
        continue;
      }
      const key = parsed.data.name.trim().toLowerCase();
      if (known.has(key)) { report.exists(rowNo, `client "${parsed.data.name}" already exists`); continue; }
      known.add(key);
      data.push({ ...parsed.data, name: parsed.data.name.trim(), email: parsed.data.email || null, organizationId: orgId });
    }
    if (data.length) await prisma.client.createMany({ data: data as never });
    report.created = data.length;
    const outcome = report.outcome();
    await auditImport(req, 'client', outcome);
    return ok(res, outcome, 201);
  }),
);

// GET ONE
router.get(
  '/:id',
  requirePermission('client:read'),
  asyncHandler(async (req, res) => {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
      include: { projects: true },
    });
    if (!client) throw NotFound('Client not found');
    return ok(res, client);
  }),
);

// CREATE
router.post(
  '/',
  requirePermission('client:write'),
  asyncHandler(async (req, res) => {
    const body = upsertSchema.parse(req.body);
    const client = await prisma.client.create({
      data: { ...body, email: body.email || null, organizationId: req.user!.orgId },
    });
    await auditFromRequest(req, 'CREATE', 'client', client.id, { newValues: client });
    return ok(res, client, 201);
  }),
);

// UPDATE
router.put(
  '/:id',
  requirePermission('client:write'),
  asyncHandler(async (req, res) => {
    const body = upsertSchema.partial().parse(req.body);
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
    });
    if (!existing) throw NotFound('Client not found');

    const client = await prisma.client.update({
      where: { id: existing.id },
      data: { ...body, email: body.email === '' ? null : body.email },
    });
    await auditFromRequest(req, 'UPDATE', 'client', client.id, { oldValues: existing, newValues: client });
    return ok(res, client);
  }),
);

// DELETE
router.delete(
  '/:id',
  requirePermission('client:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
    });
    if (!existing) throw NotFound('Client not found');
    await prisma.client.delete({ where: { id: existing.id } });
    await auditFromRequest(req, 'DELETE', 'client', existing.id, { oldValues: existing });
    return ok(res, { deleted: true });
  }),
);

export default router;
