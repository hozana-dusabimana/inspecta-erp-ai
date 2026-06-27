import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, X } from 'lucide-react';
import { AppView } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import ErpLayout from './ErpLayout';

const money = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const statusStyle = (s: string) =>
  s === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : s === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700';

export default function ApprovalsPage({ onNavigate, onLogout }: { onNavigate: (v: AppView) => void; onLogout: () => void }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('approval:write');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', amount: '', entityType: 'general' });
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ['approvals'], queryFn: () => api.get<any[]>('/approvals') });
  const rows = data?.data ?? [];
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['approvals'] });
    qc.invalidateQueries({ queryKey: ['notifications-unread'] });
  };

  const create = useMutation({
    mutationFn: () => api.post('/approvals', { title: form.title, entityType: form.entityType, amount: form.amount ? Number(form.amount) : undefined }),
    onSuccess: () => { invalidate(); setOpen(false); setForm({ title: '', amount: '', entityType: 'general' }); setError(null); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed'),
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => api.post(`/approvals/${id}/${action}`, {}),
    onSuccess: invalidate,
  });

  return (
    <ErpLayout
      active={AppView.APPROVALS} title="Approvals" subtitle="Multi-step approval workflow & escalations (Module 18)"
      onNavigate={onNavigate} onLogout={onLogout}
      actions={canWrite ? (
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary-container">
          <Plus className="w-4 h-4" /> New Request
        </button>
      ) : undefined}
    >
      <div className="space-y-3 max-w-4xl">
        {rows.length === 0 && <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 p-10 text-center text-brand-on-surface-variant text-sm">No approval requests.</div>}
        {rows.map((r) => (
          <div key={r.id} className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-brand-primary truncate">{r.title}</h4>
                <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${statusStyle(r.status)}`}>{r.status}</span>
              </div>
              <p className="text-xs text-brand-on-surface-variant mt-0.5">
                {r.entityType}{Number(r.amount) > 0 ? ` · ${money(r.amount)}` : ''}{r.project?.name ? ` · ${r.project.name}` : ''}
                {r.decisionNote ? ` · "${r.decisionNote}"` : ''}
              </p>
            </div>
            {canWrite && r.status === 'PENDING' && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => decide.mutate({ id: r.id, action: 'approve' })} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
                  <Check className="w-3.5 h-3.5" /> Approve
                </button>
                <button onClick={() => decide.mutate({ id: r.id, action: 'reject' })} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700">
                  <X className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-brand-on-surface/40 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="bg-brand-surface-container-lowest w-full max-w-md rounded-2xl p-6 shadow-2xl relative">
            <button onClick={() => setOpen(false)} className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant"><X className="w-5 h-5" /></button>
            <h3 className="font-display text-lg font-extrabold text-brand-primary mb-4">New Approval Request</h3>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-brand-on-surface-variant uppercase">Title</label>
                <input value={form.title} required onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} className="w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-brand-on-surface-variant uppercase">Type</label>
                <input value={form.entityType} onChange={(e) => setForm((s) => ({ ...s, entityType: e.target.value }))} placeholder="purchase-order / invoice / variation" className="w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-brand-on-surface-variant uppercase">Amount (optional)</label>
                <input type="number" step="any" value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))} className="w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary" />
              </div>
              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</div>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-xs font-semibold text-brand-on-surface-variant hover:bg-brand-surface rounded-lg">Cancel</button>
                <button type="submit" disabled={create.isPending} className="px-5 py-2 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container disabled:opacity-60">{create.isPending ? 'Submitting…' : 'Submit'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ErpLayout>
  );
}
