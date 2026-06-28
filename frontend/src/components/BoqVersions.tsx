import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { api, ApiError } from '../lib/api';

interface Version { id: string; versionNo: number; label: string | null; totalCost: string | number; totalBudget: string | number; createdAt: string; _count?: { items: number } }
interface CompareRow { code: string; description: string; fromCost: number; toCost: number; costDelta: number; budgetDelta: number; status: string }
interface Compare { rows: CompareRow[]; fromTotalCost: number; toTotalCost: number; fromTotalBudget: number; toTotalBudget: number; changed: number }

const money = (n: unknown) => '$' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const delta = (n: number) => (n > 0 ? '+' : '') + money(n);
const STATUS_TONE: Record<string, string> = {
  ADDED: 'bg-emerald-100 text-emerald-700', REMOVED: 'bg-red-100 text-red-700',
  CHANGED: 'bg-amber-100 text-amber-700', SAME: 'bg-brand-surface text-brand-on-surface-variant',
};

export default function BoqVersions({ projectId, canWrite }: { projectId?: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('current');
  const [err, setErr] = useState<string | null>(null);

  const { data: vData } = useQuery({
    queryKey: ['/planning/boq-versions', projectId ?? 'none'],
    queryFn: () => api.get<Version[]>(`/planning/boq-versions?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
  const versions = vData?.data ?? [];

  // Default the "from" selector to the latest snapshot once versions load.
  useEffect(() => { if (!from && versions.length) setFrom(versions[0].id); }, [versions, from]);

  const snapshot = useMutation({
    mutationFn: () => api.post(`/planning/boq-versions?projectId=${projectId}`, {}),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['/planning/boq-versions'] }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Snapshot failed'),
  });

  const { data: cmpData } = useQuery({
    queryKey: ['/planning/boq-compare', projectId, from, to],
    queryFn: () => api.get<Compare>(`/planning/boq-versions/compare?projectId=${projectId}&from=${from}&to=${to}`),
    enabled: Boolean(projectId && from && to && from !== to),
  });
  const cmp = cmpData?.data;

  if (!projectId) return <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-6 text-sm text-brand-on-surface-variant">Select a project to manage BOQ versions.</div>;

  const opts = (current: boolean) => (
    <>
      {current && <option value="current">Current BOQ (live)</option>}
      {versions.map((v) => <option key={v.id} value={v.id}>v{v.versionNo}{v.label ? ` — ${v.label}` : ''} ({money(v.totalCost)})</option>)}
    </>
  );

  return (
    <div className="space-y-6">
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-brand-outline-variant/15 flex items-center justify-between gap-3">
          <h3 className="font-bold text-brand-primary text-sm">BOQ Versions {err && <em className="text-red-600 text-[11px] ml-2">{err}</em>}</h3>
          {canWrite && (
            <button onClick={() => snapshot.mutate()} disabled={snapshot.isPending}
              className="flex items-center gap-2 bg-brand-primary text-white text-xs font-bold rounded-lg px-4 py-2 hover:bg-brand-primary-container disabled:opacity-50">
              <Camera className="w-4 h-4" /> {snapshot.isPending ? 'Snapshotting…' : 'Snapshot current BOQ'}
            </button>
          )}
        </div>
        {versions.length === 0 ? (
          <p className="px-5 py-4 text-xs text-brand-on-surface-variant">No versions yet. Snapshot the current BOQ to create a baseline you can compare against later.</p>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/15">
              <th className="px-4 py-2 font-bold">Version</th><th className="px-4 py-2 font-bold">Label</th>
              <th className="px-4 py-2 font-bold text-right">Items</th><th className="px-4 py-2 font-bold text-right">Cost</th>
              <th className="px-4 py-2 font-bold text-right">Budget</th><th className="px-4 py-2 font-bold">Created</th>
            </tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-b border-brand-outline-variant/10 last:border-0">
                  <td className="px-4 py-2 font-bold text-brand-primary">v{v.versionNo}</td>
                  <td className="px-4 py-2">{v.label ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{v._count?.items ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">{money(v.totalCost)}</td>
                  <td className="px-4 py-2 text-right font-mono">{money(v.totalBudget)}</td>
                  <td className="px-4 py-2 text-brand-on-surface-variant">{new Date(v.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Cost comparison */}
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-brand-outline-variant/15 flex items-center gap-3 flex-wrap">
          <h3 className="font-bold text-brand-primary text-sm">Cost Comparison</h3>
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs font-semibold text-brand-primary outline-none">{opts(true)}</select>
          <span className="text-brand-on-surface-variant text-xs">→</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs font-semibold text-brand-primary outline-none">{opts(true)}</select>
        </div>
        {!cmp ? (
          <p className="px-5 py-4 text-xs text-brand-on-surface-variant">{versions.length === 0 ? 'Create at least one version to compare.' : 'Pick two different versions to compare.'}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4">
              <div><p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">From Cost</p><p className="font-mono font-extrabold text-brand-primary">{money(cmp.fromTotalCost)}</p></div>
              <div><p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">To Cost</p><p className="font-mono font-extrabold text-brand-primary">{money(cmp.toTotalCost)}</p></div>
              <div><p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">Cost Δ</p><p className={`font-mono font-extrabold ${cmp.toTotalCost - cmp.fromTotalCost > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{delta(cmp.toTotalCost - cmp.fromTotalCost)}</p></div>
              <div><p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">Changed Lines</p><p className="font-mono font-extrabold text-brand-primary">{cmp.changed}</p></div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead><tr className="text-left text-brand-on-surface-variant border-y border-brand-outline-variant/15">
                <th className="px-4 py-2 font-bold">Code</th><th className="px-4 py-2 font-bold">Description</th>
                <th className="px-4 py-2 font-bold text-right">From</th><th className="px-4 py-2 font-bold text-right">To</th>
                <th className="px-4 py-2 font-bold text-right">Δ Cost</th><th className="px-4 py-2 font-bold">Status</th>
              </tr></thead>
              <tbody>
                {cmp.rows.filter((r) => r.status !== 'SAME').map((r) => (
                  <tr key={r.code} className="border-b border-brand-outline-variant/10 last:border-0">
                    <td className="px-4 py-2 font-bold text-brand-primary font-mono">{r.code}</td>
                    <td className="px-4 py-2 truncate max-w-[240px]">{r.description}</td>
                    <td className="px-4 py-2 text-right font-mono">{money(r.fromCost)}</td>
                    <td className="px-4 py-2 text-right font-mono">{money(r.toCost)}</td>
                    <td className={`px-4 py-2 text-right font-mono font-bold ${r.costDelta > 0 ? 'text-red-600' : r.costDelta < 0 ? 'text-emerald-600' : ''}`}>{r.costDelta ? delta(r.costDelta) : '—'}</td>
                    <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_TONE[r.status]}`}>{r.status}</span></td>
                  </tr>
                ))}
                {cmp.changed === 0 && <tr><td colSpan={6} className="px-4 py-4 text-center text-brand-on-surface-variant">No differences between these versions.</td></tr>}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
