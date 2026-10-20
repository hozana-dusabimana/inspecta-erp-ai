import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter, CrudOptions } from '../../lib/crud';
import { assertWbsInProject } from '../../lib/wbs-link';
import { auditFromRequest } from '../../auth/audit';
import { labourCost } from '../../lib/formulas';

const num = (v: unknown) => Number(v ?? 0);

/**
 * Daily rate for casual labour: the named worker's own rate wins, otherwise the
 * company wage rate for the trade (an HOURLY rate counts as 8 hours). Null when
 * nothing is configured, so the cost is 0 rather than a guess.
 */
export async function resolveDailyRate(orgId: string, trade?: string | null, casualWorkerId?: string | null): Promise<number | null> {
  if (casualWorkerId) {
    const w = await prisma.casualWorker.findFirst({ where: { id: casualWorkerId, organizationId: orgId }, select: { dailyRate: true } });
    if (w && num(w.dailyRate) > 0) return num(w.dailyRate);
  }
  if (!trade) return null;
  const t = await prisma.trade.findFirst({ where: { organizationId: orgId, name: { equals: trade, mode: 'insensitive' } }, select: { id: true } });
  if (!t) return null;
  const wage = await prisma.wageRate.findFirst({ where: { organizationId: orgId, tradeId: t.id }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }] });
  if (!wage || num(wage.amount) <= 0) return null;
  return wage.rateType === 'HOURLY' ? num(wage.amount) * 8 : num(wage.amount);
}

export const attendanceCreate = z.object({
  projectId: z.string(),
  employeeId: z.string().optional(),
  wbsItemId: z.string().optional(),
  casualWorkerId: z.string().optional(),
  productionEntryId: z.string().optional(),
  date: z.string().datetime().optional(),
  workerName: z.string().optional(),
  trade: z.string().optional(),
  headcount: z.number().int().min(1).max(10000).optional(),
  status: z.enum(['present', 'half_day', 'absent', 'leave']).optional(),
  hoursWorked: z.number().nonnegative().max(24).optional(),
  present: z.boolean().optional(),
  evidenceUrl: z.string().optional(),
});

// Rate lookups are async but CRUD `transform` is sync: validate resolves, transform applies.
const resolved = new WeakMap<Request, { rate: number | null; name?: string; trade?: string | null }>();

export const attendanceOpts: CrudOptions = {
  model: 'attendance',
  entity: 'attendance',
  readPerm: 'fieldops:read',
  writePerm: 'fieldops:write',
  createSchema: attendanceCreate,
  updateSchema: attendanceCreate.partial(),
  searchField: 'workerName',
  dateField: 'date',
  filterFields: ['status'],
  sumFields: ['hoursWorked', 'cost', 'headcount'],
  requireProject: true,
  orderBy: { date: 'desc' },
  refs: [
    { field: 'employeeId', model: 'employee' },
    { field: 'wbsItemId', model: 'wbsItem' },
    { field: 'casualWorkerId', model: 'casualWorker' },
    { field: 'productionEntryId', model: 'productionEntry' },
  ],
  validate: async (data, req) => {
    await assertWbsInProject(data, req);
    let name: string | undefined;
    let trade = data.trade ? String(data.trade) : null;
    if (data.casualWorkerId) {
      const w = await prisma.casualWorker.findFirst({ where: { id: String(data.casualWorkerId), organizationId: req.user!.orgId } });
      if (w) { name = w.fullName; trade = trade ?? w.trade; }
    }
    // HR employees are paid through the monthly payroll run, never costed here.
    const rate = data.employeeId ? null : await resolveDailyRate(req.user!.orgId, trade, data.casualWorkerId ? String(data.casualWorkerId) : null);
    resolved.set(req, { rate, name, trade });
  },
  // Keep present/status consistent so payroll proration and field views agree.
  transform: (data, req) => {
    if (typeof data.status === 'string') data.present = data.status === 'present' || data.status === 'half_day';
    const r = resolved.get(req);
    const headcount = Math.max(1, num(data.headcount ?? 1));
    data.headcount = headcount;
    if (!data.workerName) data.workerName = r?.name ?? `${data.trade ?? r?.trade ?? 'Casual labour'} ×${headcount}`;
    if (r) {
      data.ratePerDay = r.rate;
      data.cost = r.rate && data.present !== false ? labourCost(headcount, num(data.hoursWorked), r.rate) : 0;
    }
    return data;
  },
};

const workerSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  trade: z.string().optional(),
  dailyRate: z.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

const stamp = (d: Record<string, unknown>, req: Request) => {
  if (!('id' in d)) d.createdBy = req.user!.id;
  d.updatedBy = req.user!.id;
  return d;
};

export const casualWorkerOpts: CrudOptions = {
  model: 'casualWorker',
  entity: 'casual-worker',
  readPerm: 'fieldops:read',
  writePerm: 'fieldops:write',
  createSchema: workerSchema,
  updateSchema: workerSchema.partial(),
  searchField: 'fullName',
  orderBy: { fullName: 'asc' },
  transform: stamp,
};

/** Monday 00:00 UTC of the week containing `d`. */
function weekStartOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

export const labourRouter = Router();
labourRouter.use(authenticate);

// Site engineer signs off the headcount (foremen enter it, engineers verify it).
labourRouter.post('/attendance/verify', requirePermission('approval:write'), asyncHandler(async (req, res) => {
  const body = z.object({ ids: z.array(z.string()).optional(), projectId: z.string().optional(), date: z.string().optional(), to: z.string().optional() }).parse(req.body);
  if (!body.ids?.length && !(body.projectId && body.date)) throw BadRequest('Give attendance ids, or a project and a date');
  const day = body.date ? new Date(`${body.date.slice(0, 10)}T00:00:00.000Z`) : null;
  const last = body.to ? new Date(`${body.to.slice(0, 10)}T00:00:00.000Z`) : day;
  const where = {
    organizationId: req.user!.orgId, verifiedAt: null, employeeId: null,
    ...(body.ids?.length ? { id: { in: body.ids } } : { projectId: body.projectId!, date: { gte: day!, lt: new Date(last!.getTime() + 86400000) } }),
  };
  const r = await prisma.attendance.updateMany({ where, data: { verifiedById: req.user!.id, verifiedAt: new Date() } });
  await auditFromRequest(req, 'UPDATE', 'attendance', body.projectId ?? 'bulk', { newValues: { verified: r.count } });
  return ok(res, { verified: r.count });
}));

interface PayGroup {
  key: string; name: string; kind: 'named' | 'headcount'; phone: string | null; nationalId: string | null; trade: string | null;
  dates: Set<string>; hours: number; amount: number; unverified: number; noRate: number; byDay: Record<string, number>;
}

// Weekly casual pay sheet, built from attendance and kept apart from monthly payroll.
labourRouter.get('/casual-paysheet', requirePermission('fieldops:read'), asyncHandler(async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  const given = req.query.weekStart ? new Date(`${String(req.query.weekStart).slice(0, 10)}T00:00:00.000Z`) : new Date();
  if (isNaN(given.getTime())) throw BadRequest('weekStart must be a date (YYYY-MM-DD)');
  const start = weekStartOf(given);
  const end = new Date(start.getTime() + 7 * 86400000);
  const rows = await prisma.attendance.findMany({
    where: {
      organizationId: req.user!.orgId, employeeId: null, present: true, date: { gte: start, lt: end },
      ...(projectId ? { projectId } : {}),
    },
    include: { casualWorker: { select: { id: true, fullName: true, phone: true, nationalId: true, trade: true } } },
    orderBy: { date: 'asc' },
  });
  const groups = new Map<string, PayGroup>();
  for (const a of rows) {
    const named = a.casualWorker;
    const key = named ? `w:${named.id}` : `t:${(a.trade ?? 'Unspecified').toLowerCase()}`;
    const g: PayGroup = groups.get(key) ?? {
      key, kind: named ? 'named' : 'headcount', name: named?.fullName ?? `${a.trade ?? 'Unspecified trade'} (headcount)`,
      phone: named?.phone ?? null, nationalId: named?.nationalId ?? null, trade: named?.trade ?? a.trade ?? null,
      dates: new Set<string>(), hours: 0, amount: 0, unverified: 0, noRate: 0, byDay: {},
    };
    const day = a.date.toISOString().slice(0, 10);
    g.dates.add(day);
    g.hours += a.headcount * num(a.hoursWorked);
    g.amount += num(a.cost);
    g.byDay[day] = (g.byDay[day] ?? 0) + a.headcount;
    if (!a.verifiedAt) g.unverified += 1;
    if (a.ratePerDay == null) g.noRate += 1;
    groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => ({
    key: g.key, name: g.name, kind: g.kind, phone: g.phone, nationalId: g.nationalId, trade: g.trade,
    daysWorked: g.dates.size, hours: Number(g.hours.toFixed(2)), workerDays: Number((g.hours / 8).toFixed(2)),
    amount: Number(g.amount.toFixed(2)), unverifiedRecords: g.unverified, recordsWithoutRate: g.noRate, headcountByDay: g.byDay,
  })).sort((a, b) => a.name.localeCompare(b.name));
  return ok(res, {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: new Date(end.getTime() - 86400000).toISOString().slice(0, 10),
    projectId: projectId ?? null,
    lines,
    totals: {
      workerDays: Number(lines.reduce((s, l) => s + l.workerDays, 0).toFixed(2)),
      amount: Number(lines.reduce((s, l) => s + l.amount, 0).toFixed(2)),
      unverifiedRecords: lines.reduce((s, l) => s + l.unverifiedRecords, 0),
      recordsWithoutRate: lines.reduce((s, l) => s + l.recordsWithoutRate, 0),
    },
  });
}));

labourRouter.use('/casual-workers', createCrudRouter(casualWorkerOpts));
