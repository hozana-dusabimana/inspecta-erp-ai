import React from 'react';
import { Settings } from 'lucide-react';
import {
  Layers, Calendar, Zap, DollarSign, Warehouse, CheckSquare, HeartPulse,
  Bot, ShoppingCart, ShieldAlert, FileText, BarChart3,
  GanttChartSquare, TrendingUp, ClipboardList, CheckCircle2, Building2, ShieldCheck, Users, Truck, LayoutDashboard,
  Wallet, Store,
} from 'lucide-react';
import { AppView } from '../types';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  view: AppView;
  perm?: string;
}

// Shared sidebar nav — consumed by the persistent AppShell so the navigation
// (incl. admin-only Administration) is identical on every page.
export const NAV: NavItem[] = [
  { id: 'nav-dashboard', label: 'Dashboard', icon: Layers, view: AppView.DASHBOARD, perm: 'dashboard:read' },
  { id: 'nav-exec', label: 'Executive Intelligence', icon: Bot, view: AppView.EXEC_DASH, perm: 'ai:use' },
  { id: 'nav-portfolio', label: 'Portfolio', icon: Building2, view: AppView.PORTFOLIO, perm: 'portfolio:read' },
  { id: 'nav-planning', label: 'Planning Suite', icon: Calendar, view: AppView.PLANNING, perm: 'planning:read' },
  { id: 'nav-hr', label: 'Human Resources', icon: Users, view: AppView.HR, perm: 'hr:read' },
  { id: 'nav-payroll', label: 'Payroll', icon: Wallet, view: AppView.PAYROLL, perm: 'payroll:read' },
  { id: 'nav-pos', label: 'Point of Sale', icon: Store, view: AppView.POS, perm: 'pos:read' },
  { id: 'nav-equipment', label: 'Equipment', icon: Truck, view: AppView.EQUIPMENT, perm: 'equipment:read' },
  { id: 'nav-planning-dash', label: 'Planning Dashboards', icon: LayoutDashboard, view: AppView.PLANNING_DASH, perm: 'dashboard:read' },
  { id: 'nav-scheduling', label: 'Scheduling (CPM)', icon: GanttChartSquare, view: AppView.SCHEDULING, perm: 'scheduling:read' },
  { id: 'nav-production', label: 'Production', icon: Zap, view: AppView.PRODUCTION, perm: 'production:read' },
  { id: 'nav-fieldops', label: 'Field Ops', icon: ClipboardList, view: AppView.FIELDOPS, perm: 'fieldops:read' },
  { id: 'nav-finance', label: 'Finance', icon: DollarSign, view: AppView.FINANCE, perm: 'finance:read' },
  { id: 'nav-profitability', label: 'Profitability', icon: TrendingUp, view: AppView.PROFITABILITY, perm: 'profitability:read' },
  { id: 'nav-inventory', label: 'Inventory', icon: Warehouse, view: AppView.INVENTORY, perm: 'inventory:read' },
  { id: 'nav-procurement', label: 'Procurement', icon: ShoppingCart, view: AppView.PROCUREMENT, perm: 'procurement:read' },
  { id: 'nav-qaqc', label: 'QA/QC', icon: CheckSquare, view: AppView.QAQC, perm: 'qaqc:read' },
  { id: 'nav-hse', label: 'HSE', icon: HeartPulse, view: AppView.HSE, perm: 'hse:read' },
  { id: 'nav-risk', label: 'Risk Register', icon: ShieldAlert, view: AppView.RISK, perm: 'risk:read' },
  { id: 'nav-approvals', label: 'Approvals', icon: CheckCircle2, view: AppView.APPROVALS, perm: 'approval:read' },
  { id: 'nav-documents', label: 'Documents', icon: FileText, view: AppView.DOCUMENTS, perm: 'document:read' },
  { id: 'nav-reports', label: 'Reports', icon: BarChart3, view: AppView.REPORTS, perm: 'report:read' },
  { id: 'nav-copilot', label: 'AI Copilot', icon: Bot, view: AppView.COPILOT, perm: 'ai:use' },
  // Admin-only: only SYSTEM_ADMIN holds 'user:write'.
  { id: 'nav-admin', label: 'Administration', icon: ShieldCheck, view: AppView.ADMIN, perm: 'user:write' },
];

interface Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  // Back-compat: the persistent AppShell now owns the sidebar/header, so these
  // are accepted but ignored. Kept optional so existing call sites still compile.
  active?: AppView;
  onNavigate?: (view: AppView) => void;
  onLogout?: () => void;
}

/**
 * Page content wrapper. The sidebar + top header live once in <AppShell>; this
 * only renders the scrollable <main> with the page title/subtitle/actions, so
 * navigating between pages no longer remounts (or animates) the chrome.
 */
export default function ErpLayout({ title, subtitle, actions, children }: Props) {
  return (
    <main className="flex-1 p-6 md:p-8 overflow-y-auto custom-scrollbar">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display text-2xl font-extrabold text-brand-primary flex items-center gap-2">
            <Settings className="w-5 h-5 text-brand-secondary-container" />
            {title}
          </h2>
          {subtitle && <p className="text-brand-on-surface-variant text-xs mt-1">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </main>
  );
}
