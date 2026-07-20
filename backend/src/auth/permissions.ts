import { Role } from '@prisma/client';

/**
 * Permission matrix. Permissions are "resource:action" strings.
 * SYSTEM_ADMIN implicitly has every *tenant* permission (handled in `can`).
 * PLATFORM_ADMIN additionally holds the cross-tenant `platform:manage`.
 * Single source of truth for RBAC across every API module.
 */
export type Permission =
  | 'user:read'
  | 'user:write'
  | 'client:read'
  | 'client:write'
  | 'project:read'
  | 'project:write'
  | 'contract:read'
  | 'contract:write'
  | 'planning:read'
  | 'planning:write'
  | 'production:read'
  | 'production:write'
  | 'finance:read'
  | 'finance:write'
  | 'inventory:read'
  | 'inventory:write'
  | 'requisition:read'
  | 'requisition:write'
  | 'requisition:approve'
  | 'procurement:read'
  | 'procurement:write'
  | 'qaqc:read'
  | 'qaqc:write'
  | 'hse:read'
  | 'hse:write'
  | 'risk:read'
  | 'risk:write'
  | 'document:read'
  | 'document:write'
  | 'scheduling:read'
  | 'scheduling:write'
  | 'productivity:read'
  | 'productivity:write'
  | 'hr:read'
  | 'hr:write'
  | 'payroll:read'
  | 'payroll:write'
  | 'pos:read'
  | 'pos:write'
  | 'equipment:read'
  | 'equipment:write'
  | 'profitability:read'
  | 'fieldops:read'
  | 'fieldops:write'
  | 'approval:read'
  | 'approval:write'
  | 'portfolio:read'
  | 'notification:read'
  | 'report:read'
  | 'dashboard:read'
  | 'audit:read'
  | 'ai:use'
  | 'platform:manage';

const ALL: Permission[] = [
  'user:read', 'user:write',
  'client:read', 'client:write',
  'project:read', 'project:write',
  'contract:read', 'contract:write',
  'planning:read', 'planning:write',
  'production:read', 'production:write',
  'finance:read', 'finance:write',
  'inventory:read', 'inventory:write',
  'requisition:read', 'requisition:write', 'requisition:approve',
  'procurement:read', 'procurement:write',
  'qaqc:read', 'qaqc:write',
  'hse:read', 'hse:write',
  'risk:read', 'risk:write',
  'document:read', 'document:write',
  'scheduling:read', 'scheduling:write',
  'productivity:read', 'productivity:write',
  'hr:read', 'hr:write',
  'payroll:read', 'payroll:write',
  'pos:read', 'pos:write',
  'equipment:read', 'equipment:write',
  'profitability:read',
  'fieldops:read', 'fieldops:write',
  'approval:read', 'approval:write',
  'portfolio:read',
  'notification:read',
  'report:read',
  'dashboard:read',
  'audit:read',
  'ai:use',
];

// Cross-tenant permissions. Deliberately NOT part of `ALL`: a company's own
// SYSTEM_ADMIN is the top of *their* tenant, but must never reach other tenants.
// Only PLATFORM_ADMIN holds these.
const PLATFORM_ONLY: Permission[] = ['platform:manage'];

// Baseline every authenticated role gets. NOTE: `ai:use` (AI Copilot + Executive
// Intelligence) and `report:read` (cross-module exports) are deliberately NOT
// here — they expose cross-project financial/compliance data and are granted
// only to SYSTEM_ADMIN, PROJECT_MANAGER and QUANTITY_SURVEYOR below.
const COMMON: Permission[] = [
  'project:read', 'dashboard:read', 'notification:read', 'document:read',
  'portfolio:read', 'scheduling:read', 'fieldops:read', 'approval:read',
  'requisition:read',
];

const matrix: Record<Role, Permission[]> = {
  // Everything a SYSTEM_ADMIN can do inside a tenant, plus the cross-tenant console.
  PLATFORM_ADMIN: [...ALL, ...PLATFORM_ONLY],

  SYSTEM_ADMIN: ALL,

  PROJECT_MANAGER: [
    ...COMMON,
    'user:read',
    'client:read', 'client:write',
    'project:write',
    'contract:read', 'contract:write',
    'planning:read', 'planning:write',
    'production:read', 'production:write',
    'finance:read', 'finance:write',
    'inventory:read',
    'requisition:write', 'requisition:approve',
    'procurement:read', 'procurement:write',
    'qaqc:read', 'qaqc:write',
    'hse:read', 'hse:write',
    'risk:read', 'risk:write',
    'document:write',
    'scheduling:write',
    'productivity:read', 'productivity:write',
    'hr:read', 'hr:write',
    'payroll:read', 'payroll:write',
    'pos:read', 'pos:write',
    'equipment:read', 'equipment:write',
    'profitability:read',
    'fieldops:write',
    'approval:write',
    'audit:read',
    'report:read', 'ai:use', // performance review, exports & AI Copilot / Executive Intelligence
  ],

  SITE_ENGINEER: [
    ...COMMON,
    'client:read',
    'contract:read',
    'planning:read',
    'production:read', 'production:write',
    'inventory:read',
    // The site engineer signs off what the site asks the store for.
    'requisition:write', 'requisition:approve',
    'qaqc:read', 'qaqc:write',
    'hse:read', 'hse:write',
    'risk:read', 'risk:write',
    'document:write',
    'scheduling:write',
    'productivity:read',
    'hr:read',
    'equipment:read',
    'fieldops:write',
  ],

  QUANTITY_SURVEYOR: [
    ...COMMON,
    'client:read',
    'project:write',
    'contract:read', 'contract:write',
    'planning:read', 'planning:write',
    'production:read',
    'finance:read', 'finance:write',
    'inventory:read',
    'procurement:read', 'procurement:write',
    'qaqc:read',
    'risk:read',
    'document:write',
    'productivity:read', 'productivity:write',
    'hr:read',
    'payroll:read',
    'equipment:read',
    'profitability:read',
    'approval:write',
    'report:read', 'ai:use', // cost/profit monitoring, exports & AI Copilot / Executive Intelligence
  ],

  STOREKEEPER: [
    ...COMMON,
    'inventory:read', 'inventory:write',
    // Issues approved requisitions from stock — but cannot approve them.
    'requisition:write',
    'procurement:read', 'procurement:write',
    'pos:read', 'pos:write',
  ],
};

/**
 * Templates the default tenant roles are seeded from. A company starts with a
 * usable org chart and edits it from there; `key` is stable so re-seeding is
 * idempotent. ADMIN_ROLE_KEY is locked to every permission — see
 * modules/roles for why a tenant must not be able to strip it.
 */
export const ADMIN_ROLE_KEY = 'system-admin';

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  baseRole: Role;
  permissions: Permission[];
  isDefault?: boolean;
}

export const DEFAULT_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: ADMIN_ROLE_KEY,
    name: 'System Administrator',
    description: 'Full access to every module, users and company settings.',
    baseRole: 'SYSTEM_ADMIN',
    permissions: ALL,
  },
  {
    key: 'project-manager',
    name: 'Project Manager',
    description: 'Runs projects end to end: planning, cost, procurement and approvals.',
    baseRole: 'PROJECT_MANAGER',
    permissions: matrix.PROJECT_MANAGER,
  },
  {
    key: 'site-engineer',
    name: 'Site Engineer',
    description: 'Runs the site: production, QA/QC, HSE, and approves material requisitions.',
    baseRole: 'SITE_ENGINEER',
    permissions: matrix.SITE_ENGINEER,
    isDefault: true,
  },
  {
    key: 'quantity-surveyor',
    name: 'Quantity Surveyor',
    description: 'Measurement, valuation, cost control and profitability.',
    baseRole: 'QUANTITY_SURVEYOR',
    permissions: matrix.QUANTITY_SURVEYOR,
  },
  {
    key: 'storekeeper',
    name: 'Store Manager',
    description: 'Holds the store: receives goods and issues approved requisitions.',
    baseRole: 'STOREKEEPER',
    permissions: matrix.STOREKEEPER,
  },
  {
    key: 'foreman',
    name: 'Foreman',
    description: 'Leads the gang on site: raises material requisitions and logs daily output.',
    baseRole: 'SITE_ENGINEER',
    permissions: [
      ...COMMON,
      'production:read', 'production:write',
      'inventory:read',
      'requisition:write',
      'hse:read', 'hse:write',
      'qaqc:read',
      'fieldops:write',
      'hr:read',
      'equipment:read',
    ],
  },
];

export function permissionsFor(role: Role): Permission[] {
  if (role === 'PLATFORM_ADMIN') return [...ALL, ...PLATFORM_ONLY];
  return role === 'SYSTEM_ADMIN' ? ALL : matrix[role] ?? [];
}

/** True for roles that operate above the tenant boundary. */
export function isPlatformRole(role: Role): boolean {
  return role === 'PLATFORM_ADMIN';
}

/** The full permission catalog (used by the roles/admin endpoint). */
export const allPermissions: Permission[] = [...ALL, ...PLATFORM_ONLY];

/** Every role paired with its granted permissions — drives the admin RBAC viewer. */
export function roleMatrix(): { role: Role; permissions: Permission[] }[] {
  return (Object.values(Role) as Role[]).map((role) => ({
    role,
    permissions: permissionsFor(role),
  }));
}

export function can(role: Role, permission: Permission): boolean {
  if (role === 'PLATFORM_ADMIN') return true;
  // A tenant's SYSTEM_ADMIN gets every permission EXCEPT the cross-tenant ones.
  if (role === 'SYSTEM_ADMIN') return !PLATFORM_ONLY.includes(permission);
  return (matrix[role] ?? []).includes(permission);
}

const PERMISSION_SET = new Set<string>(allPermissions);

/** Narrows an arbitrary string (e.g. from the roles table) to a known permission. */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Drops anything that isn't a real permission, and anything cross-tenant. Used
 * on every write to the roles table AND again on read: a permission removed
 * from the catalog in a later release must stop granting anything, even if it
 * is still sitting in a tenant's row.
 */
export function sanitizeTenantPermissions(values: string[]): Permission[] {
  const seen = new Set<Permission>();
  for (const v of values) {
    if (isPermission(v) && !PLATFORM_ONLY.includes(v)) seen.add(v);
  }
  return [...seen];
}

/**
 * The permissions an account actually holds.
 *
 * A tenant-defined role, when attached, is authoritative — that is the whole
 * point of letting a company build its own org chart. Two things it can never
 * do: grant `platform:manage` (sanitized above), or apply to a PLATFORM_ADMIN,
 * whose cross-tenant access is a platform fact and not a tenant's to edit.
 */
export function resolvePermissions(
  role: Role,
  roleDefinition?: { permissions: string[] } | null,
): Permission[] {
  if (role === 'PLATFORM_ADMIN') return [...ALL, ...PLATFORM_ONLY];
  if (roleDefinition) return sanitizeTenantPermissions(roleDefinition.permissions);
  return permissionsFor(role);
}
