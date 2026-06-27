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
  unit: z.string().optional(),
  reorderLevel: z.number().nonnegative().optional(),
  unitCost: z.number().nonnegative().optional(),
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
    if (g.type === 'RECEIPT' || g.type === 'ADJUSTMENT') stock += qty;
    if (g.type === 'ISSUE') stock -= qty;
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
      const delta = g.type === 'ISSUE' ? -qty : qty;
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

export default router;
