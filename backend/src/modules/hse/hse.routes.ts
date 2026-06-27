import { Router, Request } from 'express';
import { z } from 'zod';
import { IncidentType, Severity, InspectionResult } from '@prisma/client';
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

// ── Incidents (incl. near-miss + investigation/root cause) ────
const incidentCreate = z.object({
  projectId: z.string(),
  type: z.nativeEnum(IncidentType).optional(),
  severity: z.nativeEnum(Severity).optional(),
  description: z.string().min(1),
  location: z.string().optional(),
  hazard: z.string().optional(),
  investigation: z.string().optional(),
  rootCause: z.string().optional(),
  correctiveAction: z.string().optional(),
  reportedBy: z.string().optional(),
  date: z.string().datetime().optional(),
  photos: z.array(z.string()).optional(),
});
router.use('/incidents', createCrudRouter({
  model: 'incident', entity: 'incident', readPerm: 'hse:read', writePerm: 'hse:write',
  createSchema: incidentCreate, updateSchema: incidentCreate.partial(),
  searchField: 'description', requireProject: true, orderBy: { date: 'desc' }, transform: stamp,
  afterChange: async (action, record, req) => {
    if (action === 'CREATE') {
      await notify({ organizationId: req.user!.orgId, type: 'SAFETY_INCIDENT', severity: (record.severity as Severity) ?? 'MEDIUM', title: `Safety incident: ${record.type}`, message: String(record.description), link: `/projects/${record.projectId}` });
    }
  },
}));

// ── Toolbox talks ─────────────────────────────────────────────
const talkCreate = z.object({
  projectId: z.string(),
  topic: z.string().min(1),
  presenter: z.string().optional(),
  attendees: z.number().int().nonnegative().optional(),
  date: z.string().datetime().optional(),
  notes: z.string().optional(),
});
router.use('/toolbox-talks', createCrudRouter({
  model: 'toolboxTalk', entity: 'toolbox-talk', readPerm: 'hse:read', writePerm: 'hse:write',
  createSchema: talkCreate, updateSchema: talkCreate.partial(),
  searchField: 'topic', requireProject: true, orderBy: { date: 'desc' },
}));

// ── PPE tracking ──────────────────────────────────────────────
const ppeCreate = z.object({
  projectId: z.string().optional(),
  employeeId: z.string().optional(),
  ppeType: z.string().min(1),
  quantity: z.number().int().positive().optional(),
  issueDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});
router.use('/ppe', createCrudRouter({
  model: 'ppeIssue', entity: 'ppe-issue', readPerm: 'hse:read', writePerm: 'hse:write',
  createSchema: ppeCreate, updateSchema: ppeCreate.partial(),
  searchField: 'ppeType', orderBy: { issueDate: 'desc' },
  refs: [{ field: 'employeeId', model: 'employee' }], transform: stamp,
}));

// ── Safety inspections ────────────────────────────────────────
const safetyCreate = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  template: z.string().optional(),
  inspector: z.string().optional(),
  date: z.string().datetime().optional(),
  result: z.nativeEnum(InspectionResult).optional(),
  score: z.number().min(0).max(100).optional(),
  findings: z.string().optional(),
  correctiveAction: z.string().optional(),
  photos: z.array(z.string()).optional(),
});
router.use('/safety-inspections', createCrudRouter({
  model: 'safetyInspection', entity: 'safety-inspection', readPerm: 'hse:read', writePerm: 'hse:write',
  createSchema: safetyCreate, updateSchema: safetyCreate.partial(),
  searchField: 'title', requireProject: true, orderBy: { date: 'desc' }, transform: stamp,
}));

// ── Safety KPIs (incident frequency rate, safety score) ───────
router.get('/kpis', authenticate, requirePermission('hse:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  const scope = { organizationId: orgId, projectId };

  const [incidents, talks, ppe, safety, laborAgg, risks] = await Promise.all([
    prisma.incident.findMany({ where: scope, select: { type: true, severity: true } }),
    prisma.toolboxTalk.aggregate({ where: scope, _sum: { attendees: true }, _count: true }),
    prisma.ppeIssue.findMany({ where: { organizationId: orgId }, select: { expiryDate: true } }),
    prisma.safetyInspection.findMany({ where: scope, select: { result: true } }),
    prisma.productionEntry.aggregate({ where: scope, _sum: { laborHours: true } }),
    prisma.risk.findMany({ where: scope, select: { score: true, status: true } }),
  ]);

  const laborHours = num(laborAgg._sum.laborHours);
  const nearMiss = incidents.filter((i) => i.type === 'NEAR_MISS').length;
  const lostTime = incidents.filter((i) => i.type === 'LOST_TIME' || i.type === 'FATALITY').length;
  // Incident Frequency Rate = incidents / labor hours × 200,000.
  const ifr = laborHours > 0 ? (incidents.length / laborHours) * 200000 : 0;
  // Safety Score = 100 − weighted risk (open risk scores + injury penalties).
  const openRiskWeight = risks.filter((r) => r.status !== 'CLOSED').reduce((s, r) => s + r.score, 0);
  const safetyScore = Math.max(0, 100 - Math.min(100, openRiskWeight + lostTime * 10 + incidents.length * 2));
  const now = Date.now();
  const ppeExpiring = ppe.filter((p) => p.expiryDate && p.expiryDate.getTime() < now + 30 * 86400000).length;

  return ok(res, {
    incidents: incidents.length,
    nearMiss,
    lostTimeInjuries: lostTime,
    incidentFrequencyRate: Number(ifr.toFixed(2)),
    safetyScore: Number(safetyScore.toFixed(0)),
    toolboxTalks: talks._count,
    toolboxAttendance: num(talks._sum.attendees),
    safetyInspections: safety.length,
    safetyPassRate: safety.length > 0 ? Number(((safety.filter((s) => s.result === 'PASS').length / safety.length) * 100).toFixed(1)) : 0,
    ppeExpiringSoon: ppeExpiring,
    incidentsByType: [...new Set(incidents.map((i) => i.type))].map((t) => ({ name: t, count: incidents.filter((i) => i.type === t).length })),
    riskMatrix: risks.map((r) => ({ score: r.score, status: r.status })),
  });
}));

export default router;
