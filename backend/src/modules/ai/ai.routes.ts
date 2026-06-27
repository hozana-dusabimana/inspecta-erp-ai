import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import * as service from './ai.service';
import { TOOLS, runTools } from './tools';

const router = Router();
router.use(authenticate);

const chatSchema = z.object({
  prompt: z.string().min(1).max(4000),
  provider: z.enum(['openrouter', 'claude', 'gemini']).optional(),
  projectId: z.string().optional(),
  pageContext: z.string().max(80).optional(),
});

router.post(
  '/chat',
  requirePermission('ai:use'),
  asyncHandler(async (req, res) => {
    const body = chatSchema.parse(req.body);
    const answer = await service.ask(req.user!.orgId, body.prompt, {
      provider: body.provider,
      projectId: body.projectId,
      pageContext: body.pageContext,
    });
    return ok(res, answer);
  }),
);

// ── Tool registry (definitions) ───────────────────────────────
router.get('/tools', requirePermission('ai:use'), asyncHandler(async (_req, res) => {
  return ok(res, Object.values(TOOLS).map((t) => ({ name: t.name, description: t.description, needsProject: t.needsProject })));
}));

// ── Invoke a single tool (org-scoped) ─────────────────────────
router.get('/tools/:name', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  if (!TOOLS[req.params.name]) throw BadRequest('unknown tool');
  const result = await runTools([req.params.name], req.user!.orgId, req.query.projectId as string | undefined);
  return ok(res, result[req.params.name]);
}));

// ── Executive intelligence snapshot ───────────────────────────
router.get('/executive', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const result = await runTools(['get_dashboard_metrics'], req.user!.orgId);
  return ok(res, result.get_dashboard_metrics);
}));

// ── Alert engine: derive live alerts across modules ───────────
router.get('/alerts', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  const r = await runTools(
    ['get_cost_analysis', 'get_productivity_analysis', 'get_schedule_forecast', 'get_inventory_analysis', 'get_compliance_analysis'],
    orgId, projectId,
  );
  const cost = r.get_cost_analysis as any;
  const prod = r.get_productivity_analysis as any;
  const sched = r.get_schedule_forecast as any;
  const inv = r.get_inventory_analysis as any;
  const comp = r.get_compliance_analysis as any;

  const alerts: { type: string; severity: string; message: string }[] = [];
  if (cost && cost.budget > 0 && cost.actualCost > cost.budget) alerts.push({ type: 'COST_OVERRUN', severity: 'CRITICAL', message: `Actual cost ${cost.actualCost.toLocaleString()} exceeds budget ${cost.budget.toLocaleString()}.` });
  if (cost?.evm?.cpi && cost.evm.cpi > 0 && cost.evm.cpi < 0.9) alerts.push({ type: 'COST_PERFORMANCE', severity: 'HIGH', message: `CPI ${cost.evm.cpi} below 0.9 — cost performance deteriorating.` });
  for (const a of prod?.underperformingActivities ?? []) alerts.push({ type: 'PRODUCTIVITY', severity: 'HIGH', message: `${a.activity} productivity ${a.variancePct}% below standard.` });
  if (sched?.delayedCount > 0) alerts.push({ type: 'SCHEDULE_DELAY', severity: 'HIGH', message: `${sched.delayedCount} activity(ies) delayed, up to ${sched.maxDaysDelayed} days.` });
  for (const m of inv?.reorderItems ?? []) alerts.push({ type: 'LOW_INVENTORY', severity: 'MEDIUM', message: `${m.name} at ${m.stock} (reorder ${m.reorderLevel}).` });
  if (comp?.criticalNcrs > 0) alerts.push({ type: 'QUALITY', severity: 'HIGH', message: `${comp.criticalNcrs} open critical NCR(s).` });
  if (comp?.lostTime > 0) alerts.push({ type: 'SAFETY', severity: 'CRITICAL', message: `${comp.lostTime} lost-time/serious incident(s).` });

  return ok(res, { count: alerts.length, alerts });
}));

export default router;
