import { Router, Request } from 'express';
import { z } from 'zod';
import { assertWbsInProject } from '../../lib/wbs-link';
import { createCrudRouter } from '../../lib/crud';
import { prisma } from '../../lib/prisma';

const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

// ── Equipment categories ──────────────────────────────────────
const categorySchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
});
const categories = createCrudRouter({
  model: 'equipmentCategory', entity: 'equipment-category',
  readPerm: 'equipment:read', writePerm: 'equipment:write',
  createSchema: categorySchema, updateSchema: categorySchema.partial(),
  autoCode: { field: 'code', prefix: 'CAT' },
  searchField: 'name', orderBy: { name: 'asc' }, transform: stamp,
});

// ── Equipment register ────────────────────────────────────────
const equipmentSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  categoryId: z.string().optional(),
  ownershipStatus: z.enum(['OWNED', 'RENTED', 'LEASED']).optional(),
  status: z.enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'IDLE', 'DECOMMISSIONED']).optional(),
  fuelType: z.enum(['diesel', 'petrol', 'electric', 'none']).optional(),
  primaryProjectId: z.string().optional(),
  hourlyRate: z.number().nonnegative().optional(),
  dailyRate: z.number().nonnegative().optional(),
});
const register = createCrudRouter({
  model: 'equipment', entity: 'equipment',
  readPerm: 'equipment:read', writePerm: 'equipment:write',
  createSchema: equipmentSchema, updateSchema: equipmentSchema.partial(),
  autoCode: { field: 'code', prefix: 'EQ' },
  searchField: 'name', orderBy: { name: 'asc' },
  include: { category: { select: { id: true, name: true } } },
  refs: [{ field: 'categoryId', model: 'equipmentCategory' }],
  transform: stamp,
});

// ── Planned utilization (Utilization = Planned / Available hours) ──
const utilizationSchema = z.object({
  equipmentId: z.string(),
  projectId: z.string().optional(),
  periodStart: z.string().datetime().optional(),
  plannedHours: z.number().nonnegative(),
  availableHours: z.number().positive(),
  note: z.string().optional(),
});
const utilization = createCrudRouter({
  model: 'equipmentUtilization', entity: 'equipment-utilization',
  readPerm: 'equipment:read', writePerm: 'equipment:write',
  createSchema: utilizationSchema, updateSchema: utilizationSchema.partial(),
  orderBy: { periodStart: 'desc' },
  include: { equipment: { select: { id: true, code: true, name: true } } },
  refs: [{ field: 'equipmentId', model: 'equipment' }],
  transform: (data, req) => {
    const planned = Number(data.plannedHours ?? 0);
    const available = Number(data.availableHours ?? 0);
    data.utilizationPct = available > 0 ? Number(((planned / available) * 100).toFixed(2)) : 0;
    return stamp(data, req);
  },
});

// ── Maintenance schedule ──────────────────────────────────────
const maintenanceSchema = z.object({
  equipmentId: z.string(),
  type: z.enum(['scheduled', 'breakdown_repair']).optional(),
  scheduledDate: z.string().datetime().optional(),
  completedDate: z.string().datetime().optional(),
  cost: z.number().nonnegative().optional(),
  downtimeHours: z.number().nonnegative().optional(),
  nextDueDate: z.string().datetime().optional(),
  status: z.enum(['SCHEDULED', 'DONE', 'OVERDUE']).optional(),
  notes: z.string().optional(),
});
const maintenance = createCrudRouter({
  model: 'equipmentMaintenance', entity: 'equipment-maintenance',
  readPerm: 'equipment:read', writePerm: 'equipment:write',
  createSchema: maintenanceSchema, updateSchema: maintenanceSchema.partial(),
  dateField: 'scheduledDate',
  filterFields: ['status', 'type'],
  sumFields: ['cost', 'downtimeHours'],
  orderBy: { scheduledDate: 'desc' },
  include: { equipment: { select: { id: true, code: true, name: true } } },
  refs: [{ field: 'equipmentId', model: 'equipment' }],
  transform: stamp,
});

// ── Fuel logs (consumption & cost control) ────────────────────
const fuelSchema = z.object({
  equipmentId: z.string(),
  projectId: z.string().optional(),
  wbsItemId: z.string().optional(),
  date: z.string().datetime().optional(),
  liters: z.number().positive(),
  costPerLiter: z.number().nonnegative().optional(),
  odometerReading: z.number().nonnegative().optional(),
  supplier: z.string().optional(),
  note: z.string().optional(),
});
const fuelLogs = createCrudRouter({
  model: 'fuelLog', entity: 'fuel-log',
  readPerm: 'equipment:read', writePerm: 'equipment:write',
  createSchema: fuelSchema, updateSchema: fuelSchema.partial(),
  searchField: 'supplier',
  dateField: 'date',
  sumFields: ['liters', 'totalCost'],
  orderBy: { date: 'desc' },
  include: { equipment: { select: { id: true, code: true, name: true } } },
  refs: [{ field: 'equipmentId', model: 'equipment' }, { field: 'wbsItemId', model: 'wbsItem' }],
  validate: assertWbsInProject,
  transform: (data, req) => {
    // total_cost = liters × cost_per_liter
    const liters = Number(data.liters ?? 0);
    const cpl = Number(data.costPerLiter ?? 0);
    if (liters > 0 && cpl > 0) data.totalCost = Number((liters * cpl).toFixed(2));
    return stamp(data, req);
  },
  // Fuel burned on a project is project cost (equipment category), kept in step with the log.
  afterChange: async (action, record, req) => {
    const orgId = req.user!.orgId;
    const existing = await prisma.costEntry.findFirst({ where: { organizationId: orgId, source: 'FUEL', sourceRef: String(record.id) } });
    const amount = Number(record.totalCost ?? 0);
    if (action === 'DELETE' || !record.projectId || amount <= 0) { if (existing) await prisma.costEntry.delete({ where: { id: existing.id } }); return; }
    const data = { projectId: String(record.projectId), wbsItemId: (record.wbsItemId as string) ?? null, amount, date: (record.date as Date) ?? new Date(), description: `Fuel - ${Number(record.liters)} L` };
    if (existing) await prisma.costEntry.update({ where: { id: existing.id }, data });
    else await prisma.costEntry.create({ data: { ...data, organizationId: orgId, category: 'EQUIPMENT', source: 'FUEL', sourceRef: String(record.id), createdBy: req.user!.id } });
  },
});

// ── Equipment usage logs (daily hours, operator, WBS cost allocation) ──
export const usageSchema = z.object({
  equipmentId: z.string(),
  projectId: z.string().min(1, 'Select the project the equipment worked on'),
  wbsItemId: z.string().optional(),
  operatorId: z.string().optional(),
  date: z.string().datetime().optional(),
  hoursUsed: z.number().nonnegative(),
  note: z.string().optional(),
});
const usageLogs = createCrudRouter({
  model: 'equipmentUsageLog', entity: 'equipment-usage-log',
  readPerm: 'equipment:read', writePerm: 'equipment:write',
  createSchema: usageSchema, updateSchema: usageSchema.partial(),
  dateField: 'date',
  sumFields: ['hoursUsed'],
  orderBy: { date: 'desc' },
  include: { equipment: { select: { id: true, code: true, name: true } } },
  refs: [{ field: 'equipmentId', model: 'equipment' }, { field: 'wbsItemId', model: 'wbsItem' }],
  validate: assertWbsInProject,
  requireProject: true,
  // Cost = hours x the equipment's rate, posted to the project's finance ledger.
  transform: async (data, req) => {
    const eq = await prisma.equipment.findFirst({ where: { id: String(data.equipmentId), organizationId: req.user!.orgId }, select: { hourlyRate: true, dailyRate: true } });
    const rate = Number(eq?.hourlyRate ?? 0) || Number(eq?.dailyRate ?? 0) / 8;
    data.ratePerHour = rate || null;
    data.cost = Number((Number(data.hoursUsed ?? 0) * rate).toFixed(2));
    return stamp(data, req);
  },
  afterChange: async (action, record, req) => {
    const orgId = req.user!.orgId;
    const existing = await prisma.costEntry.findFirst({ where: { organizationId: orgId, source: 'EQUIPMENT_USAGE', sourceRef: String(record.id) } });
    if (action === 'DELETE') { if (existing) await prisma.costEntry.delete({ where: { id: existing.id } }); return; }
    const amount = Number(record.cost ?? 0);
    const eq = await prisma.equipment.findUnique({ where: { id: String(record.equipmentId) }, select: { name: true } });
    const data = {
      projectId: String(record.projectId), wbsItemId: (record.wbsItemId as string) ?? null, amount, date: (record.date as Date) ?? new Date(),
      description: `Equipment - ${eq?.name ?? 'usage'} x ${Number(record.hoursUsed)} h`,
    };
    if (existing) {
      if (amount > 0) await prisma.costEntry.update({ where: { id: existing.id }, data });
      else await prisma.costEntry.delete({ where: { id: existing.id } });
    } else if (amount > 0) {
      await prisma.costEntry.create({ data: { ...data, organizationId: orgId, category: 'EQUIPMENT', source: 'EQUIPMENT_USAGE', sourceRef: String(record.id), createdBy: req.user!.id } });
    }
  },
});

const router = Router();
router.use('/categories', categories);
router.use('/register', register);
router.use('/utilization', utilization);
router.use('/maintenance', maintenance);
router.use('/fuel-logs', fuelLogs);
router.use('/usage-logs', usageLogs);

export default router;
