import { prisma } from '../../lib/prisma';

/**
 * Net stock for a material = Σ(receipts, opening, adjustments, returns)
 *                          − Σ(issues, waste, POS sales).
 * TRANSFER nets to zero org-wide.
 *
 * Lives in its own file so both the inventory routes and the requisition
 * issue path can use it without importing each other.
 */
export async function stockForMaterial(orgId: string, materialId: string): Promise<number> {
  const groups = await prisma.stockMovement.groupBy({
    by: ['type'],
    where: { organizationId: orgId, materialId },
    _sum: { quantity: true },
  });
  let stock = 0;
  for (const g of groups) {
    const qty = Number(g._sum.quantity ?? 0);
    if (g.type === 'OPENING' || g.type === 'RECEIPT' || g.type === 'ADJUSTMENT' || g.type === 'RETURN') stock += qty;
    if (g.type === 'ISSUE' || g.type === 'WASTE' || g.type === 'POS_SALE') stock -= qty;
  }
  return stock;
}

/** Weighted-average unit cost for every material at once (one query): used so every screen values stock the same way. */
export async function averageCostMap(orgId: string): Promise<Map<string, number>> {
  const moves = await prisma.stockMovement.findMany({
    where: { organizationId: orgId, type: { in: ['OPENING', 'RECEIPT', 'ADJUSTMENT', 'RETURN'] }, unitCost: { gt: 0 } },
    select: { materialId: true, quantity: true, unitCost: true },
  });
  const acc = new Map<string, { q: number; v: number }>();
  for (const m of moves) {
    const a = acc.get(m.materialId) ?? { q: 0, v: 0 };
    a.q += Number(m.quantity); a.v += Number(m.quantity) * Number(m.unitCost);
    acc.set(m.materialId, a);
  }
  return new Map([...acc].filter(([, a]) => a.q > 0).map(([id, a]) => [id, a.v / a.q]));
}

/** Weighted-average unit cost from receipts/opening/adjustments; falls back to the material's list cost. */
export async function weightedAverageCost(orgId: string, materialId: string): Promise<number> {
  const [moves, mat] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { organizationId: orgId, materialId, type: { in: ['OPENING', 'RECEIPT', 'ADJUSTMENT', 'RETURN'] }, unitCost: { gt: 0 } },
      select: { quantity: true, unitCost: true },
    }),
    prisma.material.findUnique({ where: { id: materialId }, select: { unitCost: true } }),
  ]);
  let qty = 0; let value = 0;
  for (const m of moves) { qty += Number(m.quantity); value += Number(m.quantity) * Number(m.unitCost); }
  const avg = qty > 0 ? value / qty : Number(mat?.unitCost ?? 0);
  return Number(avg.toFixed(2));
}

/** Post quantity x average cost of a material issue to project finance (idempotent per issue). */
export async function postMaterialIssueCost(
  orgId: string,
  issue: Record<string, unknown>,
  unitCost: number,
  materialName: string,
  userId: string,
): Promise<void> {
  const amount = Number((Number(issue.quantityIssued) * unitCost).toFixed(2));
  if (amount <= 0) return;
  const exists = await prisma.costEntry.findFirst({ where: { organizationId: orgId, source: 'MATERIAL_ISSUE', sourceRef: String(issue.id) } });
  if (exists) return;
  await prisma.costEntry.create({
    data: {
      organizationId: orgId, projectId: String(issue.projectId), wbsItemId: (issue.wbsItemId as string) ?? null,
      category: 'MATERIAL', source: 'MATERIAL_ISSUE', sourceRef: String(issue.id),
      description: `Material issue ${issue.issueNumber ?? ''} - ${materialName} x ${Number(issue.quantityIssued)}`.trim(),
      amount, date: (issue.dateIssued as Date) ?? new Date(), createdBy: userId,
    },
  });
}
