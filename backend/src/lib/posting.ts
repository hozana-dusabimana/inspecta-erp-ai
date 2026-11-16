import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { Conflict } from './errors';

/**
 * POSTED RECORDS (T1-01 / T1-02).
 *
 * Cost entries, stock movements, payments, invoices and the source documents
 * that post them (material issues, GRNs) are never hard-deleted. They are
 * cancelled with a reason; the cancel marks the original (it stays visible) and
 * writes an equal and opposite row, so every SUM in the system nets back to the
 * pre-posting figure without any query having to know about cancellations.
 *
 *   original  : amount +700,000   cancelledAt=… cancelReason=…
 *   reversal  : amount −700,000   reversalOfId=<original.id>
 *
 * Stock is reversed the same way: an ISSUE of +50 is reversed by an ISSUE of −50,
 * a RECEIPT of +100 by a RECEIPT of −100, so balances and weighted-average cost
 * (Σqty·cost / Σqty) come back exactly.
 */

type Tx = Prisma.TransactionClient;

export interface CancelActor {
  orgId: string;
  userId: string;
  reason: string;
}

/** Minimum length so "x" or "." is not accepted as a reason. */
export const MIN_REASON = 5;

export function assertReason(reason: unknown): string {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < MIN_REASON) throw Conflict(`A reason of at least ${MIN_REASON} characters is required to cancel a posted record.`);
  return r;
}

/** Reverse the live cost entries a source record posted. Returns how many were reversed. */
export async function reverseCostEntries(
  tx: Tx,
  where: { source: string; sourceRef: string } | { id: string },
  a: CancelActor,
): Promise<number> {
  const live = await tx.costEntry.findMany({
    where: { organizationId: a.orgId, ...where, cancelledAt: null, reversalOfId: null, deletedAt: null },
  });
  const now = new Date();
  for (const c of live) {
    await tx.costEntry.update({ where: { id: c.id }, data: { cancelledAt: now, cancelledById: a.userId, cancelReason: a.reason, updatedBy: a.userId } });
    await tx.costEntry.create({
      data: {
        organizationId: c.organizationId, projectId: c.projectId, wbsItemId: c.wbsItemId, category: c.category,
        source: c.source, sourceRef: c.sourceRef, reversalOfId: c.id,
        description: `REVERSAL of "${c.description}" — ${a.reason}`.slice(0, 500),
        amount: new Prisma.Decimal(c.amount).negated(), date: now, createdBy: a.userId, updatedBy: a.userId,
      },
    });
  }
  return live.length;
}

/** Reverse the live stock movements a source record posted (by referenceId, or one movement by id). */
export async function reverseStockMovements(
  tx: Tx,
  where: { referenceId: string } | { id: string },
  a: CancelActor,
): Promise<number> {
  const live = await tx.stockMovement.findMany({ where: { organizationId: a.orgId, ...where, cancelledAt: null, reversalOfId: null } });
  const now = new Date();
  for (const m of live) {
    await tx.stockMovement.update({ where: { id: m.id }, data: { cancelledAt: now, cancelledById: a.userId, cancelReason: a.reason } });
    await tx.stockMovement.create({
      data: {
        organizationId: m.organizationId, materialId: m.materialId, projectId: m.projectId, wbsItemId: m.wbsItemId,
        type: m.type, quantity: new Prisma.Decimal(m.quantity).negated(), unitCost: m.unitCost,
        referenceId: m.referenceId, reference: `REV ${m.reference ?? ''}`.trim(), reversalOfId: m.id,
        warehouse: m.warehouse, note: `Reversal: ${a.reason}`.slice(0, 500), date: now,
      },
    });
  }
  return live.length;
}

const IN_TYPES = new Set(['OPENING', 'RECEIPT', 'ADJUSTMENT', 'RETURN']);
const OUT_TYPES = new Set(['ISSUE', 'WASTE', 'POS_SALE']);

/** Signed effect of a movement on the stock balance. */
export function stockDelta(type: string, qty: number): number {
  if (IN_TYPES.has(type)) return qty;
  if (OUT_TYPES.has(type)) return -qty;
  return 0;
}

/**
 * Removing stock that has already been issued would leave a negative balance:
 * refuse, and say what to cancel first.
 */
export async function assertStockAllowsReversal(tx: Tx, orgId: string, materialId: string, removing: number, label: string) {
  const groups = await tx.stockMovement.groupBy({ by: ['type'], where: { organizationId: orgId, materialId }, _sum: { quantity: true } });
  const onHand = groups.reduce((s, g) => s + stockDelta(g.type, Number(g._sum.quantity ?? 0)), 0);
  if (removing > onHand + 1e-9) {
    throw Conflict(`Cannot cancel ${label}: it would take stock below zero (only ${Number(onHand.toFixed(3))} on hand). Cancel the issues that used this stock first.`);
  }
}

/** Source modules whose cost entries are posted automatically, and how to check the source still exists. */
const SOURCE_EXISTS: Record<string, (orgId: string, id: string) => Promise<boolean>> = {
  MATERIAL_ISSUE: async (o, id) => !!(await prisma.materialIssue.findFirst({ where: { id, organizationId: o, cancelledAt: null }, select: { id: true } })),
  FUEL: async (o, id) => !!(await prisma.fuelLog.findFirst({ where: { id, organizationId: o }, select: { id: true } })),
  EQUIPMENT_USAGE: async (o, id) => !!(await prisma.equipmentUsageLog.findFirst({ where: { id, organizationId: o }, select: { id: true } })),
  ATTENDANCE: async (o, id) => !!(await prisma.attendance.findFirst({ where: { id, organizationId: o }, select: { id: true } })),
  PRODUCTION: async (o, id) => !!(await prisma.productionEntry.findFirst({ where: { id, organizationId: o }, select: { id: true } })),
};

export const AUTO_SOURCES = Object.keys(SOURCE_EXISTS);

/** True when the record that posted this cost still exists (so cancel it there, not here). */
export async function costSourceAlive(orgId: string, source: string, sourceRef: string | null): Promise<boolean> {
  if (!sourceRef) return false;
  const check = SOURCE_EXISTS[source];
  return check ? check(orgId, sourceRef) : false;
}

const MOVEMENT_SOURCE: Array<(orgId: string, id: string) => Promise<string | null>> = [
  async (o, id) => ((await prisma.goodsReceipt.findFirst({ where: { id, organizationId: o, cancelledAt: null }, select: { grnNumber: true } })) ? 'goods receipt' : null),
  async (o, id) => ((await prisma.materialIssue.findFirst({ where: { id, organizationId: o, cancelledAt: null }, select: { id: true } })) ? 'material issue' : null),
  async (o, id) => ((await prisma.posTransaction.findFirst({ where: { id, organizationId: o }, select: { id: true } })) ? 'POS sale' : null),
];

/** Name of the live document that posted a stock movement, or null when it is gone (orphan). */
export async function movementSourceAlive(orgId: string, referenceId: string | null): Promise<string | null> {
  if (!referenceId) return null;
  for (const f of MOVEMENT_SOURCE) { const n = await f(orgId, referenceId); if (n) return n; }
  return null;
}

/**
 * Integrity report (T1-01 e): lists, never deletes.
 *  - duplicates : more than one live posting for the same source + category
 *  - orphans    : live auto-posted costs / movements whose source record no longer exists
 *  - lookalikes : manual-looking twins (same project, category, amount, description)
 */
export async function costIntegrityReport(orgId: string, projectId?: string) {
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}), cancelledAt: null, reversalOfId: null, deletedAt: null };
  const costs = await prisma.costEntry.findMany({
    where: scope,
    select: { id: true, projectId: true, category: true, source: true, sourceRef: true, description: true, amount: true, date: true, createdAt: true, project: { select: { code: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const row = (c: (typeof costs)[number]) => ({
    id: c.id, projectCode: c.project.code, category: c.category, source: c.source, sourceRef: c.sourceRef,
    description: c.description, amount: Number(c.amount), date: c.date, createdAt: c.createdAt,
  });

  const bySource = new Map<string, typeof costs>();
  for (const c of costs) {
    if (!c.sourceRef) continue;
    const k = `${c.source}|${c.sourceRef}|${c.category}`;
    bySource.set(k, [...(bySource.get(k) ?? []), c]);
  }
  const duplicates = [...bySource.values()].filter((g) => g.length > 1).map((g) => g.map(row));

  const orphans = [] as ReturnType<typeof row>[];
  for (const c of costs) {
    if (!c.sourceRef || !SOURCE_EXISTS[c.source]) continue;
    if (!(await costSourceAlive(orgId, c.source, c.sourceRef))) orphans.push(row(c));
  }

  const look = new Map<string, typeof costs>();
  for (const c of costs) {
    const k = `${c.projectId}|${c.category}|${Number(c.amount)}|${c.description.trim().toLowerCase()}`;
    look.set(k, [...(look.get(k) ?? []), c]);
  }
  const lookalikes = [...look.values()].filter((g) => g.length > 1).map((g) => g.map(row));

  const moves = await prisma.stockMovement.findMany({
    where: { organizationId: orgId, ...(projectId ? { projectId } : {}), cancelledAt: null, reversalOfId: null, referenceId: { not: null } },
    select: { id: true, type: true, quantity: true, reference: true, referenceId: true, date: true, material: { select: { code: true, name: true } } },
  });
  const orphanMovements = [] as Array<{ id: string; type: string; quantity: number; reference: string | null; material: string; date: Date }>;
  for (const m of moves) {
    if (!(await movementSourceAlive(orgId, m.referenceId))) orphanMovements.push({ id: m.id, type: m.type, quantity: Number(m.quantity), reference: m.reference, material: `${m.material.code} ${m.material.name}`, date: m.date });
  }

  return {
    duplicates, orphans, lookalikes, orphanMovements,
    clean: !duplicates.length && !orphans.length && !lookalikes.length && !orphanMovements.length,
  };
}

/** Idempotently (re)create the one-live-posting-per-source unique index once the data allows it. */
export async function ensureCostIntegrityIndex(): Promise<boolean> {
  const dup = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`
    SELECT COUNT(*) AS n FROM (
      SELECT 1 FROM "cost_entries"
      WHERE "sourceRef" IS NOT NULL AND "reversalOfId" IS NULL AND "cancelledAt" IS NULL AND "deletedAt" IS NULL
      GROUP BY "organizationId", "source", "sourceRef", "category" HAVING COUNT(*) > 1) d`);
  if (Number(dup[0]?.n ?? 0) > 0) return false;
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "cost_entries_one_live_per_source"
      ON "cost_entries" ("organizationId", "source", "sourceRef", "category")
      WHERE "sourceRef" IS NOT NULL AND "reversalOfId" IS NULL AND "cancelledAt" IS NULL AND "deletedAt" IS NULL`);
  return true;
}

export interface DesiredCost {
  projectId: string;
  wbsItemId: string | null;
  category: 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCONTRACTOR' | 'OVERHEAD' | 'OTHER';
  amount: number;
  date: Date;
  description: string;
}

/**
 * Keep the one live cost entry for a source record in step with that record,
 * without ever editing a posted amount in place: a change reverses the old
 * posting and writes a new one, so the ledger shows what happened and when.
 * `desired = null` (or amount ≤ 0) reverses whatever is live.
 */
export async function syncSourceCost(
  tx: Tx,
  source: string,
  sourceRef: string,
  category: DesiredCost['category'],
  desired: DesiredCost | null,
  a: CancelActor,
): Promise<'created' | 'reversed' | 'reposted' | 'unchanged' | 'none'> {
  const live = await tx.costEntry.findFirst({
    where: { organizationId: a.orgId, source, sourceRef, category, cancelledAt: null, reversalOfId: null, deletedAt: null },
  });
  const want = desired && desired.amount > 0 ? desired : null;
  if (!want) {
    if (!live) return 'none';
    await reverseCostEntries(tx, { id: live.id }, a);
    return 'reversed';
  }
  const amount = new Prisma.Decimal(want.amount.toFixed(2));
  if (live && live.amount.equals(amount) && live.projectId === want.projectId && (live.wbsItemId ?? null) === (want.wbsItemId ?? null)) {
    if (live.description !== want.description) await tx.costEntry.update({ where: { id: live.id }, data: { description: want.description } });
    return 'unchanged';
  }
  if (live) await reverseCostEntries(tx, { id: live.id }, a);
  await tx.costEntry.create({
    data: {
      organizationId: a.orgId, projectId: want.projectId, wbsItemId: want.wbsItemId, category, source, sourceRef,
      description: want.description, amount, date: want.date, createdBy: a.userId, updatedBy: a.userId,
    },
  });
  return live ? 'reposted' : 'created';
}
