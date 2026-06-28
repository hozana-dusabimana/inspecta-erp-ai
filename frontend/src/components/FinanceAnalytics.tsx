import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Wallet, Banknote, Gauge, Layers, Download } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const money = (n: unknown) => '$' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-brand-primary';
  return (
    <div className="bg-brand-surface-container-lowest p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
      <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{label}</p>
      <p className={`font-mono text-xl font-extrabold mt-1 ${color}`}>{value}</p>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm"><h4 className="font-bold text-brand-primary text-sm mb-4">{title}</h4>{children}</div>;
}

const TABS = [
  { key: 'cost', label: 'Cost', icon: Wallet },
  { key: 'cashflow', label: 'Cash Flow', icon: Banknote },
  { key: 'evm', label: 'EVM', icon: Gauge },
  { key: 'wbs', label: 'Cost by WBS', icon: Layers },
] as const;

export default function FinanceAnalytics({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<'cost' | 'cashflow' | 'evm' | 'wbs'>('cost');
  const enabled = Boolean(projectId);
  const q = projectId ? `?projectId=${projectId}` : '';

  const { data: sum } = useQuery({ queryKey: ['/finance/summary', projectId], queryFn: () => api.get<any>(`/finance/summary${q}`), enabled });
  const { data: cf } = useQuery({ queryKey: ['/finance/cash-flow', projectId], queryFn: () => api.get<any>(`/finance/cash-flow${q}`), enabled });
  const { data: evm } = useQuery({ queryKey: ['/finance/evm', projectId], queryFn: () => api.get<any>(`/finance/evm${q}`), enabled });
  const { data: wbs } = useQuery({ queryKey: ['/finance/cost-by-wbs', projectId], queryFn: () => api.get<any>(`/finance/cost-by-wbs${q}`), enabled });

  const post = useMutation({
    mutationFn: () => api.post(`/finance/post-production${q}`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/finance/summary', projectId] }); qc.invalidateQueries({ queryKey: ['/finance/cost-by-wbs', projectId] }); qc.invalidateQueries({ queryKey: ['/finance/cash-flow', projectId] }); },
    onError: (e) => alert(e instanceof Error ? e.message : 'Failed to post production costs'),
  });

  if (!projectId) return <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-6 text-sm text-brand-on-surface-variant mb-6">Select a project to view finance analytics.</div>;

  const s = sum?.data; const c = cf?.data; const e = evm?.data; const w = wbs?.data;

  return (
    <div className="space-y-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1.5 bg-brand-surface-container p-1 rounded-lg border border-brand-outline-variant/10 w-fit">
          {TABS.map((t) => { const Icon = t.icon; return (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${tab === t.key ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant hover:text-brand-primary'}`}><Icon className="w-3.5 h-3.5" /> {t.label}</button>
          ); })}
        </div>
        {hasPermission('finance:write') && (
          <button onClick={() => post.mutate()} disabled={post.isPending} className="flex items-center gap-2 bg-brand-primary text-white text-xs font-bold rounded-lg px-4 py-2 hover:bg-brand-primary-container disabled:opacity-50">
            <Download className="w-4 h-4" /> {post.isPending ? 'Posting…' : 'Post production costs'}
          </button>
        )}
      </div>

      {tab === 'cost' && s && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Budget" value={money(s.budget)} />
            <Kpi label="Actual Cost" value={money(s.actualCost)} tone={s.actualCost > s.budget ? 'bad' : 'good'} />
            <Kpi label="Cost Variance" value={money(s.costVariance)} tone={s.costVariance < 0 ? 'bad' : 'good'} />
            <Kpi label="Forecast Profit" value={money(s.forecastProfit)} tone={s.forecastProfit < 0 ? 'bad' : 'good'} />
          </div>
          <Card title="Cost by Category">
            {(s.costByCategory ?? []).length === 0 ? <p className="text-xs text-brand-on-surface-variant">No costs yet.</p> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={s.costByCategory}><CartesianGrid strokeDasharray="3 3" stroke="#c4c6d3" opacity={0.3} /><XAxis dataKey="category" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip formatter={(v) => money(v)} /><Bar dataKey="amount" fill="#00286a" radius={[4, 4, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      )}

      {tab === 'cashflow' && c && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Kpi label="Inflows" value={money(c.inflows)} tone="good" />
            <Kpi label="Outflows" value={money(c.outflows)} tone="warn" />
            <Kpi label="Cash Position" value={money(c.cashPosition)} tone={c.cashPosition < 0 ? 'bad' : 'good'} />
          </div>
          {c.hasDeficit && <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-4 py-2">⚠ Cash deficit in: {c.deficitMonths.join(', ')}</div>}
          <Card title="Monthly Cash Flow & Cumulative Position">
            {(c.curve ?? []).length === 0 ? <p className="text-xs text-brand-on-surface-variant">No cash movements yet.</p> : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={c.curve}><CartesianGrid strokeDasharray="3 3" stroke="#c4c6d3" opacity={0.3} /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip formatter={(v) => money(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="inflows" stroke="#48c768" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="outflows" stroke="#dc2626" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cumulative" stroke="#00286a" strokeWidth={2.5} dot={false} name="Cash Position" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      )}

      {tab === 'evm' && e && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="CPI" value={String(e.cpi)} tone={e.cpi < 1 ? 'bad' : 'good'} />
          <Kpi label="SPI" value={String(e.spi)} tone={e.spi < 1 ? 'bad' : 'good'} />
          <Kpi label="Earned Value" value={money(e.earnedValue)} />
          <Kpi label="Planned Value" value={money(e.plannedValue)} />
          <Kpi label="Actual Cost" value={money(e.ac)} />
          <Kpi label="EAC" value={money(e.eac)} tone={e.eac > e.bac ? 'bad' : 'good'} />
          <Kpi label="ETC" value={money(e.etc)} />
          <Kpi label="VAC" value={money(e.vac)} tone={e.vac < 0 ? 'bad' : 'good'} />
        </div>
      )}

      {tab === 'wbs' && w && (
        <Card title="Budget vs Actual by WBS">
          {(w.rows ?? []).length === 0 ? <p className="text-xs text-brand-on-surface-variant">No WBS-linked budget or cost yet.</p> : (
            <table className="w-full text-xs"><thead><tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/15"><th className="px-3 py-2 font-bold">Code</th><th className="px-3 py-2 font-bold">Activity</th><th className="px-3 py-2 font-bold text-right">Budget</th><th className="px-3 py-2 font-bold text-right">Actual</th><th className="px-3 py-2 font-bold text-right">Variance</th></tr></thead>
              <tbody>{w.rows.map((r: any) => (<tr key={r.wbsItemId} className="border-b border-brand-outline-variant/10 last:border-0"><td className="px-3 py-2 font-mono font-bold text-brand-primary">{r.code}</td><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 text-right font-mono">{money(r.budget)}</td><td className="px-3 py-2 text-right font-mono">{money(r.actual)}</td><td className={`px-3 py-2 text-right font-mono font-bold ${r.variance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(r.variance)}</td></tr>))}</tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
