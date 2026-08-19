import { prisma } from '../../lib/prisma';
import { PaymentRequired } from '../../lib/errors';
import { PLAN_LABELS } from '../platform/plans';

/**
 * Credit cost per kind of AI Copilot action. Simple chat is cheap; anything
 * that pulls live project data through tools, drafts a record, or compiles a
 * cross-project report costs more — mirrors the actual compute/token spend.
 */
export const CREDIT_COSTS = {
  CHAT: 1,
  CHAT_WITH_TOOLS: 3,
  CHAT_WITH_CREATE: 5,
  TOOL_INVOKE: 2,
  REPORT: 5,
} as const;

/** Chat cost depends on how much work the answer actually did. */
export function chatCreditCost(answer: { sources?: unknown[]; preview?: unknown }): number {
  if (answer.preview) return CREDIT_COSTS.CHAT_WITH_CREATE;
  if (answer.sources && answer.sources.length > 0) return CREDIT_COSTS.CHAT_WITH_TOOLS;
  return CREDIT_COSTS.CHAT;
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** Exported so org-creation flows can seed the first period's balance directly
 * — periodStart defaults to "now" on a new org, so the rollover check alone
 * would otherwise make a brand-new tenant wait a month for its first credits. */
export async function creditAllowanceFor(plan: string): Promise<number> {
  const row = await prisma.planPrice.findUnique({ where: { plan: plan as never }, select: { aiCreditsIncluded: true } });
  return row?.aiCreditsIncluded ?? 0;
}

/**
 * Tops up the org's balance once per elapsed month. Unused credits carry
 * forward — a quiet month is not lost. An org dormant for several months only
 * receives one month's allowance when it returns, not a backlog.
 */
async function rolloverIfDue(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { plan: true, aiCreditBalance: true, aiCreditPeriodStart: true },
  });
  if (!org) return null;

  const due = Date.now() - org.aiCreditPeriodStart.getTime() >= MONTH_MS;
  if (!due) {
    if (org.aiCreditBalance > 0) return org;
    // Balance is 0 and a month hasn't passed — either a brand-new org (already
    // seeded at creation, so this is a no-op) or a tenant that predates the
    // credit system, backfilled at 0 by the migration. Grant once, only if it
    // has never received any credit before, so a tenant that has simply spent
    // its balance down through real usage waits for its real monthly rollover.
    const everGranted = await prisma.aiCreditLedger.findFirst({ where: { organizationId: orgId }, select: { id: true } });
    if (everGranted) return org;
  }

  const allowance = await creditAllowanceFor(org.plan);
  const balanceAfter = org.aiCreditBalance + allowance;
  await prisma.$transaction([
    prisma.organization.update({
      where: { id: orgId },
      data: { aiCreditBalance: balanceAfter, aiCreditPeriodStart: new Date() },
    }),
    prisma.aiCreditLedger.create({
      data: { organizationId: orgId, delta: allowance, balanceAfter, reason: `Monthly ${PLAN_LABELS[org.plan as keyof typeof PLAN_LABELS] ?? org.plan} allowance` },
    }),
  ]);
  return { ...org, aiCreditBalance: balanceAfter, aiCreditPeriodStart: new Date() };
}

export interface AiCreditStatus {
  plan: string;
  balance: number;
  monthlyAllowance: number;
  periodStart: Date;
  nextTopUpAt: Date;
  spendLimit: number;
}

export async function getCreditStatus(orgId: string): Promise<AiCreditStatus> {
  const org = await rolloverIfDue(orgId);
  if (!org) throw new Error('Organization not found');
  const full = await prisma.organization.findUnique({ where: { id: orgId }, select: { aiSpendLimitCredits: true } });
  const monthlyAllowance = await creditAllowanceFor(org.plan);
  return {
    plan: org.plan,
    balance: org.aiCreditBalance,
    monthlyAllowance,
    periodStart: org.aiCreditPeriodStart,
    nextTopUpAt: new Date(org.aiCreditPeriodStart.getTime() + MONTH_MS),
    spendLimit: full?.aiSpendLimitCredits ?? 0,
  };
}

/**
 * Gate before doing AI work. Not perfectly race-free under concurrent
 * requests (balance can go slightly negative if two calls land at once) —
 * acceptable for a soft usage meter; the next call is blocked either way.
 */
export async function assertCreditsAvailable(orgId: string, cost: number): Promise<void> {
  const org = await rolloverIfDue(orgId);
  if (!org) throw new Error('Organization not found');
  if (org.aiCreditBalance < cost) {
    throw PaymentRequired(
      `Not enough AI credits for this request (needs ${cost}, ${Math.max(0, org.aiCreditBalance)} remaining). ` +
      'Ask a company administrator to request more credits or upgrade your plan.',
    );
  }
}

export async function deductCredits(orgId: string, cost: number, reason: string, userId?: string): Promise<void> {
  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: { aiCreditBalance: { decrement: cost } },
    select: { aiCreditBalance: true },
  });
  await prisma.aiCreditLedger.create({
    data: { organizationId: orgId, delta: -cost, balanceAfter: updated.aiCreditBalance, reason, userId },
  });
}

/** Used for purchase-request approvals and manual platform-admin grants. */
export async function grantCredits(orgId: string, amount: number, reason: string, userId?: string): Promise<void> {
  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: { aiCreditBalance: { increment: amount } },
    select: { aiCreditBalance: true },
  });
  await prisma.aiCreditLedger.create({
    data: { organizationId: orgId, delta: amount, balanceAfter: updated.aiCreditBalance, reason, userId },
  });
}

export async function setSpendLimit(orgId: string, limit: number): Promise<void> {
  await prisma.organization.update({ where: { id: orgId }, data: { aiSpendLimitCredits: limit } });
}
