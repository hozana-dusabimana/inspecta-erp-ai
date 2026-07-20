import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  X, Ban, Check, KeyRound, ShieldCheck, Plus, CreditCard, LogIn, Megaphone,
  Download, Search, ChevronLeft, ChevronRight, AlertTriangle, Eye,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppView } from '../types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { enterInspect } from '../lib/inspectStore';
import { pathForView } from '../lib/routes';
import ErpLayout from './ErpLayout';

interface Props {
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

// ─────────────────────────────── Types ───────────────────────────────

type OrgStatus = 'ACTIVE' | 'SUSPENDED';
type PlanTier = 'TRIAL' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';

const PLAN_TIERS: PlanTier[] = ['TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'];

const PLAN_TONE: Record<PlanTier, string> = {
  TRIAL: 'bg-brand-surface text-brand-on-surface-variant',
  STARTER: 'bg-sky-100 text-sky-700',
  PROFESSIONAL: 'bg-violet-100 text-violet-700',
  ENTERPRISE: 'bg-brand-primary/10 text-brand-primary',
};

const planLabel = (p: PlanTier) => p.charAt(0) + p.slice(1).toLowerCase();
/** Renders a quota as "3 / 10" or "3 / ∞". */
const quota = (used: number, limit: number | null) => `${used} / ${limit ?? '∞'}`;

interface Company {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  industry: string | null;
  country: string | null;
  currency: string | null;
  phone: string | null;
  tinNumber: string | null;
  status: OrgStatus;
  suspendedAt: string | null;
  suspendedReason: string | null;
  plan: PlanTier;
  maxUsers: number | null;
  maxProjects: number | null;
  createdAt: string;
  _count: { users: number; projects: number; clients: number; contracts: number };
}

interface CompanyDetail extends Company {
  users: PlatformUserRow[];
  projects: { id: string; code: string; name: string; status: string; health: string; budget: string; progressPct: string }[];
  recentActivity: AuditRow[];
}

interface PlatformUserRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  organization?: { id: string; name: string; slug: string; status: OrgStatus };
}

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
  organization?: { id: string; name: string; slug: string };
  user: { id: string; fullName: string; email: string } | null;
}

interface Overview {
  totals: {
    companies: number; activeCompanies: number; suspendedCompanies: number;
    users: number; activeUsers: number; blockedUsers: number;
    platformAdmins: number; projects: number; auditEvents30d: number; logins30d: number;
  };
  growth: { month: string; companies: number; users: number }[];
  roleBreakdown: { role: string; count: number }[];
  busiestCompanies: { id: string; name: string; slug: string; status: OrgStatus; users: number; projects: number; events30d: number }[];
  newestCompanies: { id: string; name: string; slug: string; status: OrgStatus; country: string | null; createdAt: string }[];
}

// ──────────────────────── Shared presentation ────────────────────────

const ROLES = ['PLATFORM_ADMIN', 'SYSTEM_ADMIN', 'PROJECT_MANAGER', 'SITE_ENGINEER', 'QUANTITY_SURVEYOR', 'STOREKEEPER'] as const;

const ROLE_TONE: Record<string, string> = {
  PLATFORM_ADMIN: 'bg-brand-secondary-container/20 text-brand-secondary-container',
  SYSTEM_ADMIN: 'bg-brand-primary/10 text-brand-primary',
  PROJECT_MANAGER: 'bg-amber-100 text-amber-700',
  SITE_ENGINEER: 'bg-sky-100 text-sky-700',
  QUANTITY_SURVEYOR: 'bg-violet-100 text-violet-700',
  STOREKEEPER: 'bg-emerald-100 text-emerald-700',
};

const inputBase =
  'h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary transition-all';
const inputCls = `w-full ${inputBase}`;
// Same control without `w-full`, so an explicit width (w-40, w-56…) actually wins.
const controlCls = inputBase;
const labelCls = 'font-sans text-[10px] font-bold text-brand-on-surface-variant block mb-1';
const cardCls = 'bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm';
const btnCls = 'bg-brand-primary text-white font-bold text-xs rounded-lg px-4 py-2.5 hover:bg-brand-primary-container transition-all disabled:opacity-60';

function roleLabel(role: string) {
  return role.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—');
const fmtDateTime = (v: string) => new Date(v).toLocaleString();
const fmtNum = (n: number) => n.toLocaleString();

function StatusPill({ status }: { status: OrgStatus }) {
  return (
    <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
      {status === 'ACTIVE' ? 'Active' : 'Suspended'}
    </span>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'critical' | 'warning' }) {
  const valueTone = tone === 'critical' ? 'text-brand-status-critical' : tone === 'warning' ? 'text-brand-status-warning' : 'text-brand-primary';
  return (
    <div className={`${cardCls} p-4`}>
      <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-mono text-2xl font-extrabold ${valueTone}`}>{typeof value === 'number' ? fmtNum(value) : value}</p>
      {hint && <p className="text-brand-on-surface-variant text-[10px] mt-1">{hint}</p>}
    </div>
  );
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-brand-on-surface/50 backdrop-blur-md flex items-center justify-center px-4 py-8">
      <div className={`bg-brand-surface-container-lowest ${wide ? 'max-w-3xl' : 'max-w-md'} w-full max-h-full overflow-y-auto custom-scrollbar rounded-2xl p-6 shadow-2xl relative border border-brand-outline-variant/30`}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-on-surface">
          <X className="w-5 h-5" />
        </button>
        <h3 className="font-display text-lg font-extrabold text-brand-primary mb-4 pr-8">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-brand-outline-variant/10">
      <p className="text-[11px] text-brand-on-surface-variant">
        {fmtNum((page - 1) * pageSize + 1)}–{fmtNum(Math.min(page * pageSize, total))} of {fmtNum(total)}
      </p>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant disabled:opacity-30">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[11px] font-bold text-brand-primary px-2">{page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant disabled:opacity-30">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** Search box + filters + export bar shared by the list tabs. */
function Toolbar({ search, onSearch, exportPath, children }: {
  search: string;
  onSearch: (v: string) => void;
  exportPath: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-brand-on-surface-variant" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search…"
          className={`${controlCls} pl-9 w-56`}
        />
      </div>
      {children}
      <div className="ml-auto flex items-center gap-2">
        <button onClick={() => api.download(`${exportPath}&format=csv`, 'export.csv')} className="flex items-center gap-1.5 text-xs font-bold text-brand-on-surface-variant hover:text-brand-primary px-3 py-2 rounded-lg hover:bg-brand-surface transition-all">
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button onClick={() => api.download(`${exportPath}&format=xlsx`, 'export.xlsx')} className="flex items-center gap-1.5 text-xs font-bold text-brand-on-surface-variant hover:text-brand-primary px-3 py-2 rounded-lg hover:bg-brand-surface transition-all">
          <Download className="w-3.5 h-3.5" /> Excel
        </button>
      </div>
    </div>
  );
}

/** Debounces the search box so each keystroke doesn't hit the API. */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ─────────────────────────────── Overview ───────────────────────────────

function OverviewTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () => api.get<Overview>('/platform/overview'),
  });
  const o = data?.data;

  if (isLoading || !o) return <p className="text-brand-on-surface-variant text-xs">Loading platform analytics…</p>;

  const t = o.totals;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Kpi label="Companies" value={t.companies} hint={`${fmtNum(t.activeCompanies)} active`} />
        <Kpi label="Suspended" value={t.suspendedCompanies} tone={t.suspendedCompanies > 0 ? 'critical' : undefined} hint="tenants frozen" />
        <Kpi label="Users" value={t.users} hint={`${fmtNum(t.activeUsers)} active`} />
        <Kpi label="Blocked Users" value={t.blockedUsers} tone={t.blockedUsers > 0 ? 'warning' : undefined} hint="cannot sign in" />
      </div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Kpi label="Projects" value={t.projects} hint="across all tenants" />
        <Kpi label="Platform Admins" value={t.platformAdmins} hint="cross-tenant access" />
        <Kpi label="Events (30d)" value={t.auditEvents30d} hint="audited actions" />
        <Kpi label="Logins (30d)" value={t.logins30d} hint="successful sign-ins" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${cardCls} p-5 lg:col-span-2`}>
          <h3 className="font-display text-sm font-extrabold text-brand-primary mb-4">Growth — last 12 months</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={o.growth} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCompanies" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#471519" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#471519" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fc6061" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#fc6061" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Area type="monotone" dataKey="companies" name="New companies" stroke="#471519" fill="url(#gCompanies)" strokeWidth={2} />
                <Area type="monotone" dataKey="users" name="New users" stroke="#fc6061" fill="url(#gUsers)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`${cardCls} p-5`}>
          <h3 className="font-display text-sm font-extrabold text-brand-primary mb-4">Users by role</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={o.roleBreakdown} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" stroke="#94a3b8" fontSize={10} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="role" stroke="#94a3b8" fontSize={9} tickLine={false} width={92} tickFormatter={roleLabel} />
                <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} formatter={(v: number) => [v, 'Users']} />
                <Bar dataKey="count" fill="#471519" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cardCls}>
          <h3 className="font-display text-sm font-extrabold text-brand-primary p-5 pb-3">Busiest companies (30 days)</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
                <th className="px-5 py-2 font-bold">Company</th>
                <th className="px-4 py-2 font-bold text-right">Users</th>
                <th className="px-4 py-2 font-bold text-right">Projects</th>
                <th className="px-5 py-2 font-bold text-right">Events</th>
              </tr>
            </thead>
            <tbody>
              {o.busiestCompanies.map((c) => (
                <tr key={c.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40">
                  <td className="px-5 py-2.5 font-bold text-brand-primary">{c.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{c.users}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{c.projects}</td>
                  <td className="px-5 py-2.5 text-right font-mono font-bold">{fmtNum(c.events30d)}</td>
                </tr>
              ))}
              {o.busiestCompanies.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-brand-on-surface-variant">No activity in the last 30 days.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={cardCls}>
          <h3 className="font-display text-sm font-extrabold text-brand-primary p-5 pb-3">Newest companies</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
                <th className="px-5 py-2 font-bold">Company</th>
                <th className="px-4 py-2 font-bold">Country</th>
                <th className="px-4 py-2 font-bold">Status</th>
                <th className="px-5 py-2 font-bold text-right">Joined</th>
              </tr>
            </thead>
            <tbody>
              {o.newestCompanies.map((c) => (
                <tr key={c.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40">
                  <td className="px-5 py-2.5 font-bold text-brand-primary">{c.name}</td>
                  <td className="px-4 py-2.5 text-brand-on-surface-variant">{c.country ?? '—'}</td>
                  <td className="px-4 py-2.5"><StatusPill status={c.status} /></td>
                  <td className="px-5 py-2.5 text-right text-brand-on-surface-variant">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── Companies ───────────────────────────────

function CompaniesTab() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [suspendTarget, setSuspendTarget] = useState<Company | null>(null);
  const [planTarget, setPlanTarget] = useState<Company | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const q = useDebounced(search);
  const pageSize = 25;

  const params = `page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(q)}&status=${status}`;
  const { data, isLoading } = useQuery({
    queryKey: ['platform-companies', q, status, page],
    queryFn: () => api.get<Company[]>(`/platform/companies?${params}`),
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const navigate = useNavigate();
  /** Enters read-only inspect mode and lands on that tenant's dashboard. */
  const openWorkspace = (c: Company) => {
    enterInspect({ id: c.id, name: c.name, slug: c.slug });
    navigate(pathForView(AppView.DASHBOARD));
  };

  const qc = useQueryClient();
  const reinstate = useMutation({
    mutationFn: (c: Company) => api.patch(`/platform/companies/${c.id}/status`, { status: 'ACTIVE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
    },
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Failed to reinstate company'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-brand-on-surface-variant text-xs">{fmtNum(total)} compan{total === 1 ? 'y' : 'ies'} on the platform</p>
        <button onClick={() => setProvisioning(true)} className={`flex items-center gap-2 ${btnCls}`}>
          <Plus className="w-4 h-4" /> New Company
        </button>
      </div>

      <Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1); }} exportPath={`/platform/companies/export?search=${encodeURIComponent(q)}&status=${status}`}>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${controlCls} w-40`}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </Toolbar>

      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
              <th className="px-4 py-3 font-bold">Company</th>
              <th className="px-4 py-3 font-bold">Plan</th>
              <th className="px-4 py-3 font-bold text-right">Users</th>
              <th className="px-4 py-3 font-bold text-right">Projects</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold">Joined</th>
              <th className="px-4 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-4 py-8 text-center text-brand-on-surface-variant">Loading companies…</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40">
                <td className="px-4 py-3">
                  <p className="font-bold text-brand-primary">{c.name}</p>
                  <p className="text-[10px] text-brand-on-surface-variant font-mono">{c.slug}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${PLAN_TONE[c.plan]}`}>{planLabel(c.plan)}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono">{quota(c._count.users, c.maxUsers)}</td>
                <td className="px-4 py-3 text-right font-mono">{quota(c._count.projects, c.maxProjects)}</td>
                <td className="px-4 py-3">
                  <StatusPill status={c.status} />
                  {c.suspendedReason && <p className="text-[10px] text-brand-on-surface-variant mt-1 max-w-[16rem] truncate" title={c.suspendedReason}>{c.suspendedReason}</p>}
                </td>
                <td className="px-4 py-3 text-brand-on-surface-variant">{fmtDate(c.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button title="Company details" onClick={() => setDetailId(c.id)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button title="Open this company's workspace (read-only)" onClick={() => openWorkspace(c)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary">
                      <LogIn className="w-3.5 h-3.5" />
                    </button>
                    <button title="Plan & limits" onClick={() => setPlanTarget(c)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary">
                      <CreditCard className="w-3.5 h-3.5" />
                    </button>
                    {c.status === 'ACTIVE' ? (
                      <button title="Suspend company" onClick={() => setSuspendTarget(c)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-status-critical">
                        <Ban className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button title="Reinstate company" disabled={reinstate.isPending} onClick={() => reinstate.mutate(c)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-emerald-600 disabled:opacity-30">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-brand-on-surface-variant">No companies match these filters.</td></tr>
            )}
          </tbody>
        </table>
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </div>

      {suspendTarget && <SuspendModal company={suspendTarget} onClose={() => setSuspendTarget(null)} />}
      {planTarget && <PlanModal company={planTarget} onClose={() => setPlanTarget(null)} />}
      {detailId && <CompanyDetailModal id={detailId} onClose={() => setDetailId(null)} />}
      {provisioning && <ProvisionModal onClose={() => setProvisioning(false)} />}
    </div>
  );
}

function ProvisionModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', country: '', currency: 'RWF', industry: '', plan: 'TRIAL' as PlanTier,
    adminFullName: '', adminEmail: '', adminPassword: '',
  });
  const mutation = useMutation({
    mutationFn: () => api.post('/platform/companies', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
      onClose();
    },
  });
  const err = mutation.error instanceof ApiError ? mutation.error.message : mutation.isError ? 'Failed to create company' : null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title="New Company" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
        <p className="text-brand-on-surface-variant text-[11px]">
          Creates the tenant and its first System Administrator. The account is pre-verified —
          hand them the password and they can sign in immediately.
        </p>
        <div><label className={labelCls}>COMPANY NAME</label><input className={inputCls} required value={form.name} onChange={set('name')} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>COUNTRY</label><input className={inputCls} value={form.country} onChange={set('country')} /></div>
          <div><label className={labelCls}>CURRENCY</label><input className={inputCls} maxLength={3} value={form.currency} onChange={set('currency')} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>INDUSTRY</label><input className={inputCls} value={form.industry} onChange={set('industry')} /></div>
          <div>
            <label className={labelCls}>PLAN</label>
            <select className={inputCls} value={form.plan} onChange={set('plan')}>
              {PLAN_TIERS.map((p) => <option key={p} value={p}>{planLabel(p)}</option>)}
            </select>
          </div>
        </div>
        <div className="h-[1px] bg-brand-outline-variant/30 my-1" />
        <div><label className={labelCls}>ADMIN FULL NAME</label><input className={inputCls} required value={form.adminFullName} onChange={set('adminFullName')} /></div>
        <div><label className={labelCls}>ADMIN EMAIL</label><input className={inputCls} type="email" required value={form.adminEmail} onChange={set('adminEmail')} /></div>
        <div><label className={labelCls}>TEMPORARY PASSWORD</label><input className={inputCls} type="text" required minLength={8} placeholder="Min. 8 characters" value={form.adminPassword} onChange={set('adminPassword')} /></div>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={mutation.isPending} className={`w-full h-11 ${btnCls}`}>
          {mutation.isPending ? 'Creating…' : 'Create Company'}
        </button>
      </form>
    </Modal>
  );
}

function PlanModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const qc = useQueryClient();
  const [plan, setPlan] = useState<PlanTier>(company.plan);
  // Empty string means "unlimited" — sent as null.
  const [maxUsers, setMaxUsers] = useState(company.maxUsers?.toString() ?? '');
  const [maxProjects, setMaxProjects] = useState(company.maxProjects?.toString() ?? '');
  const [touched, setTouched] = useState(false);

  const { data: plans } = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api.get<{ plans: { plan: PlanTier; label: string; maxUsers: number | null; maxProjects: number | null }[] }>('/platform/plans'),
  });

  // Switching tier pre-fills that tier's defaults until the admin overrides them.
  const choosePlan = (next: PlanTier) => {
    setPlan(next);
    if (!touched) {
      const d = plans?.data.plans.find((p) => p.plan === next);
      if (d) {
        setMaxUsers(d.maxUsers?.toString() ?? '');
        setMaxProjects(d.maxProjects?.toString() ?? '');
      }
    }
  };

  const mutation = useMutation({
    mutationFn: () => api.patch(`/platform/companies/${company.id}/plan`, {
      plan,
      maxUsers: maxUsers.trim() === '' ? null : Number(maxUsers),
      maxProjects: maxProjects.trim() === '' ? null : Number(maxProjects),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-companies'] });
      onClose();
    },
  });
  const err = mutation.error instanceof ApiError ? mutation.error.message : mutation.isError ? 'Failed to update plan' : null;

  return (
    <Modal title={`Plan & limits — ${company.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className={`${cardCls} p-3`}>
            <p className={labelCls}>USERS</p>
            <p className="font-mono text-lg font-extrabold text-brand-primary">{quota(company._count.users, company.maxUsers)}</p>
          </div>
          <div className={`${cardCls} p-3`}>
            <p className={labelCls}>PROJECTS</p>
            <p className="font-mono text-lg font-extrabold text-brand-primary">{quota(company._count.projects, company.maxProjects)}</p>
          </div>
        </div>
        <div>
          <label className={labelCls}>PLAN</label>
          <select className={inputCls} value={plan} onChange={(e) => choosePlan(e.target.value as PlanTier)}>
            {PLAN_TIERS.map((p) => <option key={p} value={p}>{planLabel(p)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>MAX USERS</label>
            <input className={inputCls} type="number" min={0} placeholder="Unlimited"
              value={maxUsers} onChange={(e) => { setTouched(true); setMaxUsers(e.target.value); }} />
          </div>
          <div>
            <label className={labelCls}>MAX PROJECTS</label>
            <input className={inputCls} type="number" min={0} placeholder="Unlimited"
              value={maxProjects} onChange={(e) => { setTouched(true); setMaxProjects(e.target.value); }} />
          </div>
        </div>
        <p className="text-brand-on-surface-variant text-[10px]">Leave a limit empty for unlimited. Limits are enforced when the tenant creates records.</p>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={mutation.isPending} className={`w-full h-11 ${btnCls}`}>
          {mutation.isPending ? 'Saving…' : 'Save Plan'}
        </button>
      </form>
    </Modal>
  );
}

function SuspendModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.patch(`/platform/companies/${company.id}/status`, { status: 'SUSPENDED', reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
      onClose();
    },
  });
  const err = mutation.error instanceof ApiError ? mutation.error.message : mutation.isError ? 'Failed to suspend company' : null;

  return (
    <Modal title={`Suspend ${company.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
        <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-700 leading-relaxed">
            All <strong>{company._count.users}</strong> user{company._count.users === 1 ? '' : 's'} in this company will be signed out
            immediately and blocked from signing in until you reinstate it. Their data is preserved.
          </p>
        </div>
        <div>
          <label className={labelCls}>REASON (RECORDED IN THE AUDIT TRAIL)</label>
          <textarea className={`${inputCls} h-20 py-2 resize-none`} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Non-payment of subscription" />
        </div>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={mutation.isPending} className="w-full h-11 bg-brand-status-critical text-white font-bold text-xs rounded-lg hover:opacity-90 transition-all disabled:opacity-60">
          {mutation.isPending ? 'Suspending…' : 'Suspend Company'}
        </button>
      </form>
    </Modal>
  );
}

function CompanyDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['platform-company', id],
    queryFn: () => api.get<CompanyDetail>(`/platform/companies/${id}`),
  });
  const c = data?.data;

  return (
    <Modal title={c?.name ?? 'Company'} onClose={onClose} wide>
      {isLoading || !c ? (
        <p className="text-brand-on-surface-variant text-xs">Loading company…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={c.status} />
            <span className="text-[11px] text-brand-on-surface-variant font-mono">{c.slug}</span>
            {c.suspendedAt && (
              <span className="text-[11px] text-brand-status-critical font-semibold">
                Suspended {fmtDate(c.suspendedAt)} — {c.suspendedReason}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Users" value={c._count.users} />
            <Kpi label="Projects" value={c._count.projects} />
            <Kpi label="Clients" value={c._count.clients} />
            <Kpi label="Contracts" value={c._count.contracts} />
          </div>

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
            {([['Legal name', c.legalName], ['Industry', c.industry], ['Country', c.country], ['Currency', c.currency], ['Phone', c.phone], ['TIN', c.tinNumber], ['Joined', fmtDate(c.createdAt)]] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-brand-outline-variant/10 py-1.5">
                <span className="text-brand-on-surface-variant">{k}</span>
                <span className="font-semibold text-brand-primary">{v || '—'}</span>
              </div>
            ))}
          </div>

          <div>
            <h4 className="font-display text-xs font-extrabold text-brand-primary mb-2">Users ({c.users.length})</h4>
            <div className="border border-brand-outline-variant/20 rounded-lg overflow-x-auto max-h-56 overflow-y-auto custom-scrollbar">
              <table className="w-full text-xs">
                <tbody>
                  {c.users.map((u) => (
                    <tr key={u.id} className="border-b border-brand-outline-variant/10 last:border-0">
                      <td className="px-3 py-2 font-bold text-brand-primary">{u.fullName}</td>
                      <td className="px-3 py-2 text-brand-on-surface-variant">{u.email}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ROLE_TONE[u.role] ?? ''}`}>{roleLabel(u.role)}</span></td>
                      <td className="px-3 py-2 text-right text-brand-on-surface-variant">{u.isActive ? 'Active' : 'Blocked'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="font-display text-xs font-extrabold text-brand-primary mb-2">Recent activity</h4>
            <div className="border border-brand-outline-variant/20 rounded-lg max-h-56 overflow-y-auto custom-scrollbar">
              <table className="w-full text-xs">
                <tbody>
                  {c.recentActivity.map((a) => (
                    <tr key={a.id} className="border-b border-brand-outline-variant/10 last:border-0">
                      <td className="px-3 py-2 font-mono text-[10px] text-brand-on-surface-variant whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
                      <td className="px-3 py-2 font-bold text-brand-primary">{a.action}</td>
                      <td className="px-3 py-2 text-brand-on-surface-variant">{a.entity}</td>
                      <td className="px-3 py-2 text-right text-brand-on-surface-variant">{a.user?.email ?? '—'}</td>
                    </tr>
                  ))}
                  {c.recentActivity.length === 0 && (
                    <tr><td className="px-3 py-4 text-center text-brand-on-surface-variant">No recorded activity.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ───────────────────────────── Cross-org users ─────────────────────────────

function UsersTab() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [roleTarget, setRoleTarget] = useState<PlatformUserRow | null>(null);
  const [pwTarget, setPwTarget] = useState<PlatformUserRow | null>(null);
  const q = useDebounced(search);
  const pageSize = 25;

  const filters = `search=${encodeURIComponent(q)}&role=${role}&status=${status}`;
  const { data, isLoading } = useQuery({
    queryKey: ['platform-users', q, role, status, page],
    queryFn: () => api.get<PlatformUserRow[]>(`/platform/users?page=${page}&pageSize=${pageSize}&${filters}`),
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const toggleBlock = useMutation({
    mutationFn: (u: PlatformUserRow) => api.patch(`/platform/users/${u.id}/status`, { isActive: !u.isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
    },
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Failed to update user'),
  });

  return (
    <div>
      <Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1); }} exportPath={`/platform/users/export?${filters}`}>
        <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className={`${controlCls} w-44`}>
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${controlCls} w-36`}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
        </select>
      </Toolbar>

      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
              <th className="px-4 py-3 font-bold">Name</th>
              <th className="px-4 py-3 font-bold">Company</th>
              <th className="px-4 py-3 font-bold">Role</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold">Last Login</th>
              <th className="px-4 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-on-surface-variant">Loading users…</td></tr>}
            {rows.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40">
                  <td className="px-4 py-3">
                    <p className="font-bold text-brand-primary">
                      {u.fullName}{isSelf && <span className="ml-2 text-[9px] font-bold text-brand-on-surface-variant">(you)</span>}
                    </p>
                    <p className="text-[10px] text-brand-on-surface-variant">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-brand-on-surface-variant">{u.organization?.name ?? '—'}</p>
                    {u.organization?.status === 'SUSPENDED' && <span className="text-[10px] font-bold text-brand-status-critical">company suspended</span>}
                  </td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${ROLE_TONE[u.role] ?? ''}`}>{roleLabel(u.role)}</span></td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {u.isActive ? 'Active' : 'Blocked'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-brand-on-surface-variant">{fmtDate(u.lastLoginAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button title="Change role" disabled={isSelf} onClick={() => setRoleTarget(u)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary disabled:opacity-30 disabled:cursor-not-allowed">
                        <ShieldCheck className="w-3.5 h-3.5" />
                      </button>
                      <button title="Reset password" disabled={isSelf} onClick={() => setPwTarget(u)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary disabled:opacity-30 disabled:cursor-not-allowed">
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title={u.isActive ? 'Block user' : 'Unblock user'}
                        disabled={isSelf || toggleBlock.isPending}
                        onClick={() => toggleBlock.mutate(u)}
                        className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {u.isActive ? <Ban className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-on-surface-variant">No users match these filters.</td></tr>
            )}
          </tbody>
        </table>
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </div>

      {roleTarget && <ChangeRoleModal user={roleTarget} onClose={() => setRoleTarget(null)} />}
      {pwTarget && <ResetPasswordModal user={pwTarget} onClose={() => setPwTarget(null)} />}
    </div>
  );
}

function ChangeRoleModal({ user, onClose }: { user: PlatformUserRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState(user.role);
  const mutation = useMutation({
    mutationFn: () => api.patch(`/platform/users/${user.id}/role`, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
      onClose();
    },
  });
  const err = mutation.error instanceof ApiError ? mutation.error.message : mutation.isError ? 'Failed to change role' : null;

  return (
    <Modal title={`Change role — ${user.fullName}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
        <p className="text-brand-on-surface-variant text-[11px]">
          {user.email} · {user.organization?.name}
        </p>
        <div>
          <label className={labelCls}>ROLE</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>
        {role === 'PLATFORM_ADMIN' && user.role !== 'PLATFORM_ADMIN' && (
          <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 leading-relaxed">
              This grants access to <strong>every company</strong> on the platform, including the ability to suspend tenants and block users.
            </p>
          </div>
        )}
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={mutation.isPending || role === user.role} className={`w-full h-11 ${btnCls}`}>
          {mutation.isPending ? 'Saving…' : 'Change Role'}
        </button>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: PlatformUserRow; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.post(`/platform/users/${user.id}/reset-password`, { password }),
    onSuccess: onClose,
  });
  const err = mutation.error instanceof ApiError ? mutation.error.message : mutation.isError ? 'Failed to reset password' : null;

  return (
    <Modal title={`Reset password — ${user.fullName}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
        <p className="text-brand-on-surface-variant text-[11px]">
          Set a new password for <strong>{user.email}</strong> ({user.organization?.name}). Every active session is signed out.
        </p>
        <div>
          <label className={labelCls}>NEW PASSWORD</label>
          <input className={inputCls} type="text" required minLength={8} placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={mutation.isPending} className={`w-full h-11 ${btnCls}`}>
          {mutation.isPending ? 'Resetting…' : 'Reset Password'}
        </button>
      </form>
    </Modal>
  );
}

// ─────────────────────────── Cross-org audit trail ───────────────────────────

const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT'];

const ACTION_TONE: Record<string, string> = {
  CREATE: 'bg-emerald-100 text-emerald-700',
  UPDATE: 'bg-sky-100 text-sky-700',
  DELETE: 'bg-red-100 text-red-700',
  LOGIN: 'bg-brand-surface text-brand-on-surface-variant',
  LOGOUT: 'bg-brand-surface text-brand-on-surface-variant',
  APPROVE: 'bg-emerald-100 text-emerald-700',
  REJECT: 'bg-amber-100 text-amber-700',
};

function AuditTab() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const debouncedEntity = useDebounced(entity);
  const pageSize = 50;

  const filters = `action=${action}&entity=${encodeURIComponent(debouncedEntity)}&dateFrom=${dateFrom}&dateTo=${dateTo}`;
  const { data, isLoading } = useQuery({
    queryKey: ['platform-audit', action, debouncedEntity, dateFrom, dateTo, page],
    queryFn: () => api.get<AuditRow[]>(`/platform/audit?page=${page}&pageSize=${pageSize}&${filters}`),
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} placeholder="Entity (e.g. user)" className={`${controlCls} w-44`} />
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className={`${controlCls} w-40`}>
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div><label className={labelCls}>FROM</label><input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className={`${controlCls} w-40`} /></div>
        <div><label className={labelCls}>TO</label><input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className={`${controlCls} w-40`} /></div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => api.download(`/platform/audit/export?${filters}&format=csv`, 'platform-audit.csv')} className="flex items-center gap-1.5 text-xs font-bold text-brand-on-surface-variant hover:text-brand-primary px-3 py-2 rounded-lg hover:bg-brand-surface transition-all">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => api.download(`/platform/audit/export?${filters}&format=xlsx`, 'platform-audit.xlsx')} className="flex items-center gap-1.5 text-xs font-bold text-brand-on-surface-variant hover:text-brand-primary px-3 py-2 rounded-lg hover:bg-brand-surface transition-all">
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
      </div>

      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
              <th className="px-4 py-3 font-bold">When</th>
              <th className="px-4 py-3 font-bold">Company</th>
              <th className="px-4 py-3 font-bold">Actor</th>
              <th className="px-4 py-3 font-bold">Action</th>
              <th className="px-4 py-3 font-bold">Entity</th>
              <th className="px-4 py-3 font-bold">IP</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-on-surface-variant">Loading audit trail…</td></tr>}
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40">
                <td className="px-4 py-3 font-mono text-[10px] text-brand-on-surface-variant whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
                <td className="px-4 py-3 font-bold text-brand-primary">{a.organization?.name ?? '—'}</td>
                <td className="px-4 py-3 text-brand-on-surface-variant">{a.user?.email ?? '(deleted user)'}</td>
                <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${ACTION_TONE[a.action] ?? ''}`}>{a.action}</span></td>
                <td className="px-4 py-3 text-brand-on-surface-variant font-mono text-[10px]">{a.entity}{a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ''}</td>
                <td className="px-4 py-3 text-brand-on-surface-variant font-mono text-[10px]">{a.ipAddress ?? '—'}</td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-on-surface-variant">No audit events match these filters.</td></tr>
            )}
          </tbody>
        </table>
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ────────────────── Cross-tenant projects register ──────────────────

interface PlatformProject {
  id: string;
  code: string;
  name: string;
  location: string | null;
  status: string;
  health: 'OPTIMAL' | 'WARNING' | 'CRITICAL';
  budget: string;
  currency: string;
  progressPct: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  organization: { id: string; name: string; slug: string; status: OrgStatus };
  client: { id: string; name: string } | null;
  manager: { id: string; fullName: string } | null;
}

interface ProjectTotals {
  count: number;
  totalBudget: number;
  avgProgress: number;
  byStatus: { status: string; count: number }[];
  byHealth: { health: string; count: number }[];
}

const HEALTH_TONE: Record<string, string> = {
  OPTIMAL: 'bg-emerald-100 text-emerald-700',
  WARNING: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'AT_RISK', 'COMPLETED', 'CANCELLED'];

const money = (v: number | string, currency = 'RWF') =>
  `${currency} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const compact = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v));

/** Enters read-only inspect mode on a tenant and deep-links to a record. */
function useOpenInTenant() {
  const navigate = useNavigate();
  return (org: { id: string; name: string; slug: string }, path: string) => {
    enterInspect({ id: org.id, name: org.name, slug: org.slug });
    navigate(path);
  };
}

/** Companies dropdown shared by the cross-tenant filters. */
function useCompanyOptions() {
  const { data } = useQuery({
    queryKey: ['platform-company-options'],
    queryFn: () => api.get<Company[]>('/platform/companies?pageSize=200'),
  });
  return data?.data ?? [];
}

function ProjectsTab() {
  const [search, setSearch] = useState('');
  const [org, setOrg] = useState('');
  const [status, setStatus] = useState('');
  const [health, setHealth] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const pageSize = 25;
  const companies = useCompanyOptions();
  const openInTenant = useOpenInTenant();

  const filters = `search=${encodeURIComponent(q)}&organizationId=${org}&status=${status}&health=${health}`;
  const { data, isLoading } = useQuery({
    queryKey: ['platform-projects', q, org, status, health, page],
    queryFn: () => api.get<PlatformProject[]>(`/platform/projects?page=${page}&pageSize=${pageSize}&${filters}`),
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totals = (data?.meta as { totals?: ProjectTotals } | undefined)?.totals;

  return (
    <div>
      {totals && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-5">
          <Kpi label="Projects" value={totals.count} hint="matching these filters" />
          <Kpi label="Contract Value" value={compact(totals.totalBudget)} hint="across all tenants" />
          <Kpi label="Avg Progress" value={`${totals.avgProgress}%`} />
          <Kpi
            label="Critical"
            value={totals.byHealth.find((h) => h.health === 'CRITICAL')?.count ?? 0}
            tone={(totals.byHealth.find((h) => h.health === 'CRITICAL')?.count ?? 0) > 0 ? 'critical' : undefined}
            hint="health = critical"
          />
        </div>
      )}

      <Toolbar search={search} onSearch={(v) => { setSearch(v); setPage(1); }} exportPath={`/platform/projects/export?${filters}`}>
        <select value={org} onChange={(e) => { setOrg(e.target.value); setPage(1); }} className={`${controlCls} w-48`}>
          <option value="">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${controlCls} w-36`}>
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={health} onChange={(e) => { setHealth(e.target.value); setPage(1); }} className={`${controlCls} w-36`}>
          <option value="">All health</option>
          {['OPTIMAL', 'WARNING', 'CRITICAL'].map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      </Toolbar>

      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
              <th className="px-4 py-3 font-bold">Company</th>
              <th className="px-4 py-3 font-bold">Project</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold">Health</th>
              <th className="px-4 py-3 font-bold text-right">Contract Value</th>
              <th className="px-4 py-3 font-bold text-right">Progress</th>
              <th className="px-4 py-3 font-bold">Finish</th>
              <th className="px-4 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="px-4 py-8 text-center text-brand-on-surface-variant">Loading projects…</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40">
                <td className="px-4 py-3 text-brand-on-surface-variant">{p.organization.name}</td>
                <td className="px-4 py-3">
                  <p className="font-bold text-brand-primary">{p.name}</p>
                  <p className="text-[10px] text-brand-on-surface-variant font-mono">{p.code}{p.location ? ` · ${p.location}` : ''}</p>
                </td>
                <td className="px-4 py-3"><span className="px-2 py-1 rounded-full text-[10px] font-bold bg-brand-surface text-brand-on-surface-variant">{p.status.replace('_', ' ')}</span></td>
                <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${HEALTH_TONE[p.health] ?? ''}`}>{p.health}</span></td>
                <td className="px-4 py-3 text-right font-mono">{money(p.budget, p.currency)}</td>
                <td className="px-4 py-3 text-right font-mono">{Number(p.progressPct).toFixed(1)}%</td>
                <td className="px-4 py-3 text-brand-on-surface-variant">{fmtDate(p.endDate)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    title="Open in its company (read-only)"
                    onClick={() => openInTenant(p.organization, `/planning?projectId=${p.id}`)}
                    className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-brand-on-surface-variant">No projects match these filters.</td></tr>
            )}
          </tbody>
        </table>
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ───────────────────────── Delivery watchlist ─────────────────────────

interface Watchlist {
  counts: Record<string, number>;
  criticalProjects: { id: string; code: string; name: string; status: string; health: string; progressPct: number; endDate: string | null; organization: WlOrg }[];
  overdueProjects: { id: string; code: string; name: string; endDate: string | null; progressPct: number; organization: WlOrg }[];
  overBudgetProjects: { id: string; code: string; name: string; budget: number; spent: number; utilisationPct: number; organization: WlOrg }[];
  criticalRisks: { id: string; title: string; score: number; status: string; category: string; project: WlProject }[];
  openNcrs: { id: string; number: string; description: string; severity: string; status: string; dueDate: string | null; project: WlProject }[];
  seriousIncidents: { id: string; type: string; severity: string; description: string; date: string; project: WlProject }[];
}
interface WlOrg { id: string; name: string; slug: string }
interface WlProject { id: string; code: string; name: string; organization: WlOrg }

function WatchCard({ title, count, tone, children }: { title: string; count: number; tone?: string; children: React.ReactNode }) {
  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between p-4 pb-2">
        <h3 className="font-display text-sm font-extrabold text-brand-primary">{title}</h3>
        <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${count > 0 ? tone ?? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {count}
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto custom-scrollbar">
        {count === 0
          ? <p className="px-4 py-6 text-center text-brand-on-surface-variant text-xs">Nothing to action. </p>
          : children}
      </div>
    </div>
  );
}

function WatchRow({ org, primary, secondary, right, onOpen }: {
  org: WlOrg; primary: string; secondary: string; right?: string; onOpen: () => void;
}) {
  return (
    <button onClick={onOpen} className="w-full text-left px-4 py-2.5 border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40 flex items-center gap-3">
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-bold text-brand-primary truncate">{primary}</span>
        <span className="block text-[10px] text-brand-on-surface-variant truncate">{org.name} · {secondary}</span>
      </span>
      {right && <span className="font-mono text-[11px] font-bold text-brand-status-critical shrink-0">{right}</span>}
      <LogIn className="w-3.5 h-3.5 text-brand-on-surface-variant shrink-0" />
    </button>
  );
}

function WatchlistTab() {
  const openInTenant = useOpenInTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['platform-watchlist'],
    queryFn: () => api.get<Watchlist>('/platform/watchlist'),
    refetchInterval: 60_000,
  });
  const w = data?.data;
  if (isLoading || !w) return <p className="text-brand-on-surface-variant text-xs">Loading watchlist…</p>;

  const proj = (p: { id: string; organization: WlOrg }) => () => openInTenant(p.organization, `/planning?projectId=${p.id}`);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
        <Kpi label="Critical" value={w.counts.criticalProjects} tone={w.counts.criticalProjects ? 'critical' : undefined} hint="projects" />
        <Kpi label="Overdue" value={w.counts.overdueProjects} tone={w.counts.overdueProjects ? 'warning' : undefined} hint="past finish date" />
        <Kpi label="Over Budget" value={w.counts.overBudgetProjects} tone={w.counts.overBudgetProjects ? 'critical' : undefined} hint="cost > budget" />
        <Kpi label="Critical Risks" value={w.counts.criticalRisks} tone={w.counts.criticalRisks ? 'critical' : undefined} hint="score ≥ 15" />
        <Kpi label="Open NCRs" value={w.counts.openNcrs} tone={w.counts.openNcrs ? 'warning' : undefined} hint="quality" />
        <Kpi label="Incidents" value={w.counts.seriousIncidents30d} tone={w.counts.seriousIncidents30d ? 'critical' : undefined} hint="high+ · 30d" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WatchCard title="Critical & at-risk projects" count={w.criticalProjects.length}>
          {w.criticalProjects.map((p) => (
            <WatchRow key={p.id} org={p.organization} primary={`${p.code} — ${p.name}`}
              secondary={`${p.status.replace('_', ' ')} · ${Number(p.progressPct).toFixed(0)}% done`}
              right={p.health} onOpen={proj(p)} />
          ))}
        </WatchCard>

        <WatchCard title="Overdue projects" count={w.overdueProjects.length} tone="bg-amber-100 text-amber-700">
          {w.overdueProjects.map((p) => (
            <WatchRow key={p.id} org={p.organization} primary={`${p.code} — ${p.name}`}
              secondary={`due ${fmtDate(p.endDate)} · ${Number(p.progressPct).toFixed(0)}% done`} onOpen={proj(p)} />
          ))}
        </WatchCard>

        <WatchCard title="Over budget" count={w.overBudgetProjects.length}>
          {w.overBudgetProjects.map((p) => (
            <WatchRow key={p.id} org={p.organization} primary={`${p.code} — ${p.name}`}
              secondary={`spent ${compact(p.spent)} of ${compact(p.budget)}`}
              right={`${p.utilisationPct}%`} onOpen={proj(p)} />
          ))}
        </WatchCard>

        <WatchCard title="Critical risks" count={w.criticalRisks.length}>
          {w.criticalRisks.map((r) => (
            <WatchRow key={r.id} org={r.project.organization} primary={r.title}
              secondary={`${r.project.code} · ${r.category} · ${r.status}`}
              right={`score ${r.score}`}
              onOpen={() => openInTenant(r.project.organization, `/risk?projectId=${r.project.id}`)} />
          ))}
        </WatchCard>

        <WatchCard title="Open NCRs" count={w.openNcrs.length} tone="bg-amber-100 text-amber-700">
          {w.openNcrs.map((n) => (
            <WatchRow key={n.id} org={n.project.organization} primary={`${n.number} — ${n.description.slice(0, 60)}`}
              secondary={`${n.project.code} · ${n.status.replace('_', ' ')}`} right={n.severity}
              onOpen={() => openInTenant(n.project.organization, `/qaqc?projectId=${n.project.id}`)} />
          ))}
        </WatchCard>

        <WatchCard title="Serious incidents (30 days)" count={w.seriousIncidents.length}>
          {w.seriousIncidents.map((i) => (
            <WatchRow key={i.id} org={i.project.organization} primary={i.description.slice(0, 70)}
              secondary={`${i.project.code} · ${i.type.replace('_', ' ')} · ${fmtDate(i.date)}`} right={i.severity}
              onOpen={() => openInTenant(i.project.organization, `/hse?projectId=${i.project.id}`)} />
          ))}
        </WatchCard>
      </div>
    </div>
  );
}

// ───────────────────────── Finance overview ─────────────────────────

interface FinanceRow {
  id: string; name: string; slug: string; currency: string; status: OrgStatus;
  contracts: number; invoices: number;
  contracted: number; invoiced: number; collected: number; outstanding: number; collectionRate: number;
}
interface FinanceData {
  totals: { contracted: number; invoiced: number; collected: number; outstanding: number;
    ageing: { current: number; d30: number; d60: number; d90: number; over90: number } };
  companies: FinanceRow[];
}

const AGEING_LABELS: [keyof FinanceData['totals']['ageing'], string][] = [
  ['current', 'Not yet due'], ['d30', '1–30 days'], ['d60', '31–60 days'], ['d90', '61–90 days'], ['over90', '90+ days'],
];

function FinanceTab() {
  const openInTenant = useOpenInTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['platform-finance'],
    queryFn: () => api.get<FinanceData>('/platform/finance'),
  });
  const f = data?.data;
  if (isLoading || !f) return <p className="text-brand-on-surface-variant text-xs">Loading finance overview…</p>;

  const chart = f.companies.slice(0, 8).map((c) => ({
    name: c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name,
    Invoiced: c.invoiced, Collected: c.collected,
  }));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Kpi label="Contracted" value={compact(f.totals.contracted)} hint="signed contract value" />
        <Kpi label="Invoiced" value={compact(f.totals.invoiced)} />
        <Kpi label="Collected" value={compact(f.totals.collected)} />
        <Kpi label="Outstanding" value={compact(f.totals.outstanding)} tone={f.totals.outstanding > 0 ? 'warning' : undefined} hint="invoiced − collected" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${cardCls} p-5 lg:col-span-2`}>
          <h3 className="font-display text-sm font-extrabold text-brand-primary mb-4">Invoiced vs collected — top tenants</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} tickFormatter={(v: number) => compact(v)} />
                <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} formatter={(v: number) => compact(v)} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="Invoiced" fill="#471519" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Collected" fill="#fc6061" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`${cardCls} p-5`}>
          <h3 className="font-display text-sm font-extrabold text-brand-primary mb-1">Receivables ageing</h3>
          <p className="text-brand-on-surface-variant text-[10px] mb-4">Unpaid invoices across every tenant, by age past due.</p>
          <div className="space-y-3">
            {AGEING_LABELS.map(([key, label]) => {
              const value = f.totals.ageing[key];
              const max = Math.max(...AGEING_LABELS.map(([k]) => f.totals.ageing[k]), 1);
              const overdue = key !== 'current';
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-brand-on-surface-variant font-semibold">{label}</span>
                    <span className="font-mono font-bold text-brand-primary">{compact(value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-brand-surface overflow-hidden">
                    <div
                      className={`h-full rounded-full ${overdue ? 'bg-brand-secondary-container' : 'bg-brand-primary'}`}
                      style={{ width: `${(value / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={`${cardCls} overflow-x-auto`}>
        <div className="flex items-center justify-between p-4">
          <h3 className="font-display text-sm font-extrabold text-brand-primary">By company</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => api.download('/platform/finance/export?format=csv', 'platform-finance.csv')} className="flex items-center gap-1.5 text-xs font-bold text-brand-on-surface-variant hover:text-brand-primary px-3 py-2 rounded-lg hover:bg-brand-surface">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={() => api.download('/platform/finance/export?format=xlsx', 'platform-finance.xlsx')} className="flex items-center gap-1.5 text-xs font-bold text-brand-on-surface-variant hover:text-brand-primary px-3 py-2 rounded-lg hover:bg-brand-surface">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
              <th className="px-4 py-3 font-bold">Company</th>
              <th className="px-4 py-3 font-bold text-right">Contracted</th>
              <th className="px-4 py-3 font-bold text-right">Invoiced</th>
              <th className="px-4 py-3 font-bold text-right">Collected</th>
              <th className="px-4 py-3 font-bold text-right">Outstanding</th>
              <th className="px-4 py-3 font-bold text-right">Collected %</th>
              <th className="px-4 py-3 font-bold text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {f.companies.map((c) => (
              <tr key={c.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40">
                <td className="px-4 py-3 font-bold text-brand-primary">{c.name}</td>
                <td className="px-4 py-3 text-right font-mono">{compact(c.contracted)}</td>
                <td className="px-4 py-3 text-right font-mono">{compact(c.invoiced)}</td>
                <td className="px-4 py-3 text-right font-mono">{compact(c.collected)}</td>
                <td className={`px-4 py-3 text-right font-mono ${c.outstanding > 0 ? 'text-brand-status-critical font-bold' : ''}`}>{compact(c.outstanding)}</td>
                <td className="px-4 py-3 text-right font-mono">{c.collectionRate}%</td>
                <td className="px-4 py-3 text-right">
                  <button title="Open finance in this company" onClick={() => openInTenant(c, '/finance')} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary">
                    <LogIn className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────── Adoption & engagement ─────────────────────────

interface AdoptionCompany {
  id: string; name: string; slug: string; status: OrgStatus; plan: PlanTier;
  users: number; createdAt: string; lastActiveAt: string | null; dormant: boolean;
  modulesUsed: number; totalModules: number; records: number;
  modules: Record<string, number>;
}
interface AdoptionData {
  moduleLabels: { key: string; label: string }[];
  dormantAfterDays: number;
  companies: AdoptionCompany[];
}

function AdoptionTab() {
  const openInTenant = useOpenInTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['platform-adoption'],
    queryFn: () => api.get<AdoptionData>('/platform/adoption'),
  });
  const a = data?.data;
  if (isLoading || !a) return <p className="text-brand-on-surface-variant text-xs">Loading adoption report…</p>;

  const dormant = a.companies.filter((c) => c.dormant).length;
  const avgModules = a.companies.length
    ? (a.companies.reduce((s, c) => s + c.modulesUsed, 0) / a.companies.length).toFixed(1)
    : '0';

  return (
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Kpi label="Companies" value={a.companies.length} />
        <Kpi label="Dormant" value={dormant} tone={dormant ? 'warning' : undefined} hint={`no activity in ${a.dormantAfterDays} days`} />
        <Kpi label="Avg Modules Used" value={`${avgModules} / ${a.companies[0]?.totalModules ?? 0}`} />
        <Kpi label="Total Records" value={compact(a.companies.reduce((s, c) => s + c.records, 0))} hint="across all modules" />
      </div>

      <div className={`${cardCls} overflow-x-auto`}>
        <div className="flex items-center justify-between p-4">
          <div>
            <h3 className="font-display text-sm font-extrabold text-brand-primary">Module adoption</h3>
            <p className="text-brand-on-surface-variant text-[10px]">Records created per module. Dormant tenants are listed first.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => api.download('/platform/adoption/export?format=csv', 'platform-adoption.csv')} className="flex items-center gap-1.5 text-xs font-bold text-brand-on-surface-variant hover:text-brand-primary px-3 py-2 rounded-lg hover:bg-brand-surface">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={() => api.download('/platform/adoption/export?format=xlsx', 'platform-adoption.xlsx')} className="flex items-center gap-1.5 text-xs font-bold text-brand-on-surface-variant hover:text-brand-primary px-3 py-2 rounded-lg hover:bg-brand-surface">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
              <th className="px-4 py-3 font-bold sticky left-0 bg-brand-surface-container-lowest">Company</th>
              <th className="px-3 py-3 font-bold">Last active</th>
              <th className="px-3 py-3 font-bold text-right">Modules</th>
              {a.moduleLabels.map((m) => (
                <th key={m.key} className="px-2 py-3 font-bold text-right whitespace-nowrap">{m.label}</th>
              ))}
              <th className="px-3 py-3 font-bold text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {a.companies.map((c) => (
              <tr key={c.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40">
                <td className="px-4 py-3 sticky left-0 bg-brand-surface-container-lowest">
                  <p className="font-bold text-brand-primary flex items-center gap-2">
                    {c.name}
                    {c.dormant && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700">Dormant</span>}
                  </p>
                  <p className="text-[10px] text-brand-on-surface-variant">{planLabel(c.plan)} · {c.users} user{c.users === 1 ? '' : 's'}</p>
                </td>
                <td className="px-3 py-3 text-brand-on-surface-variant whitespace-nowrap">{fmtDate(c.lastActiveAt)}</td>
                <td className="px-3 py-3 text-right font-mono font-bold">{c.modulesUsed}/{c.totalModules}</td>
                {a.moduleLabels.map((m) => {
                  const n = c.modules[m.key] ?? 0;
                  return (
                    <td key={m.key} className={`px-2 py-3 text-right font-mono ${n === 0 ? 'text-brand-outline-variant' : 'text-brand-on-surface'}`}>
                      {n === 0 ? '—' : n}
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-right">
                  <button title="Open this company (read-only)" onClick={() => openInTenant(c, '/dashboard')} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary">
                    <LogIn className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────── Settings & announcements ─────────────────────

interface PlatformSettings {
  allowSelfSignup: boolean;
  defaultCurrency: string;
  defaultTimezone: string | null;
  supportEmail: string | null;
  maintenanceMessage: string | null;
  updatedAt: string;
}

function SettingsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['platform-settings'],
    queryFn: () => api.get<PlatformSettings>('/platform/settings'),
  });
  const settings = data?.data;

  const [form, setForm] = useState<PlatformSettings | null>(null);
  const [saved, setSaved] = useState(false);
  React.useEffect(() => { if (settings) setForm(settings); }, [settings]);

  const save = useMutation({
    mutationFn: () => api.put('/platform/settings', {
      allowSelfSignup: form?.allowSelfSignup,
      defaultCurrency: form?.defaultCurrency,
      defaultTimezone: form?.defaultTimezone || null,
      supportEmail: form?.supportEmail || null,
      maintenanceMessage: form?.maintenanceMessage || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });
  const err = save.error instanceof ApiError ? save.error.message : save.isError ? 'Failed to save settings' : null;

  if (isLoading || !form) return <p className="text-brand-on-surface-variant text-xs">Loading platform settings…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className={`${cardCls} p-5 space-y-4`}>
        <h3 className="font-display text-sm font-extrabold text-brand-primary">Global settings</h3>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.allowSelfSignup}
            onChange={(e) => setForm({ ...form, allowSelfSignup: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-brand-secondary-container"
          />
          <span>
            <span className="text-xs font-bold text-brand-primary block">Allow self-service signup</span>
            <span className="text-[11px] text-brand-on-surface-variant">
              When off, /signup is closed and companies exist only when you provision them here.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>DEFAULT CURRENCY</label>
            <input className={inputCls} maxLength={3} value={form.defaultCurrency}
              onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value.toUpperCase() })} />
          </div>
          <div>
            <label className={labelCls}>DEFAULT TIMEZONE</label>
            <input className={inputCls} value={form.defaultTimezone ?? ''} placeholder="Africa/Kigali"
              onChange={(e) => setForm({ ...form, defaultTimezone: e.target.value })} />
          </div>
        </div>

        <div>
          <label className={labelCls}>SUPPORT EMAIL</label>
          <input className={inputCls} type="email" value={form.supportEmail ?? ''}
            onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} />
        </div>

        <div>
          <label className={labelCls}>MAINTENANCE BANNER</label>
          <textarea className={`${inputCls} h-20 py-2 resize-none`} value={form.maintenanceMessage ?? ''}
            placeholder="Leave empty for no banner"
            onChange={(e) => setForm({ ...form, maintenanceMessage: e.target.value })} />
          <p className="text-brand-on-surface-variant text-[10px] mt-1">Shown to every user in every company, including on the sign-in page.</p>
        </div>

        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={save.isPending} className={btnCls}>
            {save.isPending ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && <span className="text-emerald-600 text-[11px] font-bold flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>}
        </div>
      </form>

      <AnnouncementCard />
    </div>
  );
}

function AnnouncementCard() {
  const [form, setForm] = useState({ title: '', message: '', severity: 'MEDIUM', organizationId: '' });
  const [result, setResult] = useState<string | null>(null);

  const { data: companies } = useQuery({
    queryKey: ['platform-companies', '', '', 1],
    queryFn: () => api.get<Company[]>('/platform/companies?pageSize=200'),
  });

  const send = useMutation({
    mutationFn: () => api.post<{ delivered: number }>('/platform/announcements', {
      title: form.title,
      message: form.message,
      severity: form.severity,
      ...(form.organizationId ? { organizationId: form.organizationId } : {}),
    }),
    onSuccess: (res) => {
      setResult(`Delivered to ${res.data.delivered} compan${res.data.delivered === 1 ? 'y' : 'ies'}.`);
      setForm({ ...form, title: '', message: '' });
      setTimeout(() => setResult(null), 4000);
    },
  });
  const err = send.error instanceof ApiError ? send.error.message : send.isError ? 'Failed to send announcement' : null;

  return (
    <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className={`${cardCls} p-5 space-y-4 self-start`}>
      <h3 className="font-display text-sm font-extrabold text-brand-primary">Announcement</h3>
      <p className="text-brand-on-surface-variant text-[11px]">
        Drops a notification into the bell of every user in the selected tenants. Medium severity and
        above is also emailed.
      </p>

      <div>
        <label className={labelCls}>AUDIENCE</label>
        <select className={inputCls} value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
          <option value="">All active companies</option>
          {companies?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>SEVERITY</label>
          <select className={inputCls} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>TITLE</label>
          <input className={inputCls} required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
      </div>

      <div>
        <label className={labelCls}>MESSAGE</label>
        <textarea className={`${inputCls} h-24 py-2 resize-none`} required minLength={3}
          value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      </div>

      {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
      {result && <p className="text-emerald-600 text-[11px] font-bold flex items-center gap-1"><Check className="w-4 h-4" /> {result}</p>}
      <button type="submit" disabled={send.isPending} className={`flex items-center gap-2 ${btnCls}`}>
        <Megaphone className="w-4 h-4" /> {send.isPending ? 'Sending…' : 'Send Announcement'}
      </button>
    </form>
  );
}

// ─────────────────────────────── Page shell ───────────────────────────────

export type PlatformTab =
  | 'overview' | 'companies' | 'users' | 'projects'
  | 'watchlist' | 'finance' | 'adoption' | 'audit' | 'settings';

const PAGE_META: Record<PlatformTab, { view: AppView; title: string; subtitle: string }> = {
  overview: {
    view: AppView.PLATFORM,
    title: 'Platform Overview',
    subtitle: 'Every company on the platform at a glance — growth, usage and health.',
  },
  companies: {
    view: AppView.PLATFORM_COMPANIES,
    title: 'Companies',
    subtitle: 'Provision, inspect, set plans for and suspend the tenants on this platform.',
  },
  users: {
    view: AppView.PLATFORM_USERS,
    title: 'Users',
    subtitle: 'Every user across every company — block, promote or reset any account.',
  },
  projects: {
    view: AppView.PLATFORM_PROJECTS,
    title: 'Projects',
    subtitle: 'Every project on the platform — filter, export, or open one inside its company.',
  },
  watchlist: {
    view: AppView.PLATFORM_WATCHLIST,
    title: 'Delivery Watchlist',
    subtitle: 'Exceptions across every tenant: at-risk and overdue projects, overspend, critical risks, NCRs and incidents.',
  },
  finance: {
    view: AppView.PLATFORM_FINANCE,
    title: 'Finance Overview',
    subtitle: 'Contracted, invoiced, collected and outstanding across every company.',
  },
  adoption: {
    view: AppView.PLATFORM_ADOPTION,
    title: 'Adoption & Engagement',
    subtitle: 'Which modules each tenant actually uses, and who has gone quiet.',
  },
  audit: {
    view: AppView.PLATFORM_AUDIT,
    title: 'Audit Trail',
    subtitle: 'The audit log of all tenants at once.',
  },
  settings: {
    view: AppView.PLATFORM_SETTINGS,
    title: 'Platform Settings',
    subtitle: 'Global defaults, signup control, and announcements to your tenants.',
  },
};

export default function PlatformConsole({ tab, onNavigate, onLogout }: Props & { tab: PlatformTab }) {
  const { hasPermission } = useAuth();
  const meta = PAGE_META[tab];

  return (
    <ErpLayout
      active={meta.view}
      title={meta.title}
      subtitle={meta.subtitle}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {!hasPermission('platform:manage') ? (
        <div className={`${cardCls} p-8 text-center text-brand-on-surface-variant text-sm`}>
          You need platform administrator access to open this console.
        </div>
      ) : (
        <>
          {tab === 'overview' && <OverviewTab />}
          {tab === 'companies' && <CompaniesTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'projects' && <ProjectsTab />}
          {tab === 'watchlist' && <WatchlistTab />}
          {tab === 'finance' && <FinanceTab />}
          {tab === 'adoption' && <AdoptionTab />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'settings' && <SettingsTab />}
        </>
      )}
    </ErpLayout>
  );
}
