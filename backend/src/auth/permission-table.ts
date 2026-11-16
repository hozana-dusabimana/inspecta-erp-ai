import { DEFAULT_ROLE_TEMPLATES } from './permissions';

/**
 * The permission table, role x module x action (T1-08). Built from the very permission lists the
 * server enforces (requirePermission), so the table can never drift from the behaviour:
 *   view = <module>:read · create / edit / cancel = <module>:write · approve = <module>:approve,
 *   or approval:write for modules approved through the approvals inbox.
 * Cancel and approve are further limited by maker-checker (never your own record, different role).
 */
const MODULES = ['project', 'planning', 'scheduling', 'production', 'fieldops', 'finance', 'inventory', 'requisition', 'procurement',
  'qaqc', 'hse', 'risk', 'hr', 'payroll', 'equipment', 'document', 'approval', 'profitability', 'report', 'audit', 'user'] as const;
const APPROVED_VIA_INBOX = new Set(['production', 'finance', 'hr', 'scheduling', 'planning', 'qaqc', 'procurement']);

export function permissionTable(tenantRoles: Array<{ name: string; permissions: string[] }> = []) {
  const roles = tenantRoles.length ? tenantRoles : DEFAULT_ROLE_TEMPLATES.map((t) => ({ name: t.name, permissions: t.permissions as string[] }));
  return {
    actions: ['view', 'create', 'edit', 'approve', 'cancel'],
    modules: MODULES,
    rows: roles.map((r) => {
      const has = (p: string) => r.permissions.includes(p);
      return {
        role: r.name,
        modules: Object.fromEntries(MODULES.map((m) => {
          const write = has(`${m}:write`);
          const approve = has(`${m}:approve`) || (APPROVED_VIA_INBOX.has(m) && has('approval:write'));
          return [m, { view: has(`${m}:read`), create: write, edit: write, approve, cancel: write }];
        })),
      };
    }),
  };
}
