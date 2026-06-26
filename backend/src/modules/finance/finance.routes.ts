import { Router } from 'express';
import { z } from 'zod';
import { CostCategory, InvoiceStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';

const router = Router();

// ── Budget lines ──────────────────────────────────────────────
const budgetCreate = z.object({
  projectId: z.string(),
  category: z.nativeEnum(CostCategory).optional(),
  description: z.string().min(1),
  amount: z.number().nonnegative(),
});
router.use(
  '/budget',
  createCrudRouter({
    model: 'budgetLine',
    entity: 'budget-line',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: budgetCreate,
    updateSchema: budgetCreate.partial(),
    searchField: 'description',
    requireProject: true,
  }),
);

// ── Cost entries (actuals) ────────────────────────────────────
const costCreate = z.object({
  projectId: z.string(),
  category: z.nativeEnum(CostCategory).optional(),
  description: z.string().min(1),
  amount: z.number().nonnegative(),
  date: z.string().datetime().optional(),
});
router.use(
  '/costs',
  createCrudRouter({
    model: 'costEntry',
    entity: 'cost-entry',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: costCreate,
    updateSchema: costCreate.partial(),
    searchField: 'description',
    requireProject: true,
    orderBy: { date: 'desc' },
    // Alert when cumulative actual cost exceeds the project budget.
    afterChange: async (action, record, req) => {
      if (action === 'DELETE') return;
      const projectId = String(record.projectId);
      const [project, agg] = await Promise.all([
        prisma.project.findUnique({ where: { id: projectId } }),
        prisma.costEntry.aggregate({ where: { projectId }, _sum: { amount: true } }),
      ]);
      const spent = Number(agg._sum.amount ?? 0);
      const budget = Number(project?.budget ?? 0);
      if (budget > 0 && spent > budget) {
        await notify({
          organizationId: req.user!.orgId,
          type: 'COST_OVERRUN',
          severity: 'CRITICAL',
          title: 'Cost overrun',
          message: `${project?.name ?? 'Project'} actual cost (${spent.toLocaleString()}) has exceeded its budget (${budget.toLocaleString()}).`,
          link: `/projects/${projectId}`,
        });
      }
    },
  }),
);

// ── Client invoices / IPC ─────────────────────────────────────
const invoiceCreate = z.object({
  projectId: z.string(),
  number: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().nonnegative(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
});
router.use(
  '/invoices',
  createCrudRouter({
    model: 'invoice',
    entity: 'invoice',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: invoiceCreate,
    updateSchema: invoiceCreate.partial(),
    searchField: 'number',
    requireProject: true,
    include: { payments: true },
  }),
);

// ── Payments ──────────────────────────────────────────────────
const paymentCreate = z.object({
  projectId: z.string(),
  invoiceId: z.string().optional(),
  reference: z.string().min(1),
  amount: z.number().nonnegative(),
  date: z.string().datetime().optional(),
});
router.use(
  '/payments',
  createCrudRouter({
    model: 'payment',
    entity: 'payment',
    readPerm: 'finance:read',
    writePerm: 'finance:write',
    createSchema: paymentCreate,
    updateSchema: paymentCreate.partial(),
    searchField: 'reference',
    requireProject: true,
    orderBy: { date: 'desc' },
  }),
);

// ── Financial summary (budget vs actual, billing, cash) ───────
router.get(
  '/summary',
  authenticate,
  requirePermission('finance:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const projectId = req.query.projectId as string | undefined;
    const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };

    const [budgetAgg, costAgg, invoiceAgg, paymentAgg, costByCat] = await Promise.all([
      prisma.budgetLine.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.costEntry.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: scope, _sum: { amount: true } }),
      prisma.costEntry.groupBy({ by: ['category'], where: scope, _sum: { amount: true } }),
    ]);

    const budget = Number(budgetAgg._sum.amount ?? 0);
    const actual = Number(costAgg._sum.amount ?? 0);
    const billed = Number(invoiceAgg._sum.amount ?? 0);
    const received = Number(paymentAgg._sum.amount ?? 0);

    return ok(res, {
      budget,
      actualCost: actual,
      costVariance: budget - actual,
      costVariancePct: budget > 0 ? Number((((budget - actual) / budget) * 100).toFixed(2)) : 0,
      billed,
      received,
      outstanding: billed - received,
      forecastProfit: billed - actual,
      costByCategory: costByCat.map((c) => ({
        category: c.category,
        amount: Number(c._sum.amount ?? 0),
      })),
    });
  }),
);

export default router;
