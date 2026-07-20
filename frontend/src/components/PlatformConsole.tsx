import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  Globe, Building2, Users as UsersIcon, ScrollText, X, Ban, Check, KeyRound, ShieldCheck,
  Download, Search, ChevronLeft, ChevronRight, AlertTriangle, Eye,
} from 'lucide-react';
import { AppView } from '../types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import ErpLayout from './ErpLayout';

interface Props {
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

// ─────────────────────────────── Types ───────────────────────────────

type OrgStatus = 'ACTIVE' | 'SUSPENDED';

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
  const [detailId, setDetailId] = useState<string | null>(null);
  const q = useDebounced(search);
  const pageSize = 25;

  const params = `page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(q)}&status=${status}`;
  const { data, isLoading } = useQuery({
    queryKey: ['platform-companies', q, status, page],
    queryFn: () => api.get<Company[]>(`/platform/companies?${params}`),
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

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
              <th className="px-4 py-3 font-bold">Country</th>
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
                <td className="px-4 py-3 text-brand-on-surface-variant">{c.country ?? '—'}</td>
                <td className="px-4 py-3 text-right font-mono">{c._count.users}</td>
                <td className="px-4 py-3 text-right font-mono">{c._count.projects}</td>
                <td className="px-4 py-3">
                  <StatusPill status={c.status} />
                  {c.suspendedReason && <p className="text-[10px] text-brand-on-surface-variant mt-1 max-w-[16rem] truncate" title={c.suspendedReason}>{c.suspendedReason}</p>}
                </td>
                <td className="px-4 py-3 text-brand-on-surface-variant">{fmtDate(c.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button title="View company" onClick={() => setDetailId(c.id)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary">
                      <Eye className="w-3.5 h-3.5" />
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
      {detailId && <CompanyDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
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

// ─────────────────────────────── Page shell ───────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview', icon: Globe },
  { key: 'companies', label: 'Companies', icon: Building2 },
  { key: 'users', label: 'Users', icon: UsersIcon },
  { key: 'audit', label: 'Audit Trail', icon: ScrollText },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function PlatformConsole({ onNavigate, onLogout }: Props) {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<TabKey>('overview');

  return (
    <ErpLayout
      active={AppView.PLATFORM}
      title="Platform Console"
      subtitle="Every company on the platform — tenants, users, analytics and the cross-company audit trail."
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {!hasPermission('platform:manage') ? (
        <div className={`${cardCls} p-8 text-center text-brand-on-surface-variant text-sm`}>
          You need platform administrator access to open this console.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 bg-brand-surface-container p-1 rounded-lg border border-brand-outline-variant/10 mb-6 w-fit">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                    tab === t.key ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant hover:text-brand-primary'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'overview' && <OverviewTab />}
          {tab === 'companies' && <CompaniesTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'audit' && <AuditTab />}
        </>
      )}
    </ErpLayout>
  );
}
