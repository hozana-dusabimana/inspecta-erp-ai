import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { AppView } from '../types';
import { api } from '../lib/api';
import ErpLayout from './ErpLayout';

/**
 * Company audit trail (T2-01): who did what, when, in which role, old -> new, and why.
 * Read-only: the log is append-only in the database, nobody can edit or delete a row.
 */
interface Change { field: string; from: unknown; to: unknown }
interface Row {
  id: string; action: string; entity: string; entityId: string | null; role: string | null; reason: string | null;
  createdAt: string; ipAddress: string | null; user: { fullName: string; email: string } | null; changes: Change[]; newValues: any;
}

const ACTION_STYLE: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700', UPDATE: 'bg-sky-50 text-sky-700', DELETE: 'bg-red-50 text-red-700',
  CANCEL: 'bg-red-50 text-red-700', REVERSE: 'bg-red-50 text-red-700', APPROVE: 'bg-emerald-50 text-emerald-700',
  REJECT: 'bg-amber-50 text-amber-800', DENIED: 'bg-red-100 text-red-800', LOGIN: 'bg-slate-100 text-slate-700', LOGOUT: 'bg-slate-100 text-slate-700',
};
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function AuditPage({ onNavigate, onLogout }: { onNavigate: (v: AppView) => void; onLogout: () => void }) {
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '30' });
    if (text) p.set('q', text);
    if (entity) p.set('entity', entity);
    if (action) p.set('action', action);
    if (userId) p.set('userId', userId);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    return p.toString();
  }, [page, text, entity, action, userId, dateFrom, dateTo]);

  const { data: facets } = useQuery({ queryKey: ['/audit/facets'], queryFn: () => api.get<any>('/audit/facets') });
  const { data, isLoading, isError } = useQuery({ queryKey: ['/audit', params], queryFn: () => api.get<Row[]>(`/audit?${params}`) });
  const rows = data?.data ?? [];
  const total = (data?.meta as any)?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 30));
  const sel = 'h-9 rounded-lg border border-brand-outline-variant bg-brand-surface px-2 text-xs';

  return (
    <ErpLayout active={AppView.AUDIT} title="Audit Trail" subtitle="Every create, edit, approval, cancellation and refused action: who, when, role, old → new, why" onNavigate={onNavigate} onLogout={onLogout}>
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-[11px] text-brand-on-surface-variant"><Lock className="h-3.5 w-3.5" /> Append-only: no role, including administrators, can change or delete a row.</p>
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-3">
          <form onSubmit={(e) => { e.preventDefault(); setPage(1); setText(q.trim()); }} className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-on-surface-variant" />
            <input aria-label="Search the audit trail" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Person, record id, reason…" className="h-9 w-60 rounded-lg border border-brand-outline-variant bg-brand-surface pl-9 pr-3 text-xs" />
          </form>
          <select aria-label="Record type" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className={sel}>
            <option value="">All record types</option>
            {(facets?.data?.entities ?? []).map((e: any) => <option key={e.entity} value={e.entity}>{e.entity} ({e.count})</option>)}
          </select>
          <select aria-label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className={sel}>
            <option value="">All actions</option>
            {(facets?.data?.actions ?? []).map((a: string) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select aria-label="Person" value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} className={sel}>
            <option value="">Everyone</option>
            {(facets?.data?.users ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
          <label className="text-[10px] font-bold uppercase text-brand-on-surface-variant">From <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className={sel} /></label>
          <label className="text-[10px] font-bold uppercase text-brand-on-surface-variant">To <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className={sel} /></label>
        </div>

        <div className="overflow-hidden rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest">
          {isLoading ? (
            <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-brand-surface-container-low" />)}</div>
          ) : isError ? (
            <p className="p-6 text-center text-xs text-red-700">Could not load the audit trail.</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-xs text-brand-on-surface-variant">No records match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-brand-outline-variant/20 text-left text-brand-on-surface-variant">
                  <th className="px-4 py-2">When</th><th className="px-4 py-2">Who</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Record</th><th className="px-4 py-2">Change</th><th className="px-4 py-2">Reason</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-brand-outline-variant/10 align-top">
                      <td className="whitespace-nowrap px-4 py-2 font-mono">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2"><div className="font-semibold">{r.user?.fullName ?? 'System'}</div><div className="text-[10px] text-brand-on-surface-variant">{r.role ?? ''}</div></td>
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ACTION_STYLE[r.action] ?? ''}`}>{r.action}</span></td>
                      <td className="px-4 py-2"><div>{r.entity}</div><div className="font-mono text-[10px] text-brand-on-surface-variant">{r.entityId ?? ''}</div></td>
                      <td className="px-4 py-2">
                        {r.changes.length > 0
                          ? r.changes.slice(0, 6).map((c) => <div key={c.field}><span className="font-semibold">{c.field}</span>: <span className="text-red-700 line-through">{show(c.from)}</span> → <span className="text-emerald-700">{show(c.to)}</span></div>)
                          : r.action === 'DENIED' ? <span className="text-red-700">{show(r.newValues?.path ?? r.newValues?.reason)}</span> : <span className="text-brand-on-surface-variant">—</span>}
                      </td>
                      <td className="px-4 py-2">{r.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > 30 && (
            <div className="flex items-center justify-between border-t border-brand-outline-variant/15 px-4 py-2 text-xs">
              <span>{total} entries</span>
              <div className="flex items-center gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></button>
                <span className="font-mono">{page} / {pages}</span>
                <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
