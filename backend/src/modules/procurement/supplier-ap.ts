import { Router, Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter, CrudOptions } from '../../lib/crud';
import { addApprovalRoutes, alertAwaitingApproval } from '../../lib/maker-checker';
import { notify } from '../notifications/notify';

/**
 * Procurement controls (T2-08).
 *
 * What the flow checked before: a client invoice (INV-…) and a client payment (PAY-…) are revenue
 * records with no link to purchasing; there was no supplier invoice at all, so nothing tied a
 * payment to a purchase order or a goods receipt, and no order limit existed.
 *
 * Now:
 *  - a purchase order above the company's limit stays PENDING until the CEO (company admin, a
 *    different person) approves it; it cannot be issued or received against before that;
 *  - orders to one supplier within 24 h that together pass the limit are flagged SPLIT_ORDER, and a
 *    supplier with 3+ orders in 30 days is flagged REPEAT_SUPPLIER (the CEO is alerted);
 *  - a supplier invoice is paid only on a THREE-WAY MATCH: purchase order + goods received + invoice
 *    (amounts within 2%); the match status is shown on the invoice.
 */
const num = (v: unknown) => Number(v ?? 0);
const TOLERANCE = 0.02;

export async function poLimit(orgId: string): Promise<number> {
  const o = await prisma.organization.findUnique({ where: { id: orgId }, select: { poApprovalLimit: true } });
  return num(o?.poApprovalLimit ?? 10_000_000);
}

/** Flags for a new PO: split orders and repeat suppliers. */
export async function poFlags(orgId: string, po: { id?: string; supplierId: string; total: number; orderDate?: Date }): Promise<string[]> {
  const limit = await poLimit(orgId);
  const when = po.orderDate ?? new Date();
  const dayAgo = new Date(when.getTime() - 86400000);
  const recent = await prisma.purchaseOrder.findMany({
    where: { organizationId: orgId, supplierId: po.supplierId, status: { not: 'CANCELLED' }, createdAt: { gte: dayAgo }, ...(po.id ? { id: { not: po.id } } : {}) },
    select: { number: true, total: true },
  });
  const flags: string[] = [];
  const together = recent.reduce((s, r) => s + num(r.total), 0) + po.total;
  if (recent.length && po.total <= limit && together > limit) {
    flags.push(`SPLIT_ORDER: with ${recent.map((r) => r.number).join(', ')} this supplier has ${together.toLocaleString()} ordered within 24 h, above the ${limit.toLocaleString()} approval limit.`);
  }
  const month = await prisma.purchaseOrder.count({ where: { organizationId: orgId, supplierId: po.supplierId, status: { not: 'CANCELLED' }, createdAt: { gte: new Date(when.getTime() - 30 * 86400000) }, ...(po.id ? { id: { not: po.id } } : {}) } });
  if (month >= 2) flags.push(`REPEAT_SUPPLIER: ${month + 1} orders to this supplier in 30 days.`);
  return flags;
}

export interface MatchResult { status: 'MATCHED' | 'NO_PO' | 'NO_GRN' | 'MISMATCH'; detail: string; poTotal: number; received: number; invoiced: number }

/** Three-way match: purchase order ↔ goods received ↔ invoice. */
export async function threeWayMatch(orgId: string, inv: { id?: string; purchaseOrderId: string | null; amount: number }): Promise<MatchResult> {
  if (!inv.purchaseOrderId) return { status: 'NO_PO', detail: 'No purchase order is linked to this invoice.', poTotal: 0, received: 0, invoiced: inv.amount };
  const po = await prisma.purchaseOrder.findFirst({ where: { id: inv.purchaseOrderId, organizationId: orgId }, include: { items: true } });
  if (!po) return { status: 'NO_PO', detail: 'The linked purchase order was not found.', poTotal: 0, received: 0, invoiced: inv.amount };
  const grns = await prisma.goodsReceipt.findMany({ where: { organizationId: orgId, purchaseOrderId: po.id, cancelledAt: null, deletedAt: null } });
  // Value received = quantity received × the PO rate for that material (GRN cost when no line matches).
  const rate = new Map(po.items.filter((i) => i.materialId).map((i) => [i.materialId as string, num(i.rate)]));
  const received = grns.reduce((s, g) => s + num(g.quantityReceived) * (rate.get(g.materialId) ?? num(g.unitCost)), 0);
  const others = await prisma.supplierInvoice.aggregate({ where: { organizationId: orgId, purchaseOrderId: po.id, cancelledAt: null, ...(inv.id ? { id: { not: inv.id } } : {}) }, _sum: { amount: true } });
  const invoiced = num(others._sum.amount) + inv.amount;
  const poTotal = num(po.total);
  const base = { poTotal, received: Number(received.toFixed(2)), invoiced: Number(invoiced.toFixed(2)) };
  if (!grns.length) return { status: 'NO_GRN', detail: `No goods have been received against ${po.number}. Receive them (GRN) before paying.`, ...base };
  if (invoiced > poTotal * (1 + TOLERANCE)) return { status: 'MISMATCH', detail: `Invoiced ${invoiced.toLocaleString()} is more than the order ${po.number} (${poTotal.toLocaleString()}).`, ...base };
  if (invoiced > received * (1 + TOLERANCE)) return { status: 'MISMATCH', detail: `Invoiced ${invoiced.toLocaleString()} is more than the goods received (${received.toLocaleString()}).`, ...base };
  return { status: 'MATCHED', detail: `Order ${po.number}, goods received and invoice agree.`, ...base };
}

const stamp = (d: Record<string, unknown>, req: Request) => { if (!('id' in d)) d.createdBy = req.user!.id; d.updatedBy = req.user!.id; return d; };

const invoiceSchema = z.object({
  supplierId: z.string(),
  purchaseOrderId: z.string().optional(),
  projectId: z.string().optional(),
  number: z.string().optional(),
  supplierRef: z.string().optional(),
  invoiceDate: z.string().datetime().optional(),
  amount: z.number().positive(),
  note: z.string().max(2000).optional(),
});
export const supplierInvoiceOpts: CrudOptions = {
  model: 'supplierInvoice', entity: 'supplier-invoice', readPerm: 'procurement:read', writePerm: 'procurement:write',
  createSchema: invoiceSchema, updateSchema: invoiceSchema.partial(),
  autoCode: { field: 'number', prefix: 'SINV' },
  searchField: 'number', dateField: 'invoiceDate', filterFields: ['status', 'supplierId'], sumFields: ['amount'],
  sumWhere: { cancelledAt: null },
  orderBy: { invoiceDate: 'desc' },
  refs: [{ field: 'supplierId', model: 'supplier' }, { field: 'purchaseOrderId', model: 'purchaseOrder' }],
  include: { payments: { select: { id: true, amount: true, approvalStatus: true, cancelledAt: true, reference: true } } },
  validate: async (data, req) => {
    if (!data.purchaseOrderId) return;
    const po = await prisma.purchaseOrder.findFirst({ where: { id: String(data.purchaseOrderId), organizationId: req.user!.orgId }, select: { supplierId: true, projectId: true } });
    if (po && po.supplierId !== data.supplierId) throw BadRequest('The purchase order belongs to a different supplier.');
    if (po?.projectId && !data.projectId) data.projectId = po.projectId;
  },
  transform: stamp,
  posting: {
    editable: ['note', 'supplierRef'],
    onCancel: async (tx, record) => {
      const live = await tx.supplierPayment.count({ where: { supplierInvoiceId: String(record.id), cancelledAt: null, reversalOfId: null, approvalStatus: { not: 'REJECTED' } } });
      if (live) throw Conflict('This invoice has payments. Cancel them first.');
      return { status: 'CANCELLED' };
    },
  },
};

const paymentSchema = z.object({
  supplierInvoiceId: z.string(),
  amount: z.number().positive(),
  date: z.string().datetime().optional(),
  reference: z.string().optional(),
});
export const supplierPaymentOpts: CrudOptions = {
  model: 'supplierPayment', entity: 'supplier-payment', readPerm: 'procurement:read', writePerm: 'finance:write',
  createSchema: paymentSchema, updateSchema: paymentSchema.partial(),
  autoCode: { field: 'reference', prefix: 'SPAY' },
  searchField: 'reference', dateField: 'date', sumFields: ['amount'], sumWhere: { cancelledAt: null, approvalStatus: 'APPROVED' },
  orderBy: { date: 'desc' },
  refs: [{ field: 'supplierInvoiceId', model: 'supplierInvoice' }],
  include: { invoice: { select: { id: true, number: true, supplierId: true } } },
  // No payment without a three-way match; never more than the invoice.
  validate: async (data, req) => {
    if (data.id) return;
    const inv = await prisma.supplierInvoice.findFirst({ where: { id: String(data.supplierInvoiceId), organizationId: req.user!.orgId } });
    if (!inv) throw NotFound('Supplier invoice not found');
    if (inv.cancelledAt) throw Conflict('This invoice is cancelled.');
    const m = await threeWayMatch(req.user!.orgId, { id: inv.id, purchaseOrderId: inv.purchaseOrderId, amount: num(inv.amount) });
    if (m.status !== 'MATCHED') throw Conflict(`Cannot pay ${inv.number}: ${m.detail}`);
    const paid = await prisma.supplierPayment.aggregate({ where: { supplierInvoiceId: inv.id, cancelledAt: null, approvalStatus: { not: 'REJECTED' } }, _sum: { amount: true } });
    if (num(paid._sum.amount) + Number(data.amount) > num(inv.amount) + 0.01) throw Conflict(`Cannot pay more than the invoice: ${num(inv.amount).toLocaleString()} invoiced, ${num(paid._sum.amount).toLocaleString()} already paid or awaiting approval.`);
    data.projectId = inv.projectId;
  },
  transform: (data, req) => {
    if (!('id' in data)) { data.createdBy = req.user!.id; data.approvalStatus = 'PENDING'; }
    return data;
  },
  afterChange: async (action, record, req) => {
    if (action !== 'CREATE') return;
    await alertAwaitingApproval(req.user!.orgId, 'supplier-payment', String(record.id), 'Supplier payment awaiting approval',
      `Supplier payment ${record.reference} (${num(record.amount).toLocaleString()}) is awaiting approval.`, '/approvals');
  },
  posting: {
    editable: [],
    onCancel: async (tx, record, actor) => {
      if (record.approvalStatus !== 'APPROVED') return { approvalStatus: 'REJECTED' };
      await tx.supplierPayment.create({ data: {
        organizationId: actor.orgId, projectId: (record.projectId as string) ?? null, supplierInvoiceId: String(record.supplierInvoiceId),
        reference: `REV-${record.reference}`, amount: -num(record.amount), date: new Date(), reversalOfId: String(record.id), approvalStatus: 'APPROVED',
      } });
    },
  },
};

export const supplierApRouter = Router();
supplierApRouter.use(authenticate);

// Match status on every invoice (list + one).
supplierApRouter.get('/supplier-invoices/:id/match', requirePermission('procurement:read'), asyncHandler(async (req, res) => {
  const inv = await prisma.supplierInvoice.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId } });
  if (!inv) throw NotFound('Supplier invoice not found');
  return ok(res, await threeWayMatch(req.user!.orgId, { id: inv.id, purchaseOrderId: inv.purchaseOrderId, amount: num(inv.amount) }));
}));
supplierApRouter.get('/supplier-invoices/match-status', requirePermission('procurement:read'), asyncHandler(async (req, res) => {
  const invs = await prisma.supplierInvoice.findMany({ where: { organizationId: req.user!.orgId, cancelledAt: null }, select: { id: true, purchaseOrderId: true, amount: true } });
  const out: Record<string, MatchResult> = {};
  for (const i of invs) out[i.id] = await threeWayMatch(req.user!.orgId, { id: i.id, purchaseOrderId: i.purchaseOrderId, amount: num(i.amount) });
  return ok(res, out);
}));

const paymentDecisions = Router();
// Re-check the match at approval time too: a GRN cancelled in between must stop the payment.
paymentDecisions.post('/:id/approve', asyncHandler(async (req, _res, next) => {
  const p = await prisma.supplierPayment.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId }, include: { invoice: true } });
  if (p) {
    const m = await threeWayMatch(req.user!.orgId, { id: p.invoice.id, purchaseOrderId: p.invoice.purchaseOrderId, amount: num(p.invoice.amount) });
    if (m.status !== 'MATCHED') throw Conflict(`Cannot approve: ${m.detail}`);
  }
  next();
}));
addApprovalRoutes(paymentDecisions, {
  model: 'supplierPayment', entity: 'supplier-payment', label: 'supplier payment', makerField: 'createdBy',
  onDecided: async (rec, status) => {
    if (status !== 'APPROVED') return;
    const inv = await prisma.supplierInvoice.findUnique({ where: { id: String(rec.supplierInvoiceId) } });
    if (!inv) return;
    const paid = await prisma.supplierPayment.aggregate({ where: { supplierInvoiceId: inv.id, cancelledAt: null, approvalStatus: 'APPROVED' }, _sum: { amount: true } });
    if (num(paid._sum.amount) >= num(inv.amount) - 0.01) await prisma.supplierInvoice.update({ where: { id: inv.id }, data: { status: 'PAID' } });
  },
});
supplierApRouter.use('/supplier-payments', paymentDecisions);
supplierApRouter.use('/supplier-invoices', createCrudRouter(supplierInvoiceOpts));
supplierApRouter.use('/supplier-payments', createCrudRouter(supplierPaymentOpts));

// PO approval by the CEO (company admin) when above the limit, never by the person who raised it.
export const poDecisions = Router();
poDecisions.use(authenticate);
poDecisions.post('/:id/approve', asyncHandler(async (req, _res, next) => {
  if (req.user!.role !== 'SYSTEM_ADMIN' && !req.user!.isPlatformAdmin) throw Forbidden('Orders above the approval limit are approved by the CEO (company administrator).');
  next();
}));
addApprovalRoutes(poDecisions, { model: 'purchaseOrder', entity: 'purchase-order', label: 'purchase order', makerField: 'createdBy' });

/** After a PO is saved: limit → pending CEO approval; split/repeat flags → stored and alerted. */
export async function afterPoCreate(orgId: string, record: Record<string, unknown>) {
  const total = num(record.total);
  const limit = await poLimit(orgId);
  const flags = await poFlags(orgId, { id: String(record.id), supplierId: String(record.supplierId), total, orderDate: record.orderDate as Date });
  const data: Prisma.PurchaseOrderUpdateInput = { flags };
  if (total > limit) { data.approvalStatus = 'PENDING'; if (record.status !== 'DRAFT') data.status = 'DRAFT'; }
  await prisma.purchaseOrder.update({ where: { id: String(record.id) }, data });
  if (total > limit) {
    await alertAwaitingApproval(orgId, 'purchase-order', String(record.id), 'Purchase order needs CEO approval',
      `${record.number} (${total.toLocaleString()}) is above the ${limit.toLocaleString()} order limit.`, '/approvals');
  }
  if (flags.length) {
    await notify({ organizationId: orgId, type: 'GENERAL', severity: flags.some((f) => f.startsWith('SPLIT')) ? 'HIGH' : 'MEDIUM', title: `Purchase order ${record.number} flagged`, message: flags.map((f) => f.split(': ').slice(1).join(': ')).join(' '), link: '/procurement', refKey: `po-flag:${record.id}` }).catch(() => undefined);
  }
}
