import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound, Forbidden } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { allPermissions, roleMatrix, isPlatformRole } from '../../auth/permissions';
import {
  ADMIN_ROLE_KEY,
  assertAdminCoverage,
  ensureDefaultRoles,
  permissionsForWrite,
  rethrowDuplicate,
  roleKeyFrom,
} from './roles.service';

const router = Router();
router.use(authenticate);

const selectRole = {
  id: true,
  key: true,
  name: true,
  description: true,
  permissions: true,
  baseRole: true,
  isSystem: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Roles for the caller's organization, each with a live member count. */
async function listRoles(organizationId: string) {
  await ensureDefaultRoles(organizationId);
  const [roles, counts] = await Promise.all([
    prisma.roleDefinition.findMany({
      where: { organizationId },
      select: selectRole,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    }),
    prisma.user.groupBy({
      by: ['roleId'],
      where: { organizationId, roleId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const byRole = new Map(counts.map((c) => [c.roleId, c._count._all]));
  return roles.map((r) => ({ ...r, userCount: byRole.get(r.id) ?? 0 }));
}

// LIST the company's roles + the permission catalog the editor renders.
// `matrix` is the built-in fallback, still applied to accounts that have no
// tenant role attached.
router.get(
  '/',
  requirePermission('user:read'),
  asyncHandler(async (req, res) => {
    return ok(res, {
      roles: await listRoles(req.user!.orgId),
      permissions: allPermissions,
      matrix: roleMatrix(),
    });
  }),
);

const baseRole = z
  .nativeEnum(Role)
  .refine((r) => !isPlatformRole(r), {
    message: 'PLATFORM_ADMIN can only be granted from the platform console',
  });

const createSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(240).optional(),
  permissions: z.array(z.string()).default([]),
  // Coarse label kept in sync on the user row; drives notification targeting
  // and the platform console's role column.
  baseRole: baseRole.optional(),
  isDefault: z.boolean().optional(),
});

/** Exactly one role can be the default for new members. */
async function makeDefault(organizationId: string, roleId: string) {
  await prisma.$transaction([
    prisma.roleDefinition.updateMany({ where: { organizationId }, data: { isDefault: false } }),
    prisma.roleDefinition.update({ where: { id: roleId }, data: { isDefault: true } }),
  ]);
}

// CREATE a role.
router.post(
  '/',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const orgId = req.user!.orgId;
    await ensureDefaultRoles(orgId);

    const permissions = permissionsForWrite(body.permissions);
    const role = await prisma.roleDefinition
      .create({
        data: {
          organizationId: orgId,
          key: roleKeyFrom(body.name),
          name: body.name.trim(),
          description: body.description ?? null,
          permissions,
          baseRole: body.baseRole ?? Role.SITE_ENGINEER,
          isSystem: false,
          isDefault: false,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        },
        select: selectRole,
      })
      .catch(rethrowDuplicate);

    if (body.isDefault) await makeDefault(orgId, role.id);
    await auditFromRequest(req, 'CREATE', 'role', role.id, {
      newValues: { name: role.name, permissions },
    });
    return ok(res, role, 201);
  }),
);

const updateSchema = createSchema.partial();

// UPDATE a role. Renaming leaves `key` alone — it is the stable identity the
// seed and any integration refer to.
router.put(
  '/:id',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const orgId = req.user!.orgId;
    const existing = await prisma.roleDefinition.findFirst({
      where: { id: req.params.id, organizationId: orgId },
    });
    if (!existing) throw NotFound('Role not found');

    const permissions = body.permissions
      ? permissionsForWrite(body.permissions, existing)
      : undefined;

    // Removing user:write from a role can orphan the company's administration.
    if (permissions && !permissions.includes('user:write')) {
      await assertAdminCoverage(orgId, { roleId: existing.id, nextPermissions: permissions });
    }

    const role = await prisma.roleDefinition
      .update({
        where: { id: existing.id },
        data: {
          name: body.name?.trim() ?? undefined,
          description: body.description ?? undefined,
          permissions,
          // The seeded admin role's reach is fixed; so is its base role.
          baseRole: existing.key === ADMIN_ROLE_KEY ? undefined : body.baseRole ?? undefined,
          updatedBy: req.user!.id,
        },
        select: selectRole,
      })
      .catch(rethrowDuplicate);

    if (body.isDefault) await makeDefault(orgId, role.id);

    // A role's permissions are live on the next request (authenticate re-reads
    // the row), so members feel this immediately — keep the audit trail exact.
    await auditFromRequest(req, 'UPDATE', 'role', role.id, {
      oldValues: { name: existing.name, permissions: existing.permissions },
      newValues: { name: role.name, permissions: role.permissions },
    });
    return ok(res, role);
  }),
);

// DELETE a role. Seeded roles stay; a role still in use must be emptied first,
// otherwise its members would silently fall back to the enum matrix.
router.delete(
  '/:id',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const existing = await prisma.roleDefinition.findFirst({
      where: { id: req.params.id, organizationId: orgId },
    });
    if (!existing) throw NotFound('Role not found');
    if (existing.isSystem) throw Forbidden('Built-in roles cannot be deleted. Edit their permissions instead.');

    const inUse = await prisma.user.count({ where: { organizationId: orgId, roleId: existing.id } });
    if (inUse > 0) {
      throw BadRequest(`${inUse} user${inUse === 1 ? '' : 's'} still hold this role. Move them to another role first.`);
    }

    await prisma.roleDefinition.delete({ where: { id: existing.id } });
    await auditFromRequest(req, 'DELETE', 'role', existing.id, {
      oldValues: { name: existing.name, permissions: existing.permissions },
    });
    return ok(res, { id: existing.id });
  }),
);

// Make a role the default for newly invited members.
router.post(
  '/:id/default',
  requirePermission('user:write'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const existing = await prisma.roleDefinition.findFirst({
      where: { id: req.params.id, organizationId: orgId },
    });
    if (!existing) throw NotFound('Role not found');
    await makeDefault(orgId, existing.id);
    await auditFromRequest(req, 'UPDATE', 'role', existing.id, { newValues: { isDefault: true } });
    return ok(res, { id: existing.id, isDefault: true });
  }),
);

export default router;
