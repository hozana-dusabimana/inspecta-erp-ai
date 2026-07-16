import { prisma } from '../../lib/prisma';
import { getProvider, anyConfiguredProvider, ChatMessage } from './providers';
import { selectTools, runTools } from './tools';
import { retrieve, RagSource } from './rag';
import { runAgent } from './agent';
import { Actor, writeToolSpecs } from './write-tools';

export interface CopilotContext {
  organizationName: string;
  generatedAtIso: string;
  portfolio: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    totalBudget: number;
    avgProgressPct: number;
    healthBreakdown: Record<string, number>;
  };
  finance: {
    budget: number;
    actualCost: number;
    costVariance: number;
    billed: number;
    received: number;
  };
  production: {
    plannedQty: number;
    actualQty: number;
    laborHours: number;
    productivityIndex: number;
    variancePct: number;
  };
  compliance: {
    openNcrs: number;
    incidents: number;
    openRisks: number;
  };
  projects: Array<{
    code: string;
    name: string;
    status: string;
    health: string;
    progressPct: number;
    budget: number;
    location: string | null;
  }>;
}

/**
 * Builds a grounded snapshot of the organization's REAL data across every
 * module. The AI is only ever allowed to reason over this object — never
 * invented numbers.
 */
export async function buildContext(orgId: string, isoNow: string): Promise<CopilotContext> {
  const scope = { organizationId: orgId };
  const [org, projects, budgetAgg, costAgg, invoiceAgg, paymentAgg, prodAgg, laborAgg, openNcrs, incidents, openRisks] =
    await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId } }),
      prisma.project.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.budgetLine.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.productionEntry.aggregate({ where: scope, _sum: { plannedQty: true, actualQty: true } }),
      prisma.productionEntry.aggregate({ where: scope, _sum: { laborHours: true } }),
      prisma.ncr.count({ where: { ...scope, status: { not: 'CLOSED' } } }),
      prisma.incident.count({ where: scope }),
      prisma.risk.count({ where: { ...scope, status: { not: 'CLOSED' } } }),
    ]);

  const totalBudget = Number(budgetAgg._sum.amount ?? 0) || projects.reduce((s, p) => s + Number(p.budget), 0);
  const actualCost = Number(costAgg._sum.amount ?? 0);
  const planned = Number(prodAgg._sum.plannedQty ?? 0);
  const actual = Number(prodAgg._sum.actualQty ?? 0);
  const labor = Number(laborAgg._sum.laborHours ?? 0);
  const avgProgress =
    projects.length === 0 ? 0 : projects.reduce((s, p) => s + p.progressPct, 0) / projects.length;

  return {
    organizationName: org?.name ?? 'Organization',
    generatedAtIso: isoNow,
    portfolio: {
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
      completedProjects: projects.filter((p) => p.status === 'COMPLETED').length,
      totalBudget,
      avgProgressPct: Number(avgProgress.toFixed(1)),
      healthBreakdown: {
        OPTIMAL: projects.filter((p) => p.health === 'OPTIMAL').length,
        WARNING: projects.filter((p) => p.health === 'WARNING').length,
        CRITICAL: projects.filter((p) => p.health === 'CRITICAL').length,
      },
    },
    finance: {
      budget: totalBudget,
      actualCost,
      costVariance: totalBudget - actualCost,
      billed: Number(invoiceAgg._sum.amount ?? 0),
      received: Number(paymentAgg._sum.amount ?? 0),
    },
    production: {
      plannedQty: planned,
      actualQty: actual,
      laborHours: labor,
      productivityIndex: labor > 0 ? Number((actual / labor).toFixed(3)) : 0,
      variancePct: planned > 0 ? Number((((actual - planned) / planned) * 100).toFixed(2)) : 0,
    },
    compliance: { openNcrs, incidents, openRisks },
    projects: projects.map((p) => ({
      code: p.code,
      name: p.name,
      status: p.status,
      health: p.health,
      progressPct: p.progressPct,
      budget: Number(p.budget),
      location: p.location,
    })),
  };
}

const SYSTEM_PROMPT = `You are Inspecta Copilot — a construction project-controls advisor, cost controller, productivity advisor, risk advisor and executive assistant inside the INSPECTA BUILDOS ERP.

STRICT RULES:
- Use ONLY the figures in the provided JSON DATA SNAPSHOT and TOOL RESULTS. Never invent project names, numbers, costs or dates.
- If the data needed is missing, say so plainly and name what's missing — do NOT fabricate.
- When you compute something (variance, profit, productivity, EVM), show the formula and the inputs used.

ANSWER FORMAT — use these sections (omit a section only if there is genuinely no data for it):
**Executive Summary** — 1-2 sentences.
**Root Cause** — why (use Five-Whys / drivers where the data supports it).
**Impact** — quantified effect on cost / schedule / profit / safety.
**Recommendations** — specific, prioritized actions.
**Forecast** — what happens if unaddressed (use the forecast/EVM figures).
**Action Plan** — a short table: Priority | Action | Owner | Due | Expected Impact.
**Supporting Metrics** — the key numbers you used.
When you use a fact from the RETRIEVED RECORDS, cite it inline in square brackets, e.g. [NCR NCR-01] or [Inspection "Slab pour QA"].
End with: "Confidence: <0-100>%" (low if data is sparse).

CREATING RECORDS (when tools are available) — follow this workflow EXACTLY:
- You can CREATE projects, clients, risks, NCRs and cost entries on the user's behalf using the provided tools.
- Step 1: Gather the essentials conversationally. Ask for missing REQUIRED fields one at a time; don't invent values. Optional fields can be left out.
- Step 2: To attach an existing project/client by name, call list_projects / list_clients to resolve its id first. If the user names a client that doesn't exist, offer to create the client first (its own confirm), then the project.
- Step 3: Call preview_<entity>, then show the user the previewed fields and ask them to confirm (e.g. "Reply 'yes' to create it").
- Step 4: When the user confirms (e.g. "yes", "confirm", "ok", "go ahead", "create it", "do it"), you MUST IMMEDIATELY call commit_<entity>. Do NOT ask again and do NOT just repeat the details — call the commit tool.
- Never confirm on the user's behalf (never preview and commit in the same reply). Never claim something was created unless a commit tool returned created:true.
- If a tool returns an error (permission, validation), explain it plainly and, when possible, ask for what's needed. When creating records, the "Confidence" line is not required.`;

export interface CopilotAnswer {
  text: string;
  confidence: number;
  provider: string;
  model: string;
  groundedOn: { projects: number; generatedAt: string };
  sources: RagSource[];
  offline: boolean;
}

function extractConfidence(text: string): number {
  const m = text.match(/Confidence:\s*(\d{1,3})\s*%/i);
  if (!m) return 60;
  return Math.max(0, Math.min(100, Number(m[1])));
}

export interface AskOptions {
  provider?: string;
  projectId?: string;
  pageContext?: string;
  /** Conversation to load prior turns from (and to scope pending create actions). */
  conversationId?: string;
  /** The signed-in user; required to enable agentic create-by-chat (writes run as them). */
  actor?: Actor;
}

export async function ask(
  orgId: string,
  prompt: string,
  opts: AskOptions = {},
): Promise<CopilotAnswer> {
  const { provider: providerName, projectId, pageContext } = opts;
  const isoNow = new Date().toISOString();
  const context = await buildContext(orgId, isoNow);

  // Tool calling + RAG: route the question to org-scoped data tools and retrieve
  // citable records, injecting both as ground truth.
  const [toolResults, sources] = await Promise.all([
    runTools(selectTools(prompt, pageContext), orgId, projectId),
    retrieve(orgId, prompt, projectId),
  ]);
  const toolNames = selectTools(prompt, pageContext);

  // Prior turns (this conversation) so slot-filling / confirmations work across
  // messages. The current prompt is persisted by the route AFTER this call, so
  // history never includes the current turn.
  let history: ChatMessage[] = [];
  if (opts.conversationId) {
    const prior = await prisma.aiMessage.findMany({
      where: { conversationId: opts.conversationId },
      orderBy: { createdAt: 'asc' },
      take: 40,
      select: { role: true, content: true },
    });
    history = prior.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })) as ChatMessage[];
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    {
      role: 'user',
      content:
        `DATA SNAPSHOT (org-level, source of truth):\n${JSON.stringify(context, null, 2)}\n\n` +
        `TOOL RESULTS (${toolNames.join(', ')}${projectId ? ' — scoped to the selected project' : ''}):\n${JSON.stringify(toolResults, null, 2)}\n\n` +
        (sources.length ? `RETRIEVED RECORDS (cite these in [brackets] when used):\n${sources.map((s) => `[${s.source}] ${s.snippet}`).join('\n')}\n\n` : '') +
        (pageContext ? `PAGE CONTEXT: the user is on the "${pageContext}" page.\n\n` : '') +
        `QUESTION: ${prompt}`,
    },
  ];

  // Deterministic real-data answer — used when no provider is configured AND as a
  // graceful fallback when the live provider errors (e.g. free-tier upstream 429).
  const offlineAnswer = (note?: string): CopilotAnswer => {
    const p = context.portfolio;
    const f = context.finance;
    const text =
      (note ? `${note}\n\n` : '') +
      `Direct read from your live data (no AI inference):\n\n` +
      `• Projects: ${p.totalProjects} total — ${p.activeProjects} active, ${p.completedProjects} completed.\n` +
      `• Average progress across the portfolio: ${p.avgProgressPct}%.\n` +
      `• Budget: ${f.budget.toLocaleString()} · Actual cost: ${f.actualCost.toLocaleString()} · Variance: ${f.costVariance.toLocaleString()}.\n` +
      `• Health: ${p.healthBreakdown.OPTIMAL} optimal, ${p.healthBreakdown.WARNING} warning, ${p.healthBreakdown.CRITICAL} critical.\n\n` +
      `Confidence: ${p.totalProjects > 0 ? 70 : 20}%`;
    return {
      text,
      confidence: extractConfidence(text),
      provider: 'offline',
      model: 'rule-based',
      groundedOn: { projects: context.projects.length, generatedAt: isoNow },
      sources,
      offline: true,
    };
  };

  const provider = providerName ? getProvider(providerName) : anyConfiguredProvider();
  if (!provider || !provider.isConfigured()) return offlineAnswer();

  // Agentic path: a tool-capable provider + a signed-in actor + a conversation
  // lets the Copilot CREATE records (preview → confirm → commit) as the user.
  // On failure, fall through to the plain completion + offline fallback below.
  let lastErr: unknown;
  if (provider.supportsTools && opts.actor && opts.conversationId) {
    try {
      const ctx = { conversationId: opts.conversationId, sameTurnPendingIds: new Set<string>() };
      const result = await runAgent(provider, messages, writeToolSpecs(), opts.actor, ctx);
      if (result.text?.trim()) {
        return {
          text: result.text,
          confidence: extractConfidence(result.text),
          provider: result.provider,
          model: result.model,
          groundedOn: { projects: context.projects.length, generatedAt: isoNow },
          sources,
          offline: false,
        };
      }
    } catch (err) {
      lastErr = err;
    }
  }

  // Try the live provider with one retry on transient errors, then degrade gracefully.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await provider.complete(messages);
      if (!completion.text?.trim()) throw new Error('empty completion');
      return {
        text: completion.text,
        confidence: extractConfidence(completion.text),
        provider: completion.provider,
        model: completion.model,
        groundedOn: { projects: context.projects.length, generatedAt: isoNow },
        sources,
        offline: false,
      };
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  // eslint-disable-next-line no-console
  console.warn('AI provider unavailable, using data fallback:', lastErr instanceof Error ? lastErr.message : lastErr);
  return offlineAnswer(
    `(Live AI is busy right now — likely free-tier rate limiting. Showing a verified data read instead.)`,
  );
}
