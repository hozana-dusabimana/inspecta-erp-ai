import { Router, Request } from 'express';
import { ZodSchema } from 'zod';
import { prisma } from './prisma';
import { asyncHandler, ok, paginated } from './http';
import { sendTabularExport, exportFormat } from './export';
import { NotFound, BadRequest, Conflict } from './errors';
import { Prisma } from '@prisma/client';
import { assertReason, CancelActor } from './posting';
import { authenticate, requirePermission } from '../middleware/auth';
import { auditFromRequest, recordAudit } from '../auth/audit';
import { Permission } from '../auth/permissions';
import { assertWbsInProject } from './wbs-link';
import { allowedProjects, assertProjectAccess, modelHasProject } from './project-access';

type Delegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<unknown | null>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
  delete: (args: unknown) => Promise<Record<string, unknown>>;
};

/**
 * Posted financial / stock records (rule 3): never hard-deleted, edits limited to
 * non-financial fields, and cancelled with a reason through POST /:id/cancel,
 * which reverses the record's effects in the same transaction.
 */
export interface PostingOptions {
  /** Fields that may still change after posting (notes, confirmation flags, workflow status). */
  editable?: string[];
  /** When given, records for which this is false (e.g. a DRAFT invoice) keep normal edit/delete. */
  isPosted?: (record: Record<string, unknown>) => boolean;
  /**
   * Checks + reversals run inside the cancel transaction. Return extra fields to
   * set on the cancelled record (e.g. { status: 'CANCELLED' }).
   */
  onCancel?: (
    tx: Prisma.TransactionClient,
    record: Record<string, unknown>,
    actor: CancelActor,
    req: Request,
  ) => Promise<Record<string, unknown> | void>;
  /** Permission required to cancel (defaults to writePerm). */
  cancelPerm?: Permission;
}

/** Loose equality between a stored value and an incoming form value. */
function sameValue(key: string, stored: unknown, incoming: unknown): boolean {
  const blank = (v: unknown) => v === null || v === undefined || v === '';
  if (blank(stored) || blank(incoming)) return blank(stored) && blank(incoming);
  if (stored instanceof Date || DATE_FIELDS.has(key)) {
    const a = new Date(stored as string | Date), b = new Date(incoming as string | Date);
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  }
  if (typeof incoming === 'number' || typeof incoming === 'boolean') return String(Number(stored)) === String(Number(incoming));
  if (Array.isArray(incoming)) return JSON.stringify(stored) === JSON.stringify(incoming);
  return String(stored) === String(incoming);
}

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
  /** Extra filter for the sum cards only (e.g. leave cancelled invoices out of Billed). */
  sumWhere?: Record<string, unknown>;
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
  transform?: (data: Record<string, unknown>, req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Side-effect after a successful create/update/delete (notifications, realtime). */
  afterChange?: (
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    record: Record<string, unknown>,
    req: Request,
  ) => Promise<void> | void;
  /** Runs inside the DELETE transaction (reverse what the record posted, atomically). */
  onDelete?: (tx: Prisma.TransactionClient, record: Record<string, unknown>, req: Request) => Promise<void>;
  /** Marks the model as a posted record: see PostingOptions. */
  posting?: PostingOptions;
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
  // A member limited to certain projects only ever lists those projects' records.
  const mine = allowedProjects(req);
  if (mine && !projectId && modelHasProject(opts.model)) where.projectId = { in: mine };

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
  assertProjectAccess(req, parsed.projectId);
  await assertRefsInOrg(orgId, parsed, opts.refs);
  // A WBS item must always belong to the record's own project (cost must not land on another job).
  if (parsed.wbsItemId) await assertWbsInProject(parsed, req);
  if (opts.validate) await opts.validate(parsed, req);
  let data = coerceDates(parsed);
  if (opts.transform) data = await opts.transform(data, req);
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
              where: { ...where, ...(opts.sumWhere ?? {}) },
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
      assertProjectAccess(req, (record as Record<string, unknown>).projectId);
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
      assertProjectAccess(req, (existing as Record<string, unknown>).projectId);

      const parsed = opts.updateSchema.parse(req.body) as Record<string, unknown>;
      if (opts.posting) {
        const ex = existing as Record<string, unknown>;
        if (ex.cancelledAt) throw Conflict(`This ${opts.entity.replace(/-/g, ' ')} is cancelled and can no longer be changed.`);
        if (ex.reversalOfId) throw Conflict('A reversal entry cannot be changed.');
        if (!opts.posting.isPosted || opts.posting.isPosted(ex)) {
          const allowed = new Set(opts.posting.editable ?? []);
          const locked = Object.keys(parsed).filter((k) => !allowed.has(k) && !sameValue(k, ex[k], parsed[k]));
          if (locked.length) {
            throw Conflict(`Posted ${opts.entity.replace(/-/g, ' ')} cannot be edited (${locked.join(', ')}). Cancel it with a reason and enter it again.`);
          }
          for (const k of Object.keys(parsed)) if (!allowed.has(k)) delete parsed[k];
        }
      }
      if (parsed.projectId) await assertProjectInOrg(req.user!.orgId, parsed.projectId);
      assertProjectAccess(req, parsed.projectId);
      await assertRefsInOrg(req.user!.orgId, parsed, opts.refs);
      if (parsed.wbsItemId || parsed.projectId) await assertWbsInProject({ ...(existing as Record<string, unknown>), ...parsed }, req);
      if (opts.validate) await opts.validate({ ...existing, ...parsed }, req);
      let data = coerceDates(parsed);
      if (opts.transform) data = await opts.transform({ ...existing, ...data }, req);
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
      assertProjectAccess(req, (existing as Record<string, unknown>).projectId);
      if (opts.posting && (!opts.posting.isPosted || opts.posting.isPosted(existing as Record<string, unknown>))) {
        throw Conflict(`Posted ${opts.entity.replace(/-/g, ' ')} records cannot be deleted. Cancel it with a reason instead; the original stays visible.`);
      }
      await prisma.$transaction(async (tx) => {
        await (tx as unknown as Record<string, Delegate>)[opts.model].delete({ where: { id: req.params.id } });
        if (opts.onDelete) await opts.onDelete(tx, existing as Record<string, unknown>, req);
      });
      await auditFromRequest(req, 'DELETE', opts.entity, req.params.id, { oldValues: existing });
      if (opts.afterChange) await opts.afterChange('DELETE', existing as Record<string, unknown>, req);
      return ok(res, { deleted: true });
    }),
  );

  // CANCEL (posted records): reason required, original kept, effects reversed atomically.
  if (opts.posting) {
    const posting = opts.posting;
    router.post(
      '/:id/cancel',
      requirePermission(posting.cancelPerm ?? opts.writePerm),
      asyncHandler(async (req, res) => {
        const reason = assertReason(req.body?.reason);
        const existing = (await delegate().findFirst({
          where: { id: req.params.id, organizationId: req.user!.orgId },
        })) as Record<string, unknown> | null;
        if (!existing) throw NotFound(`${opts.entity} not found`);
        assertProjectAccess(req, existing.projectId);
        if (existing.cancelledAt) throw Conflict('This record is already cancelled.');
        if (existing.reversalOfId) throw Conflict('A reversal entry cannot itself be cancelled.');
        const actor: CancelActor = { orgId: req.user!.orgId, userId: req.user!.id, reason };
        const record = await prisma.$transaction(async (tx) => {
          const extra = posting.onCancel ? (await posting.onCancel(tx, existing, actor, req)) ?? {} : {};
          return (tx as unknown as Record<string, Delegate>)[opts.model].update({
            where: { id: existing.id },
            data: { cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason, ...extra },
          });
        }, { timeout: 30000 });
        await auditFromRequest(req, 'CANCEL', opts.entity, String(existing.id), {
          oldValues: existing,
          newValues: { ...record, reason },
        });
        if (opts.afterChange) await opts.afterChange('UPDATE', record, req);
        return ok(res, record);
      }),
    );
  }

  return router;
}
