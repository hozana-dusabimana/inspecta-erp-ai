import { prisma } from './prisma';

/**
 * SINGLE SOURCE OF TRUTH for project progress, earned value and forecast profit.
 * Every screen (Dashboard, Projects, Portfolio, Finance, Production, Profitability,
 * Executive, AI Copilot) must read these numbers from here so they always agree.
 *
 * Definitions
 *  - contractValue : signed Contract.value, else the project's declared value; null if neither.
 *  - budget (BAC)  : Σ budget lines, else Σ BOQ budget; null when no cost budget exists ("No data").
 *  - progress      : production achievement (Σactual ÷ Σplanned qty, capped 100) when production
 *                    exists, else the average of schedule activities, else the project's own %.
 *  - EV = progress × BAC;  PV = plannedProgress × BAC
 *  - SPI = EV ÷ PV;  CPI = EV ÷ AC
 *  - EAC = BAC ÷ CPI (= AC ÷ progress); BAC while there is no cost/progress evidence yet
 *  - forecast profit = contractValue − EAC
 */

const num = (v: unknown) => Number(v ?? 0);
const r2 = (n: number) => Number(n.toFixed(2));
const r3 = (n: number) => Number(n.toFixed(3));

export type IndexStatus = 'NO_DATA' | 'ON_TRACK' | 'AT_RISK' | 'CRITICAL';

/** One rule for every SPI/CPI badge: ≥0.95 on track, 0.85–0.95 at risk, <0.85 critical, null = no data. */
export function indexStatus(v: number | null | undefined): IndexStatus {
  if (v == null || !Number.isFinite(v)) return 'NO_DATA';
  if (v >= 0.95) return 'ON_TRACK';
  if (v >= 0.85) return 'AT_RISK';
  return 'CRITICAL';
}

/** Budget burn vs progress: spending far ahead of physical progress is the real warning. */
export function burnStatus(actualCost: number, budget: number | null, progressPct: number | null): IndexStatus {
  if (!budget || budget <= 0) return 'NO_DATA';
  const burn = (actualCost / budget) * 100;
  if (burn > 100) return 'CRITICAL';
  if (progressPct == null) return burn > 90 ? 'AT_RISK' : 'ON_TRACK';
  const gap = burn - progressPct;
  if (gap > 20) return 'CRITICAL';
  if (gap > 10) return 'AT_RISK';
  return 'ON_TRACK';
}

export function marginStatus(marginPct: number | null): IndexStatus {
  if (marginPct == null) return 'NO_DATA';
  if (marginPct < 0) return 'CRITICAL';
  if (marginPct < 5) return 'AT_RISK';
  return 'ON_TRACK';
}

export interface ProjectMetrics {
  projectId: string;
  code: string;
  name: string;
  status: string;
  isDemo: boolean;
  contractValue: number | null;
  budget: number | null;
  actualCost: number;
  billed: number;
  received: number;
  progressPct: number | null;
  progressSource: 'PRODUCTION' | 'SCHEDULE' | 'MANUAL' | 'NONE';
  plannedProgressPct: number | null;
  earnedValue: number | null;
  plannedValue: number | null;
  spi: number | null;
  cpi: number | null;
  eac: number | null;
  forecastProfit: number | null;
  forecastMarginPct: number | null;
  budgetedProfit: number | null;
  openNcrs: number;
  spiStatus: IndexStatus;
  cpiStatus: IndexStatus;
  burnStatus: IndexStatus;
  marginStatus: IndexStatus;
  /** Worst of the above — the one badge a list row should show. */
  health: IndexStatus;
}

export interface PortfolioMetrics {
  projects: ProjectMetrics[];
  totals: {
    projectCount: number;
    contractValue: number;
    budget: number;
    actualCost: number;
    billed: number;
    received: number;
    earnedValue: number;
    plannedValue: number;
    avgProgressPct: number | null;
    spi: number | null;
    cpi: number | null;
    eac: number;
    forecastProfit: number | null;
    forecastMarginPct: number | null;
    openNcrs: number;
    atRisk: number;
    critical: number;
    onTrack: number;
    noData: number;
    spiStatus: IndexStatus;
    cpiStatus: IndexStatus;
    burnStatus: IndexStatus;
    health: IndexStatus;
  };
}

const RANK: Record<IndexStatus, number> = { NO_DATA: 0, ON_TRACK: 1, AT_RISK: 2, CRITICAL: 3 };
const worst = (...s: IndexStatus[]): IndexStatus => s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'NO_DATA' as IndexStatus);

/** Pure core: build metrics from raw per-project inputs (unit-testable, no DB). */
export function buildProjectMetrics(p: {
  projectId: string; code: string; name: string; status: string; isDemo: boolean;
  contractValue: number; projectValue: number; budgetLines: number; boqBudget: number;
  actualCost: number; billed: number; received: number;
  prodPlanned: number; prodActual: number; scheduleAvg: number | null; scheduleCount: number; manualPct: number;
  startDate: Date | null; endDate: Date | null; openNcrs: number; plannedProfitMarginPct: number; now?: number;
}): ProjectMetrics {
  const contractValue = p.contractValue > 0 ? p.contractValue : p.projectValue > 0 ? p.projectValue : null;
  const budget = p.budgetLines > 0 ? p.budgetLines : p.boqBudget > 0 ? p.boqBudget : null;

  let progress: number | null = null;
  let source: ProjectMetrics['progressSource'] = 'NONE';
  if (p.prodPlanned > 0) { progress = Math.min(100, (p.prodActual / p.prodPlanned) * 100); source = 'PRODUCTION'; }
  else if (p.scheduleCount > 0 && p.scheduleAvg != null) { progress = p.scheduleAvg; source = 'SCHEDULE'; }
  else if (p.manualPct > 0) { progress = p.manualPct; source = 'MANUAL'; }

  // Planned progress: logged production is planned-to-date (100% of what was due);
  // otherwise elapsed schedule time; otherwise unknown.
  let planned: number | null = null;
  if (source === 'PRODUCTION') planned = 100;
  else if (p.startDate && p.endDate && p.endDate > p.startDate) {
    const now = p.now ?? Date.now();
    planned = Math.min(100, Math.max(0, ((now - p.startDate.getTime()) / (p.endDate.getTime() - p.startDate.getTime())) * 100));
  }

  const ev = budget != null && progress != null ? (progress / 100) * budget : null;
  const pv = budget != null && planned != null ? (planned / 100) * budget : null;
  const spi = progress != null && planned != null && planned > 0 ? progress / planned : null;
  const cpi = ev != null && p.actualCost > 0 && ev > 0 ? ev / p.actualCost : null;
  let eac: number | null = null;
  if (budget != null) eac = cpi != null ? budget / cpi : budget;
  const forecastProfit = contractValue != null && eac != null ? contractValue - eac : null;
  const forecastMarginPct = forecastProfit != null && contractValue ? (forecastProfit / contractValue) * 100 : null;
  const budgetedProfit = contractValue != null && budget != null ? contractValue - budget : null;

  const m: ProjectMetrics = {
    projectId: p.projectId, code: p.code, name: p.name, status: p.status, isDemo: p.isDemo,
    contractValue, budget, actualCost: r2(p.actualCost), billed: r2(p.billed), received: r2(p.received),
    progressPct: progress == null ? null : Number(progress.toFixed(1)), progressSource: source,
    plannedProgressPct: planned == null ? null : Number(planned.toFixed(1)),
    earnedValue: ev == null ? null : r2(ev), plannedValue: pv == null ? null : r2(pv),
    spi: spi == null ? null : r3(spi), cpi: cpi == null ? null : r3(cpi),
    eac: eac == null ? null : r2(eac),
    forecastProfit: forecastProfit == null ? null : r2(forecastProfit),
    forecastMarginPct: forecastMarginPct == null ? null : Number(forecastMarginPct.toFixed(1)),
    budgetedProfit: budgetedProfit == null ? null : r2(budgetedProfit),
    openNcrs: p.openNcrs,
    spiStatus: indexStatus(spi), cpiStatus: indexStatus(cpi),
    burnStatus: burnStatus(p.actualCost, budget, progress),
    marginStatus: marginStatus(forecastMarginPct),
    health: 'NO_DATA',
  };
  m.health = worst(m.spiStatus, m.cpiStatus, m.burnStatus, m.marginStatus);
  return m;
}

export function rollupPortfolio(projects: ProjectMetrics[]): PortfolioMetrics['totals'] {
  const sum = (f: (p: ProjectMetrics) => number | null) => projects.reduce((s, p) => s + (f(p) ?? 0), 0);
  const withProgress = projects.filter((p) => p.progressPct != null);
  const evSet = projects.filter((p) => p.earnedValue != null && p.plannedValue != null);
  const ev = evSet.reduce((s, p) => s + (p.earnedValue ?? 0), 0);
  const pv = evSet.reduce((s, p) => s + (p.plannedValue ?? 0), 0);
  const cpiSet = projects.filter((p) => p.cpi != null);
  const cpiEv = cpiSet.reduce((s, p) => s + (p.earnedValue ?? 0), 0);
  const cpiAc = cpiSet.reduce((s, p) => s + p.actualCost, 0);
  const profitSet = projects.filter((p) => p.forecastProfit != null);
  const profit = profitSet.reduce((s, p) => s + (p.forecastProfit ?? 0), 0);
  const profitRev = profitSet.reduce((s, p) => s + (p.contractValue ?? 0), 0);
  const spi = pv > 0 ? r3(ev / pv) : null;
  const cpi = cpiAc > 0 ? r3(cpiEv / cpiAc) : null;
  const budget = sum((p) => p.budget);
  const actualCost = sum((p) => p.actualCost);
  const healths = projects.map((p) => p.health);
  const forecastMarginPct = profitSet.length && profitRev > 0 ? Number(((profit / profitRev) * 100).toFixed(1)) : null;
  return {
    projectCount: projects.length,
    contractValue: sum((p) => p.contractValue), budget, actualCost,
    billed: sum((p) => p.billed), received: sum((p) => p.received),
    earnedValue: r2(ev), plannedValue: r2(pv),
    avgProgressPct: withProgress.length ? Number((withProgress.reduce((s, p) => s + (p.progressPct ?? 0), 0) / withProgress.length).toFixed(1)) : null,
    spi, cpi, eac: r2(sum((p) => p.eac)),
    forecastProfit: profitSet.length ? r2(profit) : null,
    forecastMarginPct,
    openNcrs: sum((p) => p.openNcrs),
    atRisk: healths.filter((h) => h === 'AT_RISK').length,
    critical: healths.filter((h) => h === 'CRITICAL').length,
    onTrack: healths.filter((h) => h === 'ON_TRACK').length,
    noData: healths.filter((h) => h === 'NO_DATA').length,
    spiStatus: indexStatus(spi), cpiStatus: indexStatus(cpi),
    burnStatus: burnStatus(actualCost, budget > 0 ? budget : null, null),
    health: healths.length ? worst(...healths) : 'NO_DATA',
  };
}

/**
 * Load metrics for the organisation's projects (or one). Demo/test projects are
 * excluded from client totals unless `includeDemo` is set or a single project is asked for.
 */
export async function loadProjectMetrics(orgId: string, opts: { projectId?: string; includeDemo?: boolean } = {}): Promise<PortfolioMetrics> {
  const scope = { organizationId: orgId, ...(opts.projectId ? { projectId: opts.projectId } : {}) };
  const [projects, contracts, budgetLines, boq, costs, invoices, payments, prod, sched, ncrs] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: orgId, ...(opts.projectId ? { id: opts.projectId } : opts.includeDemo ? {} : { isDemo: false }) },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contract.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { projectId: true, value: true } }),
    prisma.budgetLine.groupBy({ by: ['projectId'], where: { ...scope, deletedAt: null }, _sum: { amount: true } }),
    prisma.boqItem.groupBy({ by: ['projectId'], where: scope, _sum: { budget: true } }),
    prisma.costEntry.groupBy({ by: ['projectId'], where: { ...scope, deletedAt: null }, _sum: { amount: true } }),
    prisma.invoice.groupBy({ by: ['projectId'], where: scope, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ['projectId'], where: scope, _sum: { amount: true } }),
    prisma.productionEntry.groupBy({ by: ['projectId'], where: scope, _sum: { plannedQty: true, actualQty: true } }),
    prisma.scheduleActivity.groupBy({ by: ['projectId'], where: { ...scope, milestone: false }, _avg: { progressPct: true }, _count: { _all: true } }),
    prisma.ncr.groupBy({ by: ['projectId'], where: { ...scope, status: { not: 'CLOSED' } }, _count: { _all: true } }),
  ]);
  const by = <T extends { projectId: string | null }>(rows: T[]) => new Map(rows.filter((r) => r.projectId).map((r) => [r.projectId as string, r]));
  const cMap = new Map(contracts.filter((c) => c.projectId).map((c) => [c.projectId as string, num(c.value)]));
  const bl = by(budgetLines), bq = by(boq), co = by(costs), iv = by(invoices), pm = by(payments), pr = by(prod), sc = by(sched), nc = by(ncrs);

  const list = projects.map((p) => buildProjectMetrics({
    projectId: p.id, code: p.code, name: p.name, status: p.status, isDemo: p.isDemo,
    contractValue: cMap.get(p.id) ?? 0, projectValue: num(p.budget),
    budgetLines: num(bl.get(p.id)?._sum.amount), boqBudget: num(bq.get(p.id)?._sum.budget),
    actualCost: num(co.get(p.id)?._sum.amount), billed: num(iv.get(p.id)?._sum.amount), received: num(pm.get(p.id)?._sum.amount),
    prodPlanned: num(pr.get(p.id)?._sum.plannedQty), prodActual: num(pr.get(p.id)?._sum.actualQty),
    scheduleAvg: sc.get(p.id)?._avg.progressPct ?? null, scheduleCount: sc.get(p.id)?._count._all ?? 0,
    manualPct: p.progressPct, startDate: p.startDate, endDate: p.endDate,
    openNcrs: nc.get(p.id)?._count._all ?? 0, plannedProfitMarginPct: num(p.plannedProfitMargin),
  }));
  return { projects: list, totals: rollupPortfolio(list) };
}

/** Keep Project.progressPct/health columns in step with the computed truth (call after writes). */
export async function syncProjectProgress(orgId: string, projectId: string): Promise<void> {
  const { projects } = await loadProjectMetrics(orgId, { projectId });
  const m = projects[0];
  if (!m || m.progressPct == null) return;
  const health = m.health === 'CRITICAL' ? 'CRITICAL' : m.health === 'AT_RISK' ? 'WARNING' : 'OPTIMAL';
  await prisma.project.update({ where: { id: projectId }, data: { progressPct: m.progressPct, health } }).catch(() => undefined);
}
