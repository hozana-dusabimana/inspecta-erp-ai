import { Router } from 'express';
import { z } from 'zod';
import { PoStatus } from '@prisma/client';
import { createCrudRouter } from '../../lib/crud';

const router = Router();

// ── Suppliers (with scoring + lead time) ──────────────────────
const supplierCreate = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
});
router.use(
  '/suppliers',
  createCrudRouter({
    model: 'supplier',
    entity: 'supplier',
    readPerm: 'procurement:read',
    writePerm: 'procurement:write',
    createSchema: supplierCreate,
    updateSchema: supplierCreate.partial(),
    searchField: 'name',
    transform: (data) => {
      if (data.email === '') data.email = null;
      return data;
    },
  }),
);

// ── Purchase orders (with nested line items) ──────────────────
const poItem = z.object({
  description: z.string().min(1),
  unit: z.string().optional(),
  quantity: z.number().nonnegative(),
  rate: z.number().nonnegative(),
});
const poCreate = z.object({
  supplierId: z.string(),
  projectId: z.string().optional(),
  number: z.string().min(1),
  status: z.nativeEnum(PoStatus).optional(),
  orderDate: z.string().datetime().optional(),
  expectedDate: z.string().datetime().optional(),
  items: z.array(poItem).default([]),
});
const poUpdate = z.object({
  status: z.nativeEnum(PoStatus).optional(),
  expectedDate: z.string().datetime().optional(),
});

router.use(
  '/purchase-orders',
  createCrudRouter({
    model: 'purchaseOrder',
    entity: 'purchase-order',
    readPerm: 'procurement:read',
    writePerm: 'procurement:write',
    createSchema: poCreate,
    updateSchema: poUpdate,
    searchField: 'number',
    refs: [{ field: 'supplierId', model: 'supplier' }],
    include: { items: true, supplier: { select: { id: true, name: true } } },
    transform: (data) => {
      const items = (data.items as Array<Record<string, number>> | undefined) ?? [];
      if (Array.isArray(items) && items.length) {
        const withAmounts = items.map((it) => ({
          description: it.description,
          unit: (it.unit as unknown as string) ?? 'unit',
          quantity: Number(it.quantity ?? 0),
          rate: Number(it.rate ?? 0),
          amount: Number(it.quantity ?? 0) * Number(it.rate ?? 0),
        }));
        data.total = withAmounts.reduce((s, it) => s + it.amount, 0);
        data.items = { create: withAmounts };
      } else {
        delete data.items;
      }
      return data;
    },
  }),
);

export default router;
