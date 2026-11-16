import { Router, Request } from 'express';
import { z } from 'zod';
import { IncidentType, Severity, InspectionResult } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound, Conflict } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';
import { safetyScore } from '../../lib/safety';
import { assertMakerChecker } from '../../lib/maker-checker';
import { evidenceFromBody, saveEvidence } from '../../lib/evidence';
import { auditFromRequest } from '../../auth/audit';

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
  wbsItemId: z.string().optional(),
  number: z.string().min(1).optional(), // auto-generated (INC-####) when omitted
  type: z.nativeEnum(IncidentType).optional(),
  severity: z.nativeEnum(Severity).optional(),
  description: z.string().min(1),
  location: z.string().optional(),
  hazard: z.string().optional(),
  investigation: z.string().optional(),
  rootCause: z.string().optional(),
  correctiveAction: z.string().optional(),
  involvedEmployeeId: z.string().optional(),
  reportedBy: z.string().optional(),
  date: z.string().datetime().optional(),
  photos: z.array(z.string()).optional(),
});
router.use('/incidents', createCrudRouter({
  model: 'incident', entity: 'incident', readPerm: 'hse:read', writePerm: 'hse:write',
  evidence: 'incident',
  createSchema: incidentCreate, updateSchema: incidentCreate.partial(),
  autoCode: { field: 'number', prefix: 'INC' },
  searchField: 'description', dateField: 'date', filterFields: ['type', 'severity'],
  requireProject: true, orderBy: { date: 'desc' }, transform: stamp,
  afterChange: async (action, record, req) => {
    if (action === 'CREATE') {
      const s = await safetyScore(req.user!.orgId, { projectId: String(record.projectId) });
      await notify({ organizationId: req.user!.orgId, type: 'SAFETY_INCIDENT', severity: (record.severity as Severity) ?? 'MEDIUM', title: `Safety incident: ${record.type}`, message: `${record.description} — safety score now ${s.score}.`, link: `/projects/${record.projectId}` });
    }
  },
}));

// Close an incident: corrective action + evidence, by someone other than the reporter (T2-06).
router.post('/incidents/:id/close', authenticate, requirePermission('hse:write'), asyncHandler(async (req, res) => {
  const body = z.object({ correctiveAction: z.string().trim().min(5, 'Describe the corrective action taken'), note: z.string().max(2000).optional() }).parse(req.body);
  const inc = await prisma.incident.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId } });
  if (!inc) throw NotFound('Incident not found');
  if (inc.closedAt) throw Conflict('This incident is already closed.');
  const evidence = evidenceFromBody(req.body);
  // The photo taken when the incident was reported proves the incident, not the fix: closing carries its own.
  if (!evidence.length) throw BadRequest('Cannot close the incident without evidence of the corrective action (a photo or document).');
  await assertMakerChecker(req, inc.createdBy, 'incident closure');
  if (evidence.length) await saveEvidence(req.user!.orgId, req.user!.id, 'incident', inc.id, inc.projectId, evidence);
  const closed = await prisma.incident.update({ where: { id: inc.id }, data: { closedAt: new Date(), closedById: req.user!.id, closeNote: body.note ?? null, correctiveAction: body.correctiveAction, updatedBy: req.user!.id } });
  await auditFromRequest(req, 'UPDATE', 'incident', inc.id, { oldValues: inc, newValues: closed, reason: `Closed: ${body.correctiveAction}` });
  return ok(res, { ...closed, safety: await safetyScore(req.user!.orgId, { projectId: inc.projectId }) });
}));

// The safety score with every reason that lowered it.
router.get('/safety-score', authenticate, requirePermission('hse:read'), asyncHandler(async (req, res) => {
  return ok(res, await safetyScore(req.user!.orgId, { projectId: (req.query.projectId as string) || undefined, projectIds: req.user!.projectIds }));
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
  searchField: 'topic', dateField: 'date', requireProject: true, orderBy: { date: 'desc' },
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
  evidence: 'safety_inspection',
  createSchema: safetyCreate, updateSchema: safetyCreate.partial(),
  searchField: 'title', dateField: 'date', filterFields: ['result'],
  requireProject: true, orderBy: { date: 'desc' }, transform: stamp,
}));

// ── Risk assessments (activity-based, with validity window) ───
const raCreate = z.object({
  projectId: z.string(),
  activityName: z.string().min(1),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  controls: z.string().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  approvedBy: z.string().optional(),
});
router.use('/risk-assessments', createCrudRouter({
  model: 'riskAssessment', entity: 'risk-assessment', readPerm: 'hse:read', writePerm: 'hse:write',
  createSchema: raCreate, updateSchema: raCreate.partial(),
  searchField: 'activityName', requireProject: true, orderBy: { createdAt: 'desc' }, transform: stamp,
}));

// ── PPE compliance checks (pass/fail per employee) ────────────
const ppeCheckCreate = z.object({
  projectId: z.string(),
  employeeId: z.string().optional(),
  checkDate: z.string().datetime().optional(),
  result: z.nativeEnum(InspectionResult).optional(),
  notes: z.string().optional(),
});
router.use('/ppe-checks', createCrudRouter({
  model: 'ppeCheck', entity: 'ppe-check', readPerm: 'hse:read', writePerm: 'hse:write',
  createSchema: ppeCheckCreate, updateSchema: ppeCheckCreate.partial(),
  dateField: 'checkDate', filterFields: ['result'],
  requireProject: true, orderBy: { checkDate: 'desc' },
  refs: [{ field: 'employeeId', model: 'employee' }], transform: stamp,
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
  void openRiskWeight;
  const score = await safetyScore(orgId, { projectId });
  const now = Date.now();
  const ppeExpiring = ppe.filter((p) => p.expiryDate && p.expiryDate.getTime() < now + 30 * 86400000).length;

  return ok(res, {
    incidents: incidents.length,
    nearMiss,
    lostTimeInjuries: lostTime,
    incidentFrequencyRate: Number(ifr.toFixed(2)),
    safetyScore: score.score,
    safetyDeductions: score.deductions,
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
