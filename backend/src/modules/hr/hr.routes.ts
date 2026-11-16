import { Router, Request } from 'express';
import { z } from 'zod';
import { createCrudRouter } from '../../lib/crud';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { addApprovalRoutes, alertAwaitingApproval } from '../../lib/maker-checker';
import { auditFromRequest } from '../../auth/audit';

// Accept boolean or the string the generic form sends.
const boolish = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

// Stamp the lifecycle audit columns required by the multi-tenant spec.
const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

// ── Trades ────────────────────────────────────────────────────
const tradeSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
});
const trades = createCrudRouter({
  model: 'trade', entity: 'trade', readPerm: 'hr:read', writePerm: 'hr:write',
  createSchema: tradeSchema, updateSchema: tradeSchema.partial(),
  autoCode: { field: 'code', prefix: 'TRD' },
  searchField: 'name', orderBy: { name: 'asc' }, transform: stamp,
});

// ── Employees ─────────────────────────────────────────────────
const employeeSchema = z.object({
  employeeNo: z.string().optional(),
  fullName: z.string().min(2),
  nationalId: z.string().optional(),
  tradeId: z.string().optional(),
  crewId: z.string().optional(),
  projectId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  status: z.enum(['active', 'on_leave', 'terminated']).optional(),
  dailyWage: z.number().nonnegative().optional(),
  grossMonthlySalary: z.number().nonnegative().optional(),
  medicalScheme: z.enum(['rama', 'private', 'none']).optional(),
  hireDate: z.string().datetime().optional(),
  bankAccountNumber: z.string().optional(),
  skills: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
});
const employeesCrud = createCrudRouter({
  model: 'employee', entity: 'employee', readPerm: 'hr:read', writePerm: 'hr:write',
  createSchema: employeeSchema, updateSchema: employeeSchema.partial(),
  autoCode: { field: 'employeeNo', prefix: 'EMP' },
  searchField: 'fullName', orderBy: { fullName: 'asc' },
  filterFields: ['status'],
  sumFields: ['grossMonthlySalary'],
  include: { trade: { select: { id: true, name: true } } },
  refs: [{ field: 'tradeId', model: 'trade' }],
  transform: (data, req) => {
    if (data.email === '') data.email = null;
    return stamp(data, req);
  },
});

// ── Wage rates ────────────────────────────────────────────────
const wageSchema = z.object({
  tradeId: z.string(),
  rateType: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  effectiveDate: z.string().datetime().optional(),
});
// Maker-checker (T2-02): a new rate is PENDING and is not used for costing until a different
// person, holding a different role, approves it. An approved rate is never edited: add a new
// rate with an effective date instead, so history stays true.
const wageRates = createCrudRouter({
  model: 'wageRate', entity: 'wage-rate', readPerm: 'hr:read', writePerm: 'hr:write',
  createSchema: wageSchema, updateSchema: wageSchema.partial(),
  include: { trade: { select: { id: true, name: true } } },
  refs: [{ field: 'tradeId', model: 'trade' }],
  filterFields: ['approvalStatus'],
  transform: (data, req) => {
    if (!('id' in data)) data.approvalStatus = 'PENDING';
    return stamp(data, req);
  },
  posting: { isPosted: (r) => r.approvalStatus === 'APPROVED', editable: ['currency'], cancellable: false },
  afterChange: async (action, record, req) => {
    if (action !== 'CREATE') return;
    const trade = await prisma.trade.findUnique({ where: { id: String(record.tradeId) }, select: { name: true } });
    await alertAwaitingApproval(req.user!.orgId, 'wage-rate', String(record.id), 'Wage rate awaiting approval',
      `New ${trade?.name ?? ''} rate ${Number(record.amount).toLocaleString()} per ${record.rateType === 'HOURLY' ? 'hour' : 'day'} is awaiting approval.`, '/approvals');
  },
});
const wageDecisions = Router();
addApprovalRoutes(wageDecisions, { model: 'wageRate', entity: 'wage-rate', label: 'wage rate', makerField: 'createdBy' });

// A change to an existing employee's wage is a proposal: it becomes an approval request that a
// different person (different role) approves, and only then is it applied (approvals.routes.ts).
const wageChangeGate = asyncHandler(async (req, _res, next) => {
  const emp = await prisma.employee.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId } });
  if (!emp) return next();
  const proposed: Record<string, number | null> = {};
  for (const k of ['dailyWage', 'grossMonthlySalary'] as const) {
    if (!(k in (req.body ?? {}))) continue;
    const incoming = req.body[k] === '' || req.body[k] == null ? null : Number(req.body[k]);
    const current = emp[k] == null ? null : Number(emp[k]);
    if (incoming !== current && current != null) proposed[k] = incoming;
    if (current != null) delete req.body[k]; // never applied directly once a wage is set
  }
  if (Object.keys(proposed).length) {
    const reqRow = await prisma.approvalRequest.create({
      data: {
        organizationId: req.user!.orgId, projectId: emp.projectId, entityType: 'WAGE_CHANGE', entityId: emp.id,
        title: `Wage change for ${emp.fullName}: ${Object.entries(proposed).map(([k, v]) => `${k === 'dailyWage' ? 'daily' : 'monthly'} ${Number(emp[k as 'dailyWage']).toLocaleString()} → ${v == null ? 'none' : v.toLocaleString()}`).join(', ')}`,
        amount: proposed.grossMonthlySalary ?? proposed.dailyWage ?? 0, payload: proposed, requestedById: req.user!.id,
      },
    });
    await auditFromRequest(req, 'CREATE', 'approval-request', reqRow.id, { newValues: reqRow, reason: typeof req.body?.reason === 'string' ? req.body.reason : null });
    await alertAwaitingApproval(req.user!.orgId, 'approval', reqRow.id, 'Wage change awaiting approval', `${reqRow.title}.`, '/approvals');
  }
  next();
});

// ── Crews ─────────────────────────────────────────────────────
const crewSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1),
  foremanId: z.string().optional(),
  description: z.string().optional(),
});
const crews = createCrudRouter({
  model: 'crew', entity: 'crew', readPerm: 'hr:read', writePerm: 'hr:write',
  createSchema: crewSchema, updateSchema: crewSchema.partial(),
  searchField: 'name', orderBy: { name: 'asc' },
  include: { _count: { select: { members: true } } },
  transform: stamp,
});

// ── Crew members ──────────────────────────────────────────────
const crewMemberSchema = z.object({
  crewId: z.string(),
  employeeId: z.string(),
  roleInCrew: z.string().optional(),
});
const crewMembers = createCrudRouter({
  model: 'crewMember', entity: 'crew-member', readPerm: 'hr:read', writePerm: 'hr:write',
  createSchema: crewMemberSchema, updateSchema: crewMemberSchema.partial(),
  include: {
    crew: { select: { id: true, name: true } },
    employee: { select: { id: true, fullName: true } },
  },
  refs: [{ field: 'crewId', model: 'crew' }, { field: 'employeeId', model: 'employee' }],
  transform: stamp,
});

// ── Labor availability ────────────────────────────────────────
const availabilitySchema = z.object({
  employeeId: z.string(),
  date: z.string().datetime(),
  available: boolish.optional(),
  hoursAvailable: z.number().nonnegative().optional(),
  note: z.string().optional(),
});
const availability = createCrudRouter({
  model: 'laborAvailability', entity: 'labor-availability', readPerm: 'hr:read', writePerm: 'hr:write',
  createSchema: availabilitySchema, updateSchema: availabilitySchema.partial(),
  orderBy: { date: 'desc' },
  include: { employee: { select: { id: true, fullName: true } } },
  refs: [{ field: 'employeeId', model: 'employee' }],
  transform: stamp,
});

// Website team profiles — shown on the public /team page.
const teamSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  bio: z.string().optional(),
  photoUrl: z.string().optional(),
  sortOrder: z.number().int().optional(),
  published: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
});
const teamMembers = createCrudRouter({
  model: 'teamMember', entity: 'team-member', readPerm: 'hr:read', writePerm: 'hr:write',
  createSchema: teamSchema, updateSchema: teamSchema.partial(),
  searchField: 'name', orderBy: { sortOrder: 'asc' },
});

const router = Router();

// One headcount for HR and Payroll: payroll pays active staff, so both screens quote these numbers.
router.get('/headcount', authenticate, requirePermission('hr:read'), asyncHandler(async (req, res) => {
  const rows = await prisma.employee.findMany({ where: { organizationId: req.user!.orgId, deletedAt: null }, select: { status: true, grossMonthlySalary: true, dailyWage: true } });
  const active = rows.filter((e) => e.status === 'active');
  return ok(res, {
    total: rows.length,
    active: active.length,
    onLeave: rows.filter((e) => e.status === 'on_leave').length,
    terminated: rows.filter((e) => e.status === 'terminated').length,
    monthlyWageBillActive: active.reduce((s, e) => s + Number(e.grossMonthlySalary ?? 0), 0),
    activeWithoutSalary: active.filter((e) => !Number(e.grossMonthlySalary ?? 0) && !Number(e.dailyWage ?? 0)).length,
  });
}));
router.use('/trades', trades);
router.use('/team-members', teamMembers);
router.put('/employees/:id', authenticate, requirePermission('hr:write'), wageChangeGate);
router.use('/employees', employeesCrud);
router.use('/wage-rates', authenticate, wageDecisions);
router.use('/wage-rates', wageRates);
router.use('/crews', crews);
router.use('/crew-members', crewMembers);
router.use('/availability', availability);

export default router;
