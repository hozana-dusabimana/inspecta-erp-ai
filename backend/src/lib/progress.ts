import { prisma } from './prisma';

/**
 * ONE PROGRESS CALCULATION (T1-07). Daily entries -> WBS items -> project, using WBS weights.
 * The stored progressPct on WBS items, schedule activities and the project row is only ever a
 * copy of this result (written by syncProgress), so every page shows the same number.
 *
 *  leaf WBS item, with daily entries:
 *      progress = Σ actual qty ÷ WBS quantity            (÷ Σ planned qty when no quantity is set)
 *      planned  = Σ planned-to-date qty ÷ WBS quantity   (100% when no quantity is set)
 *  leaf WBS item, no entries yet: progress = its manual %, planned = elapsed share of its linked
 *      activities' dates (0 before start, 100 after finish; null when it has no dated activity)
 *  parent / project: weighted average of children / root items by weightPct
 *      (equal weights when every sibling weight is 0). Capped at 100.
 *  schedule activity: the progress of the WBS item it is linked to.
 */

export interface WbsNode { id: string; parentId: string | null; quantity: number | null; weightPct: number; progressPct: number }
export interface WbsProd { wbsItemId: string; planned: number; actual: number }
export interface WbsAct { wbsItemId: string; startDate: Date | null; finishDate: Date | null }
export interface NodeProgress { progress: number; planned: number | null; fromEntries: boolean }

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function elapsedPct(acts: WbsAct[], now: number): number | null {
  const dated = acts.filter((a) => a.startDate && a.finishDate);
  if (!dated.length) return null;
  const start = Math.min(...dated.map((a) => a.startDate!.getTime()));
  const finish = Math.max(...dated.map((a) => a.finishDate!.getTime()));
  if (finish <= start) return now >= finish ? 100 : 0;
  return clamp(((now - start) / (finish - start)) * 100);
}

export function rollupProgress(items: WbsNode[], prod: WbsProd[], acts: WbsAct[], now = Date.now()) {
  const prodBy = new Map(prod.map((p) => [p.wbsItemId, p]));
  const actsBy = new Map<string, WbsAct[]>();
  for (const a of acts) actsBy.set(a.wbsItemId, [...(actsBy.get(a.wbsItemId) ?? []), a]);
  const ids = new Set(items.map((i) => i.id));
  const kids = new Map<string, WbsNode[]>();
  for (const it of items) {
    const key = it.parentId && ids.has(it.parentId) ? it.parentId : '__root';
    kids.set(key, [...(kids.get(key) ?? []), it]);
  }
  const byId = new Map<string, NodeProgress>();

  const weighted = (children: WbsNode[], guard: Set<string>): NodeProgress => {
    const results = children.map((c) => ({ c, r: compute(c, guard) }));
    const wSum = children.reduce((s, c) => s + (c.weightPct > 0 ? c.weightPct : 0), 0);
    const w = (c: WbsNode) => (wSum > 0 ? Math.max(0, c.weightPct) / wSum : 1 / children.length);
    const progress = results.reduce((s, { c, r }) => s + w(c) * r.progress, 0);
    const anyPlanned = results.some(({ r }) => r.planned != null);
    const planned = anyPlanned ? results.reduce((s, { c, r }) => s + w(c) * (r.planned ?? 0), 0) : null;
    return { progress: clamp(progress), planned: planned == null ? null : clamp(planned), fromEntries: results.some(({ r }) => r.fromEntries) };
  };

  const compute = (it: WbsNode, guard: Set<string>): NodeProgress => {
    const hit = byId.get(it.id);
    if (hit) return hit;
    if (guard.has(it.id)) return { progress: 0, planned: null, fromEntries: false };
    guard.add(it.id);
    const children = kids.get(it.id) ?? [];
    let r: NodeProgress;
    if (children.length) {
      r = weighted(children, guard);
    } else {
      const p = prodBy.get(it.id);
      if (p && (p.actual > 0 || p.planned > 0)) {
        const qty = it.quantity && it.quantity > 0 ? it.quantity : null;
        const progress = qty ? (p.actual / qty) * 100 : p.planned > 0 ? (p.actual / p.planned) * 100 : 0;
        const planned = qty ? (p.planned / qty) * 100 : 100;
        r = { progress: clamp(progress), planned: clamp(planned), fromEntries: true };
      } else {
        r = { progress: clamp(it.progressPct), planned: elapsedPct(actsBy.get(it.id) ?? [], now), fromEntries: false };
      }
    }
    byId.set(it.id, r);
    return r;
  };

  for (const it of items) compute(it, new Set());
  const roots = kids.get('__root') ?? [];
  const project = roots.length ? weighted(roots, new Set()) : null;
  return { byId, project, fromEntries: [...byId.values()].some((r) => r.fromEntries) };
}

const num = (v: unknown) => Number(v ?? 0);

/** Inputs for many projects in four queries (used by loadProjectMetrics). */
export async function loadWbsProgress(orgId: string, projectIds: string[], approvedOnly = false) {
  if (!projectIds.length) return new Map<string, ReturnType<typeof rollupProgress>>();
  const where = { organizationId: orgId, projectId: { in: projectIds } };
  const [items, prod, acts] = await Promise.all([
    prisma.wbsItem.findMany({ where, select: { id: true, projectId: true, parentId: true, quantity: true, weightPct: true, progressPct: true } }),
    prisma.productionEntry.groupBy({
      by: ['projectId', 'wbsItemId'],
      where: { ...where, wbsItemId: { not: null }, deletedAt: null, ...(approvedOnly ? { OR: [{ dailyReportId: null }, { dailyReport: { status: 'APPROVED' } }] } : {}) },
      _sum: { plannedQty: true, actualQty: true },
    }),
    prisma.scheduleActivity.findMany({ where: { ...where, wbsItemId: { not: null } }, select: { projectId: true, wbsItemId: true, startDate: true, finishDate: true } }),
  ]);
  const out = new Map<string, ReturnType<typeof rollupProgress>>();
  for (const pid of projectIds) {
    const its = items.filter((i) => i.projectId === pid).map((i) => ({ id: i.id, parentId: i.parentId, quantity: i.quantity == null ? null : num(i.quantity), weightPct: i.weightPct, progressPct: i.progressPct }));
    if (!its.length) continue;
    out.set(pid, rollupProgress(
      its,
      prod.filter((p) => p.projectId === pid).map((p) => ({ wbsItemId: p.wbsItemId as string, planned: num(p._sum.plannedQty), actual: num(p._sum.actualQty) })),
      acts.filter((a) => a.projectId === pid).map((a) => ({ wbsItemId: a.wbsItemId as string, startDate: a.startDate, finishDate: a.finishDate })),
    ));
  }
  return out;
}

/**
 * Write the one result back onto WBS items (those with entries, and every parent) and onto
 * linked schedule activities, so list screens that read the stored column agree.
 */
export async function syncWbsAndActivities(orgId: string, projectId: string): Promise<void> {
  const res = (await loadWbsProgress(orgId, [projectId])).get(projectId);
  if (!res) return;
  const [items, acts] = await Promise.all([
    prisma.wbsItem.findMany({ where: { organizationId: orgId, projectId }, select: { id: true, progressPct: true } }),
    prisma.scheduleActivity.findMany({ where: { organizationId: orgId, projectId, wbsItemId: { not: null } }, select: { id: true, wbsItemId: true, progressPct: true } }),
  ]);
  const parents = new Set((await prisma.wbsItem.findMany({ where: { organizationId: orgId, projectId, parentId: { not: null } }, select: { parentId: true } })).map((p) => p.parentId));
  const r1 = (n: number) => Number(n.toFixed(1));
  for (const it of items) {
    const p = res.byId.get(it.id);
    if (!p || (!p.fromEntries && !parents.has(it.id))) continue;
    if (r1(p.progress) !== r1(it.progressPct)) await prisma.wbsItem.update({ where: { id: it.id }, data: { progressPct: r1(p.progress) } });
  }
  for (const a of acts) {
    const p = res.byId.get(a.wbsItemId as string);
    if (p && r1(p.progress) !== r1(a.progressPct)) await prisma.scheduleActivity.update({ where: { id: a.id }, data: { progressPct: r1(p.progress) } });
  }
}
