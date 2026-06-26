import { prisma } from '../../lib/prisma';
import { getProvider, anyConfiguredProvider, ChatMessage } from './providers';

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

const SYSTEM_PROMPT = `You are Inspecta Copilot, an AI construction-intelligence partner inside the INSPECTA BUILDOS ERP.

STRICT RULES:
- Use ONLY the figures present in the provided JSON DATA SNAPSHOT. Never invent project names, numbers, costs, or dates.
- If the snapshot lacks the data needed to answer, say so plainly and state what data is missing — do NOT fabricate.
- When you compute something (variance, averages, profit, productivity), show the formula and the inputs you used.
- Be concise and practical: 2-4 short paragraphs or a tight bullet list.
- End with a line: "Confidence: <0-100>%" reflecting how well the snapshot supports your answer (low if data is sparse).`;

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

export async function ask(
  orgId: string,
  prompt: string,
  providerName?: string,
): Promise<CopilotAnswer> {
  const isoNow = new Date().toISOString();
  const context = await buildContext(orgId, isoNow);

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `DATA SNAPSHOT (the only source of truth):\n${JSON.stringify(
        context,
        null,
        2,
      )}\n\nQUESTION: ${prompt}`,
    },
  ];

  const provider = providerName ? getProvider(providerName) : anyConfiguredProvider();

  // Honest offline mode: no key configured -> deterministic answer from real data, no fabrication.
  if (!provider || !provider.isConfigured()) {
    const p = context.portfolio;
    const text =
      `AI provider is not configured, so here is a direct read from your live data (no AI inference):\n\n` +
      `• Projects: ${p.totalProjects} total — ${p.activeProjects} active, ${p.completedProjects} completed.\n` +
      `• Average progress across the portfolio: ${p.avgProgressPct}%.\n` +
      `• Total budget under management: ${p.totalBudget.toLocaleString()} (base currency).\n` +
      `• Health: ${p.healthBreakdown.OPTIMAL} optimal, ${p.healthBreakdown.WARNING} warning, ${p.healthBreakdown.CRITICAL} critical.\n\n` +
      `Set OPENROUTER_API_KEY (free), ANTHROPIC_API_KEY, or GEMINI_API_KEY in the backend .env to enable full AI reasoning.\n\n` +
      `Confidence: ${p.totalProjects > 0 ? 70 : 20}%`;
    return {
      text,
      confidence: extractConfidence(text),
      provider: 'offline',
      model: 'rule-based',
      groundedOn: { projects: context.projects.length, generatedAt: isoNow },
      offline: true,
    };
  }

  const completion = await provider.complete(messages);
  return {
    text: completion.text,
    confidence: extractConfidence(completion.text),
    provider: completion.provider,
    model: completion.model,
    groundedOn: { projects: context.projects.length, generatedAt: isoNow },
    offline: false,
  };
}
