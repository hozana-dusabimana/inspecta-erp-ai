import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const MONTHS_OF_HISTORY = 12;

/** First day of the month, `n` months back, at UTC midnight. */
function monthsAgo(n: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/** `['2025-08', … '2026-07']` — the buckets the growth chart plots. */
function monthKeys(): string[] {
  const keys: string[] = [];
  for (let i = MONTHS_OF_HISTORY - 1; i >= 0; i--) {
    keys.push(monthsAgo(i).toISOString().slice(0, 7));
  }
  return keys;
}

type MonthCount = { month: string; count: number };

/**
 * Signups per calendar month for a table with a `createdAt` column. Raw SQL
 * because Prisma's groupBy cannot bucket by date_trunc.
 */
async function monthlySignups(table: 'organizations' | 'users', since: Date): Promise<MonthCount[]> {
  const rows = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>(
    Prisma.sql`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, COUNT(*) AS count
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1
    `,
  );
  return rows.map((r) => ({ month: r.month, count: Number(r.count) }));
}

/**
 * Everything the platform Overview tab renders: totals, 12-month growth,
 * role distribution, and the busiest tenants over the last 30 days.
 */
export async function platformOverview() {
  const since = monthsAgo(MONTHS_OF_HISTORY - 1);
  const last30 = daysAgo(30);

  const [
    companies,
    suspendedCompanies,
    users,
    blockedUsers,
    platformAdmins,
    projects,
    auditEvents30d,
    logins30d,
    roleGroups,
    orgSignups,
    userSignups,
    busiest,
    newest,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { status: 'SUSPENDED' } }),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: false } }),
    prisma.user.count({ where: { role: Role.PLATFORM_ADMIN } }),
    prisma.project.count(),
    prisma.auditLog.count({ where: { createdAt: { gte: last30 } } }),
    prisma.auditLog.count({ where: { action: 'LOGIN', createdAt: { gte: last30 } } }),
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    monthlySignups('organizations', since),
    monthlySignups('users', since),
    prisma.auditLog.groupBy({
      by: ['organizationId'],
      _count: { _all: true },
      where: { createdAt: { gte: last30 } },
      orderBy: { _count: { organizationId: 'desc' } },
      take: 8,
    }),
    prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, name: true, slug: true, status: true, country: true, createdAt: true },
    }),
  ]);

  // Hydrate the busiest-tenant ids into displayable rows.
  const busiestOrgs = await prisma.organization.findMany({
    where: { id: { in: busiest.map((b) => b.organizationId) } },
    select: { id: true, name: true, slug: true, status: true, _count: { select: { users: true, projects: true } } },
  });
  const byId = new Map(busiestOrgs.map((o) => [o.id, o]));

  const orgByMonth = new Map(orgSignups.map((r) => [r.month, r.count]));
  const userByMonth = new Map(userSignups.map((r) => [r.month, r.count]));

  return {
    totals: {
      companies,
      activeCompanies: companies - suspendedCompanies,
      suspendedCompanies,
      users,
      activeUsers: users - blockedUsers,
      blockedUsers,
      platformAdmins,
      projects,
      auditEvents30d,
      logins30d,
    },
    // Zero-filled so the chart never has gaps in quiet months.
    growth: monthKeys().map((month) => ({
      month,
      companies: orgByMonth.get(month) ?? 0,
      users: userByMonth.get(month) ?? 0,
    })),
    roleBreakdown: roleGroups
      .map((g) => ({ role: g.role, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    busiestCompanies: busiest
      .map((b) => {
        const org = byId.get(b.organizationId);
        return org
          ? {
              id: org.id,
              name: org.name,
              slug: org.slug,
              status: org.status,
              users: org._count.users,
              projects: org._count.projects,
              events30d: b._count._all,
            }
          : null;
      })
      .filter(Boolean),
    newestCompanies: newest,
  };
}
