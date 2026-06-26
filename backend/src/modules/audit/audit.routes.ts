import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, paginated } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';

const router = Router();
router.use(authenticate);

// LIST audit-trail entries for the caller's organization
router.get(
  '/',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 30)));
    const entity = req.query.entity as string | undefined;

    const where = {
      organizationId: req.user!.orgId,
      ...(entity ? { entity } : {}),
    };

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, fullName: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return paginated(res, data, { page, pageSize, total });
  }),
);

export default router;
