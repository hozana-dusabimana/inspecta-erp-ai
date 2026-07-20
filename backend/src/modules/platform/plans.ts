import { OrgPlan } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { Forbidden } from '../../lib/errors';

export interface PlanLimits {
  maxUsers: number | null; // null = unlimited
  maxProjects: number | null;
}

/**
 * Seat/project allowances that come with each tier. A platform admin can
 * override either number per company; these are only the defaults applied when
 * the plan is (re)assigned.
 */
export const PLAN_DEFAULTS: Record<OrgPlan, PlanLimits> = {
  TRIAL: { maxUsers: 3, maxProjects: 2 },
  STARTER: { maxUsers: 10, maxProjects: 10 },
  PROFESSIONAL: { maxUsers: 50, maxProjects: 100 },
  ENTERPRISE: { maxUsers: null, maxProjects: null },
};

export const PLAN_LABELS: Record<OrgPlan, string> = {
  TRIAL: 'Trial',
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
};

/**
 * Rejects the request when a tenant is at its seat limit.
 *
 * Called before creating a user. Quotas are enforced server-side on the create
 * path rather than only shown in the UI, so neither the API nor the AI copilot
 * can slip past them.
 */
export async function assertSeatAvailable(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { maxUsers: true, plan: true },
  });
  if (!org || org.maxUsers === null) return;
  const used = await prisma.user.count({ where: { organizationId } });
  if (used >= org.maxUsers) {
    throw Forbidden(
      `Seat limit reached — the ${PLAN_LABELS[org.plan]} plan allows ${org.maxUsers} user${org.maxUsers === 1 ? '' : 's'}. Contact your administrator to upgrade.`,
    );
  }
}

/** Rejects the request when a tenant is at its project limit. */
export async function assertProjectQuotaAvailable(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { maxProjects: true, plan: true },
  });
  if (!org || org.maxProjects === null) return;
  const used = await prisma.project.count({ where: { organizationId } });
  if (used >= org.maxProjects) {
    throw Forbidden(
      `Project limit reached — the ${PLAN_LABELS[org.plan]} plan allows ${org.maxProjects} project${org.maxProjects === 1 ? '' : 's'}. Contact your administrator to upgrade.`,
    );
  }
}

/** Current usage vs allowance, for the console and the tenant's own settings screen. */
export async function usageFor(organizationId: string) {
  const [org, users, projects] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, maxUsers: true, maxProjects: true },
    }),
    prisma.user.count({ where: { organizationId } }),
    prisma.project.count({ where: { organizationId } }),
  ]);
  return {
    plan: org?.plan ?? OrgPlan.TRIAL,
    users: { used: users, limit: org?.maxUsers ?? null },
    projects: { used: projects, limit: org?.maxProjects ?? null },
  };
}
