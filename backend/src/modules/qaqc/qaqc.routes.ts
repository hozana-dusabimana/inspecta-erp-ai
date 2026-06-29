import { Router, Request } from 'express';
import { z } from 'zod';
import { InspectionResult, Severity, NcrStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';

const num = (v: unknown) => Number(v ?? 0);
const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

const router = Router();

// ── Inspections ───────────────────────────────────────────────
const inspectionCreate = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  type: z.string().optional(),
  wbsItemId: z.string().optional(),
  result: z.nativeEnum(InspectionResult).optional(),
  defects: z.number().int().nonnegative().optional(),
  inspector: z.string().optional(),
  date: z.string().datetime().optional(),
  photos: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
router.use('/inspections', createCrudRouter({
  model: 'inspection', entity: 'inspection', readPerm: 'qaqc:read', writePerm: 'qaqc:write',
  createSchema: inspectionCreate, updateSchema: inspectionCreate.partial(),
  searchField: 'title', dateField: 'date', filterFields: ['result'],
  requireProject: true, orderBy: { date: 'desc' },
  refs: [{ field: 'wbsItemId', model: 'wbsItem' }], transform: stamp,
}));

// ── Material tests ────────────────────────────────────────────
const testCreate = z.object({
  projectId: z.string(),
  materialId: z.string().optional(),
  supplierId: z.string().optional(),
  testType: z.enum(['CONCRETE', 'SOIL', 'ASPHALT', 'STEEL', 'OTHER']).optional(),
  batchNumber: z.string().optional(),
  sampleDate: z.string().datetime().optional(),
  resultDate: z.string().datetime().optional(),
  result: z.nativeEnum(InspectionResult).optional(),
  labName: z.string().optional(),
  certificateNumber: z.string().optional(),
  notes: z.string().optional(),
});
router.use('/material-tests', createCrudRouter({
  model: 'materialTest', entity: 'material-test', readPerm: 'qaqc:read', writePerm: 'qaqc:write',
  createSchema: testCreate, updateSchema: testCreate.partial(),
  searchField: 'batchNumber', dateField: 'sampleDate', filterFields: ['result', 'testType'],
  requireProject: true, orderBy: { sampleDate: 'desc' },
  transform: stamp,
  afterChange: async (action, record, req) => {
    if (action !== 'DELETE' && record.result === 'FAIL') {
      await notify({ organizationId: req.user!.orgId, type: 'NCR', severity: 'HIGH', title: 'Material test FAILED', message: `${record.testType} test (batch ${record.batchNumber ?? '—'}) failed.`, link: '/qaqc' });
    }
  },
}));

// ── NCR register (workflow via status) ────────────────────────
const ncrCreate = z.object({
  projectId: z.string(),
  inspectionId: z.string().optional(),
  number: z.string().min(1).optional(), // auto-generated (NCR-####) when omitted
  description: z.string().min(1),
  wbsItemId: z.string().optional(),
  reworkCost: z.number().nonnegative().optional(),
  severity: z.nativeEnum(Severity).optional(),
  status: z.nativeEnum(NcrStatus).optional(),
  rootCause: z.string().optional(),
  correctiveAction: z.string().optional(),
  responsiblePerson: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  photos: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
  raisedBy: z.string().optional(),
  closedAt: z.string().datetime().optional(),
});
router.use('/ncrs', createCrudRouter({
  model: 'ncr', entity: 'ncr', readPerm: 'qaqc:read', writePerm: 'qaqc:write',
  createSchema: ncrCreate, updateSchema: ncrCreate.partial(),
  autoCode: { field: 'number', prefix: 'NCR' },
  searchField: 'description', filterFields: ['status', 'severity'], requireProject: true, orderBy: { createdAt: 'desc' },
  include: { actions: true }, refs: [{ field: 'wbsItemId', model: 'wbsItem' }, { field: 'inspectionId', model: 'inspection' }], transform: stamp,
  afterChange: async (action, record, req) => {
    if (action === 'CREATE' || (action === 'UPDATE' && record.severity === 'CRITICAL')) {
      await notify({ organizationId: req.user!.orgId, type: 'NCR', severity: (record.severity as Severity) ?? 'MEDIUM', title: `NCR ${record.number}`, message: String(record.description), link: `/projects/${record.projectId}` });
    }
  },
}));

// ── Corrective actions (first-class, multiple per NCR) ────────
const caCreate = z.object({
  ncrId: z.string().optional(),
  projectId: z.string().optional(),
  description: z.string().min(1),
  responsiblePerson: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'VERIFIED', 'CLOSED']).optional(),
  verification: z.string().optional(),
  closedAt: z.string().datetime().optional(),
});
router.use('/corrective-actions', createCrudRouter({
  model: 'correctiveAction', entity: 'corrective-action', readPerm: 'qaqc:read', writePerm: 'qaqc:write',
  createSchema: caCreate, updateSchema: caCreate.partial(),
  searchField: 'description', orderBy: { createdAt: 'desc' },
  refs: [{ field: 'ncrId', model: 'ncr' }], transform: stamp,
}));

// ── Rework (rework cost = labor + equipment) ──────────────────
const reworkCreate = z.object({
  projectId: z.string(),
  wbsItemId: z.string().optional(),
  ncrId: z.string().optional(),
  activity: z.string().min(1),
  quantity: z.number().nonnegative().optional(),
  laborCost: z.number().nonnegative().optional(),
  equipmentCost: z.number().nonnegative().optional(),
  delayDays: z.number().int().nonnegative().optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).optional(),
  notes: z.string().optional(),
});
router.use('/reworks', createCrudRouter({
  model: 'rework', entity: 'rework', readPerm: 'qaqc:read', writePerm: 'qaqc:write',
  createSchema: reworkCreate, updateSchema: reworkCreate.partial(),
  searchField: 'activity', filterFields: ['status'], sumFields: ['reworkCost', 'laborCost', 'equipmentCost'],
  requireProject: true, orderBy: { createdAt: 'desc' },
  transform: (data, req) => {
    data.reworkCost = num(data.laborCost) + num(data.equipmentCost);
    return stamp(data, req);
  },
}));

// ── Quality KPIs ──────────────────────────────────────────────
router.get('/kpis', authenticate, requirePermission('qaqc:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  const scope = { organizationId: orgId, projectId };

  const [inspections, tests, ncrs, reworks, costAgg] = await Promise.all([
    prisma.inspection.findMany({ where: scope, select: { result: true, defects: true, type: true } }),
    prisma.materialTest.findMany({ where: scope, select: { result: true } }),
    prisma.ncr.findMany({ where: scope, select: { status: true, severity: true } }),
    prisma.rework.aggregate({ where: scope, _sum: { reworkCost: true } }),
    prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
  ]);

  const totalDefects = inspections.reduce((s, i) => s + i.defects, 0);
  const testsFailed = tests.filter((t) => t.result === 'FAIL').length;
  const reworkCost = num(reworks._sum.reworkCost);
  const projectCost = num(costAgg._sum.amount);

  // Defect heatmap by inspection type.
  const byType = new Map<string, { defects: number; inspections: number }>();
  for (const i of inspections) {
    const g = byType.get(i.type) ?? { defects: 0, inspections: 0 };
    g.defects += i.defects; g.inspections += 1; byType.set(i.type, g);
  }

  return ok(res, {
    inspections: inspections.length,
    inspectionsPassed: inspections.filter((i) => i.result === 'PASS').length,
    totalDefects,
    defectRate: inspections.length > 0 ? Number(((totalDefects / inspections.length) * 100).toFixed(2)) : 0,
    tests: tests.length,
    testsFailed,
    testPassRate: tests.length > 0 ? Number((((tests.length - testsFailed) / tests.length) * 100).toFixed(1)) : 0,
    openNcrs: ncrs.filter((n) => n.status !== 'CLOSED').length,
    criticalNcrs: ncrs.filter((n) => n.severity === 'CRITICAL' && n.status !== 'CLOSED').length,
    reworkCost: Number(reworkCost.toFixed(2)),
    reworkCostPct: projectCost > 0 ? Number(((reworkCost / projectCost) * 100).toFixed(2)) : 0,
    ncrByStatus: ['DRAFT', 'OPEN', 'IN_PROGRESS', 'INVESTIGATING', 'CORRECTIVE_ACTION', 'CLOSED']
      .map((st) => ({ status: st, count: ncrs.filter((n) => n.status === st).length })).filter((x) => x.count > 0),
    defectsByType: [...byType.entries()].map(([type, g]) => ({ name: type, defects: g.defects, inspections: g.inspections })),
  });
}));

export default router;
