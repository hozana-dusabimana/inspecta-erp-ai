import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  HardHat, 
  Search, 
  Bell, 
  Sparkles, 
  Bot, 
  TrendingUp, 
  Layers, 
  Calendar, 
  Zap, 
  DollarSign, 
  Warehouse, 
  CheckSquare, 
  HeartPulse, 
  BarChart3, 
  Settings, 
  Plus, 
  ArrowUpRight, 
  ArrowDownRight, 
  AlertCircle, 
  AlertTriangle,
  Smile,
  Send,
  HelpCircle,
  LogOut,
  MapPin,
  Maximize2,
  Menu,
  X
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  AreaChart, 
  Area 
} from 'recharts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppView } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NAV } from './ErpLayout';
import ThemeToggle from './ThemeToggle';

interface DashboardProps {
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

// Shape returned by GET /api/projects
interface ApiProject {
  id: string;
  code: string;
  name: string;
  location: string | null;
  progressPct: number;
  status: string;
  health: string;
  budget: string | number;
  client?: { id: string; name: string } | null;
}

interface PortfolioSummary {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalBudget: number;
  avgProgressPct: number;
  healthBreakdown: { OPTIMAL: number; WARNING: number; CRITICAL: number };
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function roleLabel(role?: string): string {
  if (!role) return 'User';
  return role
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

const CATEGORY_COLORS: Record<string, string> = {
  LABOR: '#00286a', MATERIAL: '#ff8a00', EQUIPMENT: '#b2c5ff',
  SUBCONTRACTOR: '#7c9cff', OVERHEAD: '#c4c6d3', OTHER: '#9aa0b4',
};

// Compact currency for the KPI mini-grid (e.g. 1450000 -> "$1.5M").
function compactMoney(n: number): string {
  const v = Number(n || 0);
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

export default function Dashboard({ onNavigate, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<'portfolio' | 'region' | 'risk'>('portfolio');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  
  // Interactive mini-copilot state inside the sidebar
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotMessages, setCopilotMessages] = useState<Array<{sender: 'user' | 'ai', text: string}>>([
    { sender: 'ai', text: "Hi — I'm Inspecta Copilot. Ask me anything about your live project data, or open the Copilot Workspace." }
  ]);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectLocation, setNewProjectLocation] = useState('Chicago, IL');
  const [createError, setCreateError] = useState<string | null>(null);

  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  // ── Real project portfolio (Module 1) ──────────────────────────
  const { data: projectsResp } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ApiProject[]>('/projects'),
  });
  const projectsList = projectsResp?.data ?? [];

  const { data: summaryResp } = useQuery({
    queryKey: ['projects-summary'],
    queryFn: () => api.get<PortfolioSummary>('/projects/summary'),
  });
  const summary = summaryResp?.data;

  // Real chart data (replaces the previous mock series).
  const { data: financeResp } = useQuery({
    queryKey: ['finance-summary', 'all'],
    queryFn: () => api.get<any>('/finance/summary'),
  });
  const { data: prodResp } = useQuery({
    queryKey: ['production-summary', 'all'],
    queryFn: () => api.get<any>('/production/summary/metrics'),
  });

  // Cost breakdown pie from real cost-by-category.
  const costData = (financeResp?.data?.costByCategory ?? []).map((c: any) => ({
    name: c.category.charAt(0) + c.category.slice(1).toLowerCase(),
    value: Number(c.amount),
    color: CATEGORY_COLORS[c.category] ?? '#9aa0b4',
  }));
  const costTotal = costData.reduce((s: number, c: any) => s + c.value, 0);

  // S-curve: cumulative planned vs actual from production entries.
  let cumP = 0;
  let cumA = 0;
  const sCurveData = (prodResp?.data?.series ?? []).map((pt: any, i: number) => {
    cumP += Number(pt.planned);
    cumA += Number(pt.actual);
    return { name: `D${i + 1}`, Planned: Number(cumP.toFixed(1)), Actual: Number(cumA.toFixed(1)) };
  });

  // Productivity trend per entry.
  const productivityTrendData = (prodResp?.data?.series ?? []).map((pt: any, i: number) => ({
    name: `E${i + 1}`,
    value: Number(Number(pt.productivity).toFixed(2)),
  }));

  // Executive KPIs (real) for the productivity / SPI / budget / profit tiles.
  const { data: execResp } = useQuery({
    queryKey: ['dashboard-exec'],
    queryFn: () => api.get<any>('/dashboards/executive'),
  });
  const kpis = execResp?.data?.kpis;
  const execFinance = execResp?.data?.finance;
  const compliance = execResp?.data?.compliance;
  // Safety score derived from real incident count (100 minus a penalty per incident).
  const safetyScore = compliance ? Math.max(0, 100 - Number(compliance.incidents) * 5).toFixed(1) : '—';

  // Real notifications power the AI Insights panel (replaces mock alerts).
  const { data: notifResp } = useQuery({
    queryKey: ['dashboard-notifs'],
    queryFn: () => api.get<any[]>('/notifications?pageSize=8'),
    refetchInterval: 20_000,
  });
  const sevToBadge = (s: string): 'critical' | 'warning' | 'optimal' =>
    s === 'CRITICAL' || s === 'HIGH' ? 'critical' : s === 'MEDIUM' ? 'warning' : 'optimal';
  const alerts = (notifResp?.data ?? []).map((n: any) => ({
    id: n.id,
    type: String(n.type).replace(/_/g, ' '),
    site: new Date(n.createdAt).toLocaleDateString(),
    title: n.title,
    description: n.message,
    severity: sevToBadge(n.severity),
    actionLabel: n.isRead ? undefined : 'Mark as Reviewed',
  }));

  // "Portfolio / By Region / Risk Priority" tabs scope the project set + the
  // Project Progress KPI. Risk Priority filters to at-risk (non-optimal) projects.
  const healthRank: Record<string, number> = { CRITICAL: 0, WARNING: 1, OPTIMAL: 2 };
  const scoped = activeTab === 'risk' ? projectsList.filter((p) => p.health !== 'OPTIMAL') : [...projectsList];
  const displayedProjects = scoped.sort((a, b) => {
    if (activeTab === 'region') return (a.location ?? '').localeCompare(b.location ?? '');
    if (activeTab === 'risk')
      return (healthRank[a.health] ?? 3) - (healthRank[b.health] ?? 3) || a.progressPct - b.progressPct;
    return 0; // Portfolio = default (most-recent) order
  });
  const viewLabel = activeTab === 'region' ? 'by region' : activeTab === 'risk' ? 'at risk' : 'all projects';
  // Project Progress KPI recomputes from the scoped set so the tabs change the number.
  const scopedAvgProgress = displayedProjects.length
    ? displayedProjects.reduce((s, p) => s + p.progressPct, 0) / displayedProjects.length
    : 0;
  const regionCount = new Set(projectsList.map((p) => p.location || 'Unspecified')).size;
  const progressSubtext =
    activeTab === 'region' ? `${regionCount} regions`
    : activeTab === 'risk' ? `${displayedProjects.length} at risk`
    : `${summary?.activeProjects ?? 0} active`;

  const createProject = useMutation({
    mutationFn: (input: { code: string; name: string; location: string; status: string }) =>
      api.post<ApiProject>('/projects', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-summary'] });
      setNewProjectName('');
      setIsNewProjectOpen(false);
      setCreateError(null);
    },
    onError: (err) => setCreateError(err instanceof Error ? err.message : 'Failed to create project'),
  });

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName) return;
    // Derive a project code from the name (backend requires a unique code).
    const code =
      newProjectName
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 10) || 'PRJ';
    createProject.mutate({
      code: `${code}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      name: newProjectName,
      location: newProjectLocation,
      status: 'PLANNING',
    });
  };

  const handleCopilotSend = async () => {
    if (!copilotInput.trim()) return;
    const userMsg = copilotInput;
    setCopilotMessages((prev) => [...prev, { sender: 'user', text: userMsg }]);
    setCopilotInput('');
    setCopilotMessages((prev) => [...prev, { sender: 'ai', text: 'Analyzing your live project data…' }]);

    try {
      const res = await api.post<{ text: string; confidence: number }>('/ai/chat', { prompt: userMsg });
      setCopilotMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { sender: 'ai', text: res.data.text };
        return next;
      });
    } catch (err) {
      setCopilotMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          sender: 'ai',
          text: err instanceof Error ? `Copilot error: ${err.message}` : 'Copilot is unavailable right now.',
        };
        return next;
      });
    }
  };

  const handleRemoveAlert = (id: string) => {
    // Mark the underlying notification as read.
    api.put(`/notifications/${id}/read`).finally(() => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-notifs'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    });
  };

  return (
    <div className="min-h-screen bg-brand-surface text-brand-on-surface font-sans flex" id="dashboard-root">
      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar Panel — slide-in drawer on mobile, static on lg+ */}
      <aside
        id="sidebar"
        className={`w-64 h-screen fixed lg:sticky top-0 left-0 bg-brand-nav border-r border-brand-outline-variant flex flex-col justify-between py-4 shadow-md z-50 shrink-0 transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Mobile close button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden absolute top-3 right-3 p-1.5 rounded-lg text-white/80 hover:bg-white/10"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col gap-6">
          {/* Sidebar Brand Header */}
          <div className="px-6 py-2 flex items-center gap-3 cursor-pointer" onClick={() => onNavigate(AppView.LANDING)}>
            <div className="w-10 h-10 rounded-xl bg-brand-secondary-container flex items-center justify-center shadow-lg shadow-brand-secondary-container/20">
              <HardHat className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-white leading-none">Inspecta AI</h1>
              <p className="text-brand-on-primary-container text-[10px] uppercase font-bold tracking-widest mt-1">Construction ERP</p>
            </div>
          </div>

          {/* Navigation Items — shared list (incl. admin-only Administration) */}
          <nav className="px-3 space-y-1 overflow-y-auto custom-scrollbar max-h-[calc(100vh-180px)]" id="sidebar-nav" onClick={() => setSidebarOpen(false)}>
            {NAV.filter((n) => !n.perm || hasPermission(n.perm)).map((n) => {
              const Icon = n.icon;
              const isActive = n.view === AppView.DASHBOARD;
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

        {/* Sidebar Footer Operations */}
        <div className="px-4 py-2 space-y-3">
          <button 
            id="btn-sidebar-new-project"
            onClick={() => setIsNewProjectOpen(true)}
            className="w-full bg-brand-secondary-container text-white py-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:opacity-95 transition-opacity cursor-pointer shadow-lg shadow-brand-secondary-container/10"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </button>
          
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

      {/* Main Panel Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        {/* Top Header */}
        <header id="header" className="h-16 w-full sticky top-0 z-40 bg-brand-surface-container-lowest/90 backdrop-blur-md flex justify-between items-center px-6 md:px-8 border-b border-brand-outline-variant/10 shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            {/* Mobile menu toggle */}
            <button
              id="btn-mobile-menu"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-1 rounded-lg text-brand-primary hover:bg-brand-surface shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-on-surface-variant w-4 h-4" />
              <input 
                id="search-input"
                type="text"
                placeholder="Search projects, documents, or insights..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-brand-surface border-none rounded-lg focus:ring-2 focus:ring-brand-primary/10 text-xs outline-none font-medium"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              id="header-ask-ai"
              onClick={() => onNavigate(AppView.COPILOT)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-primary/5 text-brand-primary font-bold text-xs hover:bg-brand-primary/10 transition-all border border-brand-primary/10 cursor-pointer"
            >
              <Bot className="w-4 h-4 text-brand-secondary-container" />
              <span>Ask AI Assistant</span>
            </button>

            <ThemeToggle />

            <button id="header-notifications" className="p-2 rounded-full hover:bg-brand-surface transition-colors relative">
              <Bell className="w-4.5 h-4.5 text-brand-on-surface-variant" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand-status-critical rounded-full animate-pulse"></span>
            </button>
            
            <div className="h-6 w-[1px] bg-brand-outline-variant/30"></div>
            
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-brand-on-surface">{user?.fullName ?? 'User'}</p>
                <p className="text-[9px] text-brand-on-surface-variant uppercase font-bold tracking-widest">{roleLabel(user?.role)}</p>
              </div>
              <div className="w-10 h-10 rounded-full border-2 border-brand-primary-container/20 bg-brand-surface-container overflow-hidden">
                <div className="w-full h-full bg-brand-primary flex items-center justify-center text-white font-bold text-sm">
                  {user ? initials(user.fullName) : '··'}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Canvas Wrapper */}
        <main className="flex-1 flex flex-col xl:flex-row xl:overflow-hidden">
          {/* Left Area: General Charts & KPI grids */}
          <div className="flex-1 p-6 md:p-8 xl:overflow-y-auto custom-scrollbar space-y-6 min-w-0">
            {/* Header Title Banner */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-extrabold text-brand-primary">Executive Overview</h2>
                <p className="text-brand-on-surface-variant text-xs mt-1">Portfolio performance across active construction sites.</p>
              </div>
              
              <div className="flex gap-1.5 bg-brand-surface-container p-1 rounded-lg border border-brand-outline-variant/10">
                <button 
                  id="tab-portfolio"
                  onClick={() => setActiveTab('portfolio')}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'portfolio' ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant hover:text-brand-primary'}`}
                >
                  Portfolio
                </button>
                <button 
                  id="tab-region"
                  onClick={() => setActiveTab('region')}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'region' ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant hover:text-brand-primary'}`}
                >
                  By Region
                </button>
                <button 
                  id="tab-risk"
                  onClick={() => setActiveTab('risk')}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'risk' ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant hover:text-brand-primary'}`}
                >
                  Risk Priority
                </button>
              </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-5">
              {/* Progress Card */}
              <div className="bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 relative overflow-hidden shadow-sm hover:shadow-md transition-all min-w-0">
                <div className="flex justify-between items-start gap-2 mb-4 min-w-0">
                  <span className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider min-w-0 truncate">Project Progress</span>
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap bg-emerald-50 text-emerald-700 text-[9px] font-bold border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span> GREEN
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                  <span className="font-mono text-2xl sm:text-3xl font-extrabold text-brand-primary leading-none">{scopedAvgProgress.toFixed(1)}%</span>
                  <span className="text-brand-on-surface-variant text-xs font-bold flex items-center">
                    {progressSubtext}
                  </span>
                </div>
                <div className="mt-4 h-1.5 w-full bg-brand-surface-container rounded-full overflow-hidden">
                  <div className="h-full bg-brand-primary rounded-full transition-all" style={{ width: `${scopedAvgProgress}%` }}></div>
                </div>
              </div>

              {/* Productivity Card */}
              <div className="bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm hover:shadow-md transition-all min-w-0 overflow-hidden">
                <div className="flex justify-between items-start gap-2 mb-4">
                  <span className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider min-w-0 truncate">Productivity Index</span>
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap bg-amber-50 text-amber-700 text-[9px] font-bold border border-amber-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> YELLOW
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                  <span className="font-mono text-2xl sm:text-3xl font-extrabold text-brand-primary leading-none">{kpis ? Number(kpis.productivityIndex).toFixed(2) : '—'}</span>
                  <span className="text-brand-on-surface-variant text-xs font-semibold whitespace-nowrap">out/lh</span>
                </div>
                <p className="text-[10px] text-brand-on-surface-variant mt-3 italic leading-tight">Actual output per labor hour across production entries.</p>
              </div>

              {/* Schedule Card */}
              <div className="bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm hover:shadow-md transition-all min-w-0 overflow-hidden">
                <div className="flex justify-between items-start gap-2 mb-4">
                  <span className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider min-w-0 truncate">Schedule SPI</span>
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap bg-emerald-50 text-emerald-700 text-[9px] font-bold border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> ON TRACK
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                  <span className="font-mono text-2xl sm:text-3xl font-extrabold text-brand-primary leading-none">{kpis ? Number(kpis.spi).toFixed(2) : '—'}</span>
                  <span className="text-brand-on-surface-variant text-xs font-semibold whitespace-nowrap">Target: 1.00</span>
                </div>
                <div className="mt-4 flex gap-1">
                  <div className="h-1 flex-1 bg-emerald-600 rounded-full"></div>
                  <div className="h-1 flex-1 bg-emerald-600 rounded-full"></div>
                  <div className="h-1 flex-1 bg-brand-outline-variant/30 rounded-full"></div>
                  <div className="h-1 flex-1 bg-brand-outline-variant/30 rounded-full"></div>
                </div>
              </div>

              {/* Budget Card */}
              <div className="bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm hover:shadow-md transition-all min-w-0 overflow-hidden">
                <div className="flex justify-between items-start gap-2 mb-4">
                  <span className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider min-w-0 truncate">Budget Util.</span>
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap bg-red-50 text-red-700 text-[9px] font-bold border border-red-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-status-critical"></span> CRITICAL
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                  <span className="font-mono text-2xl sm:text-3xl font-extrabold text-brand-primary leading-none">{kpis ? `${Number(kpis.budgetUtilizationPct).toFixed(1)}%` : '—'}</span>
                  <span className="text-brand-on-surface-variant text-xs font-semibold whitespace-nowrap">
                    {execFinance ? `${Number(execFinance.costVariance).toLocaleString(undefined, { maximumFractionDigits: 0 })} left` : ''}
                  </span>
                </div>
                <p className="text-[10px] text-brand-on-surface-variant mt-3 font-bold">Actual cost vs total budget across the portfolio.</p>
              </div>
            </div>

            {/* Secondary KPI Mini-Grid */}
            <div className="grid grid-cols-2 2xl:grid-cols-4 gap-4">
              <div className="bg-brand-surface-container-low px-4 py-3 rounded-xl border border-brand-outline-variant/10 flex justify-between items-center gap-2 shadow-sm min-w-0 overflow-hidden">
                <div className="min-w-0">
                  <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider truncate">Forecast Profit</p>
                  <p className="font-mono font-bold text-base text-brand-primary truncate">{execFinance ? compactMoney(execFinance.forecastProfit) : '—'}</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-brand-primary/5 flex items-center justify-center text-brand-primary shrink-0">
                  <TrendingUp className="w-4.5 h-4.5" />
                </div>
              </div>

              <div className="bg-brand-surface-container-low px-4 py-3 rounded-xl border border-brand-outline-variant/10 flex justify-between items-center gap-2 shadow-sm min-w-0 overflow-hidden">
                <div className="min-w-0">
                  <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider truncate">Cash Received</p>
                  <p className="font-mono font-bold text-base text-brand-primary truncate">{execFinance ? compactMoney(execFinance.received) : '—'}</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-brand-primary/5 flex items-center justify-center text-brand-primary shrink-0">
                  <DollarSign className="w-4.5 h-4.5" />
                </div>
              </div>

              <div className="bg-brand-surface-container-low px-4 py-3 rounded-xl border border-brand-outline-variant/10 flex justify-between items-center gap-2 shadow-sm min-w-0 overflow-hidden">
                <div className="min-w-0">
                  <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider truncate">Safety Score</p>
                  <p className="font-mono font-bold text-base text-brand-primary truncate">{safetyScore}</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-brand-primary/5 flex items-center justify-center text-emerald-600 shrink-0">
                  <HeartPulse className="w-4.5 h-4.5" />
                </div>
              </div>

              <div className="bg-brand-surface-container-low px-4 py-3 rounded-xl border border-brand-outline-variant/10 flex justify-between items-center gap-2 shadow-sm min-w-0 overflow-hidden">
                <div className="min-w-0">
                  <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider truncate">Open NCRs</p>
                  <p className="font-mono font-bold text-base text-brand-status-critical truncate">{compliance ? compliance.openNcrs : '—'}</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-brand-primary/5 flex items-center justify-center text-brand-status-critical shrink-0">
                  <AlertTriangle className="w-4.5 h-4.5" />
                </div>
              </div>
            </div>

            {/* Bento Grid Analytics charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Progress S-Curve chart */}
              <div className="lg:col-span-2 bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm flex flex-col justify-between">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="font-bold text-brand-primary text-sm">S-Curve: Planned vs Actual Progress</h3>
                    <p className="text-brand-on-surface-variant text-[11px]">Cumulative completion index tracking vs baseline plan.</p>
                  </div>
                  <span className="text-[10px] bg-brand-surface px-2.5 py-1 rounded border font-semibold text-brand-on-surface-variant">Last 6 Months</span>
                </div>
                
                <div className="h-60 w-full mt-4" id="s-curve-chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sCurveData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                      <Line type="monotone" dataKey="Actual" stroke="#00286a" strokeWidth={3} activeDot={{ r: 6 }} name="Actual Progress %" />
                      <Line type="monotone" dataKey="Planned" stroke="#cbd5e1" strokeDasharray="5 5" strokeWidth={2} name="Planned Baseline %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Cost Breakdown Donut Chart */}
              <div className="bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-brand-primary text-sm">Cost Breakdown</h3>
                  <p className="text-brand-on-surface-variant text-[11px]">Direct expenses divided by categories.</p>
                </div>

                <div className="h-44 w-full flex items-center justify-center relative mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={costData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={75}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {costData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Absolute Center Text */}
                  <div className="absolute text-center">
                    <p className="text-xs font-semibold text-brand-on-surface-variant">Total Spend</p>
                    <p className="text-lg font-mono font-extrabold text-brand-primary">{compactMoney(costTotal)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-brand-outline-variant/15">
                  {costData.length === 0 && (
                    <span className="text-[11px] text-brand-on-surface-variant col-span-2">No cost entries yet.</span>
                  )}
                  {costData.map((item: { name: string; value: number; color: string }, idx: number) => (
                    <div key={idx} className="flex items-center gap-1.5 text-[11px] font-medium text-brand-on-surface-variant min-w-0">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="truncate">{item.name}: {costTotal > 0 ? Math.round((item.value / costTotal) * 100) : 0}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Productivity Area Chart */}
              <div className="lg:col-span-3 bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm">
                <div>
                  <h3 className="font-bold text-brand-primary text-sm">Productivity Trend Analysis</h3>
                  <p className="text-brand-on-surface-variant text-[11px]">Weekly normalized labor units per volume logged.</p>
                </div>
                
                <div className="h-44 w-full mt-4" id="prod-trend-chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={productivityTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorProd" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ff8a00" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#ff8a00" stopOpacity={0.01}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} domain={[0.8, 1.3]} />
                      <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                      <Area type="monotone" dataKey="value" stroke="#ff8a00" strokeWidth={2.5} fillOpacity={1} fill="url(#colorProd)" name="Productivity Index" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Project List Subsection */}
            <section className="bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-brand-primary text-sm">Active Project Portfolio</h3>
                <span className="text-[10px] text-brand-on-surface-variant font-bold uppercase">{displayedProjects.length} of {projectsList.length} · {viewLabel}</span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-brand-outline-variant/20 text-brand-on-surface-variant font-bold">
                      <th className="pb-3 pl-2">Project Name</th>
                      <th className="pb-3">Location</th>
                      <th className="pb-3">WBS Progress</th>
                      <th className="pb-3">Crews</th>
                      <th className="pb-3">Yield Rate</th>
                      <th className="pb-3 pr-2 text-right">Cost Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedProjects.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-brand-on-surface-variant">
                          {activeTab === 'risk'
                            ? 'No at-risk projects — all are healthy. 🎉'
                            : 'No projects yet. Use “New Project” to provision one.'}
                        </td>
                      </tr>
                    )}
                    {displayedProjects.map((proj) => (
                      <tr key={proj.id} className="border-b border-brand-outline-variant/10 hover:bg-brand-surface/35 transition-all">
                        <td className="py-3 pl-2 font-bold text-brand-primary">{proj.name}</td>
                        <td className="py-3 text-brand-on-surface-variant">{proj.location ?? '—'}</td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 bg-brand-surface-container rounded-full overflow-hidden">
                              <div className="h-full bg-brand-primary" style={{ width: `${proj.progressPct}%` }} />
                            </div>
                            <span className="font-mono font-bold">{proj.progressPct}%</span>
                          </div>
                        </td>
                        {/* Crews / Yield / Cost variance are populated by Production (M2)
                            and Finance (M3) — shown as pending until those modules land. */}
                        <td className="py-3 font-semibold text-brand-on-surface-variant/50">—</td>
                        <td className="py-3">
                          <span className={`font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            proj.health === 'CRITICAL' ? 'bg-red-50 text-red-700' :
                            proj.health === 'WARNING' ? 'bg-amber-50 text-amber-700' :
                            'bg-emerald-50 text-emerald-700'
                          }`}>{proj.health}</span>
                        </td>
                        <td className="py-3 pr-2 text-right font-mono font-bold text-brand-on-surface-variant/50">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Right Area: AI Insights & Map panel — full width on mobile, side column on xl */}
          <aside id="ai-insights-panel" className="w-full xl:w-[340px] xl:h-full bg-brand-surface-ai border-t xl:border-t-0 xl:border-l border-brand-glass-border flex flex-col shrink-0">
            {/* Header */}
            <div className="p-5 border-b border-brand-glass-border bg-brand-surface-container-lowest">
              <div className="flex items-center gap-1.5 text-brand-primary font-bold text-sm mb-1">
                <Sparkles className="w-4 h-4 text-brand-secondary-container" />
                <span>AI Assistant Insights</span>
              </div>
              <p className="text-[10px] text-brand-on-surface-variant font-medium">Live insights from your project data ({alerts.length} active).</p>
            </div>

            {/* Alerts List */}
            <div className="xl:flex-1 p-4 overflow-y-auto custom-scrollbar space-y-4 max-h-[26rem] xl:max-h-none">
              {alerts.length === 0 && (
                <p className="text-[11px] text-brand-on-surface-variant text-center py-6">No active insights right now.</p>
              )}
              <AnimatePresence>
                {alerts.map((alert) => (
                  <motion.div 
                    key={alert.id}
                    initial={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                    className={`glass-panel p-4 rounded-xl relative overflow-hidden group hover:shadow-md transition-all border-l-4 ${
                      alert.severity === 'critical' ? 'border-brand-status-critical bg-brand-surface-container-lowest' :
                      alert.severity === 'warning' ? 'border-brand-status-warning bg-brand-surface-container-lowest' :
                      'border-emerald-500 bg-brand-surface-container-lowest'
                    }`}
                  >
                    <div className="ai-shimmer absolute inset-0 opacity-10 pointer-events-none"></div>
                    
                    <div className="flex justify-between items-start mb-2">
                      <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                        alert.severity === 'critical' ? 'bg-red-50 text-red-700' :
                        alert.severity === 'warning' ? 'bg-amber-50 text-amber-700' :
                        'bg-emerald-50 text-emerald-700'
                      }`}>
                        {alert.type}
                      </span>
                      <span className="text-[9px] font-bold text-brand-on-surface-variant">{alert.site}</span>
                    </div>

                    <h4 className="font-bold text-xs text-brand-primary">{alert.title}</h4>
                    <p className="text-[11px] text-brand-on-surface-variant mt-1.5 leading-relaxed">{alert.description}</p>
                    
                    {alert.actionLabel && (
                      <div className="mt-3 flex gap-2">
                        <button 
                          id={`alert-btn-${alert.id}`}
                          onClick={() => {
                            if (alert.severity === 'critical') {
                              onNavigate(AppView.COPILOT);
                            } else {
                              handleRemoveAlert(alert.id);
                            }
                          }}
                          className={`px-3 py-1.5 rounded text-[10px] font-bold shadow-sm cursor-pointer ${
                            alert.severity === 'critical' 
                              ? 'bg-brand-primary text-white hover:bg-brand-primary-container' 
                              : 'bg-brand-surface text-brand-primary hover:bg-brand-surface-container-high'
                          }`}
                        >
                          {alert.actionLabel}
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Portfolio Geography — real projects grouped by location + health */}
              <div className="pt-4">
                <h4 className="text-[10px] font-extrabold text-brand-on-surface-variant uppercase tracking-wider mb-2">Portfolio Geography</h4>
                <div className="space-y-2">
                  {projectsList.length === 0 && (
                    <p className="text-[11px] text-brand-on-surface-variant px-1">No projects to map yet.</p>
                  )}
                  {projectsList.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onNavigate(AppView.PORTFOLIO)}
                      className="w-full flex items-center justify-between gap-2 bg-brand-surface-container-lowest rounded-lg px-3 py-2 border border-brand-outline-variant/30 hover:shadow-sm transition-all text-left min-w-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <MapPin className={`w-4 h-4 shrink-0 ${
                          p.health === 'CRITICAL' ? 'text-brand-status-critical' :
                          p.health === 'WARNING' ? 'text-brand-status-warning' : 'text-emerald-500'
                        }`} />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-brand-primary truncate">{p.name}</p>
                          <p className="text-[10px] text-brand-on-surface-variant truncate">{p.location ?? 'No location set'}</p>
                        </div>
                      </div>
                      <span className="font-mono text-[10px] font-bold text-brand-on-surface-variant shrink-0">{p.progressPct}%</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar quick copilot chatter */}
            <div className="p-4 bg-brand-surface-container-lowest border-t border-brand-glass-border">
              <div className="h-32 overflow-y-auto custom-scrollbar mb-2 space-y-2 text-[10px]">
                {copilotMessages.map((msg, i) => (
                  <div key={i} className={`p-2 rounded-lg max-w-[90%] leading-relaxed ${msg.sender === 'user' ? 'bg-brand-primary text-white ml-auto' : 'bg-brand-surface-ai text-brand-on-surface-variant'}`}>
                    <p>{msg.text}</p>
                  </div>
                ))}
              </div>
              
              <div className="relative">
                <input 
                  id="sidebar-copilot-input"
                  type="text" 
                  placeholder="Ask copilot..." 
                  value={copilotInput}
                  onChange={(e) => setCopilotInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCopilotSend()}
                  className="w-full bg-brand-surface border-none rounded-lg py-2 pl-3 pr-8 text-xs outline-none focus:ring-1 focus:ring-brand-primary font-medium text-brand-on-surface"
                />
                <button 
                  id="sidebar-copilot-send"
                  onClick={handleCopilotSend}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-primary hover:text-brand-secondary-container transition-colors cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </aside>
        </main>
      </div>

      {/* New Project Dialog Modal */}
      <AnimatePresence>
        {isNewProjectOpen && (
          <div className="fixed inset-0 z-50 bg-brand-on-background/40 backdrop-blur-sm flex items-center justify-center px-4" id="new-project-modal">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-brand-surface-container-lowest w-full max-w-md rounded-2xl p-6 shadow-2xl relative"
            >
              <h3 className="font-display text-lg font-extrabold text-brand-primary mb-1">Provision Enterprise Project</h3>
              <p className="text-brand-on-surface-variant text-xs mb-4">Set up a new physical node under Inspecta AI supervision.</p>
              
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="font-sans text-[11px] font-bold text-brand-on-surface-variant block">PROJECT NAME</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. Skyline Tower B"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary transition-all font-medium"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-sans text-[11px] font-bold text-brand-on-surface-variant block">GEOGRAPHIC REGION</label>
                  <select 
                    value={newProjectLocation}
                    onChange={(e) => setNewProjectLocation(e.target.value)}
                    className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary transition-all font-semibold text-brand-primary"
                  >
                    <option value="Chicago, IL">Chicago, IL (Headquarters)</option>
                    <option value="Austin, TX">Austin, TX (South Regional)</option>
                    <option value="New York, NY">New York, NY (East Coast)</option>
                    <option value="San Francisco, CA">San Francisco, CA (West Coast)</option>
                  </select>
                </div>

                {createError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
                    {createError}
                  </div>
                )}

                <div className="flex gap-3 justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => setIsNewProjectOpen(false)}
                    className="px-4 py-2 text-xs font-semibold text-brand-on-surface-variant hover:bg-brand-surface rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createProject.isPending}
                    className="px-5 py-2 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container transition-all disabled:opacity-60"
                  >
                    {createProject.isPending ? 'Provisioning…' : 'Provision Project'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
