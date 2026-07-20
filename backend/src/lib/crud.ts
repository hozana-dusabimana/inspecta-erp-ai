import { Router, Request } from 'express';
import { ZodSchema } from 'zod';
import { prisma } from './prisma';
import { asyncHandler, ok, paginated } from './http';
import { sendTabularExport, exportFormat } from './export';
import { NotFound, BadRequest } from './errors';
import { authenticate, requirePermission } from '../middleware/auth';
import { auditFromRequest, recordAudit } from '../auth/audit';
import { Permission } from '../auth/permissions';

type Delegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<unknown | null>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
  delete: (args: unknown) => Promise<Record<string, unknown>>;
};

interface AutoCodeSpec {
  field: string;
  prefix: string;
  /** Only generate when this returns true for the parsed body (e.g. IPC-only). */
  when?: (data: Record<string, unknown>) => boolean;
}

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
  /**
   * Date field that `?dateFrom=`/`?dateTo=` (ISO or yyyy-mm-dd) filter on.
   * Enables the date-range picker for this resource.
   */
  dateField?: string;
  /**
   * Scalar fields that can be filtered by exact match via `?<field>=value`
   * (e.g. status/category/type enums). Whitelisted to avoid query injection.
   */
  filterFields?: string[];
  /**
   * Numeric fields aggregated (SUM) over the full filtered set and returned in
   * `meta.sums` — drives summation cards in the UI.
   */
  sumFields?: string[];
  /**
   * Scalar fields the client may sort by via `?sortBy=field&sortDir=asc|desc`.
   * Whitelisted to avoid ordering on relations/invalid columns.
   */
  sortFields?: string[];
  /** Prisma `include` for list/detail responses. */
  include?: Record<string, unknown>;
  /** Prisma `orderBy`; defaults to { createdAt: 'desc' }. */
  orderBy?: Record<string, unknown>;
  /** Require & validate that body.projectId belongs to the caller's org. */
  requireProject?: boolean;
  /** Foreign keys to validate as belonging to the caller's org before write. */
  refs?: Array<{ field: string; model: string }>;
  /**
   * Auto-generate a sequential, org-scoped identifier when the field is omitted
   * or blank on create. e.g. { field: 'number', prefix: 'NCR' } → NCR-0001,
   * NCR-0002, … (skips codes freed by deletes). The field must be optional in
   * `createSchema` so an omitted value passes validation. Pass an array to
   * generate several. `when` restricts generation to rows matching a predicate
   * (e.g. only assign an IPC number when the invoice is an IPC).
   */
  autoCode?: AutoCodeSpec | AutoCodeSpec[];
  /**
   * Async cross-field/relational validation that the generic `refs`/project
   * checks can't express (e.g. two FKs must share the same parent). Runs after
   * project + refs validation, before `transform`. Throw (BadRequest) to reject.
   * On update it receives the merged `{ ...existing, ...body }` effective record.
   */
  validate?: (data: Record<string, unknown>, req: Request) => Promise<void> | void;
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
  'signedDate',
  'effectiveDate',
  'periodStart',
  'periodEnd',
  'periodMonth',
  'submittedDate',
  'paidDate',
  'forecastFinishDate',
  'actualStart',
  'actualFinish',
  'scheduledDate',
  'completedDate',
  'requiredByDate',
  'neededByDate',
  'dateRequested',
  'deliveryDate',
  'reportDate',
  'sampleDate',
  'resultDate',
  'expiryDate',
  'issueDate',
  'dueDate',
  'orderDate',
  'expectedDate',
  'closedAt',
  'effectiveFrom',
  'hireDate',
  'nextDueDate',
  'dateReceived',
  'dateIssued',
  'validFrom',
  'validUntil',
  'checkDate',
  'openedAt',
]);

/** Coerce ISO date strings on known date fields into Date objects. */
export function coerceDates(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of Object.keys(out)) {
    if (DATE_FIELDS.has(key) && typeof out[key] === 'string') {
      out[key] = new Date(out[key] as string);
    }
  }
  return out;
}

/**
 * Generate a sequential, org-scoped identifier (PREFIX-0001, PREFIX-0002, …),
 * skipping any value already taken (handles gaps from deleted records).
 */
export async function generateAutoCode(model: string, orgId: string, field: string, prefix: string): Promise<string> {
  const delegate = (prisma as unknown as Record<string, Delegate>)[model];
  // Count rows that already carry a value with this prefix — gives a correct
  // per-prefix sequence and works whether the field is nullable or not (handles
  // fields only set on a subset of rows, e.g. an IPC number on the invoice table).
  let n = (await delegate.count({ where: { organizationId: orgId, [field]: { startsWith: `${prefix}-` } } })) + 1;
  for (let i = 0; i < 10000; i++) {
    const code = `${prefix}-${String(n).padStart(4, '0')}`;
    const taken = await delegate.findFirst({ where: { organizationId: orgId, [field]: code } });
    if (!taken) return code;
    n++;
  }
  return `${prefix}-${Date.now()}`;
}

export async function assertProjectInOrg(orgId: string, projectId: unknown) {
  if (!projectId) return;
  const project = await prisma.project.findFirst({
    where: { id: String(projectId), organizationId: orgId },
    select: { id: true },
  });
  if (!project) throw BadRequest('projectId does not belong to your organization');
}

export async function assertRefsInOrg(
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

/** Build the tenant-scoped `where` from query params (shared by LIST + export). */
function buildWhere(req: Request, opts: CrudOptions): Record<string, unknown> {
  const where: Record<string, unknown> = { organizationId: req.user!.orgId };
  const projectId = req.query.projectId as string | undefined;
  if (projectId) where.projectId = projectId;

  const search = (req.query.search as string)?.trim();
  if (search && opts.searchField) {
    where[opts.searchField] = { contains: search, mode: 'insensitive' };
  }

  // Whitelisted exact-match filters (status/category/type enums, etc.).
  if (opts.filterFields) {
    for (const field of opts.filterFields) {
      const v = req.query[field];
      if (typeof v === 'string' && v.trim() !== '') where[field] = v.trim();
    }
  }

  // Date-range filter on the configured date field.
  if (opts.dateField) {
    const from = req.query.dateFrom as string | undefined;
    const to = req.query.dateTo as string | undefined;
    const range: Record<string, Date> = {};
    if (from) range.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) end.setUTCHours(23, 59, 59, 999); // inclusive end-of-day
      range.lte = end;
    }
    if (Object.keys(range).length) where[opts.dateField] = range;
  }
  return where;
}

/**
 * Resolve the orderBy from `?sortBy/?sortDir`, or the default. Sortable columns
 * are the explicit `sortFields` plus the already-declared scalar fields
 * (search/date/sum/filter) and `createdAt` — all guaranteed real columns.
 */
function resolveOrderBy(req: Request, opts: CrudOptions): Record<string, unknown> {
  const sortBy = req.query.sortBy as string | undefined;
  const sortDir = (req.query.sortDir as string) === 'asc' ? 'asc' : 'desc';
  if (sortBy) {
    const allowed = new Set<string>([
      'createdAt',
      ...(opts.sortFields ?? []),
      ...(opts.searchField ? [opts.searchField] : []),
      ...(opts.dateField ? [opts.dateField] : []),
      ...(opts.sumFields ?? []),
      ...(opts.filterFields ?? []),
    ]);
    if (allowed.has(sortBy)) return { [sortBy]: sortDir };
  }
  return opts.orderBy ?? { createdAt: 'desc' };
}

/**
 * The create pipeline shared by the CRUD route handler and the AI Copilot write
 * tools: parse → autoCode → project/ref scoping → validate → coerce dates →
 * transform → force org. When `commit` is false it stops there and returns the
 * resolved would-be record (used to build a preview without writing). When true
 * it persists, audits, and runs `afterChange`. `req` may be a real Express
 * request or a minimal actor shim ({ user, ip, headers }).
 */
export async function runCreate(
  opts: CrudOptions,
  req: Request,
  body: unknown,
  commit: boolean,
): Promise<{ data: Record<string, unknown>; record?: Record<string, unknown> }> {
  const orgId = req.user!.orgId;
  const parsed = opts.createSchema.parse(body) as Record<string, unknown>;
  if (opts.autoCode) {
    const codes = Array.isArray(opts.autoCode) ? opts.autoCode : [opts.autoCode];
    for (const ac of codes) {
      if (ac.when && !ac.when(parsed)) continue;
      const cur = parsed[ac.field];
      if (cur === undefined || cur === null || String(cur).trim() === '') {
        parsed[ac.field] = await generateAutoCode(opts.model, orgId, ac.field, ac.prefix);
      }
    }
  }
  if (opts.requireProject || parsed.projectId) {
    await assertProjectInOrg(orgId, parsed.projectId);
  }
  await assertRefsInOrg(orgId, parsed, opts.refs);
  if (opts.validate) await opts.validate(parsed, req);
  let data = coerceDates(parsed);
  if (opts.transform) data = opts.transform(data, req);
  data.organizationId = orgId;

  if (!commit) return { data };

  const delegate = (prisma as unknown as Record<string, Delegate>)[opts.model];
  const record = await delegate.create({ data });
  await recordAudit({
    organizationId: orgId,
    userId: req.user!.id,
    action: 'CREATE',
    entity: opts.entity,
    entityId: String(record.id),
    newValues: record,
    ipAddress: req.ip ?? null,
    userAgent: req.headers?.['user-agent'] ?? null,
  });
  if (opts.afterChange) await opts.afterChange('CREATE', record, req);
  return { data, record };
}

/**
 * Builds a full tenant-scoped CRUD router for a Prisma model with RBAC + audit.
 * Special/computed endpoints can be layered on the returned router by the caller.
 */
export function createCrudRouter(opts: CrudOptions): Router {
  const router = Router();
  router.use(authenticate);
  const delegate = () => (prisma as unknown as Record<string, Delegate>)[opts.model];

  // EXPORT (csv | xlsx) — honors the same filters/sort as LIST, no pagination.
  router.get(
    '/export',
    requirePermission(opts.readPerm),
    asyncHandler(async (req, res) => {
      const where = buildWhere(req, opts);
      const rows = (await delegate().findMany({
        where,
        orderBy: resolveOrderBy(req, opts),
        take: 10000, // hard cap to protect memory
      })) as Record<string, unknown>[];
      return sendTabularExport(res, rows, opts.entity, exportFormat(req.query.format));
    }),
  );

  // LIST
  router.get(
    '/',
    requirePermission(opts.readPerm),
    asyncHandler(async (req, res) => {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 25)));
      const where = buildWhere(req, opts);
      const orderBy = resolveOrderBy(req, opts);

      const [data, total, sumAgg] = await Promise.all([
        delegate().findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          ...(opts.include ? { include: opts.include } : {}),
        }),
        delegate().count({ where }),
        opts.sumFields && opts.sumFields.length
          ? (delegate() as unknown as { aggregate: (a: unknown) => Promise<{ _sum: Record<string, unknown> }> }).aggregate({
              where,
              _sum: Object.fromEntries(opts.sumFields.map((f) => [f, true])),
            })
          : Promise.resolve(null),
      ]);

      const sums = sumAgg
        ? Object.fromEntries(opts.sumFields!.map((f) => [f, Number(sumAgg._sum[f] ?? 0)]))
        : undefined;

      return paginated(res, data, { page, pageSize, total, ...(sums ? { sums } : {}) });
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
      const { record } = await runCreate(opts, req, req.body, true);
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
      if (opts.validate) await opts.validate({ ...existing, ...parsed }, req);
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
