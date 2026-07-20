import { BillingPeriod, OrgPlan, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { PLAN_DEFAULTS, PLAN_LABELS } from '../platform/plans';

/** How long a brand-new company may use the product before paying. */
export const TRIAL_DAYS = 14;

/**
 * How long after a subscription lapses before the workspace goes read-only.
 * The grace exists so a customer whose transfer is still being approved — or
 * who is simply a day late — does not lose the ability to run their sites.
 */
export const GRACE_DAYS = 7;

/** Banner starts nagging this many days before the clock runs out. */
export const WARN_WITHIN_DAYS = 7;

export type BillingStatus = 'EXEMPT' | 'TRIAL' | 'ACTIVE' | 'GRACE' | 'LAPSED';

export interface BillingState {
  plan: OrgPlan;
  planLabel: string;
  status: BillingStatus;
  trialEndsAt: Date | null;
  subscriptionEndsAt: Date | null;
  /** When the current entitlement runs out (trial or paid, whichever applies). */
  expiresAt: Date | null;
  /** Whole days until `expiresAt`; negative once past. */
  daysRemaining: number | null;
  /** During GRACE, days left before the workspace locks. */
  graceDaysRemaining: number | null;
  /** True once the tenant may only read. */
  readOnly: boolean;
  /** True when the UI should warn (trial ending, in grace, or lapsed). */
  warn: boolean;
  message: string | null;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY_MS);

export function addPeriod(from: Date, period: BillingPeriod): Date {
  const d = new Date(from);
  if (period === 'ANNUAL') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export function trialEndFrom(start: Date = new Date()): Date {
  return new Date(start.getTime() + TRIAL_DAYS * DAY_MS);
}

type OrgBillingFields = {
  plan: OrgPlan;
  trialEndsAt: Date | null;
  subscriptionEndsAt: Date | null;
  billingExempt: boolean;
};

/**
 * Resolves a tenant's billing state. Pure so it can be reused by the request
 * middleware, the tenant billing page and the platform console without three
 * slightly different interpretations of "expired".
 */
export function billingStateOf(org: OrgBillingFields, now: Date = new Date()): BillingState {
  const base = { plan: org.plan, planLabel: PLAN_LABELS[org.plan], trialEndsAt: org.trialEndsAt, subscriptionEndsAt: org.subscriptionEndsAt };

  if (org.billingExempt) {
    return { ...base, status: 'EXEMPT', expiresAt: null, daysRemaining: null, graceDaysRemaining: null, readOnly: false, warn: false, message: null };
  }

  // A paid subscription always wins over the trial clock.
  if (org.subscriptionEndsAt && org.subscriptionEndsAt > now) {
    const daysRemaining = daysBetween(now, org.subscriptionEndsAt);
    return {
      ...base,
      status: 'ACTIVE',
      expiresAt: org.subscriptionEndsAt,
      daysRemaining,
      graceDaysRemaining: null,
      readOnly: false,
      warn: daysRemaining <= WARN_WITHIN_DAYS,
      message: daysRemaining <= WARN_WITHIN_DAYS
        ? `Your ${PLAN_LABELS[org.plan]} subscription ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Renew to avoid interruption.`
        : null,
    };
  }

  if (org.trialEndsAt && org.trialEndsAt > now) {
    const daysRemaining = daysBetween(now, org.trialEndsAt);
    return {
      ...base,
      status: 'TRIAL',
      expiresAt: org.trialEndsAt,
      daysRemaining,
      graceDaysRemaining: null,
      readOnly: false,
      warn: daysRemaining <= WARN_WITHIN_DAYS,
      message: daysRemaining <= WARN_WITHIN_DAYS
        ? `Your free trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Choose a plan to keep full access.`
        : null,
    };
  }

  // Nothing current. The later of the two dates is when entitlement actually ran
  // out — a tenant who paid once should not be judged by their old trial date.
  const ends = [org.subscriptionEndsAt, org.trialEndsAt].filter(Boolean) as Date[];
  const expiresAt = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;

  // A tenant with no clock at all has never been put on billing — treat as
  // active rather than locking them out on a missing value.
  if (!expiresAt) {
    return { ...base, status: 'ACTIVE', expiresAt: null, daysRemaining: null, graceDaysRemaining: null, readOnly: false, warn: false, message: null };
  }

  const graceEndsAt = new Date(expiresAt.getTime() + GRACE_DAYS * DAY_MS);
  if (graceEndsAt > now) {
    const graceDaysRemaining = daysBetween(now, graceEndsAt);
    return {
      ...base,
      status: 'GRACE',
      expiresAt,
      daysRemaining: daysBetween(now, expiresAt),
      graceDaysRemaining,
      readOnly: false,
      warn: true,
      message: `Your subscription has expired. You have ${graceDaysRemaining} day${graceDaysRemaining === 1 ? '' : 's'} left before this workspace becomes read-only.`,
    };
  }

  return {
    ...base,
    status: 'LAPSED',
    expiresAt,
    daysRemaining: daysBetween(now, expiresAt),
    graceDaysRemaining: 0,
    readOnly: true,
    warn: true,
    message: 'This workspace is read-only because the subscription has expired. Your data is safe — submit a payment to restore full access.',
  };
}

export async function billingStateFor(organizationId: string): Promise<BillingState | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, trialEndsAt: true, subscriptionEndsAt: true, billingExempt: true },
  });
  return org ? billingStateOf(org) : null;
}

/** Published prices, newest values first created if the table is empty. */
export async function planPrices() {
  const rows = await prisma.planPrice.findMany({ orderBy: { monthlyPrice: 'asc' } });
  if (rows.length) return rows;
  // Self-heal a database migrated before the seed rows existed.
  await prisma.$transaction(
    (Object.keys(PLAN_DEFAULTS) as OrgPlan[]).map((plan) =>
      prisma.planPrice.upsert({
        where: { plan },
        update: {},
        create: { plan, isPublic: plan !== 'TRIAL' },
      }),
    ),
  );
  return prisma.planPrice.findMany({ orderBy: { monthlyPrice: 'asc' } });
}

/** The price a company should pay for a plan+period, or null if not for sale. */
export function priceFor(
  prices: { plan: OrgPlan; monthlyPrice: Prisma.Decimal; annualPrice: Prisma.Decimal; isPublic: boolean }[],
  plan: OrgPlan,
  period: BillingPeriod,
): number | null {
  const row = prices.find((p) => p.plan === plan);
  if (!row || !row.isPublic) return null;
  const value = period === 'ANNUAL' ? row.annualPrice.toNumber() : row.monthlyPrice.toNumber();
  return value > 0 ? value : null;
}
