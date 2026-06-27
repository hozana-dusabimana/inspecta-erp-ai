import { Router, Request } from 'express';
import { ZodSchema } from 'zod';
import { prisma } from './prisma';
import { asyncHandler, ok, paginated } from './http';
import { NotFound, BadRequest } from './errors';
import { authenticate, requirePermission } from '../middleware/auth';
import { auditFromRequest } from '../auth/audit';
import { Permission } from '../auth/permissions';

type Delegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<unknown | null>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
  delete: (args: unknown) => Promise<Record<string, unknown>>;
};

export interface CrudOptions {
  /** Prisma model accessor, e.g. "productionEntry". */
  model: string;
  /** Audit-trail entity name, e.g. "production-entry". */
  entity: string;
  readPerm: Permission;
  writePerm: Permission;
  createSchema: ZodSchema;
  updateSchema: ZodSchema;
  /** Field used for case-insensitive `?search=` filtering. */
  searchField?: string;
  /** Prisma `include` for list/detail responses. */
  include?: Record<string, unknown>;
  /** Prisma `orderBy`; defaults to { createdAt: 'desc' }. */
  orderBy?: Record<string, unknown>;
  /** Require & validate that body.projectId belongs to the caller's org. */
  requireProject?: boolean;
  /** Foreign keys to validate as belonging to the caller's org before write. */
  refs?: Array<{ field: string; model: string }>;
  /**
   * Derive/normalize fields just before persisting (compute amounts, scores,
   * coerce dates...). Receives the validated body and the request.
   */
  transform?: (data: Record<string, unknown>, req: Request) => Record<string, unknown>;
  /** Side-effect after a successful create/update/delete (notifications, realtime). */
  afterChange?: (
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    record: Record<string, unknown>,
    req: Request,
  ) => Promise<void> | void;
}

const DATE_FIELDS = new Set([
  'date',
  'startDate',
  'endDate',
  'actualEndDate',
  'contractDate',
  'commencementDate',
  'issueDate',
  'dueDate',
  'orderDate',
  'expectedDate',
  'closedAt',
]);

/** Coerce ISO date strings on known date fields into Date objects. */
function coerceDates(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of Object.keys(out)) {
    if (DATE_FIELDS.has(key) && typeof out[key] === 'string') {
      out[key] = new Date(out[key] as string);
    }
  }
  return out;
}

async function assertProjectInOrg(orgId: string, projectId: unknown) {
  if (!projectId) return;
  const project = await prisma.project.findFirst({
    where: { id: String(projectId), organizationId: orgId },
    select: { id: true },
  });
  if (!project) throw BadRequest('projectId does not belong to your organization');
}

async function assertRefsInOrg(
  orgId: string,
  data: Record<string, unknown>,
  refs?: Array<{ field: string; model: string }>,
) {
  if (!refs) return;
  for (const ref of refs) {
    const value = data[ref.field];
    if (!value) continue;
    const found = await (prisma as unknown as Record<string, Delegate>)[ref.model].findFirst({
      where: { id: String(value), organizationId: orgId },
    });
    if (!found) throw BadRequest(`${ref.field} does not belong to your organization`);
  }
}

/**
 * Builds a full tenant-scoped CRUD router for a Prisma model with RBAC + audit.
 * Special/computed endpoints can be layered on the returned router by the caller.
 */
export function createCrudRouter(opts: CrudOptions): Router {
  const router = Router();
  router.use(authenticate);
  const delegate = () => (prisma as unknown as Record<string, Delegate>)[opts.model];
  const orderBy = opts.orderBy ?? { createdAt: 'desc' };

  // LIST
  router.get(
    '/',
    requirePermission(opts.readPerm),
    asyncHandler(async (req, res) => {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 25)));
      const search = (req.query.search as string)?.trim();
      const projectId = req.query.projectId as string | undefined;

      const where: Record<string, unknown> = { organizationId: req.user!.orgId };
      if (projectId) where.projectId = projectId;
      if (search && opts.searchField) {
        where[opts.searchField] = { contains: search, mode: 'insensitive' };
      }

      const [data, total] = await Promise.all([
        delegate().findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          ...(opts.include ? { include: opts.include } : {}),
        }),
        delegate().count({ where }),
      ]);
      return paginated(res, data, { page, pageSize, total });
    }),
  );

  // GET ONE
  router.get(
    '/:id',
    requirePermission(opts.readPerm),
    asyncHandler(async (req, res) => {
      const record = await delegate().findFirst({
        where: { id: req.params.id, organizationId: req.user!.orgId },
        ...(opts.include ? { include: opts.include } : {}),
      });
      if (!record) throw NotFound(`${opts.entity} not found`);
      return ok(res, record);
    }),
  );

  // CREATE
  router.post(
    '/',
    requirePermission(opts.writePerm),
    asyncHandler(async (req, res) => {
      const parsed = opts.createSchema.parse(req.body) as Record<string, unknown>;
      if (opts.requireProject || parsed.projectId) {
        await assertProjectInOrg(req.user!.orgId, parsed.projectId);
      }
      await assertRefsInOrg(req.user!.orgId, parsed, opts.refs);
      let data = coerceDates(parsed);
      if (opts.transform) data = opts.transform(data, req);
      data.organizationId = req.user!.orgId;

      const record = await delegate().create({ data });
      await auditFromRequest(req, 'CREATE', opts.entity, String(record.id), { newValues: record });
      if (opts.afterChange) await opts.afterChange('CREATE', record, req);
      return ok(res, record, 201);
    }),
  );

  // UPDATE
  router.put(
    '/:id',
    requirePermission(opts.writePerm),
    asyncHandler(async (req, res) => {
      const existing = await delegate().findFirst({
        where: { id: req.params.id, organizationId: req.user!.orgId },
      });
      if (!existing) throw NotFound(`${opts.entity} not found`);

      const parsed = opts.updateSchema.parse(req.body) as Record<string, unknown>;
      if (parsed.projectId) await assertProjectInOrg(req.user!.orgId, parsed.projectId);
      await assertRefsInOrg(req.user!.orgId, parsed, opts.refs);
      let data = coerceDates(parsed);
      if (opts.transform) data = opts.transform({ ...existing, ...data }, req);
      delete data.organizationId;

      const record = await delegate().update({ where: { id: req.params.id }, data });
      await auditFromRequest(req, 'UPDATE', opts.entity, String(record.id), {
        oldValues: existing,
        newValues: record,
      });
      if (opts.afterChange) await opts.afterChange('UPDATE', record, req);
      return ok(res, record);
    }),
  );

  // DELETE
  router.delete(
    '/:id',
    requirePermission(opts.writePerm),
    asyncHandler(async (req, res) => {
      const existing = await delegate().findFirst({
        where: { id: req.params.id, organizationId: req.user!.orgId },
      });
      if (!existing) throw NotFound(`${opts.entity} not found`);
      await delegate().delete({ where: { id: req.params.id } });
      await auditFromRequest(req, 'DELETE', opts.entity, req.params.id, { oldValues: existing });
      if (opts.afterChange) await opts.afterChange('DELETE', existing as Record<string, unknown>, req);
      return ok(res, { deleted: true });
    }),
  );

  return router;
}
