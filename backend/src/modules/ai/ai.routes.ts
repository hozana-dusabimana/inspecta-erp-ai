import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
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
  conversationId: z.string().optional(),
});

/**
 * Resolve the caller's conversation, creating one if needed. Done BEFORE the
 * answer is generated so agentic create previews can be attached to it and
 * confirmed on a later turn. Returns a conversation id owned by this user+org.
 */
async function resolveConversation(orgId: string, userId: string, conversationId: string | undefined, prompt: string): Promise<string> {
  if (conversationId) {
    const conv = await prisma.aiConversation.findFirst({ where: { id: conversationId, organizationId: orgId, userId } });
    if (conv) return conv.id;
  }
  const conv = await prisma.aiConversation.create({ data: { organizationId: orgId, userId, title: prompt.slice(0, 80) } });
  return conv.id;
}

router.post(
  '/chat',
  requirePermission('ai:use'),
  asyncHandler(async (req, res) => {
    const body = chatSchema.parse(req.body);
    const orgId = req.user!.orgId;
    const conversationId = await resolveConversation(orgId, req.user!.id, body.conversationId, body.prompt);

    const answer = await service.ask(orgId, body.prompt, {
      provider: body.provider,
      projectId: body.projectId,
      pageContext: body.pageContext,
      conversationId,
      actor: req.user!,
    });

    // Persist the exchange (conversation memory).
    await prisma.aiMessage.createMany({ data: [
      { conversationId, role: 'user', content: body.prompt },
      { conversationId, role: 'assistant', content: answer.text, confidence: answer.confidence },
    ] });
    await prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

    return ok(res, { ...answer, conversationId });
  }),
);

// ── Streaming chat (SSE) — streams the answer progressively ───
router.post('/chat/stream', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const body = chatSchema.parse(req.body);
  const orgId = req.user!.orgId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Ensure the conversation exists before answering (agentic previews attach to it).
  const conversationId = await resolveConversation(orgId, req.user!.id, body.conversationId, body.prompt);

  // Compute the grounded answer (tools + RAG + agentic writes + provider/offline), then stream it.
  const answer = await service.ask(orgId, body.prompt, {
    provider: body.provider, projectId: body.projectId, pageContext: body.pageContext,
    conversationId, actor: req.user!,
  });

  // Persist conversation memory.
  await prisma.aiMessage.createMany({ data: [
    { conversationId, role: 'user', content: body.prompt },
    { conversationId, role: 'assistant', content: answer.text, confidence: answer.confidence },
  ] });
  await prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

  // Stream the text in small chunks for a token-by-token feel.
  const tokens = answer.text.split(/(\s+)/);
  for (let i = 0; i < tokens.length; i += 3) {
    send({ delta: tokens.slice(i, i + 3).join('') });
    await new Promise((r) => setTimeout(r, 12));
  }
  send({ done: true, conversationId, sources: answer.sources, confidence: answer.confidence, provider: answer.provider, model: answer.model, offline: answer.offline });
  res.end();
}));

// ── Conversation history (per user, org-scoped) ───────────────
router.get('/conversations', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const list = await prisma.aiConversation.findMany({
    where: { organizationId: req.user!.orgId, userId: req.user!.id },
    orderBy: { updatedAt: 'desc' }, take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return ok(res, list);
}));

router.get('/conversations/:id', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const conv = await prisma.aiConversation.findFirst({
    where: { id: req.params.id, organizationId: req.user!.orgId, userId: req.user!.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conv) throw NotFound('Conversation not found');
  return ok(res, conv);
}));

router.delete('/conversations/:id', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const conv = await prisma.aiConversation.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId, userId: req.user!.id } });
  if (!conv) throw NotFound('Conversation not found');
  await prisma.aiConversation.delete({ where: { id: conv.id } });
  return ok(res, { deleted: true });
}));

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
