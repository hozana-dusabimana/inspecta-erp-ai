import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import * as service from './ai.service';
import { Attachment } from './providers';
import { audioFormat, transcribeAudio } from './satellite';
import { TOOLS, runTools } from './tools';
import { CREDIT_COSTS, chatCreditCost, assertCreditsAvailable, deductCredits, getCreditStatus } from '../billing/aiCredits.service';

const router = Router();
router.use(authenticate);

const attachmentSchema = z.object({
  filename: z.string().min(1).max(200),
  mime: z.string().max(100).default(''),
  data: z.string().min(1).max(7_000_000), // base64
});

const chatSchema = z.object({
  prompt: z.string().max(4000).default(''),
  provider: z.enum(['satellite', 'openrouter', 'claude', 'gemini']).optional(),
  projectId: z.string().optional(),
  pageContext: z.string().max(80).optional(),
  conversationId: z.string().optional(),
  attachments: z.array(attachmentSchema).max(6).optional(),
}).refine((b) => b.prompt.trim().length > 0 || (b.attachments?.length ?? 0) > 0, { message: 'Write a message or attach a file.' });

type ChatBody = z.infer<typeof chatSchema>;

const isAudio = (a: { filename: string; mime: string }) =>
  a.mime.startsWith('audio/') || /\.(wav|mp3|m4a|ogg|flac|webm)$/i.test(a.filename) && !a.mime.startsWith('video/');
const isImage = (a: { filename: string; mime: string }) =>
  a.mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(a.filename);

/**
 * Turn the request into what the model sees: voice clips are transcribed into the
 * prompt text; images and documents are passed on as attachments.
 */
async function prepareInput(body: ChatBody): Promise<{ prompt: string; attachments: Attachment[]; note: string }> {
  const total = (body.attachments ?? []).reduce((s, a) => s + a.data.length, 0);
  if (total > 13_000_000) throw BadRequest('Attachments are too large (limit about 10 MB in total).');
  let prompt = body.prompt.trim();
  const attachments: Attachment[] = [];
  const names: string[] = [];
  for (const a of body.attachments ?? []) {
    if (isAudio(a)) {
      let text: string;
      try { text = await transcribeAudio(a.data, audioFormat(a.mime, a.filename)); }
      catch (e) { throw BadRequest(e instanceof Error ? e.message : 'Could not transcribe the recording.'); }
      prompt = prompt ? `${prompt}\n\n(voice message) ${text}` : text;
      names.push('🎤 voice message');
    } else {
      const kind = isImage(a) ? 'image' : 'file';
      attachments.push({ kind, filename: a.filename, mime: a.mime || (kind === 'image' ? 'image/png' : 'application/octet-stream'), data: a.data });
      names.push(`📎 ${a.filename}`);
    }
  }
  if (!prompt) prompt = attachments.length ? 'Please review the attached file(s) and tell me what is important.' : '';
  return { prompt, attachments, note: names.length ? `\n\n[${names.join(', ')}]` : '' };
}

/** Credits for one chat: the usual tier, bumped up when files/voice were processed. */
function chatCost(answer: Parameters<typeof chatCreditCost>[0], body: ChatBody): number {
  return Math.max(chatCreditCost(answer), body.attachments?.length ? CREDIT_COSTS.CHAT_WITH_TOOLS : 0);
}

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
    await assertCreditsAvailable(orgId, CREDIT_COSTS.CHAT);
    const input = await prepareInput(body);
    const conversationId = await resolveConversation(orgId, req.user!.id, body.conversationId, input.prompt);

    const answer = await service.ask(orgId, input.prompt, {
      provider: body.provider,
      projectId: body.projectId,
      pageContext: body.pageContext,
      conversationId,
      actor: req.user!,
      attachments: input.attachments,
    });
    const cost = chatCost(answer, body);
    await deductCredits(orgId, cost, `AI chat${answer.preview ? ' (draft record)' : answer.sources?.length ? ' (tool-assisted)' : ''}`, req.user!.id);

    // Persist the exchange (conversation memory).
    await prisma.aiMessage.createMany({ data: [
      { conversationId, role: 'user', content: input.prompt + input.note },
      { conversationId, role: 'assistant', content: answer.text, confidence: answer.confidence },
    ] });
    await prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

    return ok(res, { ...answer, conversationId, creditsUsed: cost });
  }),
);

// ── Streaming chat (SSE) — streams the answer progressively ───
router.post('/chat/stream', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const body = chatSchema.parse(req.body);
  const orgId = req.user!.orgId;
  await assertCreditsAvailable(orgId, CREDIT_COSTS.CHAT);
  // Transcribe voice / validate files BEFORE opening the stream so errors are normal JSON 400s.
  const input = await prepareInput(body);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Ensure the conversation exists before answering (agentic previews attach to it).
  const conversationId = await resolveConversation(orgId, req.user!.id, body.conversationId, input.prompt);

  // Compute the grounded answer (tools + RAG + agentic writes + provider/offline), then stream it.
  const answer = await service.ask(orgId, input.prompt, {
    provider: body.provider, projectId: body.projectId, pageContext: body.pageContext,
    conversationId, actor: req.user!, attachments: input.attachments,
  });
  const cost = chatCost(answer, body);
  await deductCredits(orgId, cost, `AI chat${answer.preview ? ' (draft record)' : answer.sources?.length ? ' (tool-assisted)' : ''}`, req.user!.id);

  // Persist conversation memory.
  await prisma.aiMessage.createMany({ data: [
    { conversationId, role: 'user', content: input.prompt + input.note },
    { conversationId, role: 'assistant', content: answer.text, confidence: answer.confidence },
  ] });
  await prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

  // Stream the text in small chunks for a token-by-token feel.
  const tokens = answer.text.split(/(\s+)/);
  for (let i = 0; i < tokens.length; i += 3) {
    send({ delta: tokens.slice(i, i + 3).join('') });
    await new Promise((r) => setTimeout(r, 12));
  }
  send({ done: true, conversationId, transcript: body.attachments?.some(isAudio) ? input.prompt : undefined, sources: answer.sources, confidence: answer.confidence, provider: answer.provider, model: answer.model, offline: answer.offline, field: answer.field, preview: answer.preview, navigateTo: answer.navigateTo, creditsUsed: cost });
  res.end();
}));

// ── Voice: speech → text (for dictating into the composer) ────
const transcribeSchema = z.object({ audio: z.string().min(1).max(7_000_000), mime: z.string().max(100).optional(), filename: z.string().max(200).optional() });
router.post('/transcribe', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const body = transcribeSchema.parse(req.body);
  const orgId = req.user!.orgId;
  await assertCreditsAvailable(orgId, CREDIT_COSTS.CHAT);
  let text: string;
  try { text = await transcribeAudio(body.audio, audioFormat(body.mime, body.filename)); }
  catch (e) { throw BadRequest(e instanceof Error ? e.message : 'Could not transcribe the recording.'); }
  await deductCredits(orgId, CREDIT_COSTS.CHAT, 'AI voice transcription', req.user!.id);
  return ok(res, { text });
}));

// ── Guided create: deterministic, server-driven field-by-field intake ─────────
// The model kicks off a create (start_create); these endpoints then collect each
// field via input widgets, build a preview, and commit — no model in the loop.
const answerSchema = z.object({
  conversationId: z.string(),
  name: z.string(),
  value: z.unknown().optional(),
  action: z.enum(['value', 'skip', 'addNew']).optional(),
});
router.post('/create/answer', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const body = answerSchema.parse(req.body);
  const result = await service.answerCreateField(body.conversationId, req.user!, body.name, body.value, body.action ?? 'value');
  return ok(res, result);
}));

const convSchema = z.object({ conversationId: z.string() });
router.post('/create/commit', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const { conversationId } = convSchema.parse(req.body);
  const result = await service.commitCreateSession(conversationId, req.user!);
  if (result.created) {
    await prisma.aiMessage.create({ data: { conversationId, role: 'assistant', content: `Created ${result.created.entity} ${result.created.id ?? ''}`.trim() } });
  }
  return ok(res, result);
}));
router.post('/create/cancel', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const { conversationId } = convSchema.parse(req.body);
  const result = await service.cancelCreateSession(conversationId, req.user!);
  return ok(res, result);
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
  const orgId = req.user!.orgId;
  await assertCreditsAvailable(orgId, CREDIT_COSTS.TOOL_INVOKE);
  const result = await runTools([req.params.name], orgId, req.query.projectId as string | undefined);
  await deductCredits(orgId, CREDIT_COSTS.TOOL_INVOKE, `AI tool: ${req.params.name}`, req.user!.id);
  return ok(res, result[req.params.name]);
}));

// ── AI credit balance for the Copilot meter ───────────────────
router.get('/credits', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  return ok(res, await getCreditStatus(req.user!.orgId));
}));

// ── Executive intelligence snapshot ───────────────────────────
router.get('/executive', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  await assertCreditsAvailable(orgId, CREDIT_COSTS.REPORT);
  const result = await runTools(['get_dashboard_metrics'], orgId);
  await deductCredits(orgId, CREDIT_COSTS.REPORT, 'AI executive snapshot', req.user!.id);
  return ok(res, result.get_dashboard_metrics);
}));

// ── Alert engine: derive live alerts across modules ───────────
router.get('/alerts', requirePermission('ai:use'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  await assertCreditsAvailable(orgId, CREDIT_COSTS.REPORT);
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

  await deductCredits(orgId, CREDIT_COSTS.REPORT, 'AI alert scan', req.user!.id);
  return ok(res, { count: alerts.length, alerts });
}));

export default router;
