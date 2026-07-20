import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { BadRequest, Conflict } from '../../lib/errors';
import { ADMIN_ROLE_KEY, DEFAULT_ROLE_TEMPLATES, Permission } from '../../auth/permissions';

// The pure rules live in roles.rules.ts (no DB access); re-exported so callers
// have one import site for everything role-related.
export { permissionsForWrite, roleKeyFrom } from './roles.rules';
export { ADMIN_ROLE_KEY };

/**
 * Creates the starter org chart for a tenant, if it isn't there already.
 *
 * Idempotent on (organizationId, key), so it is safe to call from registration,
 * platform provisioning, the seed, and lazily from the roles API — a tenant
 * created before this feature existed gets its roles the first time an admin
 * opens the screen, without a data migration.
 */
export async function ensureDefaultRoles(organizationId: string) {
  const existing = await prisma.roleDefinition.findMany({
    where: { organizationId },
    select: { key: true },
  });
  const have = new Set(existing.map((r) => r.key));
  const missing = DEFAULT_ROLE_TEMPLATES.filter((t) => !have.has(t.key));
  if (missing.length === 0) return;

  await prisma.roleDefinition.createMany({
    data: missing.map((t) => ({
      organizationId,
      key: t.key,
      name: t.name,
      description: t.description,
      baseRole: t.baseRole,
      permissions: t.permissions,
      isSystem: true,
      isDefault: t.isDefault ?? false,
    })),
    skipDuplicates: true,
  });
}

/** The tenant's administrator role — the one that must never lose `user:write`. */
export async function adminRoleFor(organizationId: string) {
  return prisma.roleDefinition.findUnique({
    where: { organizationId_key: { organizationId, key: ADMIN_ROLE_KEY } },
  });
}

/** Puts an account on the tenant's administrator role (used when an org and
 *  its first admin are created together). No-op if the role is missing. */
export async function attachAdminRole(organizationId: string, userId: string) {
  const admin = await adminRoleFor(organizationId);
  if (!admin) return;
  await prisma.user.update({ where: { id: userId }, data: { roleId: admin.id } });
}

/**
 * Refuses a change that would leave the organization with nobody able to
 * administer users. Called before removing `user:write` from a role and before
 * moving the last administrator onto a role that lacks it.
 */
export async function assertAdminCoverage(
  organizationId: string,
  change: { roleId: string; nextPermissions?: Permission[]; losingUserId?: string },
) {
  const roles = await prisma.roleDefinition.findMany({
    where: { organizationId },
    select: { id: true, permissions: true },
  });
  const adminRoleIds = new Set(
    roles
      .filter((r) =>
        r.id === change.roleId
          ? (change.nextPermissions ?? (r.permissions as string[])).includes('user:write')
          : (r.permissions as string[]).includes('user:write'),
      )
      .map((r) => r.id),
  );

  const covered = await prisma.user.count({
    where: {
      organizationId,
      isActive: true,
      id: change.losingUserId ? { not: change.losingUserId } : undefined,
      OR: [
        { roleId: { in: [...adminRoleIds] } },
        // Accounts still on the legacy enum role resolve from the static matrix.
        { roleId: null, role: { in: [Role.SYSTEM_ADMIN, Role.PLATFORM_ADMIN] } },
      ],
    },
  });

  if (covered === 0) {
    throw BadRequest(
      'This would leave nobody in the company able to manage users. Grant "user:write" to another role or user first.',
    );
  }
}

/** Maps a Prisma unique-constraint failure on (organizationId, key) to a 409. */
export function rethrowDuplicate(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw Conflict('A role with this name already exists in your company.');
  }
  throw e;
}
