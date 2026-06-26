import { Router } from 'express';
import { z } from 'zod';
import { createCrudRouter } from '../../lib/crud';

// ── WBS (Work Breakdown Structure) ────────────────────────────
const wbsCreate = z.object({
  projectId: z.string(),
  parentId: z.string().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  level: z.number().int().min(1).optional(),
  weightPct: z.number().min(0).max(100).optional(),
});

const wbsRouter = createCrudRouter({
  model: 'wbsItem',
  entity: 'wbs-item',
  readPerm: 'planning:read',
  writePerm: 'planning:write',
  createSchema: wbsCreate,
  updateSchema: wbsCreate.partial(),
  searchField: 'name',
  requireProject: true,
  orderBy: { code: 'asc' },
});

// ── BOQ (Bill of Quantities) ──────────────────────────────────
const boqCreate = z.object({
  projectId: z.string(),
  wbsItemId: z.string().optional(),
  code: z.string().min(1),
  description: z.string().min(1),
  unit: z.string().optional(),
  quantity: z.number().nonnegative(),
  rate: z.number().nonnegative(),
});

const boqRouter = createCrudRouter({
  model: 'boqItem',
  entity: 'boq-item',
  readPerm: 'planning:read',
  writePerm: 'planning:write',
  createSchema: boqCreate,
  updateSchema: boqCreate.partial(),
  searchField: 'description',
  requireProject: true,
  orderBy: { code: 'asc' },
  transform: (data) => {
    const qty = Number(data.quantity ?? 0);
    const rate = Number(data.rate ?? 0);
    data.amount = qty * rate; // BOQ line amount = quantity × rate
    return data;
  },
});

const router = Router();
router.use('/wbs', wbsRouter);
router.use('/boq', boqRouter);

export default router;
