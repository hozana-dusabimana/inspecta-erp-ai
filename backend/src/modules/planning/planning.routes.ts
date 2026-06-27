import { Router, Request } from 'express';
import { z } from 'zod';
import { createCrudRouter } from '../../lib/crud';

const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

// ── WBS (Work Breakdown Structure) ────────────────────────────
const wbsCreate = z.object({
  projectId: z.string(),
  parentId: z.string().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  unit: z.string().optional(),
  quantity: z.number().nonnegative().optional(),
  level: z.number().int().min(1).optional(),
  weightPct: z.number().min(0).max(100).optional(),
  progressPct: z.number().min(0).max(100).optional(),
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
  refs: [{ field: 'parentId', model: 'wbsItem' }],
});

// ── BOQ (Bill of Quantities) ──────────────────────────────────
const boqCreate = z.object({
  projectId: z.string(),
  wbsItemId: z.string().optional(),
  code: z.string().min(1),
  category: z.string().optional(),
  description: z.string().min(1),
  unit: z.string().optional(),
  quantity: z.number().nonnegative(),
  rate: z.number().nonnegative(),
  markupPct: z.number().min(0).max(100).optional(),
  contingencyPct: z.number().min(0).max(100).optional(),
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
  refs: [{ field: 'wbsItemId', model: 'wbsItem' }],
  transform: (data) => {
    const qty = Number(data.quantity ?? 0);
    const rate = Number(data.rate ?? 0);
    const cost = qty * rate;
    data.amount = cost; // BOQ line cost = quantity × rate
    const markup = (cost * Number(data.markupPct ?? 0)) / 100;
    const contingency = (cost * Number(data.contingencyPct ?? 0)) / 100;
    data.budget = cost + markup + contingency; // Budget = Cost + Markup + Contingency
    // Revision tracking: increment on update (merged object carries createdAt).
    if (data.createdAt) data.revision = Number(data.revision ?? 0) + 1;
    return data;
  },
});

// ── Productivity Standards (#5) ───────────────────────────────
const productivityCreate = z.object({
  activity: z.string().min(1),
  unit: z.string().min(1),
  productivityRate: z.number().positive(),
  benchmarkSource: z.string().optional(),
  companyStandard: z.number().nonnegative().optional(),
  historicalStandard: z.number().nonnegative().optional(),
});

const productivityRouter = createCrudRouter({
  model: 'productivityStandard',
  entity: 'productivity-standard',
  readPerm: 'productivity:read',
  writePerm: 'productivity:write',
  createSchema: productivityCreate,
  updateSchema: productivityCreate.partial(),
  searchField: 'activity',
  orderBy: { activity: 'asc' },
  transform: stamp,
});

const router = Router();
router.use('/wbs', wbsRouter);
router.use('/boq', boqRouter);
router.use('/productivity', productivityRouter);

export default router;
