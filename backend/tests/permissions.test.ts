import { can, permissionsFor } from '../src/auth/permissions';

describe('RBAC permission matrix', () => {
  it('grants SYSTEM_ADMIN every permission', () => {
    expect(can('SYSTEM_ADMIN', 'user:write')).toBe(true);
    expect(can('SYSTEM_ADMIN', 'finance:write')).toBe(true);
    expect(can('SYSTEM_ADMIN', 'audit:read')).toBe(true);
  });

  it('restricts SITE_ENGINEER from finance writes but allows production writes', () => {
    expect(can('SITE_ENGINEER', 'production:write')).toBe(true);
    expect(can('SITE_ENGINEER', 'finance:write')).toBe(false);
    expect(can('SITE_ENGINEER', 'user:write')).toBe(false);
  });

  it('lets STOREKEEPER manage inventory only', () => {
    expect(can('STOREKEEPER', 'inventory:write')).toBe(true);
    expect(can('STOREKEEPER', 'finance:write')).toBe(false);
    expect(can('STOREKEEPER', 'project:write')).toBe(false);
  });

  it('gives QUANTITY_SURVEYOR finance + planning write', () => {
    expect(can('QUANTITY_SURVEYOR', 'finance:write')).toBe(true);
    expect(can('QUANTITY_SURVEYOR', 'planning:write')).toBe(true);
    expect(can('QUANTITY_SURVEYOR', 'hse:write')).toBe(false);
  });

  it('restricts AI copilot to admin/PM/QS but gives dashboards to every role', () => {
    // ai:use exposes cross-project financial/compliance data — granted only to
    // SYSTEM_ADMIN, PROJECT_MANAGER and QUANTITY_SURVEYOR.
    expect(can('SYSTEM_ADMIN', 'ai:use')).toBe(true);
    expect(can('PROJECT_MANAGER', 'ai:use')).toBe(true);
    expect(can('QUANTITY_SURVEYOR', 'ai:use')).toBe(true);
    expect(can('SITE_ENGINEER', 'ai:use')).toBe(false);
    expect(can('STOREKEEPER', 'ai:use')).toBe(false);
    // Dashboards remain available to every authenticated role.
    for (const role of ['PROJECT_MANAGER', 'SITE_ENGINEER', 'QUANTITY_SURVEYOR', 'STOREKEEPER'] as const) {
      expect(can(role, 'dashboard:read')).toBe(true);
    }
  });

  it('permissionsFor returns a non-empty list for each role', () => {
    for (const role of ['SYSTEM_ADMIN', 'PROJECT_MANAGER', 'SITE_ENGINEER', 'QUANTITY_SURVEYOR', 'STOREKEEPER'] as const) {
      expect(permissionsFor(role).length).toBeGreaterThan(0);
    }
  });
});
