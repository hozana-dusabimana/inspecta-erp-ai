import { prisma } from '../../lib/prisma';
import { getProvider, anyConfiguredProvider, ChatMessage } from './providers';
import { selectTools, runTools } from './tools';

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
End with: "Confidence: <0-100>%" (low if data is sparse).`;

export interface CopilotAnswer {
  text: string;
  confidence: number;
  provider: string;
  model: string;
  groundedOn: { projects: number; generatedAt: string };
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
}

export async function ask(
  orgId: string,
  prompt: string,
  opts: AskOptions = {},
): Promise<CopilotAnswer> {
  const { provider: providerName, projectId, pageContext } = opts;
  const isoNow = new Date().toISOString();
  const context = await buildContext(orgId, isoNow);

  // Tool calling: route the question (+page context) to the relevant org-scoped
  // data tools, run them, and inject their structured results as ground truth.
  const toolNames = selectTools(prompt, pageContext);
  const toolResults = await runTools(toolNames, orgId, projectId);

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `DATA SNAPSHOT (org-level, source of truth):\n${JSON.stringify(context, null, 2)}\n\n` +
        `TOOL RESULTS (${toolNames.join(', ')}${projectId ? ' — scoped to the selected project' : ''}):\n${JSON.stringify(toolResults, null, 2)}\n\n` +
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
      offline: true,
    };
  };

  const provider = providerName ? getProvider(providerName) : anyConfiguredProvider();
  if (!provider || !provider.isConfigured()) return offlineAnswer();

  // Try the live provider with one retry on transient errors, then degrade gracefully.
  let lastErr: unknown;
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
