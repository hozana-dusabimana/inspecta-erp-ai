import { Router, Request } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';

const router = Router();
router.use(authenticate);

// Notifications targeted at the org broadly (userId null) or at the specific user.
function scope(req: Request) {
  return {
    organizationId: req.user!.orgId,
    OR: [{ userId: null }, { userId: req.user!.id }],
  };
}

// LIST
router.get(
  '/',
  requirePermission('notification:read'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 30)));
    const unreadOnly = req.query.unread === 'true';

    const where = { ...scope(req), ...(unreadOnly ? { isRead: false } : {}) };
    const [data, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where }),
    ]);
    return paginated(res, data, { page, pageSize, total });
  }),
);

// UNREAD COUNT
router.get(
  '/unread-count',
  requirePermission('notification:read'),
  asyncHandler(async (req, res) => {
    const count = await prisma.notification.count({ where: { ...scope(req), isRead: false } });
    return ok(res, { count });
  }),
);

// MARK ONE READ
router.put(
  '/:id/read',
  requirePermission('notification:read'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.notification.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
    });
    if (!existing) throw NotFound('Notification not found');
    const updated = await prisma.notification.update({
      where: { id: existing.id },
      data: { isRead: true },
    });
    return ok(res, updated);
  }),
);

// MARK ALL READ
router.put(
  '/read-all',
  requirePermission('notification:read'),
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { ...scope(req), isRead: false }, data: { isRead: true } });
    return ok(res, { ok: true });
  }),
);

export default router;
