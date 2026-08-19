import { Router } from 'express';
import { z } from 'zod';
import { BillingPeriod, OrgPlan } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, Conflict, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { usageFor, PLAN_DEFAULTS, PLAN_LABELS } from '../platform/plans';
import { billingStateFor, planPrices, priceFor } from './billing.service';
import { getCreditStatus, setSpendLimit } from './aiCredits.service';
import { notifyPlatformAdmins } from '../notifications/notify';

/**
 * The company-facing side of billing: what plan am I on, when does it end,
 * where do I pay, and here is proof that I did. Deliberately readable by every
 * member (so the whole team sees the banner and why they are read-only) while
 * only an admin can submit a payment.
 */
const router = Router();
router.use(authenticate);

const requestSelect = {
  id: true,
  plan: true,
  period: true,
  amount: true,
  currency: true,
  payerName: true,
  payerPhone: true,
  reference: true,
  paidAt: true,
  note: true,
  status: true,
  reviewedAt: true,
  reviewNote: true,
  activatedFrom: true,
  activatedUntil: true,
  createdAt: true,
  paymentAccount: { select: { id: true, label: true, accountNumber: true } },
} as const;

// GET /api/billing — everything the billing page needs in one call.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const [state, usage, prices, accounts, requests, org, aiCredits] = await Promise.all([
      billingStateFor(orgId),
      usageFor(orgId),
      planPrices(),
      prisma.paymentAccount.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, type: true, label: true, accountName: true, accountNumber: true, bankName: true, instructions: true },
      }),
      prisma.subscriptionRequest.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: requestSelect,
      }),
      prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, currency: true } }),
      getCreditStatus(orgId),
    ]);
    if (!state || !org) throw NotFound('Organization not found');

    return ok(res, {
      company: org.name,
      state,
      usage,
      aiCredits,
      // Only sellable plans, with the limits each one grants so the choice is informed.
      plans: prices
        .filter((p) => p.isPublic)
        .map((p) => ({
          plan: p.plan,
          label: PLAN_LABELS[p.plan],
          monthlyPrice: p.monthlyPrice,
          annualPrice: p.annualPrice,
          currency: p.currency,
          description: p.description,
          limits: PLAN_DEFAULTS[p.plan],
          aiCreditsIncluded: p.aiCreditsIncluded,
          current: p.plan === state.plan,
        })),
      paymentAccounts: accounts,
      requests,
      pendingRequest: requests.find((r) => r.status === 'PENDING') ?? null,
    });
  }),
);

// GET /api/billing/state — just the banner's worth of data. Separate from the
// full page payload because every signed-in user polls this.
router.get(
  '/state',
  asyncHandler(async (req, res) => {
    const state = await billingStateFor(req.user!.orgId);
    if (!state) throw NotFound('Organization not found');
    return ok(res, state);
  }),
);

const submitSchema = z.object({
  plan: z.nativeEnum(OrgPlan),
  period: z.nativeEnum(BillingPeriod),
  paymentAccountId: z.string().trim().optional(),
  payerName: z.string().trim().min(2),
  payerPhone: z.string().trim().min(6),
  reference: z.string().trim().min(3),
  paidAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
});

// POST /api/billing/requests — "I have paid, please activate my plan."
router.post(
  '/requests',
  requirePermission('user:write'), // company admins only
  asyncHandler(async (req, res) => {
    const body = submitSchema.parse(req.body);
    const orgId = req.user!.orgId;

    // One open claim at a time, so the platform admin never has to reconcile
    // two competing requests for the same company.
    const open = await prisma.subscriptionRequest.findFirst({
      where: { organizationId: orgId, status: 'PENDING' },
      select: { id: true },
    });
    if (open) throw Conflict('You already have a payment awaiting approval. Please wait for it to be reviewed.');

    const prices = await planPrices();
    const amount = priceFor(prices, body.plan, body.period);
    if (amount === null) {
      throw BadRequest('That plan is not available for purchase. Contact support to arrange it.');
    }

    if (body.paymentAccountId) {
      const account = await prisma.paymentAccount.findFirst({
        where: { id: body.paymentAccountId, isActive: true },
        select: { id: true },
      });
      if (!account) throw BadRequest('Unknown payment account');
    }

    // The amount is taken from the published price, never from the client — a
    // tenant must not be able to declare its own price for a plan.
    const created = await prisma.subscriptionRequest.create({
      data: {
        organizationId: orgId,
        requestedById: req.user!.id,
        plan: body.plan,
        period: body.period,
        amount,
        currency: prices.find((p) => p.plan === body.plan)?.currency ?? 'RWF',
        paymentAccountId: body.paymentAccountId ?? null,
        payerName: body.payerName,
        payerPhone: body.payerPhone,
        reference: body.reference,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        note: body.note ?? null,
      },
      select: requestSelect,
    });

    await auditFromRequest(req, 'CREATE', 'subscription-request', created.id, {
      newValues: { plan: body.plan, period: body.period, amount, reference: body.reference },
    });

    // A subscription is never activated automatically — a platform admin must
    // review and approve this payment. Alert them so the claim doesn't sit
    // unseen (the tenant keeps their trial/current access until it's approved).
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    await notifyPlatformAdmins({
      type: 'APPROVAL',
      severity: 'MEDIUM',
      title: 'Subscription payment awaiting approval',
      message: `${org?.name ?? 'A company'} submitted a ${PLAN_LABELS[body.plan]} (${body.period.toLowerCase()}) payment of ${created.amount} ${created.currency} — reference ${body.reference}. Review and approve it to activate their subscription.`,
      link: '/platform/subscriptions',
    });

    return ok(res, created, 201);
  }),
);

// GET /api/billing/requests — the company's own payment history.
router.get(
  '/requests',
  asyncHandler(async (req, res) =>
    ok(
      res,
      await prisma.subscriptionRequest.findMany({
        where: { organizationId: req.user!.orgId },
        orderBy: { createdAt: 'desc' },
        select: requestSelect,
      }),
    ),
  ),
);

// DELETE /api/billing/requests/:id — withdraw a claim submitted by mistake.
router.delete(
  '/requests/:id',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.subscriptionRequest.findFirst({
      where: { id: req.params.id, organizationId: req.user!.orgId },
    });
    if (!existing) throw NotFound('Payment request not found');
    if (existing.status !== 'PENDING') throw BadRequest('Only a pending request can be withdrawn');

    await prisma.subscriptionRequest.delete({ where: { id: existing.id } });
    await auditFromRequest(req, 'DELETE', 'subscription-request', existing.id, {
      oldValues: { reference: existing.reference, plan: existing.plan },
    });
    return ok(res, { id: existing.id, withdrawn: true });
  }),
);

// ─────────────────────── AI Copilot credits ───────────────────────

// GET /api/billing/ai-credits — balance, monthly allowance, and spend limit.
router.get('/ai-credits', asyncHandler(async (req, res) => ok(res, await getCreditStatus(req.user!.orgId))));

const spendLimitSchema = z.object({ limit: z.number().int().min(0).max(1_000_000) });

// PUT /api/billing/ai-credits/spend-limit — the ceiling a company admin sets
// on how many credits can be requested in a single top-up. Nothing purchases
// itself; this only bounds what an admin is allowed to ask for.
router.put(
  '/ai-credits/spend-limit',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const { limit } = spendLimitSchema.parse(req.body);
    await setSpendLimit(req.user!.orgId, limit);
    await auditFromRequest(req, 'UPDATE', 'ai-credit-spend-limit', req.user!.orgId, { newValues: { limit } });
    return ok(res, await getCreditStatus(req.user!.orgId));
  }),
);

const creditRequestSelect = {
  id: true,
  credits: true,
  amount: true,
  currency: true,
  payerName: true,
  payerPhone: true,
  reference: true,
  paidAt: true,
  note: true,
  status: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
  paymentAccount: { select: { id: true, label: true, accountNumber: true } },
} as const;

const creditRequestSchema = z.object({
  credits: z.number().int().min(1),
  paymentAccountId: z.string().trim().optional(),
  payerName: z.string().trim().min(2),
  payerPhone: z.string().trim().min(6),
  reference: z.string().trim().min(3),
  paidAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
});

// POST /api/billing/ai-credits/requests — "I have paid for a credit top-up."
// Priced at the Starter plan's per-credit rate (the smallest, so nobody pays
// more per credit by picking a cheaper tier's top-up).
router.post(
  '/ai-credits/requests',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const body = creditRequestSchema.parse(req.body);
    const orgId = req.user!.orgId;

    const [open, limit, prices] = await Promise.all([
      prisma.aiCreditPurchaseRequest.findFirst({ where: { organizationId: orgId, status: 'PENDING' }, select: { id: true } }),
      prisma.organization.findUnique({ where: { id: orgId }, select: { aiSpendLimitCredits: true } }),
      planPrices(),
    ]);
    if (open) throw Conflict('You already have a credit top-up awaiting approval. Please wait for it to be reviewed.');
    if (body.credits > (limit?.aiSpendLimitCredits ?? 0)) {
      throw BadRequest(`This request exceeds your spending limit of ${limit?.aiSpendLimitCredits ?? 0} credits. Raise the limit in Billing first.`);
    }

    const starter = prices.find((p) => p.plan === 'STARTER');
    const perCredit = starter && starter.aiCreditsIncluded > 0 ? Number(starter.monthlyPrice) / starter.aiCreditsIncluded : 0;
    const amount = Math.round(perCredit * body.credits);

    if (body.paymentAccountId) {
      const account = await prisma.paymentAccount.findFirst({ where: { id: body.paymentAccountId, isActive: true }, select: { id: true } });
      if (!account) throw BadRequest('Unknown payment account');
    }

    const created = await prisma.aiCreditPurchaseRequest.create({
      data: {
        organizationId: orgId,
        requestedById: req.user!.id,
        credits: body.credits,
        amount,
        currency: starter?.currency ?? 'RWF',
        paymentAccountId: body.paymentAccountId ?? null,
        payerName: body.payerName,
        payerPhone: body.payerPhone,
        reference: body.reference,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        note: body.note ?? null,
      },
      select: creditRequestSelect,
    });

    await auditFromRequest(req, 'CREATE', 'ai-credit-request', created.id, { newValues: { credits: body.credits, amount, reference: body.reference } });

    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    await notifyPlatformAdmins({
      type: 'APPROVAL',
      severity: 'MEDIUM',
      title: 'AI credit top-up awaiting approval',
      message: `${org?.name ?? 'A company'} requested ${body.credits} AI credits (${created.amount} ${created.currency}) — reference ${body.reference}.`,
      link: '/platform/ai-credits',
    });

    return ok(res, created, 201);
  }),
);

// GET /api/billing/ai-credits/requests — the company's own top-up history.
router.get(
  '/ai-credits/requests',
  asyncHandler(async (req, res) =>
    ok(res, await prisma.aiCreditPurchaseRequest.findMany({ where: { organizationId: req.user!.orgId }, orderBy: { createdAt: 'desc' }, select: creditRequestSelect })),
  ),
);

// DELETE /api/billing/ai-credits/requests/:id — withdraw a claim submitted by mistake.
router.delete(
  '/ai-credits/requests/:id',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.aiCreditPurchaseRequest.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId } });
    if (!existing) throw NotFound('Credit request not found');
    if (existing.status !== 'PENDING') throw BadRequest('Only a pending request can be withdrawn');

    await prisma.aiCreditPurchaseRequest.delete({ where: { id: existing.id } });
    await auditFromRequest(req, 'DELETE', 'ai-credit-request', existing.id, { oldValues: { reference: existing.reference, credits: existing.credits } });
    return ok(res, { id: existing.id, withdrawn: true });
  }),
);

export default router;
