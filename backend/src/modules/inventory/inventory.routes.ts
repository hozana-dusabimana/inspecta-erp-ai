import { Router } from 'express';
import { z } from 'zod';
import { MovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';

const router = Router();

// ── Material register ─────────────────────────────────────────
const materialCreate = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  supplierId: z.string().optional(),
  unit: z.string().optional(),
  reorderLevel: z.number().nonnegative().optional(),
  unitCost: z.number().nonnegative().optional(),
  standardCost: z.number().nonnegative().optional(),
});
router.use(
  '/materials',
  createCrudRouter({
    model: 'material',
    entity: 'material',
    readPerm: 'inventory:read',
    writePerm: 'inventory:write',
    createSchema: materialCreate,
    updateSchema: materialCreate.partial(),
    searchField: 'name',
  }),
);

// ── Material Planning — planned requirements per project (#8) ─────
const requirementCreate = z.object({
  projectId: z.string(),
  materialId: z.string(),
  plannedQuantity: z.number().nonnegative(),
  requiredByDate: z.string().datetime().optional(),
  supplierId: z.string().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  status: z.enum(['PLANNED', 'REQUESTED', 'ORDERED', 'FULFILLED']).optional(),
  note: z.string().optional(),
});
router.use(
  '/requirements',
  createCrudRouter({
    model: 'materialRequirement',
    entity: 'material-requirement',
    readPerm: 'inventory:read',
    writePerm: 'inventory:write',
    createSchema: requirementCreate,
    updateSchema: requirementCreate.partial(),
    requireProject: true,
    orderBy: { requiredByDate: 'asc' },
    include: { material: { select: { id: true, code: true, name: true, unit: true } } },
    refs: [
      { field: 'materialId', model: 'material' },
      { field: 'supplierId', model: 'supplier' },
    ],
    transform: (data, req) => {
      if (!('id' in data)) data.createdBy = req.user!.id;
      data.updatedBy = req.user!.id;
      return data;
    },
  }),
);

/** Compute net stock for a material = Σreceipts − Σissues (+adjustments). */
async function stockForMaterial(orgId: string, materialId: string): Promise<number> {
  const groups = await prisma.stockMovement.groupBy({
    by: ['type'],
    where: { organizationId: orgId, materialId },
    _sum: { quantity: true },
  });
  let stock = 0;
  for (const g of groups) {
    const qty = Number(g._sum.quantity ?? 0);
    if (g.type === 'RECEIPT' || g.type === 'ADJUSTMENT' || g.type === 'RETURN') stock += qty;
    if (g.type === 'ISSUE' || g.type === 'WASTE') stock -= qty;
    // TRANSFER nets to zero org-wide.
  }
  return stock;
}

// ── Stock movements (GRN / issues / adjustments) ──────────────
const movementCreate = z.object({
  materialId: z.string(),
  projectId: z.string().optional(),
  type: z.nativeEnum(MovementType),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().optional(),
  reference: z.string().optional(),
  warehouse: z.string().optional(),
  requestedBy: z.string().optional(),
  approvedBy: z.string().optional(),
  note: z.string().optional(),
  date: z.string().datetime().optional(),
});
router.use(
  '/movements',
  createCrudRouter({
    model: 'stockMovement',
    entity: 'stock-movement',
    readPerm: 'inventory:read',
    writePerm: 'inventory:write',
    createSchema: movementCreate,
    updateSchema: movementCreate.partial(),
    refs: [{ field: 'materialId', model: 'material' }],
    orderBy: { date: 'desc' },
    include: { material: { select: { id: true, code: true, name: true, unit: true } } },
    afterChange: async (action, record, req) => {
      if (action === 'DELETE') return;
      const materialId = String(record.materialId);
      const material = await prisma.material.findUnique({ where: { id: materialId } });
      if (!material) return;
      const stock = await stockForMaterial(req.user!.orgId, materialId);
      if (Number(material.reorderLevel) > 0 && stock <= Number(material.reorderLevel)) {
        await notify({
          organizationId: req.user!.orgId,
          type: 'LOW_STOCK',
          severity: 'HIGH',
          title: 'Low stock alert',
          message: `${material.name} (${material.code}) is at ${stock} ${material.unit}, at/below reorder level ${material.reorderLevel}.`,
          link: '/inventory',
        });
      }
    },
  }),
);

// ── Stock ledger: current stock + reorder flags ───────────────
router.get(
  '/stock',
  authenticate,
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const materials = await prisma.material.findMany({ where: { organizationId: orgId } });
    const groups = await prisma.stockMovement.groupBy({
      by: ['materialId', 'type'],
      where: { organizationId: orgId },
      _sum: { quantity: true },
    });

    const byMaterial = new Map<string, number>();
    for (const g of groups) {
      const qty = Number(g._sum.quantity ?? 0);
      const delta = g.type === 'ISSUE' || g.type === 'WASTE' ? -qty : g.type === 'TRANSFER' ? 0 : qty;
      byMaterial.set(g.materialId, (byMaterial.get(g.materialId) ?? 0) + delta);
    }

    const rows = materials.map((m) => {
      const stock = byMaterial.get(m.id) ?? 0;
      return {
        id: m.id,
        code: m.code,
        name: m.name,
        unit: m.unit,
        stock,
        reorderLevel: Number(m.reorderLevel),
        unitCost: Number(m.unitCost),
        stockValue: stock * Number(m.unitCost),
        needsReorder: Number(m.reorderLevel) > 0 && stock <= Number(m.reorderLevel),
      };
    });

    return ok(res, {
      materials: rows,
      totalValue: rows.reduce((s, r) => s + r.stockValue, 0),
      reorderCount: rows.filter((r) => r.needsReorder).length,
    });
  }),
);

// ── Inventory valuation: Weighted-Average or FIFO ─────────────
router.get(
  '/valuation',
  authenticate,
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const method = (req.query.method as string) === 'fifo' ? 'FIFO' : 'WAVG';
    const materials = await prisma.material.findMany({ where: { organizationId: orgId } });
    const movements = await prisma.stockMovement.findMany({
      where: { organizationId: orgId },
      orderBy: { date: 'asc' },
    });

    const byMat = new Map<string, typeof movements>();
    for (const m of movements) {
      const a = byMat.get(m.materialId) ?? []; a.push(m); byMat.set(m.materialId, a);
    }

    const rows = materials.map((mat) => {
      const mv = byMat.get(mat.id) ?? [];
      let qty = 0; let value = 0;
      const layers: { q: number; c: number }[] = []; // FIFO receipt layers
      for (const m of mv) {
        const q = Number(m.quantity);
        const isIn = m.type === 'RECEIPT' || m.type === 'ADJUSTMENT' || m.type === 'RETURN';
        const isOut = m.type === 'ISSUE' || m.type === 'WASTE';
        const cost = Number(m.unitCost) || Number(mat.unitCost);
        if (m.type === 'TRANSFER') continue;
        if (isIn) {
          qty += q; value += q * cost; layers.push({ q, c: cost });
        } else if (isOut) {
          if (method === 'FIFO') {
            let rem = q;
            while (rem > 0 && layers.length) {
              const layer = layers[0];
              const take = Math.min(rem, layer.q);
              value -= take * layer.c; layer.q -= take; rem -= take;
              if (layer.q <= 0) layers.shift();
            }
            qty -= q;
          } else {
            const avg = qty > 0 ? value / qty : cost;
            qty -= q; value -= q * avg;
          }
        }
      }
      const avgCost = qty > 0 ? value / qty : 0;
      return { id: mat.id, code: mat.code, name: mat.name, unit: mat.unit, quantity: Number(qty.toFixed(3)), avgCost: Number(avgCost.toFixed(2)), value: Number(Math.max(0, value).toFixed(2)) };
    });

    return ok(res, { method, rows, totalValue: Number(rows.reduce((s, r) => s + r.value, 0).toFixed(2)) });
  }),
);

export default router;
