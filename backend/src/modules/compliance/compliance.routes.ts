import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';

const num = (v: unknown) => Number(v ?? 0);
const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

const router = Router();

// ── Compliance documents (method statements, ITPs, permits…) ──
const docCreate = z.object({
  projectId: z.string().optional(),
  docType: z.enum(['METHOD_STATEMENT', 'ITP', 'PERMIT', 'CERTIFICATION', 'REGULATORY']).optional(),
  title: z.string().min(1),
  reference: z.string().optional(),
  version: z.string().optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'EXPIRED']).optional(),
  issueDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
  fileUrl: z.string().optional(),
  notes: z.string().optional(),
});
router.use('/documents', createCrudRouter({
  model: 'complianceDocument', entity: 'compliance-document', readPerm: 'document:read', writePerm: 'document:write',
  createSchema: docCreate, updateSchema: docCreate.partial(),
  searchField: 'title', orderBy: { createdAt: 'desc' }, transform: stamp,
}));

// ── AI risk / compliance insight engine (Submodule 8) ─────────
router.get('/ai-risk', authenticate, requirePermission('qaqc:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw BadRequest('projectId is required');
  const scope = { organizationId: orgId, projectId };

  const [inspections, ncrs, incidents, risks, reworks, costAgg] = await Promise.all([
    prisma.inspection.findMany({ where: scope, select: { type: true, defects: true, result: true } }),
    prisma.ncr.findMany({ where: scope, select: { status: true, severity: true } }),
    prisma.incident.findMany({ where: scope, select: { type: true, severity: true } }),
    prisma.risk.findMany({ where: scope, select: { score: true, status: true, title: true } }),
    prisma.rework.aggregate({ where: scope, _sum: { reworkCost: true } }),
    prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
  ]);

  const insights: { severity: string; title: string; detail: string; recommendation: string }[] = [];

  // Defect-prone activities.
  const byType = new Map<string, number>();
  for (const i of inspections) byType.set(i.type, (byType.get(i.type) ?? 0) + i.defects);
  for (const [type, defects] of byType) {
    if (defects >= 3) insights.push({ severity: 'HIGH', title: `${type} has ${defects} defects`, detail: 'High defect concentration in this inspection type.', recommendation: 'Increase inspection frequency and review workmanship/method for this activity.' });
  }
  // Open critical NCRs.
  const openCritical = ncrs.filter((n) => n.severity === 'CRITICAL' && n.status !== 'CLOSED').length;
  if (openCritical > 0) insights.push({ severity: 'HIGH', title: `${openCritical} open critical NCR(s)`, detail: 'Critical non-conformances are unresolved.', recommendation: 'Escalate and assign corrective actions with due dates immediately.' });
  // Rework eroding profit.
  const reworkCost = num(reworks._sum.reworkCost); const projectCost = num(costAgg._sum.amount);
  if (reworkCost > 0 && projectCost > 0 && reworkCost / projectCost > 0.03) insights.push({ severity: 'MEDIUM', title: `Rework is ${((reworkCost / projectCost) * 100).toFixed(1)}% of project cost`, detail: `Rework cost ${reworkCost.toLocaleString()} is eroding margin.`, recommendation: 'Target the top defect activities to cut rework; tie to the productivity engine.' });
  // Safety risk.
  const seriousIncidents = incidents.filter((i) => ['LOST_TIME', 'FATALITY'].includes(i.type)).length;
  if (seriousIncidents > 0) insights.push({ severity: 'HIGH', title: `${seriousIncidents} serious safety incident(s)`, detail: 'Lost-time or worse incidents recorded.', recommendation: 'Conduct a safety stand-down and review high-risk activities.' });
  // High open risks.
  const highRisks = risks.filter((r) => r.score >= 15 && r.status !== 'CLOSED');
  for (const r of highRisks.slice(0, 3)) insights.push({ severity: 'MEDIUM', title: `High risk: ${r.title} (score ${r.score})`, detail: 'Open risk above the alert threshold.', recommendation: 'Implement mitigation measures and reassess.' });

  if (insights.length === 0) insights.push({ severity: 'LOW', title: 'Compliance healthy', detail: 'No significant quality or safety risks detected.', recommendation: 'Keep capturing inspections, tests and toolbox talks.' });

  // Overall compliance score (quality + safety blended).
  const openNcrs = ncrs.filter((n) => n.status !== 'CLOSED').length;
  const complianceScore = Math.max(0, 100 - openNcrs * 5 - openCritical * 10 - seriousIncidents * 15 - highRisks.length * 5);

  return ok(res, { projectId, complianceScore, insights });
}));

export default router;
