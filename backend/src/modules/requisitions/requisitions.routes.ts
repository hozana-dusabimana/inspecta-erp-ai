import { Router, Request } from 'express';
import { z } from 'zod';
import { Prisma, RequisitionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound, Forbidden } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';
import { stockForMaterial } from '../inventory/stock';

const router = Router();

// ── Shape ─────────────────────────────────────────────────────
const itemSchema = z.object({
  materialId: z.string(),
  wbsItemId: z.string().optional(),
  unit: z.string().optional(),
  quantityRequested: z.number().positive(),
  note: z.string().optional(),
});

const createSchema = z.object({
  projectId: z.string(),
  number: z.string().optional(), // auto-generated REQ-#### when omitted
  title: z.string().optional(),
  location: z.string().optional(),
  requiredByDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).default([]),
});

// A submitted requisition is a signed request: its lines are frozen and only
// the header's soft fields stay editable. Quantities move via approve/issue.
const updateSchema = z.object({
  title: z.string().optional(),
  location: z.string().optional(),
  requiredByDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).optional(),
});

const include = {
  items: {
    include: { material: { select: { id: true, code: true, name: true, unit: true } } },
  },
} as const;

const crud = createCrudRouter({
  model: 'materialRequisition',
  entity: 'material-requisition',
  readPerm: 'requisition:read',
  writePerm: 'requisition:write',
  createSchema,
  updateSchema,
  autoCode: { field: 'number', prefix: 'REQ' },
  searchField: 'number',
  dateField: 'dateRequested',
  filterFields: ['status'],
  requireProject: true,
  orderBy: { createdAt: 'desc' },
  include,
  refs: [{ field: 'projectId', model: 'project' }],
  // Lines can only be rewritten while the requisition is still a draft —
  // otherwise an approval could be obtained for one set of materials and
  // quietly spent on another.
  validate: async (data, req) => {
    if (!data.id) return;
    if (!Array.isArray(data.items)) return;
    const existing = await prisma.materialRequisition.findFirst({
      where: { id: String(data.id), organizationId: req.user!.orgId },
      select: { status: true },
    });
    if (existing && existing.status !== 'DRAFT') {
      throw BadRequest(`Lines can only be changed while the requisition is a draft (this one is ${existing.status}).`);
    }
  },
  transform: (data, req) => {
    const items = data.items as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items) && items.length) {
      const lines = items.map((it) => ({
        materialId: String(it.materialId),
        wbsItemId: (it.wbsItemId as string) || null,
        unit: (it.unit as string) || 'unit',
        quantityRequested: Number(it.quantityRequested ?? 0),
        // Approval starts from what was asked for; the approver trims it down.
        quantityApproved: Number(it.quantityRequested ?? 0),
        note: (it.note as string) || null,
      }));
      // On update this replaces the draft's lines wholesale.
      data.items = 'id' in data ? { deleteMany: {}, create: lines } : { create: lines };
    } else {
      delete data.items;
    }
    if (!('id' in data)) {
      data.requestedById = req.user!.id;
      data.createdBy = req.user!.id;
    }
    data.updatedBy = req.user!.id;
    return data;
  },
});

// ── Workflow ──────────────────────────────────────────────────
// foreman raises → site engineer approves → store issues from stock.
const TRANSITIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PARTIALLY_ISSUED', 'ISSUED', 'CANCELLED'],
  PARTIALLY_ISSUED: ['ISSUED', 'CLOSED'],
  ISSUED: ['CLOSED'],
  REJECTED: [],
  CANCELLED: [],
  CLOSED: [],
};

type Requisition = Prisma.MaterialRequisitionGetPayload<{ include: typeof include }>;

async function loadRequisition(req: Request): Promise<Requisition> {
  const found = await prisma.materialRequisition.findFirst({
    where: { id: req.params.id, organizationId: req.user!.orgId, deletedAt: null },
    include,
  });
  if (!found) throw NotFound('Requisition not found');
  return found;
}

function assertTransition(from: RequisitionStatus, to: RequisitionStatus, action: string) {
  if (!TRANSITIONS[from].includes(to)) {
    throw BadRequest(`Cannot ${action} a requisition in status ${from}.`);
  }
}

/** Everyone who can approve, for "this needs your sign-off" notifications. */
async function notifyApprovers(organizationId: string, title: string, message: string) {
  await notify({
    organizationId,
    type: 'APPROVAL',
    severity: 'MEDIUM',
    title,
    message,
    link: '/requisitions',
  });
}

// SUBMIT — the foreman sends it up for approval.
router.post(
  '/:id/submit',
  authenticate,
  requirePermission('requisition:write'),
  asyncHandler(async (req, res) => {
    const existing = await loadRequisition(req);
    assertTransition(existing.status, 'SUBMITTED', 'submit');
    if (existing.items.length === 0) {
      throw BadRequest('Add at least one material line before submitting.');
    }
    // Only the person who raised it (or a manager who can approve) may submit
    // it — a requisition is a signed request, not an anonymous form.
    if (
      existing.requestedById &&
      existing.requestedById !== req.user!.id &&
      !req.user!.permissions.includes('requisition:approve')
    ) {
      throw Forbidden('Only the requester can submit this requisition.');
    }

    const updated = await prisma.materialRequisition.update({
      where: { id: existing.id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), updatedBy: req.user!.id },
      include,
    });
    await auditFromRequest(req, 'UPDATE', 'material-requisition', existing.id, {
      oldValues: { status: existing.status },
      newValues: { status: 'SUBMITTED' },
    });
    await notifyApprovers(
      req.user!.orgId,
      'Material requisition submitted',
      `${updated.number} (${updated.items.length} line${updated.items.length === 1 ? '' : 's'}) is awaiting approval.`,
    );
    return ok(res, updated);
  }),
);

const approveSchema = z.object({
  note: z.string().optional(),
  // The approver may cut individual lines back rather than reject everything.
  lines: z
    .array(z.object({ id: z.string(), quantityApproved: z.number().nonnegative() }))
    .optional(),
});

// APPROVE — the site engineer signs it off, optionally trimming quantities.
router.post(
  '/:id/approve',
  authenticate,
  requirePermission('requisition:approve'),
  asyncHandler(async (req, res) => {
    const existing = await loadRequisition(req);
    assertTransition(existing.status, 'APPROVED', 'approve');
    const body = approveSchema.parse(req.body ?? {});

    // Approving your own requisition defeats the point of the second pair of
    // eyes the chain exists to provide.
    if (existing.requestedById && existing.requestedById === req.user!.id) {
      throw Forbidden('You cannot approve a requisition you raised yourself.');
    }

    const byId = new Map(existing.items.map((i) => [i.id, i]));
    const edits = body.lines ?? [];
    for (const line of edits) {
      const item = byId.get(line.id);
      if (!item) throw BadRequest('A line in this request does not belong to the requisition.');
      if (line.quantityApproved > Number(item.quantityRequested)) {
        throw BadRequest(
          `Cannot approve more than requested on line ${item.id} (requested ${Number(item.quantityRequested)}).`,
        );
      }
    }
    const approvedTotal = existing.items.reduce((sum, item) => {
      const edit = edits.find((e) => e.id === item.id);
      return sum + (edit ? edit.quantityApproved : Number(item.quantityApproved));
    }, 0);
    if (approvedTotal <= 0) {
      throw BadRequest('Approving zero of everything is a rejection — use Reject instead.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      for (const line of edits) {
        await tx.materialRequisitionItem.update({
          where: { id: line.id },
          data: { quantityApproved: line.quantityApproved },
        });
      }
      return tx.materialRequisition.update({
        where: { id: existing.id },
        data: {
          status: 'APPROVED',
          approvedById: req.user!.id,
          approvedAt: new Date(),
          decisionNote: body.note ?? null,
          updatedBy: req.user!.id,
        },
        include,
      });
    });

    await auditFromRequest(req, 'APPROVE', 'material-requisition', existing.id, {
      oldValues: { status: existing.status },
      newValues: { status: 'APPROVED', lines: edits },
    });
    // Tell the requester it cleared, and the store that there is work waiting.
    if (existing.requestedById) {
      await notify({
        organizationId: req.user!.orgId,
        userId: existing.requestedById,
        type: 'APPROVAL',
        severity: 'LOW',
        title: 'Requisition approved',
        message: `${updated.number} was approved${body.note ? `: ${body.note}` : ''}. The store can now issue it.`,
        link: '/requisitions',
      });
    }
    await notifyApprovers(
      req.user!.orgId,
      'Requisition ready to issue',
      `${updated.number} was approved and is waiting for the store to issue it.`,
    );
    return ok(res, updated);
  }),
);

// REJECT — with a reason, which the requester sees.
router.post(
  '/:id/reject',
  authenticate,
  requirePermission('requisition:approve'),
  asyncHandler(async (req, res) => {
    const existing = await loadRequisition(req);
    assertTransition(existing.status, 'REJECTED', 'reject');
    const note = z.object({ note: z.string().min(1) }).parse(req.body ?? {}).note;

    const updated = await prisma.materialRequisition.update({
      where: { id: existing.id },
      data: {
        status: 'REJECTED',
        approvedById: req.user!.id,
        approvedAt: new Date(),
        decisionNote: note,
        updatedBy: req.user!.id,
      },
      include,
    });
    await auditFromRequest(req, 'REJECT', 'material-requisition', existing.id, {
      oldValues: { status: existing.status },
      newValues: { status: 'REJECTED', note },
    });
    if (existing.requestedById) {
      await notify({
        organizationId: req.user!.orgId,
        userId: existing.requestedById,
        type: 'APPROVAL',
        severity: 'HIGH',
        title: 'Requisition rejected',
        message: `${updated.number} was rejected: ${note}`,
        link: '/requisitions',
      });
    }
    return ok(res, updated);
  }),
);

// CANCEL — the requester (or an approver) withdraws it before it is spent.
router.post(
  '/:id/cancel',
  authenticate,
  requirePermission('requisition:write'),
  asyncHandler(async (req, res) => {
    const existing = await loadRequisition(req);
    assertTransition(existing.status, 'CANCELLED', 'cancel');
    const updated = await prisma.materialRequisition.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED', updatedBy: req.user!.id },
      include,
    });
    await auditFromRequest(req, 'UPDATE', 'material-requisition', existing.id, {
      oldValues: { status: existing.status },
      newValues: { status: 'CANCELLED' },
    });
    return ok(res, updated);
  }),
);

const issueSchema = z.object({
  dateIssued: z.string().datetime().optional(),
  issuedTo: z.string().optional(),
  note: z.string().optional(),
  // Omit to issue everything still outstanding on every line.
  lines: z.array(z.object({ id: z.string(), quantity: z.number().positive() })).optional(),
});

/**
 * ISSUE — the store releases the approved materials.
 *
 * This creates `MaterialIssue` rows rather than posting movements itself, so
 * the drawdown goes through exactly the same path as a manual issue: the stock
 * ledger, FIFO/WAVG valuation, WBS cost allocation and the low-stock alert all
 * behave identically whether or not a requisition was involved.
 *
 * Guarded on `inventory:write`, not `requisition:approve` — releasing stock is
 * the storekeeper's job, and they must not be able to approve their own draws.
 */
router.post(
  '/:id/issue',
  authenticate,
  requirePermission('inventory:write'),
  asyncHandler(async (req, res) => {
    const existing = await loadRequisition(req);
    if (existing.status !== 'APPROVED' && existing.status !== 'PARTIALLY_ISSUED') {
      throw BadRequest(`Only an approved requisition can be issued (this one is ${existing.status}).`);
    }
    const body = issueSchema.parse(req.body ?? {});
    const orgId = req.user!.orgId;

    // Work out what to issue per line, defaulting to the full outstanding balance.
    const byId = new Map(existing.items.map((i) => [i.id, i]));
    const requested = body.lines
      ? body.lines.map((l) => {
          const item = byId.get(l.id);
          if (!item) throw BadRequest('A line in this request does not belong to the requisition.');
          return { item, quantity: l.quantity };
        })
      : existing.items
          .map((item) => ({
            item,
            quantity: Number(item.quantityApproved) - Number(item.quantityIssued),
          }))
          .filter((l) => l.quantity > 0);

    if (requested.length === 0) throw BadRequest('Nothing left to issue on this requisition.');

    // Two independent checks, both fatal: never issue more than was approved,
    // and never issue stock the store does not physically hold.
    for (const { item, quantity } of requested) {
      const outstanding = Number(item.quantityApproved) - Number(item.quantityIssued);
      if (quantity > outstanding + 1e-9) {
        throw BadRequest(
          `Line ${item.material.code}: only ${outstanding} ${item.unit} remain approved, cannot issue ${quantity}.`,
        );
      }
      const onHand = await stockForMaterial(orgId, item.materialId);
      if (quantity > onHand + 1e-9) {
        throw BadRequest(
          `Insufficient stock for ${item.material.name} (${item.material.code}): ${onHand} ${item.unit} on hand, ${quantity} requested.`,
        );
      }
    }

    const dateIssued = body.dateIssued ? new Date(body.dateIssued) : new Date();

    const updated = await prisma.$transaction(async (tx) => {
      for (const { item, quantity } of requested) {
        const issue = await tx.materialIssue.create({
          data: {
            organizationId: orgId,
            materialId: item.materialId,
            projectId: existing.projectId,
            wbsItemId: item.wbsItemId,
            requisitionId: existing.id,
            quantityIssued: quantity,
            dateIssued,
            issuedTo: body.issuedTo ?? null,
            issueNumber: `${existing.number}/${item.material.code}`,
            note: body.note ?? `Issued against requisition ${existing.number}`,
            createdBy: req.user!.id,
            updatedBy: req.user!.id,
          },
        });
        // Post the drawdown to the stock ledger, mirroring what the
        // /inventory/material-issues route does on create.
        await tx.stockMovement.create({
          data: {
            organizationId: orgId,
            materialId: item.materialId,
            projectId: existing.projectId,
            wbsItemId: item.wbsItemId,
            type: 'ISSUE',
            quantity,
            reference: issue.issueNumber ?? existing.number,
            referenceId: issue.id,
            date: dateIssued,
            note: `Requisition ${existing.number}`,
          },
        });
        await tx.materialRequisitionItem.update({
          where: { id: item.id },
          data: { quantityIssued: { increment: quantity } },
        });
      }

      const after = await tx.materialRequisition.findUniqueOrThrow({
        where: { id: existing.id },
        include,
      });
      const fullyIssued = after.items.every(
        (i) => Number(i.quantityIssued) >= Number(i.quantityApproved) - 1e-9,
      );
      return tx.materialRequisition.update({
        where: { id: existing.id },
        data: {
          status: fullyIssued ? 'ISSUED' : 'PARTIALLY_ISSUED',
          issuedById: req.user!.id,
          issuedAt: dateIssued,
          updatedBy: req.user!.id,
        },
        include,
      });
    });

    await auditFromRequest(req, 'UPDATE', 'material-requisition', existing.id, {
      oldValues: { status: existing.status },
      newValues: {
        status: updated.status,
        issued: requested.map((r) => ({ material: r.item.material.code, quantity: r.quantity })),
      },
    });

    // Issuing can take a material under its reorder level — same alert the
    // manual issue path raises.
    for (const { item } of requested) {
      const material = await prisma.material.findUnique({ where: { id: item.materialId } });
      if (!material || Number(material.reorderLevel) <= 0) continue;
      const stock = await stockForMaterial(orgId, item.materialId);
      if (stock <= Number(material.reorderLevel)) {
        await notify({
          organizationId: orgId,
          type: 'LOW_STOCK',
          severity: 'HIGH',
          title: 'Low stock alert',
          message: `${material.name} (${material.code}) is at ${stock} ${material.unit}, at/below reorder level ${material.reorderLevel}.`,
          link: '/inventory',
        });
      }
    }

    if (existing.requestedById) {
      await notify({
        organizationId: orgId,
        userId: existing.requestedById,
        type: 'APPROVAL',
        severity: 'LOW',
        title: updated.status === 'ISSUED' ? 'Requisition issued' : 'Requisition partly issued',
        message: `${updated.number}: the store released ${requested.length} line${requested.length === 1 ? '' : 's'}.`,
        link: '/requisitions',
      });
    }
    return ok(res, updated);
  }),
);

// CLOSE — the site accepts a short delivery and stops chasing the balance.
router.post(
  '/:id/close',
  authenticate,
  requirePermission('requisition:write'),
  asyncHandler(async (req, res) => {
    const existing = await loadRequisition(req);
    assertTransition(existing.status, 'CLOSED', 'close');
    const updated = await prisma.materialRequisition.update({
      where: { id: existing.id },
      data: { status: 'CLOSED', updatedBy: req.user!.id },
      include,
    });
    await auditFromRequest(req, 'UPDATE', 'material-requisition', existing.id, {
      oldValues: { status: existing.status },
      newValues: { status: 'CLOSED' },
    });
    return ok(res, updated);
  }),
);

/**
 * Board view for the workflow screen: what is waiting on whom, plus the stock
 * position of every approved line so the store sees shortfalls before it walks
 * to the shelf.
 */
router.get(
  '/board',
  authenticate,
  requirePermission('requisition:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const rows = await prisma.materialRequisition.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_ISSUED'] },
      },
      include,
      orderBy: [{ status: 'asc' }, { requiredByDate: 'asc' }],
      take: 200,
    });

    const materialIds = [...new Set(rows.flatMap((r) => r.items.map((i) => i.materialId)))];
    const onHand = new Map<string, number>();
    for (const id of materialIds) onHand.set(id, await stockForMaterial(orgId, id));

    const board = rows.map((r) => ({
      ...r,
      items: r.items.map((i) => {
        const outstanding = Number(i.quantityApproved) - Number(i.quantityIssued);
        const stock = onHand.get(i.materialId) ?? 0;
        return {
          ...i,
          outstanding,
          onHand: stock,
          // Flags a line the store cannot fully satisfy today.
          shortfall: Math.max(0, outstanding - stock),
        };
      }),
    }));

    return ok(res, {
      requisitions: board,
      counts: {
        draft: board.filter((r) => r.status === 'DRAFT').length,
        awaitingApproval: board.filter((r) => r.status === 'SUBMITTED').length,
        awaitingIssue: board.filter((r) => r.status === 'APPROVED' || r.status === 'PARTIALLY_ISSUED').length,
        shortfalls: board.filter((r) => r.items.some((i) => i.shortfall > 0)).length,
      },
    });
  }),
);

router.use('/', crud);

export default router;
