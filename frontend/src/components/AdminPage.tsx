import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users as UsersIcon, ShieldCheck, Building2, Plus, X, KeyRound, Check, Ban, Pencil,
} from 'lucide-react';
import { AppView } from '../types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import ErpLayout from './ErpLayout';

interface Props {
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

// Mirror of the backend Role enum.
const ROLES = [
  'SYSTEM_ADMIN',
  'PROJECT_MANAGER',
  'SITE_ENGINEER',
  'QUANTITY_SURVEYOR',
  'STOREKEEPER',
] as const;
type RoleName = (typeof ROLES)[number];

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: RoleName;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface RoleEntry {
  role: RoleName;
  permissions: string[];
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  industry: string | null;
  country: string | null;
  timezone: string | null;
  currency: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  totalUsers: number;
  usersByRole: Record<string, number>;
}

function roleLabel(role: string) {
  return role.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const ROLE_TONE: Record<RoleName, string> = {
  SYSTEM_ADMIN: 'bg-brand-primary/10 text-brand-primary',
  PROJECT_MANAGER: 'bg-amber-100 text-amber-700',
  SITE_ENGINEER: 'bg-sky-100 text-sky-700',
  QUANTITY_SURVEYOR: 'bg-violet-100 text-violet-700',
  STOREKEEPER: 'bg-emerald-100 text-emerald-700',
};

const inputCls =
  'w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary transition-all';
const labelCls = 'font-sans text-[10px] font-bold text-brand-on-surface-variant block mb-1';

// ─────────────────────────────── Modal shell ───────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-brand-on-surface/50 backdrop-blur-md flex items-center justify-center px-4">
      <div className="bg-brand-surface-container-lowest max-w-md w-full rounded-2xl p-6 shadow-2xl relative border border-brand-outline-variant/30">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-on-surface">
          <X className="w-5 h-5" />
        </button>
        <h3 className="font-display text-lg font-extrabold text-brand-primary mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────── Users tab ───────────────────────────────
function UsersTab() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<AdminUser[]>('/users'),
  });
  const users = data?.data ?? [];

  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [pwUser, setPwUser] = useState<AdminUser | null>(null);

  const toggleActive = useMutation({
    mutationFn: (u: AdminUser) => api.put(`/users/${u.id}`, { isActive: !u.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-brand-on-surface-variant text-xs">{users.length} user{users.length === 1 ? '' : 's'} in your organization</p>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 bg-brand-primary text-white font-bold text-xs rounded-lg px-4 py-2.5 hover:bg-brand-primary-container transition-all"
        >
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
              <th className="px-4 py-3 font-bold">Name</th>
              <th className="px-4 py-3 font-bold">Email</th>
              <th className="px-4 py-3 font-bold">Role</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold">Last Login</th>
              <th className="px-4 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-on-surface-variant">Loading users…</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface/40">
                <td className="px-4 py-3 font-bold text-brand-primary">
                  {u.fullName}{u.id === me?.id && <span className="ml-2 text-[9px] font-bold text-brand-on-surface-variant">(you)</span>}
                </td>
                <td className="px-4 py-3 text-brand-on-surface-variant">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${ROLE_TONE[u.role]}`}>{roleLabel(u.role)}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-brand-on-surface-variant">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button title="Edit role / name" onClick={() => setEditUser(u)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button title="Reset password" onClick={() => setPwUser(u)} className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary">
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title={u.isActive ? 'Deactivate' : 'Activate'}
                      disabled={u.id === me?.id || toggleActive.isPending}
                      onClick={() => toggleActive.mutate(u)}
                      className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-primary disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {u.isActive ? <Ban className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-on-surface-variant">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {editUser && <EditModal user={editUser} onClose={() => setEditUser(null)} />}
      {pwUser && <ResetPasswordModal user={pwUser} onClose={() => setPwUser(null)} />}
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: RoleName; onChange: (r: RoleName) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as RoleName)} className={inputCls}>
      {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
    </select>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'SITE_ENGINEER' as RoleName });
  const mutation = useMutation({
    mutationFn: () => api.post('/users', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['admin-org'] }); onClose(); },
  });
  const err = mutation.error instanceof ApiError ? mutation.error.message : mutation.isError ? 'Failed to create user' : null;

  return (
    <Modal title="Add User" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
        <div><label className={labelCls}>FULL NAME</label><input className={inputCls} required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
        <div><label className={labelCls}>EMAIL</label><input className={inputCls} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className={labelCls}>TEMPORARY PASSWORD</label><input className={inputCls} type="text" required minLength={8} placeholder="Min. 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div><label className={labelCls}>ROLE</label><RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} /></div>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={mutation.isPending} className="w-full h-11 bg-brand-primary text-white font-bold text-xs rounded-lg hover:bg-brand-primary-container transition-all disabled:opacity-60">
          {mutation.isPending ? 'Creating…' : 'Create User'}
        </button>
      </form>
    </Modal>
  );
}

function EditModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const isSelf = user.id === me?.id;
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState<RoleName>(user.role);
  const mutation = useMutation({
    mutationFn: () => api.put(`/users/${user.id}`, { fullName, role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['admin-org'] }); onClose(); },
  });
  const err = mutation.error instanceof ApiError ? mutation.error.message : mutation.isError ? 'Failed to update user' : null;

  return (
    <Modal title={`Edit ${user.fullName}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
        <div><label className={labelCls}>FULL NAME</label><input className={inputCls} required value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
        <div>
          <label className={labelCls}>ROLE</label>
          <RoleSelect value={role} onChange={setRole} />
          {isSelf && <p className="text-brand-on-surface-variant text-[10px] mt-1">You cannot change your own role.</p>}
        </div>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={mutation.isPending} className="w-full h-11 bg-brand-primary text-white font-bold text-xs rounded-lg hover:bg-brand-primary-container transition-all disabled:opacity-60">
          {mutation.isPending ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.post(`/users/${user.id}/reset-password`, { password }),
    onSuccess: () => onClose(),
  });
  const err = mutation.error instanceof ApiError ? mutation.error.message : mutation.isError ? 'Failed to reset password' : null;

  return (
    <Modal title={`Reset password — ${user.fullName}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-3">
        <p className="text-brand-on-surface-variant text-[11px]">Set a new password for <strong>{user.email}</strong>. Their active sessions will be signed out.</p>
        <div><label className={labelCls}>NEW PASSWORD</label><input className={inputCls} type="text" required minLength={8} placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={mutation.isPending} className="w-full h-11 bg-brand-primary text-white font-bold text-xs rounded-lg hover:bg-brand-primary-container transition-all disabled:opacity-60">
          {mutation.isPending ? 'Resetting…' : 'Reset Password'}
        </button>
      </form>
    </Modal>
  );
}

// ───────────────────────── Roles & Permissions tab ─────────────────────────
function RolesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get<{ roles: RoleEntry[]; permissions: string[] }>('/roles'),
  });
  const roles = data?.data.roles ?? [];

  return (
    <div>
      <p className="text-brand-on-surface-variant text-xs mb-4">
        Role-based access control matrix. Each role grants the permissions below; <strong>System Administrator</strong> has full access to every module.
      </p>
      {isLoading && <p className="text-brand-on-surface-variant text-xs">Loading roles…</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((r) => (
          <div key={r.role} className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${ROLE_TONE[r.role]}`}>{roleLabel(r.role)}</span>
              <span className="text-[10px] font-bold text-brand-on-surface-variant">{r.permissions.length} permissions</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.permissions.map((p) => (
                <span key={p} className="px-2 py-0.5 rounded-md bg-brand-surface text-brand-on-surface-variant text-[10px] font-mono font-semibold">{p}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────── Company Settings tab ──────────────────────────
const SETTING_FIELDS: { name: keyof Organization; label: string }[] = [
  { name: 'name', label: 'Display Name' },
  { name: 'legalName', label: 'Legal Name' },
  { name: 'industry', label: 'Industry' },
  { name: 'country', label: 'Country' },
  { name: 'timezone', label: 'Timezone' },
  { name: 'currency', label: 'Currency (e.g. USD)' },
  { name: 'phone', label: 'Phone' },
  { name: 'logoUrl', label: 'Logo URL' },
];

function CompanyTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-org'],
    queryFn: () => api.get<Organization>('/organization'),
  });
  const org = data?.data;

  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (org) {
      setForm({
        name: org.name ?? '', legalName: org.legalName ?? '', industry: org.industry ?? '',
        country: org.country ?? '', timezone: org.timezone ?? '', currency: org.currency ?? '',
        phone: org.phone ?? '', address: org.address ?? '', logoUrl: org.logoUrl ?? '',
      });
    }
  }, [org]);

  const mutation = useMutation({
    mutationFn: () => api.put('/organization', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-org'] }); setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });
  const err = mutation.error instanceof ApiError ? mutation.error.message : mutation.isError ? 'Failed to save settings' : null;

  if (isLoading || !org) return <p className="text-brand-on-surface-variant text-xs">Loading company settings…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="lg:col-span-2 bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          {SETTING_FIELDS.map((f) => (
            <div key={f.name}>
              <label className={labelCls}>{f.label.toUpperCase()}</label>
              <input className={inputCls} value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
            </div>
          ))}
        </div>
        <div>
          <label className={labelCls}>ADDRESS</label>
          <textarea className={`${inputCls} h-20 py-2 resize-none`} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={mutation.isPending} className="bg-brand-primary text-white font-bold text-xs rounded-lg px-5 py-2.5 hover:bg-brand-primary-container transition-all disabled:opacity-60">
            {mutation.isPending ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && <span className="text-emerald-600 text-[11px] font-bold flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>}
        </div>
      </form>

      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-5">
        <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider mb-1">Total Users</p>
        <p className="font-mono text-3xl font-extrabold text-brand-primary mb-4">{org.totalUsers}</p>
        <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider mb-2">By Role</p>
        <div className="space-y-2">
          {ROLES.map((r) => (
            <div key={r} className="flex items-center justify-between text-xs">
              <span className="text-brand-on-surface-variant">{roleLabel(r)}</span>
              <span className="font-bold text-brand-primary">{org.usersByRole?.[r] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── Page shell ────────────────────────────────
const TABS = [
  { key: 'users', label: 'Users', icon: UsersIcon },
  { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck },
  { key: 'company', label: 'Company Settings', icon: Building2 },
] as const;

export default function AdminPage({ onNavigate, onLogout }: Props) {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<'users' | 'roles' | 'company'>('users');

  return (
    <ErpLayout
      active={AppView.ADMIN}
      title="Administration"
      subtitle="Manage users, roles & permissions, and company settings."
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {!hasPermission('user:write') ? (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-8 text-center text-brand-on-surface-variant text-sm">
          You need System Administrator access to manage this organization.
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

          {tab === 'users' && <UsersTab />}
          {tab === 'roles' && <RolesTab />}
          {tab === 'company' && <CompanyTab />}
        </>
      )}
    </ErpLayout>
  );
}
