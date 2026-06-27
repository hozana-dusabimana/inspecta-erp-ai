import { Router, Request } from 'express';
import { z } from 'zod';
import { createCrudRouter } from '../../lib/crud';

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
  searchField: 'name', orderBy: { name: 'asc' }, transform: stamp,
});

// ── Equipment register ────────────────────────────────────────
const equipmentSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  categoryId: z.string().optional(),
  ownershipStatus: z.enum(['OWNED', 'RENTED', 'LEASED']).optional(),
  status: z.enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE']).optional(),
  hourlyRate: z.number().nonnegative().optional(),
  dailyRate: z.number().nonnegative().optional(),
});
const register = createCrudRouter({
  model: 'equipment', entity: 'equipment',
  readPerm: 'equipment:read', writePerm: 'equipment:write',
  createSchema: equipmentSchema, updateSchema: equipmentSchema.partial(),
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
  type: z.string().optional(),
  scheduledDate: z.string().datetime().optional(),
  completedDate: z.string().datetime().optional(),
  cost: z.number().nonnegative().optional(),
  status: z.enum(['SCHEDULED', 'DONE', 'OVERDUE']).optional(),
  notes: z.string().optional(),
});
const maintenance = createCrudRouter({
  model: 'equipmentMaintenance', entity: 'equipment-maintenance',
  readPerm: 'equipment:read', writePerm: 'equipment:write',
  createSchema: maintenanceSchema, updateSchema: maintenanceSchema.partial(),
  orderBy: { scheduledDate: 'desc' },
  include: { equipment: { select: { id: true, code: true, name: true } } },
  refs: [{ field: 'equipmentId', model: 'equipment' }],
  transform: stamp,
});

const router = Router();
router.use('/categories', categories);
router.use('/register', register);
router.use('/utilization', utilization);
router.use('/maintenance', maintenance);

export default router;
