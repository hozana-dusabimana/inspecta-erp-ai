import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { auditFromRequest } from '../../auth/audit';
import { notify } from '../notifications/notify';

const num = (v: unknown) => Number(v ?? 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

// Rwanda standard VAT (configurable via env; falls back to 18%).
const VAT_PCT = Number(process.env.POS_VAT_PCT ?? 18);

const router = Router();

// ── POS products ──────────────────────────────────────────────
const productSchema = z.object({
  materialId: z.string().optional(),
  name: z.string().min(1),
  productType: z.enum(['material', 'equipment_rental', 'service']).optional(),
  unit: z.string().optional(),
  unitPrice: z.number().nonnegative(),
  vatApplicable: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
});
router.use('/products', createCrudRouter({
  model: 'posProduct', entity: 'pos-product',
  readPerm: 'pos:read', writePerm: 'pos:write',
  createSchema: productSchema, updateSchema: productSchema.partial(),
  searchField: 'name', orderBy: { name: 'asc' },
  filterFields: ['productType'],
  include: { material: { select: { id: true, code: true, name: true } } },
  refs: [{ field: 'materialId', model: 'material' }],
  transform: stamp,
}));

// ── Service invoices (billed services outside the project IPC flow) ──
const serviceInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  clientId: z.string().optional(),
  clientNameFreetext: z.string().optional(),
  description: z.string().min(1),
  amount: z.number().nonnegative(),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
  vatApplicable: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
});
router.use('/service-invoices', createCrudRouter({
  model: 'serviceInvoice', entity: 'service-invoice',
  readPerm: 'pos:read', writePerm: 'pos:write',
  createSchema: serviceInvoiceSchema, updateSchema: serviceInvoiceSchema.partial(),
  searchField: 'invoiceNumber', orderBy: { createdAt: 'desc' },
  dateField: 'dueDate',
  filterFields: ['status'],
  sumFields: ['amount', 'totalAmount'],
  include: { client: { select: { id: true, name: true } } },
  refs: [{ field: 'clientId', model: 'client' }],
  transform: (data, req) => {
    const amount = num(data.amount);
    const vat = data.vatApplicable === false ? 0 : round2((amount * VAT_PCT) / 100);
    data.vatAmount = vat;
    data.totalAmount = round2(amount + vat);
    delete data.vatApplicable;
    return stamp(data, req);
  },
}));

// ── Till sessions ─────────────────────────────────────────────
router.get('/sessions', authenticate, requirePermission('pos:read'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 25)));
  const where = { organizationId: req.user!.orgId };
  const [data, total] = await Promise.all([
    prisma.tillSession.findMany({ where, orderBy: { openedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { transactions: true } } } }),
    prisma.tillSession.count({ where }),
  ]);
  return paginated(res, data, { page, pageSize, total });
}));

const openSchema = z.object({ openingFloat: z.number().nonnegative().optional(), note: z.string().optional() });
router.post('/sessions', authenticate, requirePermission('pos:write'), asyncHandler(async (req, res) => {
  const body = openSchema.parse(req.body);
  const session = await prisma.tillSession.create({
    data: { organizationId: req.user!.orgId, openedById: req.user!.id, openingFloat: body.openingFloat ?? 0, note: body.note, status: 'OPEN' },
  });
  await auditFromRequest(req, 'CREATE', 'till-session', session.id, { newValues: session });
  return ok(res, session, 201);
}));

const closeSchema = z.object({ countedCash: z.number().nonnegative() });
router.post('/sessions/:id/close', authenticate, requirePermission('pos:write'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const session = await prisma.tillSession.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!session) throw NotFound('till session not found');
  if (session.status === 'CLOSED') throw BadRequest('till session is already closed');
  const { countedCash } = closeSchema.parse(req.body);

  // Expected cash = opening float + Σ cash sales for this session.
  const cashAgg = await prisma.posTransaction.aggregate({
    where: { tillSessionId: session.id, paymentMethod: 'CASH', status: 'COMPLETED' },
    _sum: { totalAmount: true },
  });
  const expected = round2(num(session.openingFloat) + num(cashAgg._sum.totalAmount));
  const variance = round2(countedCash - expected);
  const updated = await prisma.tillSession.update({
    where: { id: session.id },
    data: { status: Math.abs(variance) > 0.5 ? 'FLAGGED' : 'CLOSED', closedAt: new Date(), countedCash, expectedCash: expected, variance },
  });
  await auditFromRequest(req, 'UPDATE', 'till-session', session.id, { oldValues: session, newValues: updated });
  return ok(res, updated);
}));

// ── POS transactions (sale = lines + VAT + optional stock drawdown) ──
const txnSchema = z.object({
  tillSessionId: z.string(),
  clientName: z.string().optional(),
  paymentMethod: z.enum(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER']).optional(),
  lines: z.array(z.object({
    posProductId: z.string(),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative().optional(), // overrides product price when set
  })).min(1),
});
router.get('/transactions', authenticate, requirePermission('pos:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const sessionId = req.query.tillSessionId as string | undefined;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 25)));
  const where = { organizationId: orgId, ...(sessionId ? { tillSessionId: sessionId } : {}) };
  const [data, total] = await Promise.all([
    prisma.posTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { lines: { include: { product: { select: { name: true } } } } } }),
    prisma.posTransaction.count({ where }),
  ]);
  return paginated(res, data, { page, pageSize, total });
}));

router.post('/transactions', authenticate, requirePermission('pos:write'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const body = txnSchema.parse(req.body);

  const session = await prisma.tillSession.findFirst({ where: { id: body.tillSessionId, organizationId: orgId } });
  if (!session) throw BadRequest('tillSessionId does not belong to your organization');
  if (session.status !== 'OPEN') throw BadRequest('till session is not open');

  const products = await prisma.posProduct.findMany({
    where: { organizationId: orgId, id: { in: body.lines.map((l) => l.posProductId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  let subtotal = 0;
  let vat = 0;
  const lineData = body.lines.map((l) => {
    const product = byId.get(l.posProductId);
    if (!product) throw BadRequest(`product ${l.posProductId} does not belong to your organization`);
    const price = l.unitPrice ?? num(product.unitPrice);
    const lineTotal = round2(price * l.quantity);
    subtotal += lineTotal;
    if (product.vatApplicable) vat += (lineTotal * VAT_PCT) / 100;
    return { organizationId: orgId, posProductId: product.id, quantity: l.quantity, unitPrice: price, lineTotal };
  });
  subtotal = round2(subtotal);
  vat = round2(vat);
  const total = round2(subtotal + vat);

  const count = await prisma.posTransaction.count({ where: { organizationId: orgId } });
  const receiptNumber = `RCT-${String(count + 1).padStart(4, '0')}`;

  const txn = await prisma.$transaction(async (tx) => {
    const created = await tx.posTransaction.create({
      data: {
        organizationId: orgId, tillSessionId: session.id, receiptNumber,
        clientName: body.clientName ?? 'Walk-in client',
        subtotal, vatAmount: vat, totalAmount: total,
        paymentMethod: body.paymentMethod ?? 'CASH', status: 'COMPLETED',
        createdById: req.user!.id,
        lines: { create: lineData },
      },
      include: { lines: true },
    });

    // Draw down shared stock for material-backed products (POS_SALE ledger rows).
    for (const l of body.lines) {
      const product = byId.get(l.posProductId)!;
      if (product.productType === 'material' && product.materialId) {
        await tx.stockMovement.create({
          data: {
            organizationId: orgId, materialId: product.materialId, type: 'POS_SALE',
            quantity: l.quantity, reference: receiptNumber, referenceId: created.id,
            note: `POS sale ${receiptNumber}`,
          },
        });
      }
    }
    return created;
  });

  await auditFromRequest(req, 'CREATE', 'pos-transaction', txn.id, { newValues: txn });

  // Low-stock check for sold materials.
  for (const l of body.lines) {
    const product = byId.get(l.posProductId)!;
    if (product.productType === 'material' && product.materialId) {
      const material = await prisma.material.findUnique({ where: { id: product.materialId } });
      if (material && num(material.reorderLevel) > 0) {
        const groups = await prisma.stockMovement.groupBy({ by: ['type'], where: { organizationId: orgId, materialId: product.materialId }, _sum: { quantity: true } });
        let stock = 0;
        for (const g of groups) {
          const q = num(g._sum.quantity);
          if (g.type === 'OPENING' || g.type === 'RECEIPT' || g.type === 'ADJUSTMENT' || g.type === 'RETURN') stock += q;
          if (g.type === 'ISSUE' || g.type === 'WASTE' || g.type === 'POS_SALE') stock -= q;
        }
        if (stock <= num(material.reorderLevel)) {
          await notify({
            organizationId: orgId, type: 'LOW_STOCK', severity: 'HIGH',
            title: 'Low stock alert',
            message: `${material.name} (${material.code}) is at ${stock} ${material.unit} after a POS sale, at/below reorder level ${material.reorderLevel}.`,
            link: '/inventory',
          });
        }
      }
    }
  }

  return ok(res, txn, 201);
}));

// ── POS summary ───────────────────────────────────────────────
router.get('/summary', authenticate, requirePermission('pos:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const [sales, txnCount, openSessions, byMethod] = await Promise.all([
    prisma.posTransaction.aggregate({ where: { organizationId: orgId, status: 'COMPLETED' }, _sum: { subtotal: true, vatAmount: true, totalAmount: true } }),
    prisma.posTransaction.count({ where: { organizationId: orgId } }),
    prisma.tillSession.count({ where: { organizationId: orgId, status: 'OPEN' } }),
    prisma.posTransaction.groupBy({ by: ['paymentMethod'], where: { organizationId: orgId, status: 'COMPLETED' }, _sum: { totalAmount: true } }),
  ]);
  return ok(res, {
    totalSales: num(sales._sum.totalAmount),
    totalSubtotal: num(sales._sum.subtotal),
    totalVat: num(sales._sum.vatAmount),
    transactions: txnCount,
    openSessions,
    byPaymentMethod: byMethod.map((m) => ({ method: m.paymentMethod, amount: num(m._sum.totalAmount) })),
  });
}));

export default router;
