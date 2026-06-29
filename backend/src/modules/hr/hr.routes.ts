import { Router, Request } from 'express';
import { z } from 'zod';
import { createCrudRouter } from '../../lib/crud';

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
const employees = createCrudRouter({
  model: 'employee', entity: 'employee', readPerm: 'hr:read', writePerm: 'hr:write',
  createSchema: employeeSchema, updateSchema: employeeSchema.partial(),
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
const wageRates = createCrudRouter({
  model: 'wageRate', entity: 'wage-rate', readPerm: 'hr:read', writePerm: 'hr:write',
  createSchema: wageSchema, updateSchema: wageSchema.partial(),
  include: { trade: { select: { id: true, name: true } } },
  refs: [{ field: 'tradeId', model: 'trade' }],
  transform: stamp,
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

const router = Router();
router.use('/trades', trades);
router.use('/employees', employees);
router.use('/wage-rates', wageRates);
router.use('/crews', crews);
router.use('/crew-members', crewMembers);
router.use('/availability', availability);

export default router;
