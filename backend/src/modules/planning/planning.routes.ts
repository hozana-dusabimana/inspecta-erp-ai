import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';

const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

const str = (v: unknown) => (v === null || v === undefined ? '' : String(typeof v === 'object' && 'text' in (v as any) ? (v as any).text : v).trim());
const numOrU = (v: unknown) => {
  const n = Number(str(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) && str(v) !== '' ? n : undefined;
};

/** Parse the first worksheet of an uploaded .xlsx into header-keyed rows. */
async function rowsFromXlsx(buf: Buffer): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = str(cell.value).toLowerCase(); });
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const obj: Record<string, unknown> = {};
    row.eachCell((cell, col) => { if (headers[col]) obj[headers[col]] = cell.value; });
    if (Object.values(obj).some((v) => str(v) !== '')) rows.push(obj);
  });
  return rows;
}

const xlsxRaw = express.raw({
  type: () => true, // accept any content-type for the upload body
  limit: '8mb',
});

async function sendXlsx(res: Response, sheetName: string, columns: Partial<ExcelJS.Column>[], rows: Record<string, unknown>[], filename: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'INSPECTA BUILDOS';
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns as ExcelJS.Column[];
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

// ── WBS (Work Breakdown Structure) ────────────────────────────
const wbsCreate = z.object({
  projectId: z.string(),
  parentId: z.string().nullable().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  unit: z.string().optional(),
  quantity: z.number().nonnegative().optional(),
  budgetAmount: z.number().nonnegative().optional(),
  sortOrder: z.number().int().optional(),
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

// ── Excel import / export for WBS & BOQ ───────────────────────
const ioRouter = Router();
ioRouter.use(authenticate);

function requireProjectQuery(req: Request): string {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  return projectId;
}

// WBS export
ioRouter.get('/wbs/export.xlsx', requirePermission('planning:read'), asyncHandler(async (req, res) => {
  const projectId = requireProjectQuery(req);
  const items = await prisma.wbsItem.findMany({ where: { organizationId: req.user!.orgId, projectId }, orderBy: { code: 'asc' } });
  await sendXlsx(res, 'WBS',
    [
      { header: 'code', key: 'code', width: 14 }, { header: 'name', key: 'name', width: 32 },
      { header: 'description', key: 'description', width: 30 }, { header: 'unit', key: 'unit', width: 10 },
      { header: 'quantity', key: 'quantity', width: 12 }, { header: 'level', key: 'level', width: 8 },
      { header: 'weightPct', key: 'weightPct', width: 10 }, { header: 'progressPct', key: 'progressPct', width: 12 },
    ],
    items.map((i) => ({ code: i.code, name: i.name, description: i.description, unit: i.unit, quantity: i.quantity ? Number(i.quantity) : null, level: i.level, weightPct: i.weightPct, progressPct: i.progressPct })),
    'wbs.xlsx');
}));

// WBS import
ioRouter.post('/wbs/import', requirePermission('planning:write'), xlsxRaw, asyncHandler(async (req, res) => {
  const projectId = requireProjectQuery(req);
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: req.user!.orgId }, select: { id: true } });
  if (!project) throw BadRequest('projectId does not belong to your organization');
  const rows = await rowsFromXlsx(req.body as Buffer);
  let created = 0; const errors: string[] = [];
  for (const [i, r] of rows.entries()) {
    const code = str(r.code); const name = str(r.name);
    if (!code || !name) { errors.push(`Row ${i + 2}: code and name are required`); continue; }
    await prisma.wbsItem.create({ data: {
      organizationId: req.user!.orgId, projectId,
      code, name, description: str(r.description) || null, unit: str(r.unit) || null,
      quantity: numOrU(r.quantity), level: numOrU(r.level) ?? 1,
      weightPct: numOrU(r.weightpct) ?? 0, progressPct: numOrU(r.progresspct) ?? 0,
    } });
    created++;
  }
  return ok(res, { created, skipped: errors.length, errors: errors.slice(0, 10) }, 201);
}));

// BOQ export
ioRouter.get('/boq/export.xlsx', requirePermission('planning:read'), asyncHandler(async (req, res) => {
  const projectId = requireProjectQuery(req);
  const items = await prisma.boqItem.findMany({ where: { organizationId: req.user!.orgId, projectId }, orderBy: { code: 'asc' } });
  await sendXlsx(res, 'BOQ',
    [
      { header: 'code', key: 'code', width: 14 }, { header: 'category', key: 'category', width: 16 },
      { header: 'description', key: 'description', width: 34 }, { header: 'unit', key: 'unit', width: 10 },
      { header: 'quantity', key: 'quantity', width: 12 }, { header: 'rate', key: 'rate', width: 12 },
      { header: 'amount', key: 'amount', width: 14 }, { header: 'markupPct', key: 'markupPct', width: 10 },
      { header: 'contingencyPct', key: 'contingencyPct', width: 12 }, { header: 'budget', key: 'budget', width: 14 },
    ],
    items.map((i) => ({ code: i.code, category: i.category, description: i.description, unit: i.unit, quantity: Number(i.quantity), rate: Number(i.rate), amount: Number(i.amount), markupPct: i.markupPct ? Number(i.markupPct) : null, contingencyPct: i.contingencyPct ? Number(i.contingencyPct) : null, budget: Number(i.budget) })),
    'boq.xlsx');
}));

// BOQ import
ioRouter.post('/boq/import', requirePermission('planning:write'), xlsxRaw, asyncHandler(async (req, res) => {
  const projectId = requireProjectQuery(req);
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: req.user!.orgId }, select: { id: true } });
  if (!project) throw BadRequest('projectId does not belong to your organization');
  const rows = await rowsFromXlsx(req.body as Buffer);
  let created = 0; const errors: string[] = [];
  for (const [i, r] of rows.entries()) {
    const code = str(r.code); const description = str(r.description);
    if (!code || !description) { errors.push(`Row ${i + 2}: code and description are required`); continue; }
    const quantity = numOrU(r.quantity) ?? 0; const rate = numOrU(r.rate) ?? 0;
    const cost = quantity * rate;
    const markupPct = numOrU(r.markuppct); const contingencyPct = numOrU(r.contingencypct);
    const budget = cost + (cost * (markupPct ?? 0)) / 100 + (cost * (contingencyPct ?? 0)) / 100;
    await prisma.boqItem.create({ data: {
      organizationId: req.user!.orgId, projectId,
      code, category: str(r.category) || null, description, unit: str(r.unit) || 'unit',
      quantity, rate, amount: cost, markupPct, contingencyPct, budget,
    } });
    created++;
  }
  return ok(res, { created, skipped: errors.length, errors: errors.slice(0, 10) }, 201);
}));

// ── BOQ Versioning + Cost Comparison (#3) ─────────────────────
const verRouter = Router();
verRouter.use(authenticate);
const num = (v: unknown) => Number(v ?? 0);

// LIST versions for a project.
verRouter.get('/', requirePermission('planning:read'), asyncHandler(async (req, res) => {
  const projectId = requireProjectQuery(req);
  const versions = await prisma.boqVersion.findMany({
    where: { organizationId: req.user!.orgId, projectId },
    orderBy: { versionNo: 'desc' },
    include: { _count: { select: { items: true } } },
  });
  return ok(res, versions);
}));

// SNAPSHOT the current BOQ into a new version.
verRouter.post('/', requirePermission('planning:write'), asyncHandler(async (req, res) => {
  const projectId = requireProjectQuery(req);
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: req.user!.orgId }, select: { id: true } });
  if (!project) throw BadRequest('projectId does not belong to your organization');
  const items = await prisma.boqItem.findMany({ where: { organizationId: req.user!.orgId, projectId }, orderBy: { code: 'asc' } });
  if (items.length === 0) throw BadRequest('No BOQ items to snapshot');

  const last = await prisma.boqVersion.findFirst({ where: { organizationId: req.user!.orgId, projectId }, orderBy: { versionNo: 'desc' }, select: { versionNo: true } });
  const versionNo = (last?.versionNo ?? 0) + 1;
  const totalCost = items.reduce((s, i) => s + num(i.amount), 0);
  const totalBudget = items.reduce((s, i) => s + num(i.budget), 0);
  const label = typeof req.body?.label === 'string' ? req.body.label : undefined;
  const note = typeof req.body?.note === 'string' ? req.body.note : undefined;

  const version = await prisma.boqVersion.create({
    data: {
      organizationId: req.user!.orgId, projectId, versionNo, label, note, totalCost, totalBudget,
      createdBy: req.user!.id,
      items: { create: items.map((i) => ({
        code: i.code, category: i.category, description: i.description, unit: i.unit,
        quantity: i.quantity, rate: i.rate, amount: i.amount,
        markupPct: i.markupPct, contingencyPct: i.contingencyPct, budget: i.budget,
      })) },
    },
    include: { _count: { select: { items: true } } },
  });
  return ok(res, version, 201);
}));

// COST COMPARISON between two versions (or a version vs current BOQ via to=current).
verRouter.get('/compare', requirePermission('planning:read'), asyncHandler(async (req, res) => {
  const projectId = requireProjectQuery(req);
  const orgId = req.user!.orgId;
  const fromId = req.query.from as string | undefined;
  const toId = req.query.to as string | undefined;
  if (!fromId || !toId) throw BadRequest('from and to version ids are required (to may be "current")');

  type Line = { code: string; description: string; amount: number; budget: number };
  const loadVersion = async (id: string): Promise<Line[]> => {
    const v = await prisma.boqVersion.findFirst({ where: { id, organizationId: orgId, projectId }, include: { items: true } });
    if (!v) throw BadRequest(`Version ${id} not found`);
    return v.items.map((i) => ({ code: i.code, description: i.description, amount: num(i.amount), budget: num(i.budget) }));
  };
  const loadCurrent = async (): Promise<Line[]> => {
    const items = await prisma.boqItem.findMany({ where: { organizationId: orgId, projectId } });
    return items.map((i) => ({ code: i.code, description: i.description, amount: num(i.amount), budget: num(i.budget) }));
  };

  const from = fromId === 'current' ? await loadCurrent() : await loadVersion(fromId);
  const to = toId === 'current' ? await loadCurrent() : await loadVersion(toId);
  const fromBy = new Map(from.map((l) => [l.code, l]));
  const toBy = new Map(to.map((l) => [l.code, l]));
  const codes = [...new Set([...fromBy.keys(), ...toBy.keys()])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const rows = codes.map((code) => {
    const f = fromBy.get(code); const t = toBy.get(code);
    const fromCost = f?.amount ?? 0; const toCost = t?.amount ?? 0;
    const fromBudget = f?.budget ?? 0; const toBudget = t?.budget ?? 0;
    const status = !f ? 'ADDED' : !t ? 'REMOVED' : (fromCost !== toCost || fromBudget !== toBudget) ? 'CHANGED' : 'SAME';
    return { code, description: (t ?? f)!.description, fromCost, toCost, costDelta: toCost - fromCost, fromBudget, toBudget, budgetDelta: toBudget - fromBudget, status };
  });

  return ok(res, {
    rows,
    fromTotalCost: from.reduce((s, l) => s + l.amount, 0),
    toTotalCost: to.reduce((s, l) => s + l.amount, 0),
    fromTotalBudget: from.reduce((s, l) => s + l.budget, 0),
    toTotalBudget: to.reduce((s, l) => s + l.budget, 0),
    changed: rows.filter((r) => r.status !== 'SAME').length,
  });
}));

// DETAIL with snapshot items.
verRouter.get('/:id', requirePermission('planning:read'), asyncHandler(async (req, res) => {
  const version = await prisma.boqVersion.findFirst({
    where: { id: req.params.id, organizationId: req.user!.orgId },
    include: { items: { orderBy: { code: 'asc' } } },
  });
  if (!version) throw BadRequest('Version not found');
  return ok(res, version);
}));

const router = Router();
router.use('/wbs', wbsRouter);
router.use('/boq', boqRouter);
router.use('/boq-versions', verRouter); // separate prefix avoids the /boq/:id route
router.use('/productivity', productivityRouter);
router.use('/io', ioRouter); // /planning/io/wbs/export.xlsx, /planning/io/boq/import, ...

export default router;
