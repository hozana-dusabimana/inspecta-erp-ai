import { Router, Request } from 'express';
import { z } from 'zod';
import { PoStatus, PrStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { notify } from '../notifications/notify';
import { createCrudRouter } from '../../lib/crud';

const router = Router();

const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

// ── Suppliers (with scoring + lead time) ──────────────────────
const supplierCreate = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  tinNumber: z.string().optional(),
  paymentTerms: z.string().optional(),
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
  materialId: z.string().optional(),
  description: z.string().min(1),
  unit: z.string().optional(),
  quantity: z.number().nonnegative(),
  rate: z.number().nonnegative(),
});
const poCreate = z.object({
  supplierId: z.string(),
  projectId: z.string().optional(),
  purchaseRequestId: z.string().optional(),
  number: z.string().min(1).optional(), // auto-generated (PO-####) when omitted
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
    autoCode: { field: 'number', prefix: 'PO' },
    searchField: 'number',
    dateField: 'orderDate',
    filterFields: ['status'],
    sumFields: ['total'],
    refs: [{ field: 'supplierId', model: 'supplier' }],
    include: { items: true, supplier: { select: { id: true, name: true } } },
    transform: (data) => {
      const items = (data.items as Array<Record<string, number>> | undefined) ?? [];
      if (Array.isArray(items) && items.length) {
        const withAmounts = items.map((it) => ({
          materialId: (it.materialId as unknown as string) || null,
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

// ── Purchase Requests (#9) with approval workflow ─────────────
const prItem = z.object({
  materialId: z.string().optional(),
  description: z.string().min(1),
  unit: z.string().optional(),
  quantity: z.number().nonnegative(),
  estimatedRate: z.number().nonnegative().optional(),
});
const prCreate = z.object({
  projectId: z.string().optional(),
  number: z.string().min(1),
  title: z.string().optional(),
  neededByDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  items: z.array(prItem).default([]),
});
const prUpdate = z.object({
  title: z.string().optional(),
  neededByDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

const prCrud = createCrudRouter({
  model: 'purchaseRequest',
  entity: 'purchase-request',
  readPerm: 'procurement:read',
  writePerm: 'procurement:write',
  createSchema: prCreate,
  updateSchema: prUpdate,
  searchField: 'number',
  filterFields: ['status'],
  sumFields: ['total'],
  orderBy: { createdAt: 'desc' },
  include: { items: true },
  transform: (data, req) => {
    const items = (data.items as Array<Record<string, number>> | undefined) ?? [];
    if (Array.isArray(items) && items.length) {
      const withAmounts = items.map((it) => ({
        materialId: (it.materialId as unknown as string) || null,
        description: it.description,
        unit: (it.unit as unknown as string) ?? 'unit',
        quantity: Number(it.quantity ?? 0),
        estimatedRate: Number(it.estimatedRate ?? 0),
        amount: Number(it.quantity ?? 0) * Number(it.estimatedRate ?? 0),
      }));
      data.total = withAmounts.reduce((s, it) => s + it.amount, 0);
      data.items = { create: withAmounts };
    } else if ('id' in data) {
      delete data.items;
    } else {
      delete data.items;
    }
    if (!('id' in data)) data.requestedById = req.user!.id;
    return stamp(data, req);
  },
});

// Allowed status transitions for the PR workflow engine.
const PR_TRANSITIONS: Record<PrStatus, PrStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['ORDERED'],
  REJECTED: [],
  ORDERED: ['DELIVERED'],
  DELIVERED: ['CLOSED'],
  CLOSED: [],
};

const prRouter = Router();

function prAction(
  action: string,
  to: PrStatus,
  perm: 'procurement:write' | 'approval:write',
) {
  prRouter.post(
    `/:id/${action}`,
    authenticate,
    requirePermission(perm),
    asyncHandler(async (req, res) => {
      const existing = await prisma.purchaseRequest.findFirst({
        where: { id: req.params.id, organizationId: req.user!.orgId },
      });
      if (!existing) throw NotFound('Purchase request not found');
      if (!PR_TRANSITIONS[existing.status].includes(to)) {
        throw BadRequest(`Cannot ${action} a request in status ${existing.status}`);
      }
      const data: Record<string, unknown> = { status: to, updatedBy: req.user!.id };
      if (to === 'APPROVED' || to === 'REJECTED') {
        data.approvedById = req.user!.id;
        data.approvedAt = new Date();
        if (typeof req.body?.decisionNote === 'string') data.decisionNote = req.body.decisionNote;
      }
      const pr = await prisma.purchaseRequest.update({ where: { id: existing.id }, data });
      await auditFromRequest(req, 'UPDATE', 'purchase-request', pr.id, {
        oldValues: { status: existing.status },
        newValues: { status: to },
      });

      // Notifications: submission asks approvers; decisions inform the requester.
      if (to === 'SUBMITTED') {
        await notify({
          organizationId: req.user!.orgId,
          type: 'APPROVAL',
          severity: 'MEDIUM',
          title: 'Purchase request submitted',
          message: `PR ${pr.number} was submitted for approval.`,
          link: '/procurement',
        });
      } else if (to === 'APPROVED' || to === 'REJECTED') {
        await notify({
          organizationId: req.user!.orgId,
          userId: existing.requestedById,
          type: 'APPROVAL',
          severity: to === 'REJECTED' ? 'HIGH' : 'MEDIUM',
          title: `Purchase request ${to.toLowerCase()}`,
          message: `PR ${pr.number} was ${to.toLowerCase()}.`,
          link: '/procurement',
        });
      }
      return ok(res, pr);
    }),
  );
}

prAction('submit', PrStatus.SUBMITTED, 'procurement:write');
prAction('approve', PrStatus.APPROVED, 'approval:write');
prAction('reject', PrStatus.REJECTED, 'approval:write');
prAction('order', PrStatus.ORDERED, 'procurement:write');
prAction('deliver', PrStatus.DELIVERED, 'procurement:write');
prAction('close', PrStatus.CLOSED, 'procurement:write');
prRouter.use('/', prCrud);
router.use('/purchase-requests', prRouter);

// ── RFQs + supplier quotes (vendor comparison) ────────────────
const rfqCreate = z.object({
  projectId: z.string().optional(),
  purchaseRequestId: z.string().optional(),
  number: z.string().min(1).optional(), // auto-generated (RFQ-####) when omitted
  status: z.enum(['DRAFT', 'SENT', 'AWARDED', 'CLOSED']).optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});
router.use(
  '/rfqs',
  createCrudRouter({
    model: 'rfq', entity: 'rfq',
    readPerm: 'procurement:read', writePerm: 'procurement:write',
    createSchema: rfqCreate, updateSchema: rfqCreate.partial(),
    autoCode: { field: 'number', prefix: 'RFQ' },
    searchField: 'number', orderBy: { createdAt: 'desc' },
    include: { quotes: true },
    transform: stamp,
  }),
);

const quoteCreate = z.object({
  rfqId: z.string(),
  supplierId: z.string(),
  totalAmount: z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});
const quoteRouter = Router();
// Award a quote: marks it awarded, un-awards siblings, sets the RFQ to AWARDED.
quoteRouter.post(
  '/:id/award',
  authenticate,
  requirePermission('procurement:write'),
  asyncHandler(async (req, res) => {
    const quote = await prisma.rfqQuote.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
    });
    if (!quote) throw NotFound('Quote not found');
    await prisma.$transaction([
      prisma.rfqQuote.updateMany({ where: { rfqId: quote.rfqId }, data: { awarded: false } }),
      prisma.rfqQuote.update({ where: { id: quote.id }, data: { awarded: true, updatedBy: req.user!.id } }),
      prisma.rfq.update({ where: { id: quote.rfqId }, data: { status: 'AWARDED', updatedBy: req.user!.id } }),
    ]);
    await auditFromRequest(req, 'UPDATE', 'rfq-quote', quote.id, { newValues: { awarded: true } });
    return ok(res, { awarded: quote.id });
  }),
);
quoteRouter.use(
  '/',
  createCrudRouter({
    model: 'rfqQuote', entity: 'rfq-quote',
    readPerm: 'procurement:read', writePerm: 'procurement:write',
    createSchema: quoteCreate, updateSchema: quoteCreate.partial(),
    orderBy: { totalAmount: 'asc' },
    include: { rfq: { select: { id: true, number: true } } },
    refs: [{ field: 'rfqId', model: 'rfq' }, { field: 'supplierId', model: 'supplier' }],
    transform: stamp,
  }),
);
router.use('/rfq-quotes', quoteRouter);

// ── Delivery tracking ─────────────────────────────────────────
const deliveryCreate = z.object({
  projectId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
  number: z.string().min(1).optional(), // auto-generated (GRN-####) when omitted
  status: z.enum(['PENDING', 'PARTIAL', 'RECEIVED']).optional(),
  deliveryDate: z.string().datetime().optional(),
  receivedBy: z.string().optional(),
  notes: z.string().optional(),
});
router.use(
  '/deliveries',
  createCrudRouter({
    model: 'delivery', entity: 'delivery',
    readPerm: 'procurement:read', writePerm: 'procurement:write',
    createSchema: deliveryCreate, updateSchema: deliveryCreate.partial(),
    autoCode: { field: 'number', prefix: 'DLV' },
    searchField: 'number', dateField: 'deliveryDate', filterFields: ['status'],
    orderBy: { deliveryDate: 'desc' },
    include: { purchaseOrder: { select: { id: true, number: true } } },
    refs: [{ field: 'purchaseOrderId', model: 'purchaseOrder' }],
    transform: stamp,
  }),
);

// ── MRP: net material requirements = planned − stock on hand ──
router.get(
  '/mrp',
  authenticate,
  requirePermission('procurement:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) throw BadRequest('projectId is required');

    const requirements = await prisma.materialRequirement.findMany({
      where: { organizationId: orgId, projectId },
      include: { material: { select: { id: true, code: true, name: true, unit: true, unitCost: true } } },
    });

    // Stock on hand per material (org-wide ledger).
    const groups = await prisma.stockMovement.groupBy({
      by: ['materialId', 'type'],
      where: { organizationId: orgId },
      _sum: { quantity: true },
    });
    const stockByMaterial = new Map<string, number>();
    for (const g of groups) {
      const qty = Number(g._sum.quantity ?? 0);
      const delta = g.type === 'ISSUE' || g.type === 'WASTE' || g.type === 'POS_SALE' ? -qty : g.type === 'TRANSFER' ? 0 : qty;
      stockByMaterial.set(g.materialId, (stockByMaterial.get(g.materialId) ?? 0) + delta);
    }

    const rows = requirements.map((r) => {
      const planned = Number(r.plannedQuantity);
      const onHand = stockByMaterial.get(r.materialId) ?? 0;
      const net = Math.max(0, planned - onHand);
      const unitCost = Number(r.material.unitCost);
      return {
        materialId: r.materialId,
        code: r.material.code,
        name: r.material.name,
        unit: r.material.unit,
        plannedQuantity: planned,
        onHand,
        netRequirement: net,
        estimatedCost: net * unitCost,
        requiredByDate: r.requiredByDate,
        leadTimeDays: r.leadTimeDays,
        status: r.status,
        toProcure: net > 0,
      };
    });

    return ok(res, {
      projectId,
      rows,
      totalNetCost: rows.reduce((s, r) => s + r.estimatedCost, 0),
      itemsToProcure: rows.filter((r) => r.toProcure).length,
    });
  }),
);

export default router;
