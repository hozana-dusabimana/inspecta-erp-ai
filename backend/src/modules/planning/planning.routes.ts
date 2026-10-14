import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter, CrudOptions, assertProjectInOrg } from '../../lib/crud';
import {
  xlsxRaw, rowsFromXlsx, sendTemplate, str, numOrU, hasValue, ImportReport, auditImport,
} from '../../lib/xlsx-import';
import { planWbsImport } from './wbs-import';

const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

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
export const wbsCreate = z.object({
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

/** A NEW item may not reuse a code already in the project (the Excel import skips repeats the same way). */
async function assertUniqueCode(model: 'wbsItem' | 'boqItem', data: Record<string, unknown>, req: Request, what: string) {
  if (data.id || !data.projectId || !data.code) return;
  const dup = await (prisma[model] as unknown as { findFirst: (a: unknown) => Promise<unknown> }).findFirst({
    where: { organizationId: req.user!.orgId, projectId: String(data.projectId), code: { equals: String(data.code), mode: 'insensitive' } },
  });
  if (dup) throw BadRequest(`${what} code "${data.code}" already exists in this project`);
}

export const wbsOpts: CrudOptions = {
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
  validate: async (data, req) => {
    await assertUniqueCode('wbsItem', data, req, 'WBS');
    // New nested item: sit one level under its parent unless a level was given.
    if (!data.id && data.parentId && data.level === undefined) {
      const parent = await prisma.wbsItem.findFirst({ where: { id: String(data.parentId), organizationId: req.user!.orgId }, select: { level: true, projectId: true } });
      if (parent && data.projectId && parent.projectId !== data.projectId) throw BadRequest('Parent WBS item must belong to the same project');
      if (parent) data.level = parent.level + 1;
    }
  },
};

const wbsRouter = createCrudRouter(wbsOpts);

// ── BOQ (Bill of Quantities) ──────────────────────────────────
export const boqCreate = z.object({
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

export const boqOpts: CrudOptions = {
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
  validate: (data, req) => assertUniqueCode('boqItem', data, req, 'BOQ'),
};

const boqRouter = createCrudRouter(boqOpts);

// ── Productivity Standards (#5) ───────────────────────────────
export const productivityCreate = z.object({
  activity: z.string().min(1),
  unit: z.string().min(1),
  productivityRate: z.number().positive(),
  benchmarkSource: z.string().optional(),
  companyStandard: z.number().nonnegative().optional(),
  historicalStandard: z.number().nonnegative().optional(),
});

export const productivityOpts: CrudOptions = {
  model: 'productivityStandard',
  entity: 'productivity-standard',
  readPerm: 'productivity:read',
  writePerm: 'productivity:write',
  createSchema: productivityCreate,
  updateSchema: productivityCreate.partial(),
  searchField: 'activity',
  orderBy: { activity: 'asc' },
  transform: stamp,
  // One rate per activity + unit: creating a second would silently shadow the first.
  validate: async (data, req) => {
    if (data.id || !data.activity || !data.unit) return;
    const dup = await prisma.productivityStandard.findFirst({
      where: { organizationId: req.user!.orgId, activity: { equals: String(data.activity), mode: 'insensitive' }, unit: { equals: String(data.unit), mode: 'insensitive' } },
      select: { id: true },
    });
    if (dup) throw BadRequest(`A productivity rate for "${data.activity}" (${data.unit}) already exists — edit it instead`);
  },
};

const productivityRouter = createCrudRouter(productivityOpts);

// ── Excel import / export for WBS, BOQ & productivity rates ───
const ioRouter = Router();
ioRouter.use(authenticate);

function requireProjectQuery(req: Request): string {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  return projectId;
}

// WBS export (round-trips with the import: parentCode is included)
ioRouter.get('/wbs/export.xlsx', requirePermission('planning:read'), asyncHandler(async (req, res) => {
  const projectId = requireProjectQuery(req);
  const items = await prisma.wbsItem.findMany({ where: { organizationId: req.user!.orgId, projectId }, orderBy: { code: 'asc' } });
  const codeById = new Map(items.map((i) => [i.id, i.code]));
  await sendXlsx(res, 'WBS',
    [
      { header: 'code', key: 'code', width: 14 }, { header: 'name', key: 'name', width: 32 },
      { header: 'parentCode', key: 'parentCode', width: 14 },
      { header: 'description', key: 'description', width: 30 }, { header: 'unit', key: 'unit', width: 10 },
      { header: 'quantity', key: 'quantity', width: 12 }, { header: 'budgetAmount', key: 'budgetAmount', width: 14 },
      { header: 'weightPct', key: 'weightPct', width: 10 }, { header: 'progressPct', key: 'progressPct', width: 12 },
    ],
    items.map((i) => ({ code: i.code, name: i.name, parentCode: i.parentId ? codeById.get(i.parentId) ?? null : null, description: i.description, unit: i.unit, quantity: i.quantity ? Number(i.quantity) : null, budgetAmount: i.budgetAmount ? Number(i.budgetAmount) : null, weightPct: i.weightPct, progressPct: i.progressPct })),
    'wbs.xlsx');
}));

ioRouter.get('/wbs/template.xlsx', requirePermission('planning:write'), asyncHandler(async (_req, res) => {
  await sendTemplate(res, 'WBS', [
    { header: 'code', example: '1.1', note: 'Required. Unique within the project (e.g. 1, 1.1, 1.1.1).' },
    { header: 'name', example: 'Substructure', note: 'Required.' },
    { header: 'parentCode', example: '1', note: 'Optional. When blank the parent is inferred from the dotted code ("1.1" sits under "1" if it exists), otherwise the item is a top-level node.' },
    { header: 'description', example: '', note: 'Optional.' },
    { header: 'unit', example: 'm3', note: 'Optional.' },
    { header: 'quantity', example: 120, note: 'Optional number ≥ 0.' },
    { header: 'budgetAmount', example: 5000000, note: 'Optional number ≥ 0.' },
    { header: 'weightPct', example: 25, note: 'Optional 0–100: weight among siblings for progress roll-up.' },
    { header: 'progressPct', example: 0, note: 'Optional 0–100.' },
  ], 'wbs-template.xlsx', 'Level is derived from the parent chain. Codes that already exist in the project are skipped, so re-importing a file is safe.');
}));

// WBS import
ioRouter.post('/wbs/import', requirePermission('planning:write'), xlsxRaw, asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = requireProjectQuery(req);
  await assertProjectInOrg(orgId, projectId);
  const rows = await rowsFromXlsx(req.body as Buffer);
  const existing = await prisma.wbsItem.findMany({ where: { organizationId: orgId, projectId }, select: { id: true, code: true, level: true } });
  const report = new ImportReport();
  const plan = planWbsImport(rows, existing, () => randomUUID(), report);
  if (plan.length) {
    await prisma.wbsItem.createMany({
      data: plan.map((w) => ({
        id: w.id, organizationId: orgId, projectId, parentId: w.parentId, code: w.code, name: w.name,
        description: w.description, unit: w.unit, quantity: w.quantity, budgetAmount: w.budgetAmount,
        level: w.level, sortOrder: w.sortOrder, weightPct: w.weightPct, progressPct: w.progressPct,
      })),
    });
  }
  report.created = plan.length;
  const outcome = report.outcome();
  await auditImport(req, 'wbs-item', outcome, { projectId });
  return ok(res, outcome, 201);
}));

// BOQ export
ioRouter.get('/boq/export.xlsx', requirePermission('planning:read'), asyncHandler(async (req, res) => {
  const projectId = requireProjectQuery(req);
  const items = await prisma.boqItem.findMany({ where: { organizationId: req.user!.orgId, projectId }, orderBy: { code: 'asc' }, include: { wbsItem: { select: { code: true } } } });
  await sendXlsx(res, 'BOQ',
    [
      { header: 'code', key: 'code', width: 14 }, { header: 'wbsCode', key: 'wbsCode', width: 12 },
      { header: 'category', key: 'category', width: 16 },
      { header: 'description', key: 'description', width: 34 }, { header: 'unit', key: 'unit', width: 10 },
      { header: 'quantity', key: 'quantity', width: 12 }, { header: 'rate', key: 'rate', width: 12 },
      { header: 'amount', key: 'amount', width: 14 }, { header: 'markupPct', key: 'markupPct', width: 10 },
      { header: 'contingencyPct', key: 'contingencyPct', width: 12 }, { header: 'budget', key: 'budget', width: 14 },
    ],
    items.map((i) => ({ code: i.code, wbsCode: i.wbsItem?.code ?? null, category: i.category, description: i.description, unit: i.unit, quantity: Number(i.quantity), rate: Number(i.rate), amount: Number(i.amount), markupPct: i.markupPct ? Number(i.markupPct) : null, contingencyPct: i.contingencyPct ? Number(i.contingencyPct) : null, budget: Number(i.budget) })),
    'boq.xlsx');
}));

ioRouter.get('/boq/template.xlsx', requirePermission('planning:write'), asyncHandler(async (_req, res) => {
  await sendTemplate(res, 'BOQ', [
    { header: 'code', example: 'B-001', note: 'Required. Unique within the project.' },
    { header: 'wbsCode', example: '1.1', note: 'Recommended. Links the line to a WBS item that already exists in the project (import the WBS first).' },
    { header: 'category', example: 'Concrete', note: 'Optional.' },
    { header: 'description', example: 'Reinforced concrete C25', note: 'Required.' },
    { header: 'unit', example: 'm3', note: 'Optional, default "unit".' },
    { header: 'quantity', example: 120, note: 'Number ≥ 0.' },
    { header: 'rate', example: 185000, note: 'Unit rate, number ≥ 0.' },
    { header: 'markupPct', example: 10, note: 'Optional 0–100.' },
    { header: 'contingencyPct', example: 5, note: 'Optional 0–100.' },
  ], 'boq-template.xlsx', 'Amount = quantity × rate; budget = amount + markup + contingency (computed for you). Codes that already exist in the project are skipped.');
}));

// BOQ import
ioRouter.post('/boq/import', requirePermission('planning:write'), xlsxRaw, asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = requireProjectQuery(req);
  await assertProjectInOrg(orgId, projectId);
  const rows = await rowsFromXlsx(req.body as Buffer);
  const [existing, wbs] = await Promise.all([
    prisma.boqItem.findMany({ where: { organizationId: orgId, projectId }, select: { code: true } }),
    prisma.wbsItem.findMany({ where: { organizationId: orgId, projectId }, select: { id: true, code: true } }),
  ]);
  const known = new Set(existing.map((b) => b.code.toLowerCase()));
  const wbsByCode = new Map(wbs.map((w) => [w.code.toLowerCase(), w.id]));
  const report = new ImportReport();
  const data: Record<string, unknown>[] = [];
  for (const { rowNo, cells: r } of rows) {
    const code = str(r.code); const description = str(r.description);
    if (!code || !description) { report.fail(rowNo, 'code and description are required'); continue; }
    if (known.has(code.toLowerCase())) { report.exists(rowNo, `BOQ code "${code}" already exists`); continue; }
    const quantity = hasValue(r.quantity) ? numOrU(r.quantity) : 0; const rate = hasValue(r.rate) ? numOrU(r.rate) : 0;
    if (quantity === undefined || quantity < 0) { report.fail(rowNo, 'quantity must be a number ≥ 0'); continue; }
    if (rate === undefined || rate < 0) { report.fail(rowNo, 'rate must be a number ≥ 0'); continue; }
    const markupPct = numOrU(r.markuppct); const contingencyPct = numOrU(r.contingencypct);
    if (hasValue(r.markuppct) && (markupPct === undefined || markupPct < 0 || markupPct > 100)) { report.fail(rowNo, 'markupPct must be between 0 and 100'); continue; }
    if (hasValue(r.contingencypct) && (contingencyPct === undefined || contingencyPct < 0 || contingencyPct > 100)) { report.fail(rowNo, 'contingencyPct must be between 0 and 100'); continue; }
    let wbsItemId: string | undefined;
    if (hasValue(r.wbscode)) {
      wbsItemId = wbsByCode.get(str(r.wbscode).toLowerCase());
      if (!wbsItemId) { report.fail(rowNo, `no WBS item with code "${str(r.wbscode)}" in this project (import the WBS first)`); continue; }
    }
    known.add(code.toLowerCase());
    const cost = quantity * rate;
    const budget = cost + (cost * (markupPct ?? 0)) / 100 + (cost * (contingencyPct ?? 0)) / 100;
    data.push({
      organizationId: orgId, projectId, wbsItemId, code, category: str(r.category) || null, description,
      unit: str(r.unit) || 'unit', quantity, rate, amount: cost, markupPct, contingencyPct, budget,
    });
  }
  if (data.length) await prisma.boqItem.createMany({ data: data as never });
  report.created = data.length;
  const outcome = report.outcome();
  await auditImport(req, 'boq-item', outcome, { projectId });
  return ok(res, outcome, 201);
}));

// Productivity baseline rates (organization-wide library)
ioRouter.get('/productivity/template.xlsx', requirePermission('productivity:write'), asyncHandler(async (_req, res) => {
  await sendTemplate(res, 'Productivity', [
    { header: 'activity', example: 'Block laying', note: 'Required. Together with unit it identifies the rate.' },
    { header: 'unit', example: 'm2', note: 'Required. Output unit.' },
    { header: 'productivityRate', example: 18, note: 'Required, > 0. Planned output units per crew-day.' },
    { header: 'companyStandard', example: 16, note: 'Optional number ≥ 0.' },
    { header: 'historicalStandard', example: 15, note: 'Optional number ≥ 0.' },
    { header: 'benchmarkSource', example: 'Site records 2025', note: 'Optional.' },
  ], 'productivity-rates-template.xlsx', 'A row whose activity + unit already exists UPDATES that rate instead of adding a duplicate.');
}));

ioRouter.post('/productivity/import', requirePermission('productivity:write'), xlsxRaw, asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const rows = await rowsFromXlsx(req.body as Buffer);
  const existing = await prisma.productivityStandard.findMany({ where: { organizationId: orgId }, select: { id: true, activity: true, unit: true } });
  const idByKey = new Map(existing.map((e) => [`${e.activity.toLowerCase()}|${e.unit.toLowerCase()}`, e.id]));
  const report = new ImportReport();
  const seen = new Set<string>();
  const creates: Record<string, unknown>[] = [];
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  for (const { rowNo, cells: r } of rows) {
    const activity = str(r.activity); const unit = str(r.unit);
    if (!activity || !unit) { report.fail(rowNo, 'activity and unit are required'); continue; }
    const rate = numOrU(r.productivityrate);
    if (rate === undefined || rate <= 0) { report.fail(rowNo, 'productivityRate must be a number > 0'); continue; }
    const company = numOrU(r.companystandard); const historical = numOrU(r.historicalstandard);
    if ((hasValue(r.companystandard) && (company === undefined || company < 0)) || (hasValue(r.historicalstandard) && (historical === undefined || historical < 0))) {
      report.fail(rowNo, 'companyStandard / historicalStandard must be numbers ≥ 0'); continue;
    }
    const key = `${activity.toLowerCase()}|${unit.toLowerCase()}`;
    if (seen.has(key)) { report.exists(rowNo, `"${activity}" (${unit}) appears more than once in the file`); continue; }
    seen.add(key);
    const fields = { activity, unit, productivityRate: rate, companyStandard: company, historicalStandard: historical, benchmarkSource: str(r.benchmarksource) || undefined };
    const id = idByKey.get(key);
    // An existing rate keeps its name/unit spelling; only the numbers and source change.
    if (id) updates.push({ id, data: { productivityRate: rate, companyStandard: company, historicalStandard: historical, benchmarkSource: fields.benchmarkSource, updatedBy: req.user!.id } });
    else creates.push({ ...fields, organizationId: orgId, createdBy: req.user!.id, updatedBy: req.user!.id });
  }
  await prisma.$transaction([
    ...(creates.length ? [prisma.productivityStandard.createMany({ data: creates as never })] : []),
    ...updates.map((u) => prisma.productivityStandard.update({ where: { id: u.id }, data: u.data as never })),
  ]);
  report.created = creates.length;
  report.updated = updates.length;
  const outcome = report.outcome();
  await auditImport(req, 'productivity-standard', outcome);
  return ok(res, outcome, 201);
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

/**
 * WBS roll-up: returns every WBS item with computed progress & budget.
 * - Leaf progress: derived from production (Σ actualQty ÷ Σ plannedQty, capped
 *   100%) when production exists, else the manually-entered progressPct.
 * - Parent progress: weight-weighted average of children (falls back to a plain
 *   average when sibling weights are all zero).
 * - Budget: leaf = budgetAmount; parent = sum of children's computed budget.
 * Registered before the /wbs CRUD mount so it isn't captured by /wbs/:id.
 */
router.get('/wbs/rollup', authenticate, requirePermission('planning:read'), asyncHandler(async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  const orgId = req.user!.orgId;

  const [items, prod, acts] = await Promise.all([
    prisma.wbsItem.findMany({ where: { organizationId: orgId, projectId } }),
    prisma.productionEntry.groupBy({
      by: ['wbsItemId'],
      where: { organizationId: orgId, projectId, wbsItemId: { not: null } },
      _sum: { plannedQty: true, actualQty: true },
    }),
    // Linked schedule activities — for date roll-up onto WBS branches.
    prisma.scheduleActivity.findMany({
      where: { organizationId: orgId, projectId, wbsItemId: { not: null } },
      select: { wbsItemId: true, startDate: true, finishDate: true },
    }),
  ]);

  const prodById = new Map(prod.map((p) => [p.wbsItemId as string, p._sum]));
  const actsByWbs = new Map<string, { start: number | null; finish: number | null }[]>();
  for (const a of acts) {
    const arr = actsByWbs.get(a.wbsItemId as string) ?? [];
    arr.push({ start: a.startDate ? a.startDate.getTime() : null, finish: a.finishDate ? a.finishDate.getTime() : null });
    actsByWbs.set(a.wbsItemId as string, arr);
  }
  const minOf = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.min(...v) : null; };
  const maxOf = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.max(...v) : null; };
  const kids = new Map<string, typeof items>();
  for (const it of items) {
    const key = it.parentId ?? '__root';
    const arr = kids.get(key) ?? [];
    arr.push(it);
    kids.set(key, arr);
  }

  type Computed = { progress: number; budget: number; fromProduction: boolean; isLeaf: boolean; start: number | null; finish: number | null };
  const memo = new Map<string, Computed>();
  const compute = (it: (typeof items)[number], guard: Set<string>): Computed => {
    const cached = memo.get(it.id);
    if (cached) return cached;
    if (guard.has(it.id)) return { progress: 0, budget: 0, fromProduction: false, isLeaf: true, start: null, finish: null }; // cycle guard
    guard.add(it.id);
    const children = kids.get(it.id) ?? [];
    // This node's own linked schedule activities contribute dates at any level.
    const own = actsByWbs.get(it.id) ?? [];
    const starts: (number | null)[] = own.map((a) => a.start);
    const finishes: (number | null)[] = own.map((a) => a.finish);
    let result: Computed;
    if (children.length === 0) {
      const sums = prodById.get(it.id);
      const planned = Number(sums?.plannedQty ?? 0);
      let progress = it.progressPct;
      let fromProduction = false;
      if (planned > 0) {
        progress = Math.min(100, (Number(sums?.actualQty ?? 0) / planned) * 100);
        fromProduction = true;
      }
      result = { progress, budget: Number(it.budgetAmount ?? 0), fromProduction, isLeaf: true, start: minOf(starts), finish: maxOf(finishes) };
    } else {
      let weightSum = 0;
      let weighted = 0;
      let budget = 0;
      for (const c of children) {
        const cr = compute(c, guard);
        weightSum += c.weightPct;
        weighted += c.weightPct * cr.progress;
        budget += cr.budget;
        starts.push(cr.start);
        finishes.push(cr.finish);
      }
      const progress = weightSum > 0
        ? weighted / weightSum
        : children.reduce((s, c) => s + compute(c, guard).progress, 0) / children.length;
      result = { progress, budget, fromProduction: false, isLeaf: false, start: minOf(starts), finish: maxOf(finishes) };
    }
    memo.set(it.id, result);
    return result;
  };

  const out = items.map((it) => {
    const r = compute(it, new Set());
    // Weight check: do this node's direct children's weights sum to ~100%?
    const children = kids.get(it.id) ?? [];
    const childWeightSum = children.reduce((s, c) => s + c.weightPct, 0);
    return {
      id: it.id,
      code: it.code,
      name: it.name,
      parentId: it.parentId,
      level: it.level,
      weightPct: it.weightPct,
      progress: Math.round(r.progress * 10) / 10,
      budget: r.budget,
      fromProduction: r.fromProduction,
      isLeaf: r.isLeaf,
      plannedStart: r.start != null ? new Date(r.start).toISOString() : null,
      plannedFinish: r.finish != null ? new Date(r.finish).toISOString() : null,
      childWeightSum: children.length ? Math.round(childWeightSum * 10) / 10 : null,
    };
  });

  return ok(res, { items: out });
}));

router.use('/wbs', wbsRouter);
router.use('/boq', boqRouter);
router.use('/boq-versions', verRouter); // separate prefix avoids the /boq/:id route
router.use('/productivity', productivityRouter);
router.use('/io', ioRouter); // /planning/io/wbs/export.xlsx, /planning/io/boq/import, ...

export default router;
