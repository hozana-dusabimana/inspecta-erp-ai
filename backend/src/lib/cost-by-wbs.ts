import { prisma } from './prisma';

const num = (v: unknown) => Number(v ?? 0);

export interface WbsCostRow {
  wbsItemId: string; code: string; name: string;
  budget: number; actual: number; committed: number; requested: number; forecast: number;
  variance: number; forecastVariance: number;
}

/**
 * Budget vs actual vs commitments per WBS item. One calculation used by the Finance screen and the PDF reports.
 *  committed  = open purchase orders not yet received
 *  requested  = approved purchase requests not yet ordered
 *  forecast   = actual + committed + requested
 */
export async function costByWbs(orgId: string, projectId: string): Promise<WbsCostRow[]> {
  const scope = { organizationId: orgId, projectId };
  const [wbs, budgets, costs, poLines, prLines] = await Promise.all([
    prisma.wbsItem.findMany({ where: scope, select: { id: true, code: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.budgetLine.groupBy({ by: ['wbsItemId'], where: scope, _sum: { amount: true } }),
    prisma.costEntry.groupBy({ by: ['wbsItemId'], where: scope, _sum: { amount: true } }),
    prisma.purchaseOrderItem.findMany({ where: { wbsItemId: { not: null }, purchaseOrder: { organizationId: orgId, projectId, status: { in: ['ISSUED', 'PARTIAL'] } } }, select: { wbsItemId: true, quantity: true, quantityReceived: true, rate: true } }),
    prisma.purchaseRequestItem.findMany({ where: { wbsItemId: { not: null }, purchaseRequest: { organizationId: orgId, projectId, status: 'APPROVED' } }, select: { wbsItemId: true, amount: true } }),
  ]);
  const bMap = new Map(budgets.map((b) => [b.wbsItemId ?? 'none', num(b._sum.amount)]));
  const cMap = new Map(costs.map((c) => [c.wbsItemId ?? 'none', num(c._sum.amount)]));
  const committed = new Map<string, number>();
  for (const l of poLines) committed.set(l.wbsItemId as string, (committed.get(l.wbsItemId as string) ?? 0) + Math.max(0, num(l.quantity) - num(l.quantityReceived)) * num(l.rate));
  const requested = new Map<string, number>();
  for (const l of prLines) requested.set(l.wbsItemId as string, (requested.get(l.wbsItemId as string) ?? 0) + num(l.amount));

  const row = (id: string, code: string, name: string): WbsCostRow => {
    const budget = bMap.get(id) ?? 0; const actual = cMap.get(id) ?? 0;
    const com = committed.get(id) ?? 0; const req = requested.get(id) ?? 0;
    const forecast = actual + com + req;
    return { wbsItemId: id, code, name, budget, actual, committed: com, requested: req, forecast, variance: budget - actual, forecastVariance: budget - forecast };
  };
  const rows = wbs.map((w) => row(w.id, w.code, w.name));
  rows.push(row('none', '—', 'Unassigned'));
  return rows.filter((r) => r.budget || r.actual || r.committed || r.requested);
}
