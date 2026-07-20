import { BadRequest } from '../../lib/errors';
import {
  ADMIN_ROLE_KEY,
  Permission,
  allPermissions,
  sanitizeTenantPermissions,
} from '../../auth/permissions';

/**
 * The pure decision rules for tenant roles — no database access, so they can be
 * exercised directly by tests without opening a Prisma client.
 */

/**
 * The permission set a tenant role may actually hold.
 *
 * Two separate concerns, both non-negotiable:
 *  - `platform:manage` is stripped (sanitize) — a company must never be able to
 *    mint itself cross-tenant access by editing its own roles.
 *  - the seeded administrator role keeps every permission. A tenant that could
 *    trim its own admin role would lock itself out of the very screen needed to
 *    put the permission back, with no in-app way to recover.
 */
export function permissionsForWrite(
  requested: string[],
  role?: { key: string; isSystem: boolean } | null,
): Permission[] {
  if (role?.key === ADMIN_ROLE_KEY) return allPermissions.filter((p) => p !== 'platform:manage');
  const clean = sanitizeTenantPermissions(requested);
  if (clean.length === 0) throw BadRequest('A role must grant at least one permission.');
  return clean;
}

/** Slug used as the stable machine key for a newly created role. */
export function roleKeyFrom(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  if (!key) throw BadRequest('Role name must contain at least one letter or number.');
  return key;
}
