import { prisma } from '../../lib/prisma';
import { productivity, productivityVariancePct, spi, cpi, eac, etc, vac } from '../../lib/formulas';

const num = (v: unknown) => Number(v ?? 0);
const round = (n: number, d = 2) => Number(n.toFixed(d));

/**
 * Deterministic, org-scoped data tools for the AI Copilot (Module 5). Each tool
 * reads ONLY the caller's organization data and returns structured JSON the
 * model reasons over — never invented numbers. Reuses Module 1–4 analytics.
 */
export interface ToolDef {
  name: string;
  description: string;
  needsProject: boolean;
  run: (orgId: string, projectId?: string) => Promise<unknown>;
}

async function resolveLaborRate(orgId: string): Promise<number> {
  const wages = await prisma.wageRate.findMany({ where: { organizationId: orgId } });
  const hourly = wages.map((w) => (w.rateType === 'HOURLY' ? num(w.amount) : num(w.amount) / 8)).filter((x) => x > 0);
  if (hourly.length) return hourly.reduce((s, x) => s + x, 0) / hourly.length;
  return 20;
}

// ── get_project_summary ───────────────────────────────────────
async function getProjectSummary(orgId: string, projectId?: string) {
  if (projectId) {
    const p = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, include: { client: { select: { name: true } } } });
    if (!p) return { error: 'project not found' };
    return { code: p.code, name: p.name, client: p.client?.name, status: p.status, health: p.health, progressPct: p.progressPct, budget: num(p.budget), location: p.location, plannedProfitMargin: num(p.plannedProfitMargin) };
  }
  const projects = await prisma.project.findMany({ where: { organizationId: orgId } });
  return {
    totalProjects: projects.length,
    active: projects.filter((p) => p.status === 'ACTIVE').length,
    completed: projects.filter((p) => p.status === 'COMPLETED').length,
    avgProgressPct: projects.length ? round(projects.reduce((s, p) => s + p.progressPct, 0) / projects.length, 1) : 0,
    totalBudget: projects.reduce((s, p) => s + num(p.budget), 0),
    health: { OPTIMAL: projects.filter((p) => p.health === 'OPTIMAL').length, WARNING: projects.filter((p) => p.health === 'WARNING').length, CRITICAL: projects.filter((p) => p.health === 'CRITICAL').length },
    projects: projects.slice(0, 20).map((p) => ({ code: p.code, name: p.name, status: p.status, health: p.health, progressPct: p.progressPct, budget: num(p.budget) })),
  };
}

// ── get_productivity_analysis ─────────────────────────────────
async function getProductivityAnalysis(orgId: string, projectId?: string) {
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };
  const [entries, standards] = await Promise.all([
    prisma.productionEntry.findMany({ where: scope, select: { wbsActivity: true, actualQty: true, plannedQty: true, laborHours: true, equipmentHours: true } }),
    prisma.productivityStandard.findMany({ where: { organizationId: orgId }, select: { activity: true, productivityRate: true } }),
  ]);
  const stdBy = new Map(standards.map((s) => [s.activity.toLowerCase(), num(s.productivityRate)]));
  const totalActual = entries.reduce((s, e) => s + num(e.actualQty), 0);
  const totalLabor = entries.reduce((s, e) => s + num(e.laborHours), 0);
  const labrProd = productivity(totalActual, totalLabor);
  const byAct = new Map<string, { a: number; l: number }>();
  for (const e of entries) { const g = byAct.get(e.wbsActivity) ?? { a: 0, l: 0 }; g.a += num(e.actualQty); g.l += num(e.laborHours); byAct.set(e.wbsActivity, g); }
  const activities = [...byAct.entries()].map(([name, g]) => {
    const ap = productivity(g.a, g.l); const std = stdBy.get(name.toLowerCase());
    return { activity: name, productivity: round(ap, 3), standard: std ?? null, variancePct: std ? round(productivityVariancePct(ap, std)) : null };
  }).sort((x, y) => (x.variancePct ?? 0) - (y.variancePct ?? 0));
  return {
    entries: entries.length, totalActual, totalLaborHours: totalLabor,
    laborProductivity: round(labrProd, 3),
    underperformingActivities: activities.filter((a) => a.variancePct !== null && a.variancePct < -10).slice(0, 5),
    activities: activities.slice(0, 10),
  };
}

// ── get_cost_analysis (+ EVM) ─────────────────────────────────
async function getCostAnalysis(orgId: string, projectId?: string) {
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };
  const [budgetAgg, costAgg, byCat, prod, project] = await Promise.all([
    prisma.budgetLine.aggregate({ where: scope, _sum: { amount: true } }),
    prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
    prisma.costEntry.groupBy({ by: ['category'], where: scope, _sum: { amount: true } }),
    prisma.productionEntry.aggregate({ where: scope, _sum: { plannedQty: true, actualQty: true } }),
    projectId ? prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } }) : null,
  ]);
  const bac = num(budgetAgg._sum.amount) || num(project?.budget);
  const ac = num(costAgg._sum.amount);
  const progress = num(prod._sum.plannedQty) > 0 ? Math.min(1, num(prod._sum.actualQty) / num(prod._sum.plannedQty)) : num(project?.progressPct) / 100;
  const ev = progress * bac; const pv = bac; const cpiV = cpi(ev, ac); const eacV = eac(bac, cpiV);
  return {
    budget: bac, actualCost: ac, costVariance: bac - ac,
    costByCategory: byCat.map((c) => ({ category: c.category, amount: num(c._sum.amount) })).sort((a, b) => b.amount - a.amount),
    topCostDriver: byCat.length ? byCat.sort((a, b) => num(b._sum.amount) - num(a._sum.amount))[0].category : null,
    evm: { cpi: round(cpiV, 3), spi: round(spi(ev, pv), 3), eac: round(eacV), etc: round(etc(eacV, ac)), vac: round(vac(bac, eacV)) },
  };
}

// ── get_profit_forecast ───────────────────────────────────────
async function getProfitForecast(orgId: string, projectId?: string) {
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };
  const [costAgg, invoiceAgg, project, reworkAgg] = await Promise.all([
    prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
    prisma.invoice.aggregate({ where: scope, _sum: { amount: true } }),
    projectId ? prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } }) : null,
    prisma.rework.aggregate({ where: scope, _sum: { reworkCost: true } }),
  ]);
  const contractValue = num(project?.budget);
  const ac = num(costAgg._sum.amount);
  const budgetedProfit = (contractValue * num(project?.plannedProfitMargin)) / 100;
  const reworkCost = num(reworkAgg._sum.reworkCost);
  const forecastProfit = budgetedProfit - reworkCost;
  return {
    contractValue, billed: num(invoiceAgg._sum.amount), actualCost: ac,
    budgetedProfit: round(budgetedProfit), reworkCostErosion: round(reworkCost),
    forecastProfit: round(forecastProfit),
    forecastMarginPct: contractValue > 0 ? round((forecastProfit / contractValue) * 100) : 0,
  };
}

// ── get_schedule_forecast ─────────────────────────────────────
async function getScheduleForecast(orgId: string, projectId?: string) {
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };
  const activities = await prisma.scheduleActivity.findMany({ where: scope });
  const now = Date.now();
  const delayed = activities.filter((a) => a.finishDate && a.finishDate.getTime() < now && a.progressPct < 100)
    .map((a) => ({ code: a.code, name: a.name, progressPct: a.progressPct, daysDelayed: Math.ceil((now - a.finishDate!.getTime()) / 86400000) }))
    .sort((x, y) => y.daysDelayed - x.daysDelayed);
  const avgProgress = activities.length ? round(activities.reduce((s, a) => s + a.progressPct, 0) / activities.length, 1) : 0;
  return { totalActivities: activities.length, avgProgressPct: avgProgress, delayedCount: delayed.length, maxDaysDelayed: delayed[0]?.daysDelayed ?? 0, delayedActivities: delayed.slice(0, 5) };
}

// ── get_inventory_analysis ────────────────────────────────────
async function getInventoryAnalysis(orgId: string) {
  const scope = { organizationId: orgId };
  const [materials, groups, waste] = await Promise.all([
    prisma.material.findMany({ where: scope }),
    prisma.stockMovement.groupBy({ by: ['materialId', 'type'], where: scope, _sum: { quantity: true } }),
    prisma.productionMaterial.aggregate({ where: scope, _sum: { wasteQty: true, qtyUsed: true } }),
  ]);
  const stockBy = new Map<string, number>();
  for (const g of groups) { const q = num(g._sum.quantity); const d = g.type === 'ISSUE' || g.type === 'WASTE' ? -q : g.type === 'TRANSFER' ? 0 : q; stockBy.set(g.materialId, (stockBy.get(g.materialId) ?? 0) + d); }
  const reorder = materials.filter((m) => num(m.reorderLevel) > 0 && (stockBy.get(m.id) ?? 0) <= num(m.reorderLevel)).map((m) => ({ code: m.code, name: m.name, stock: stockBy.get(m.id) ?? 0, reorderLevel: num(m.reorderLevel) }));
  const totalValue = materials.reduce((s, m) => s + (stockBy.get(m.id) ?? 0) * num(m.unitCost), 0);
  const used = num(waste._sum.qtyUsed); const wasteQty = num(waste._sum.wasteQty);
  return { materials: materials.length, totalStockValue: round(totalValue), reorderItems: reorder, materialWaste: wasteQty, wastePct: used > 0 ? round((wasteQty / used) * 100, 1) : 0 };
}

// ── get_compliance_analysis ───────────────────────────────────
async function getComplianceAnalysis(orgId: string, projectId?: string) {
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };
  const [inspections, ncrs, incidents, risks, reworkAgg, costAgg] = await Promise.all([
    prisma.inspection.findMany({ where: scope, select: { defects: true, result: true } }),
    prisma.ncr.findMany({ where: scope, select: { status: true, severity: true } }),
    prisma.incident.findMany({ where: scope, select: { type: true } }),
    prisma.risk.findMany({ where: scope, select: { score: true, status: true, title: true } }),
    prisma.rework.aggregate({ where: scope, _sum: { reworkCost: true } }),
    prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
  ]);
  const defects = inspections.reduce((s, i) => s + i.defects, 0);
  const reworkCost = num(reworkAgg._sum.reworkCost); const cost = num(costAgg._sum.amount);
  return {
    openNcrs: ncrs.filter((n) => n.status !== 'CLOSED').length,
    criticalNcrs: ncrs.filter((n) => n.severity === 'CRITICAL' && n.status !== 'CLOSED').length,
    defectRate: inspections.length ? round((defects / inspections.length) * 100) : 0,
    incidents: incidents.length, lostTime: incidents.filter((i) => ['LOST_TIME', 'FATALITY'].includes(i.type)).length,
    reworkCost: round(reworkCost), reworkCostPct: cost > 0 ? round((reworkCost / cost) * 100) : 0,
    highRisks: risks.filter((r) => r.score >= 15 && r.status !== 'CLOSED').map((r) => ({ title: r.title, score: r.score })),
  };
}

// ── get_dashboard_metrics (executive) ─────────────────────────
async function getDashboardMetrics(orgId: string) {
  const [summary, cost, inv, comp] = await Promise.all([
    getProjectSummary(orgId), getCostAnalysis(orgId), getInventoryAnalysis(orgId), getComplianceAnalysis(orgId),
  ]);
  return { portfolio: summary, finance: cost, inventory: inv, compliance: comp };
}

export const TOOLS: Record<string, ToolDef> = {
  get_project_summary: { name: 'get_project_summary', description: 'Portfolio or single-project status, progress, budget, health.', needsProject: false, run: getProjectSummary },
  get_productivity_analysis: { name: 'get_productivity_analysis', description: 'Labor productivity, variance vs standard, underperforming activities.', needsProject: false, run: getProductivityAnalysis },
  get_cost_analysis: { name: 'get_cost_analysis', description: 'Budget vs actual, cost drivers, EVM (CPI/SPI/EAC).', needsProject: false, run: getCostAnalysis },
  get_profit_forecast: { name: 'get_profit_forecast', description: 'Forecast profit and margin, profit erosion from rework.', needsProject: false, run: getProfitForecast },
  get_schedule_forecast: { name: 'get_schedule_forecast', description: 'Delayed/critical activities and progress forecast.', needsProject: false, run: getScheduleForecast },
  get_inventory_analysis: { name: 'get_inventory_analysis', description: 'Stock value, reorder items, material waste.', needsProject: false, run: (o) => getInventoryAnalysis(o) },
  get_compliance_analysis: { name: 'get_compliance_analysis', description: 'Open NCRs, defect rate, rework cost, incidents, high risks.', needsProject: false, run: getComplianceAnalysis },
  get_dashboard_metrics: { name: 'get_dashboard_metrics', description: 'Blended executive metrics across all modules.', needsProject: false, run: (o) => getDashboardMetrics(o) },
};

/** Pick the tools most relevant to a question + page context (keyword routing). */
export function selectTools(prompt: string, pageContext?: string): string[] {
  const t = `${prompt} ${pageContext ?? ''}`.toLowerCase();
  const picks = new Set<string>();
  const add = (k: string) => picks.add(k);
  if (/produc|crew|labou?r|efficien|output/.test(t)) add('get_productivity_analysis');
  if (/cost|budget|overrun|spend|cpi|eac|variance/.test(t)) add('get_cost_analysis');
  if (/profit|margin|erosion|leak/.test(t)) add('get_profit_forecast');
  if (/schedul|delay|complet|critical|progress|late/.test(t)) add('get_schedule_forecast');
  if (/invent|stock|material|reorder|waste|overstock/.test(t)) add('get_inventory_analysis');
  if (/ncr|qa|qc|defect|rework|incident|safety|risk|complian|hse/.test(t)) add('get_compliance_analysis');
  if (/portfolio|project|overview|status|health/.test(t)) add('get_project_summary');
  if (picks.size === 0) { add('get_dashboard_metrics'); }
  return [...picks].slice(0, 5);
}

/** Run a set of tools and return a map of name → result. */
export async function runTools(names: string[], orgId: string, projectId?: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await Promise.all(names.map(async (n) => {
    const tool = TOOLS[n];
    if (tool) { try { out[n] = await tool.run(orgId, tool.needsProject ? projectId : projectId); } catch (e) { out[n] = { error: e instanceof Error ? e.message : 'failed' }; } }
  }));
  return out;
}
