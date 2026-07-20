import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/**
 * Cross-tenant reads of the ERP domain itself — projects, delivery exceptions,
 * money and module adoption. Everything here deliberately ignores
 * `organizationId` scoping, so it is only ever reachable behind
 * requirePlatformAdmin.
 */

const num = (v: Prisma.Decimal | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : v.toNumber();

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// ───────────────────────── Projects register ─────────────────────────

export function projectWhere(query: Record<string, unknown>): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = {};
  const search = (query.search as string)?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { location: { contains: search, mode: 'insensitive' } },
    ];
  }
  const orgId = (query.organizationId as string)?.trim();
  if (orgId) where.organizationId = orgId;

  const status = (query.status as string)?.trim();
  if (status) where.status = status as Prisma.ProjectWhereInput['status'];
  const health = (query.health as string)?.trim();
  if (health) where.health = health as Prisma.ProjectWhereInput['health'];

  const from = query.dateFrom as string | undefined;
  const to = query.dateTo as string | undefined;
  if (from || to) {
    const range: Prisma.DateTimeFilter = {};
    if (from) range.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) end.setUTCHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.createdAt = range;
  }
  return where;
}

export const projectSelect = {
  id: true,
  code: true,
  name: true,
  location: true,
  status: true,
  health: true,
  budget: true,
  currency: true,
  progressPct: true,
  startDate: true,
  endDate: true,
  forecastFinishDate: true,
  createdAt: true,
  organization: { select: { id: true, name: true, slug: true, status: true } },
  client: { select: { id: true, name: true } },
  manager: { select: { id: true, fullName: true } },
} satisfies Prisma.ProjectSelect;

/** Portfolio totals for the header cards, honouring the same filters as the list. */
export async function projectTotals(where: Prisma.ProjectWhereInput) {
  const [agg, byStatus, byHealth] = await Promise.all([
    prisma.project.aggregate({ where, _sum: { budget: true }, _avg: { progressPct: true }, _count: { _all: true } }),
    prisma.project.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.project.groupBy({ by: ['health'], where, _count: { _all: true } }),
  ]);
  return {
    count: agg._count._all,
    totalBudget: num(agg._sum.budget),
    avgProgress: Number((agg._avg.progressPct ?? 0).toFixed(1)),
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    byHealth: byHealth.map((h) => ({ health: h.health, count: h._count._all })),
  };
}

// ───────────────────────── Delivery watchlist ─────────────────────────

/**
 * The exceptions across every tenant: what a platform operator would want to
 * look at first thing in the morning. Each list is capped — this is a triage
 * view, not a report; the register and exports are for exhaustive work.
 */
export async function deliveryWatchlist() {
  const LIMIT = 15;
  const now = new Date();
  const live: Prisma.ProjectWhereInput = { status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD', 'AT_RISK'] } };
  const orgSel = { select: { id: true, name: true, slug: true } };

  const [critical, overdue, criticalRisks, openNcrs, incidents, costRows, budgetRows] = await Promise.all([
    prisma.project.findMany({
      where: { ...live, OR: [{ health: 'CRITICAL' }, { status: 'AT_RISK' }] },
      select: { id: true, code: true, name: true, status: true, health: true, progressPct: true, endDate: true, organization: orgSel },
      orderBy: { progressPct: 'asc' },
      take: LIMIT,
    }),
    prisma.project.findMany({
      where: { ...live, endDate: { lt: now } },
      select: { id: true, code: true, name: true, endDate: true, progressPct: true, organization: orgSel },
      orderBy: { endDate: 'asc' },
      take: LIMIT,
    }),
    prisma.risk.findMany({
      where: { score: { gte: 15 }, status: { not: 'CLOSED' } },
      select: {
        id: true, title: true, score: true, status: true, category: true,
        project: { select: { id: true, code: true, name: true, organization: orgSel } },
      },
      orderBy: { score: 'desc' },
      take: LIMIT,
    }),
    prisma.ncr.findMany({
      where: { status: { notIn: ['CLOSED', 'DRAFT'] } },
      select: {
        id: true, number: true, description: true, severity: true, status: true, dueDate: true,
        project: { select: { id: true, code: true, name: true, organization: orgSel } },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: LIMIT,
    }),
    prisma.incident.findMany({
      where: { date: { gte: daysAgo(30) }, severity: { in: ['HIGH', 'CRITICAL'] } },
      select: {
        id: true, type: true, severity: true, description: true, date: true,
        project: { select: { id: true, code: true, name: true, organization: orgSel } },
      },
      orderBy: { date: 'desc' },
      take: LIMIT,
    }),
    // Over-budget detection: actual cost per project vs its budget.
    prisma.costEntry.groupBy({ by: ['projectId'], _sum: { amount: true } }),
    prisma.project.findMany({
      where: { ...live, budget: { gt: 0 } },
      select: { id: true, code: true, name: true, budget: true, progressPct: true, organization: orgSel },
    }),
  ]);

  const spendByProject = new Map(costRows.map((c) => [c.projectId, num(c._sum.amount)]));
  const overBudget = budgetRows
    .map((p) => {
      const spent = spendByProject.get(p.id) ?? 0;
      const budget = num(p.budget);
      return { ...p, budget, spent, utilisationPct: budget ? Number(((spent / budget) * 100).toFixed(1)) : 0 };
    })
    .filter((p) => p.spent > p.budget)
    .sort((a, b) => b.utilisationPct - a.utilisationPct)
    .slice(0, LIMIT);

  return {
    counts: {
      criticalProjects: critical.length,
      overdueProjects: overdue.length,
      overBudgetProjects: overBudget.length,
      criticalRisks: criticalRisks.length,
      openNcrs: openNcrs.length,
      seriousIncidents30d: incidents.length,
    },
    criticalProjects: critical,
    overdueProjects: overdue,
    overBudgetProjects: overBudget,
    criticalRisks,
    openNcrs,
    seriousIncidents: incidents,
  };
}

// ───────────────────────── Finance overview ─────────────────────────

/**
 * Money per tenant: contracted, invoiced, collected, outstanding — plus a
 * simple receivables ageing bucket set across the whole platform.
 */
export async function financeOverview() {
  const now = new Date();
  const [orgs, contracts, invoices, payments, unpaidInvoices] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, name: true, slug: true, currency: true, status: true } }),
    prisma.contract.groupBy({ by: ['organizationId'], _sum: { value: true }, _count: { _all: true } }),
    prisma.invoice.groupBy({ by: ['organizationId'], _sum: { amount: true }, _count: { _all: true } }),
    prisma.payment.groupBy({ by: ['organizationId'], _sum: { amount: true } }),
    prisma.invoice.findMany({
      where: { status: { notIn: ['PAID', 'REJECTED', 'DRAFT'] } },
      select: { organizationId: true, amount: true, dueDate: true, issueDate: true },
    }),
  ]);

  const byId = <T extends { organizationId: string }>(rows: T[]) => new Map(rows.map((r) => [r.organizationId, r]));
  const c = byId(contracts), i = byId(invoices), p = byId(payments);

  const companies = orgs
    .map((o) => {
      const contracted = num(c.get(o.id)?._sum.value);
      const invoiced = num(i.get(o.id)?._sum.amount);
      const collected = num(p.get(o.id)?._sum.amount);
      return {
        id: o.id,
        name: o.name,
        slug: o.slug,
        currency: o.currency,
        status: o.status,
        contracts: c.get(o.id)?._count._all ?? 0,
        invoices: i.get(o.id)?._count._all ?? 0,
        contracted,
        invoiced,
        collected,
        outstanding: invoiced - collected,
        collectionRate: invoiced ? Number(((collected / invoiced) * 100).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.contracted - a.contracted);

  // Receivables ageing, bucketed on the due date (falling back to issue date).
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  for (const inv of unpaidInvoices) {
    const due = inv.dueDate ?? inv.issueDate;
    const age = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
    const amount = num(inv.amount);
    if (age <= 0) buckets.current += amount;
    else if (age <= 30) buckets.d30 += amount;
    else if (age <= 60) buckets.d60 += amount;
    else if (age <= 90) buckets.d90 += amount;
    else buckets.over90 += amount;
  }

  const totals = companies.reduce(
    (acc, x) => ({
      contracted: acc.contracted + x.contracted,
      invoiced: acc.invoiced + x.invoiced,
      collected: acc.collected + x.collected,
      outstanding: acc.outstanding + x.outstanding,
    }),
    { contracted: 0, invoiced: 0, collected: 0, outstanding: 0 },
  );

  return { totals: { ...totals, ageing: buckets }, companies };
}

// ───────────────────────── Adoption & engagement ─────────────────────────

/** Modules whose record counts stand in for "is this tenant actually using us?". */
const ADOPTION_MODULES = [
  { key: 'projects', label: 'Projects', model: 'project' },
  { key: 'boq', label: 'BOQ', model: 'boqItem' },
  { key: 'production', label: 'Production', model: 'productionEntry' },
  { key: 'costs', label: 'Costs', model: 'costEntry' },
  { key: 'invoices', label: 'Invoices', model: 'invoice' },
  { key: 'materials', label: 'Inventory', model: 'material' },
  { key: 'purchaseOrders', label: 'Procurement', model: 'purchaseOrder' },
  { key: 'inspections', label: 'QA/QC', model: 'inspection' },
  { key: 'incidents', label: 'HSE', model: 'incident' },
  { key: 'risks', label: 'Risk', model: 'risk' },
  { key: 'employees', label: 'HR', model: 'employee' },
  { key: 'documents', label: 'Documents', model: 'document' },
] as const;

type GroupDelegate = {
  groupBy: (args: unknown) => Promise<Array<{ organizationId: string; _count: { _all: number } }>>;
};

const DORMANT_AFTER_DAYS = 30;

/**
 * Per-tenant module usage plus last activity, so a dormant customer is visible
 * before they churn. Counts come from one groupBy per module rather than a
 * per-tenant loop, so cost stays flat as tenants are added.
 */
export async function adoptionReport() {
  const [orgs, lastActivity, ...moduleCounts] = await Promise.all([
    prisma.organization.findMany({
      select: { id: true, name: true, slug: true, status: true, plan: true, createdAt: true, _count: { select: { users: true } } },
    }),
    prisma.auditLog.groupBy({ by: ['organizationId'], _max: { createdAt: true } }),
    ...ADOPTION_MODULES.map((m) =>
      (prisma as unknown as Record<string, GroupDelegate>)[m.model].groupBy({
        by: ['organizationId'],
        _count: { _all: true },
      }),
    ),
  ]);

  const lastById = new Map(lastActivity.map((a) => [a.organizationId, a._max.createdAt]));
  const countsByModule = ADOPTION_MODULES.map((m, idx) => ({
    key: m.key,
    label: m.label,
    byOrg: new Map(moduleCounts[idx].map((r) => [r.organizationId, r._count._all])),
  }));

  const dormantCutoff = daysAgo(DORMANT_AFTER_DAYS);

  const companies = orgs.map((o) => {
    const modules = Object.fromEntries(countsByModule.map((m) => [m.key, m.byOrg.get(o.id) ?? 0]));
    const modulesUsed = countsByModule.filter((m) => (m.byOrg.get(o.id) ?? 0) > 0).length;
    const lastActiveAt = lastById.get(o.id) ?? null;
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      plan: o.plan,
      users: o._count.users,
      createdAt: o.createdAt,
      lastActiveAt,
      // No activity at all, or none for a month — the churn signal.
      dormant: !lastActiveAt || lastActiveAt < dormantCutoff,
      modulesUsed,
      totalModules: ADOPTION_MODULES.length,
      records: Object.values(modules).reduce((a, b) => a + b, 0),
      modules,
    };
  });

  companies.sort((a, b) => Number(b.dormant) - Number(a.dormant) || a.modulesUsed - b.modulesUsed);

  return {
    moduleLabels: ADOPTION_MODULES.map((m) => ({ key: m.key, label: m.label })),
    dormantAfterDays: DORMANT_AFTER_DAYS,
    companies,
  };
}
