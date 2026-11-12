import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { debugLog, debugLogEnabled, secretsEnabled } from '../../lib/debug-log';
import { isEmailConfigured } from '../../lib/email';

/**
 * Debug log viewer. Mounted inside the platform router, so every route here already sits behind
 * authenticate + requirePlatformAdmin: a company admin can never read it.
 */
export const debugLogRouter = Router();

const listQuery = z.object({
  category: z.enum(['AUTH', 'EMAIL', 'HTTP', 'SYSTEM', 'NOTIFY']).optional(),
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  q: z.string().trim().max(200).optional(),
  since: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** "secrets" = only events that carry a verification / reset link (the one-time codes). */
  only: z.enum(['secrets']).optional(),
});

debugLogRouter.get('/status', asyncHandler(async (_req, res) => {
  const day = new Date(Date.now() - 86_400_000);
  const [total, last24h, errors24h, emailFailures24h] = await Promise.all([
    prisma.debugEvent.count(),
    prisma.debugEvent.count({ where: { createdAt: { gte: day } } }),
    prisma.debugEvent.count({ where: { createdAt: { gte: day }, level: 'ERROR' } }),
    prisma.debugEvent.count({ where: { createdAt: { gte: day }, category: 'EMAIL', level: { in: ['ERROR', 'WARN'] } } }),
  ]);
  return ok(res, {
    enabled: debugLogEnabled(),
    // When false, verification / reset links are NOT stored (the log says "hidden"). Set DEBUG_LOG_SECRETS=true on the server to record them.
    secretsRecorded: secretsEnabled(),
    smtpConfigured: isEmailConfigured(),
    total, last24h, errors24h, emailFailures24h,
  });
}));

debugLogRouter.get('/', asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where: Record<string, unknown> = {};
  if (q.category) where.category = q.category;
  if (q.level) where.level = q.level;
  if (q.only === 'secrets') where.secret = { not: null };
  const range: Record<string, Date> = {};
  if (q.since) range.gte = new Date(q.since);
  if (q.before) range.lt = new Date(q.before);
  if (Object.keys(range).length) where.createdAt = range;
  if (q.q) where.OR = [{ message: { contains: q.q, mode: 'insensitive' } }, { secret: { contains: q.q, mode: 'insensitive' } }];

  const rows = await prisma.debugEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit });
  const secretsRecorded = secretsEnabled();
  return ok(res, {
    secretsRecorded,
    nextBefore: rows.length === q.limit ? rows[rows.length - 1].createdAt.toISOString() : null,
    events: rows.map((e) => ({
      id: e.id, at: e.createdAt, level: e.level, category: e.category, message: e.message, meta: e.meta,
      // Rows written while recording was off simply have no secret: say so instead of leaving a blank.
      secret: e.secret,
      organizationId: e.organizationId, userId: e.userId,
    })),
  });
}));

debugLogRouter.delete('/', asyncHandler(async (req, res) => {
  const { count } = await prisma.debugEvent.deleteMany({});
  debugLog({ category: 'SYSTEM', message: `Debug log cleared (${count} events) by ${req.user!.email}`, userId: req.user!.id });
  return ok(res, { deleted: count });
}));
