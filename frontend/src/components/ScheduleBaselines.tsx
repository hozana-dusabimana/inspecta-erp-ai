import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import ExcelImportBar from './ExcelImport';

interface Baseline { id: string; versionNo: number; name: string; note: string | null; source: string; createdAt: string; _count?: { activities: number } }
interface CompareRow {
  code: string; name: string; baselineFinish: string | null; currentFinish: string | null;
  startVariance: number | null; finishVariance: number | null; durationDelta: number | null; status: string;
}
interface Compare {
  baseline: { id: string; versionNo: number; name: string };
  projectFinishVariance: number | null; baselineFinish: string | null; currentFinish: string | null;
  slipped: number; ahead: number; onTrack: number; added: number; removed: number; rows: CompareRow[];
}

const day = (d: string | null) => (d ? d.slice(0, 10) : '—');
const days = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n}d`);
const TONE: Record<string, string> = {
  SLIPPED: 'bg-red-100 text-red-700', AHEAD: 'bg-emerald-100 text-emerald-700', ON_TRACK: 'bg-brand-surface text-brand-on-surface-variant',
  ADDED: 'bg-blue-100 text-blue-700', REMOVED: 'bg-amber-100 text-amber-700', NO_DATES: 'bg-brand-surface text-brand-on-surface-variant',
};
const card = 'bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden';

export default function ScheduleBaselines({ projectId, canWrite }: { projectId?: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['/scheduling/baselines', projectId ?? 'none'],
    queryFn: () => api.get<Baseline[]>(`/scheduling/baselines?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
  const baselines = data?.data ?? [];
  useEffect(() => {
    if (baselines.length && !baselines.some((b) => b.id === selected)) setSelected(baselines[0].id);
    if (!baselines.length && selected) setSelected('');
  }, [baselines, selected]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['/scheduling/baselines'] });
  const snapshot = useMutation({
    mutationFn: () => api.post(`/scheduling/baselines?projectId=${projectId}`, name.trim() ? { name: name.trim() } : {}),
    onSuccess: () => { setErr(null); setName(''); refresh(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not take the baseline'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/scheduling/baselines/${id}`),
    onSuccess: () => { setErr(null); refresh(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not delete the baseline'),
  });

  const { data: cmpData } = useQuery({
    queryKey: ['/scheduling/baselines/compare', projectId, selected],
    queryFn: () => api.get<Compare>(`/scheduling/baselines/compare?projectId=${projectId}&baselineId=${selected}`),
    enabled: Boolean(projectId && selected),
  });
  const cmp = cmpData?.data;

  if (!projectId) return <div className={`${card} p-6 text-sm text-brand-on-surface-variant`}>Select a project to manage its schedule baselines.</div>;

  return (
    <div className="space-y-6">
      {canWrite && (
        <>
          <div className={`${card} p-4 flex items-center gap-3 flex-wrap`}>
            <Camera className="w-4 h-4 text-brand-primary" />
            <h3 className="font-bold text-brand-primary text-sm">Baseline the current schedule</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Name (optional), e.g. Contract baseline"
              className="h-9 flex-1 min-w-[200px] bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary" />
            <button onClick={() => snapshot.mutate()} disabled={snapshot.isPending}
              className="bg-brand-primary text-white text-xs font-bold rounded-lg px-4 py-2 hover:bg-brand-primary-container disabled:opacity-50">
              {snapshot.isPending ? 'Saving…' : 'Take baseline'}
            </button>
            {err && <em className="text-red-600 text-[11px] basis-full">{err}</em>}
          </div>
          <ExcelImportBar
            projectScoped projectId={projectId}
            extraQuery={name.trim() ? { name: name.trim() } : undefined}
            onDone={refresh}
            def={{
              label: 'a baseline', path: '/scheduling/baselines/import', templatePath: '/scheduling/baselines/import-template.xlsx',
              hint: 'Already have a planned schedule (Primavera / MS Project / Excel)? Import its planned dates by activity code — it is saved as a new baseline using the name above.',
            }}
          />
        </>
      )}

      <div className={card}>
        <div className="px-5 py-3 border-b border-brand-outline-variant/15"><h3 className="font-bold text-brand-primary text-sm">Baselines</h3></div>
        {baselines.length === 0 ? (
          <p className="px-5 py-4 text-xs text-brand-on-surface-variant">No baselines yet. Take one once the schedule is agreed, then compare it with the live schedule as the work progresses.</p>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/15">
              <th className="px-4 py-2 font-bold">Version</th><th className="px-4 py-2 font-bold">Name</th><th className="px-4 py-2 font-bold">Source</th>
              <th className="px-4 py-2 font-bold text-right">Activities</th><th className="px-4 py-2 font-bold">Created</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody>
              {baselines.map((b) => (
                <tr key={b.id} className="border-b border-brand-outline-variant/10 last:border-0">
                  <td className="px-4 py-2 font-bold text-brand-primary">v{b.versionNo}</td>
                  <td className="px-4 py-2">{b.name}</td>
                  <td className="px-4 py-2 text-brand-on-surface-variant">{b.source === 'IMPORT' ? 'Excel import' : 'Snapshot'}</td>
                  <td className="px-4 py-2 text-right">{b._count?.activities ?? '—'}</td>
                  <td className="px-4 py-2 text-brand-on-surface-variant">{new Date(b.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-right">
                    {canWrite && (
                      <button aria-label={`Delete baseline v${b.versionNo}`} disabled={remove.isPending}
                        onClick={() => { if (window.confirm(`Delete baseline v${b.versionNo} "${b.name}"?`)) remove.mutate(b.id); }}
                        className="text-red-600 hover:text-red-800 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {baselines.length > 0 && (
        <div className={card}>
          <div className="px-5 py-3 border-b border-brand-outline-variant/15 flex items-center gap-3 flex-wrap">
            <h3 className="font-bold text-brand-primary text-sm">Slippage vs live schedule</h3>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}
              className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs font-semibold text-brand-primary outline-none">
              {baselines.map((b) => <option key={b.id} value={b.id}>v{b.versionNo} — {b.name}</option>)}
            </select>
          </div>
          {!cmp ? <p className="px-5 py-4 text-xs text-brand-on-surface-variant">Loading comparison…</p> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 p-4">
                <div><p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">Project finish</p>
                  <p className={`font-mono font-extrabold ${(cmp.projectFinishVariance ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{days(cmp.projectFinishVariance)}</p>
                  <p className="text-[10px] text-brand-on-surface-variant">{day(cmp.baselineFinish)} → {day(cmp.currentFinish)}</p></div>
                <div><p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">Slipped</p><p className="font-mono font-extrabold text-red-600">{cmp.slipped}</p></div>
                <div><p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">Ahead</p><p className="font-mono font-extrabold text-emerald-600">{cmp.ahead}</p></div>
                <div><p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">On track</p><p className="font-mono font-extrabold text-brand-primary">{cmp.onTrack}</p></div>
                <div><p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">Added / removed</p><p className="font-mono font-extrabold text-brand-primary">{cmp.added} / {cmp.removed}</p></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead><tr className="text-left text-brand-on-surface-variant border-y border-brand-outline-variant/15">
                    <th className="px-4 py-2 font-bold">Code</th><th className="px-4 py-2 font-bold">Activity</th>
                    <th className="px-4 py-2 font-bold">Baseline finish</th><th className="px-4 py-2 font-bold">Current finish</th>
                    <th className="px-4 py-2 font-bold text-right">Start Δ</th><th className="px-4 py-2 font-bold text-right">Finish Δ</th>
                    <th className="px-4 py-2 font-bold text-right">Duration Δ</th><th className="px-4 py-2 font-bold">Status</th>
                  </tr></thead>
                  <tbody>
                    {cmp.rows.map((r) => (
                      <tr key={r.code} className="border-b border-brand-outline-variant/10 last:border-0">
                        <td className="px-4 py-2 font-bold text-brand-primary font-mono">{r.code}</td>
                        <td className="px-4 py-2">{r.name}</td>
                        <td className="px-4 py-2">{day(r.baselineFinish)}</td><td className="px-4 py-2">{day(r.currentFinish)}</td>
                        <td className="px-4 py-2 text-right font-mono">{days(r.startVariance)}</td>
                        <td className="px-4 py-2 text-right font-mono">{days(r.finishVariance)}</td>
                        <td className="px-4 py-2 text-right font-mono">{days(r.durationDelta)}</td>
                        <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${TONE[r.status] ?? ''}`}>{r.status.replace('_', ' ')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
