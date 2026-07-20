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
    'procurement:read', 'procurement:write',
    'pos:read', 'pos:write',
  ],
};

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
