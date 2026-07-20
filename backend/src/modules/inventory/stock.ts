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
