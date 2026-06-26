import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';

const router = Router();
router.use(authenticate);

const upsertSchema = z.object({
  name: z.string().min(2),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
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
