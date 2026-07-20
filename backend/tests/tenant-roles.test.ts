import {
  resolvePermissions,
  sanitizeTenantPermissions,
  isPermission,
  permissionsFor,
  DEFAULT_ROLE_TEMPLATES,
  ADMIN_ROLE_KEY,
  Permission,
} from '../src/auth/permissions';
import { permissionsForWrite, roleKeyFrom } from '../src/modules/roles/roles.rules';

describe('tenant-defined roles — permission resolution', () => {
  it('lets a company role override the built-in matrix', () => {
    // A STOREKEEPER normally cannot approve anything. Their company decides
    // otherwise; the tenant role is what counts.
    const resolved = resolvePermissions('STOREKEEPER', {
      permissions: ['inventory:read', 'requisition:approve'],
    });
    expect(resolved).toContain('requisition:approve');
    // ...and it is authoritative, not additive: nothing else leaks in.
    expect(resolved).not.toContain('inventory:write');
    expect(resolved).not.toContain('pos:write');
  });

  it('falls back to the static matrix when no role is attached', () => {
    expect(resolvePermissions('STOREKEEPER', null)).toEqual(permissionsFor('STOREKEEPER'));
    expect(resolvePermissions('SITE_ENGINEER')).toEqual(permissionsFor('SITE_ENGINEER'));
  });

  it('never lets a tenant role grant cross-tenant access', () => {
    // The whole tenancy boundary rests on this: a company admin editing their
    // own roles must not be able to reach other companies' data.
    const resolved = resolvePermissions('SYSTEM_ADMIN', {
      permissions: ['platform:manage', 'user:write'],
    });
    expect(resolved).not.toContain('platform:manage');
    expect(resolved).toContain('user:write');
  });

  it('keeps a PLATFORM_ADMIN on the platform permission set regardless of role rows', () => {
    // Cross-tenant access is a platform fact, not a tenant's to edit away.
    const resolved = resolvePermissions('PLATFORM_ADMIN', { permissions: ['project:read'] });
    expect(resolved).toContain('platform:manage');
    expect(resolved).toContain('finance:write');
  });

  it('drops permissions that are not in the catalog', () => {
    expect(sanitizeTenantPermissions(['inventory:read', 'made:up', ''])).toEqual(['inventory:read']);
    expect(isPermission('inventory:read')).toBe(true);
    expect(isPermission('inventory:destroy')).toBe(false);
  });

  it('de-duplicates repeated permissions', () => {
    expect(sanitizeTenantPermissions(['hse:read', 'hse:read'])).toEqual(['hse:read']);
  });
});

describe('tenant-defined roles — write guard rails', () => {
  it('locks the administrator role to full access', () => {
    // A tenant that could trim its own admin role would lock itself out of the
    // very screen needed to put the permission back.
    const written = permissionsForWrite(['project:read'], { key: ADMIN_ROLE_KEY, isSystem: true });
    expect(written).toContain('user:write');
    expect(written).toContain('finance:write');
    expect(written).not.toContain('platform:manage');
  });

  it('strips platform:manage from any other role on write', () => {
    const written = permissionsForWrite(['platform:manage', 'hse:read'], { key: 'foreman', isSystem: false });
    expect(written).toEqual(['hse:read']);
  });

  it('rejects a role that would grant nothing', () => {
    expect(() => permissionsForWrite([], { key: 'ghost', isSystem: false })).toThrow();
    expect(() => permissionsForWrite(['not:real'], { key: 'ghost', isSystem: false })).toThrow();
  });

  it('slugifies role names into stable keys', () => {
    expect(roleKeyFrom('Store Manager')).toBe('store-manager');
    expect(roleKeyFrom('  Site Agent!  ')).toBe('site-agent');
    expect(() => roleKeyFrom('!!!')).toThrow();
  });
});

describe('default role templates', () => {
  it('ships an administrator role holding every tenant permission', () => {
    const admin = DEFAULT_ROLE_TEMPLATES.find((t) => t.key === ADMIN_ROLE_KEY);
    expect(admin).toBeDefined();
    expect(admin!.permissions).toContain('user:write');
  });

  it('gives exactly one default role for new members', () => {
    expect(DEFAULT_ROLE_TEMPLATES.filter((t) => t.isDefault)).toHaveLength(1);
  });

  it('uses unique keys so seeding is idempotent', () => {
    const keys = DEFAULT_ROLE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('material requisition chain — separation of duties', () => {
  const perms = (role: Parameters<typeof permissionsFor>[0]) => permissionsFor(role) as Permission[];

  it('lets a foreman raise but not approve a requisition', () => {
    const foreman = DEFAULT_ROLE_TEMPLATES.find((t) => t.key === 'foreman')!;
    expect(foreman.permissions).toContain('requisition:write');
    expect(foreman.permissions).not.toContain('requisition:approve');
    // ...and cannot walk into the store and issue it either.
    expect(foreman.permissions).not.toContain('inventory:write');
  });

  it('lets a site engineer approve', () => {
    expect(perms('SITE_ENGINEER')).toContain('requisition:approve');
  });

  it('lets the storekeeper issue but not approve', () => {
    // The store releasing stock it also signed off on defeats the whole chain.
    expect(perms('STOREKEEPER')).toContain('inventory:write');
    expect(perms('STOREKEEPER')).not.toContain('requisition:approve');
  });

  it('lets every role at least see requisitions', () => {
    for (const role of ['PROJECT_MANAGER', 'SITE_ENGINEER', 'QUANTITY_SURVEYOR', 'STOREKEEPER'] as const) {
      expect(perms(role)).toContain('requisition:read');
    }
  });
});
