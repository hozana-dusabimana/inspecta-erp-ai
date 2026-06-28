import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HardHat, Layers, Calendar, Zap, DollarSign, Warehouse, CheckSquare, HeartPulse,
  Bot, Bell, Search, LogOut, ShoppingCart, ShieldAlert, FileText, BarChart3, Settings,
  GanttChartSquare, TrendingUp, ClipboardList, CheckCircle2, Building2, Menu, X, ShieldCheck, Users, Truck, LayoutDashboard,
  Wallet, Store,
} from 'lucide-react';
import { AppView } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import ThemeToggle from './ThemeToggle';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  view: AppView;
  perm?: string;
}

// Shared sidebar nav — used by both ErpLayout (module pages) and the Dashboard
// so the navigation (incl. admin-only Administration) is identical everywhere.
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

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
function roleLabel(role?: string) {
  if (!role) return 'User';
  return role.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

interface Props {
  active: AppView;
  title: string;
  subtitle?: string;
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export default function ErpLayout({ active, title, subtitle, onNavigate, onLogout, actions, children }: Props) {
  const { user, hasPermission } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 20_000,
  });
  const unreadCount = unread?.data.count ?? 0;

  return (
    <div className="min-h-screen bg-brand-surface text-brand-on-surface font-sans flex" id="erp-root">
      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — slide-in drawer on mobile, static on lg+ */}
      <aside
        className={`w-64 h-screen fixed lg:sticky top-0 left-0 bg-brand-nav border-r border-brand-outline-variant flex flex-col justify-between py-4 shadow-md z-50 shrink-0 transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <button
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden absolute top-3 right-3 p-1.5 rounded-lg text-white/80 hover:bg-white/10"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex flex-col gap-6">
          <div className="px-6 py-2 flex items-center gap-3 cursor-pointer" onClick={() => onNavigate(AppView.DASHBOARD)}>
            <div className="w-10 h-10 rounded-xl bg-brand-secondary-container flex items-center justify-center shadow-lg shadow-brand-secondary-container/20">
              <HardHat className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-white leading-none">Inspecta AI</h1>
              <p className="text-brand-on-primary-container text-[10px] uppercase font-bold tracking-widest mt-1">Construction ERP</p>
            </div>
          </div>

          <nav className="px-3 space-y-1 overflow-y-auto custom-scrollbar max-h-[calc(100vh-180px)]" onClick={() => setSidebarOpen(false)}>
            {NAV.filter((n) => !n.perm || hasPermission(n.perm)).map((n) => {
              const Icon = n.icon;
              const isActive = n.view === active;
              return (
                <button
                  key={n.id}
                  id={n.id}
                  onClick={() => onNavigate(n.view)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all text-xs text-left ${
                    isActive
                      ? 'text-white border-l-4 border-brand-secondary-container bg-white/10 font-semibold'
                      : 'text-brand-on-primary-container/85 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-brand-secondary-container' : ''}`} />
                  <span>{n.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="px-4 py-2 space-y-3">
          <div className="h-[1px] bg-brand-on-primary-container/20 my-2" />
          <div className="flex items-center justify-between text-brand-on-primary-container/70 text-xs px-2">
            <button className="flex items-center gap-2 hover:text-white transition-all text-[11px] font-bold" onClick={onLogout}>
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
            <span className="text-[9px] font-mono opacity-60">V3.14-AI</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <header className="h-16 w-full sticky top-0 z-40 bg-brand-surface-container-lowest/90 backdrop-blur-md flex justify-between items-center px-6 md:px-8 border-b border-brand-outline-variant/10 shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-1 rounded-lg text-brand-primary hover:bg-brand-surface shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="relative max-w-md w-full hidden md:block">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-on-surface-variant w-4 h-4" />
              <input
                type="text"
                placeholder="Search..."
                className="w-full pl-10 pr-4 py-2 bg-brand-surface border-none rounded-lg focus:ring-2 focus:ring-brand-primary/10 text-xs outline-none font-medium"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => onNavigate(AppView.COPILOT)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-primary/5 text-brand-primary font-bold text-xs hover:bg-brand-primary/10 transition-all border border-brand-primary/10 cursor-pointer"
            >
              <Bot className="w-4 h-4 text-brand-secondary-container" />
              <span className="hidden sm:inline">Ask AI</span>
            </button>

            <ThemeToggle />

            <button
              onClick={() => onNavigate(AppView.NOTIFICATIONS)}
              className="p-2 rounded-full hover:bg-brand-surface transition-colors relative"
              aria-label="Notifications"
            >
              <Bell className="w-4.5 h-4.5 text-brand-on-surface-variant" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-brand-status-critical text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            <div className="h-6 w-[1px] bg-brand-outline-variant/30" />

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-brand-on-surface">{user?.fullName ?? 'User'}</p>
                <p className="text-[9px] text-brand-on-surface-variant uppercase font-bold tracking-widest">{roleLabel(user?.role)}</p>
              </div>
              <div className="w-10 h-10 rounded-full border-2 border-brand-primary-container/20 bg-brand-primary flex items-center justify-center text-white font-bold text-sm">
                {user ? initials(user.fullName) : '··'}
              </div>
            </div>
          </div>
        </header>

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
      </div>
    </div>
  );
}
