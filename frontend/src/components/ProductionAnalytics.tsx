import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Activity, Gauge, Clock, Wallet, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const money = (n: unknown) => 'RWF ' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const num = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

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
function Bars({ data }: { data: { name: string; productivity: number }[] }) {
  if (!data.length) return <p className="text-xs text-brand-on-surface-variant">No data.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" opacity={0.3} /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="productivity" fill="#471519" radius={[4, 4, 0, 0]} /></BarChart>
    </ResponsiveContainer>
  );
}

const TABS = [
  { key: 'productivity', label: 'Productivity', icon: Activity },
  { key: 'resources', label: 'Resource Efficiency', icon: Gauge },
  { key: 'delays', label: 'Delays', icon: Clock },
  { key: 'profitability', label: 'Profitability', icon: Wallet },
] as const;

export default function ProductionAnalytics({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<'productivity' | 'resources' | 'delays' | 'profitability'>('productivity');
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const enabled = Boolean(projectId);
  const { data: aData } = useQuery({ queryKey: ['/production/analytics', projectId], queryFn: () => api.get<any>(`/production/analytics?projectId=${projectId}`), enabled });
  const { data: dData } = useQuery({ queryKey: ['/production/delays', projectId], queryFn: () => api.get<any>(`/production/delays?projectId=${projectId}`), enabled });
  const { data: aiData } = useQuery({ queryKey: ['/production/ai-summary', projectId], queryFn: () => api.get<any>(`/production/ai-summary?projectId=${projectId}`), enabled });
  const { data: rData } = useQuery({ queryKey: ['/production/daily-reports', projectId], queryFn: () => api.get<any>(`/production/daily-reports?projectId=${projectId}`), enabled });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post(`/production/daily-reports/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/production/daily-reports', projectId] }),
  });

  if (!projectId) return <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-6 text-sm text-brand-on-surface-variant mb-6">Select a project to view production analytics & profitability impact.</div>;

  const a = aData?.data; const d = dData?.data; const ai = aiData?.data; const reports = rData?.data ?? [];
  const REPORT_ACTIONS: Record<string, Array<[string, string, boolean]>> = {
    DRAFT: [['Submit', 'submit', false]], SUBMITTED: [['Approve', 'approve', true], ['Reject', 'reject', true]], REJECTED: [['Resubmit', 'submit', false]], APPROVED: [],
  };

  return (
    <div className="space-y-5 mb-6">
      {/* AI insights */}
      {ai && ai.insights?.length > 0 && (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-4">
          <h4 className="font-bold text-brand-primary text-sm flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-brand-secondary-container" /> AI Insights</h4>
          <ul className="space-y-1.5">
            {ai.insights.map((i: any, idx: number) => (
              <li key={idx} className="text-xs flex items-start gap-2">
                <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${i.severity === 'HIGH' ? 'bg-red-100 text-red-700' : i.severity === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{i.severity}</span>
                <span><strong className="text-brand-primary">{i.title}.</strong> <span className="text-brand-on-surface-variant">{i.detail}</span>{i.recommendation && <em className="text-brand-secondary block text-[11px] mt-0.5">→ {i.recommendation}</em>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Daily report approvals */}
      {reports.length > 0 && (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-brand-outline-variant/15 font-bold text-brand-primary text-sm">Daily Reports</div>
          <table className="w-full text-xs"><tbody>
            {reports.map((r: any) => (
              <tr key={r.id} className="border-b border-brand-outline-variant/10 last:border-0">
                <td className="px-4 py-2 font-bold text-brand-primary">{r.reportNumber}</td>
                <td className="px-4 py-2 text-brand-on-surface-variant">{new Date(r.reportDate).toLocaleDateString()}</td>
                <td className="px-4 py-2">{r._count?.entries ?? 0} entries</td>
                <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-full bg-brand-surface text-[10px] font-bold">{r.status}</span></td>
                <td className="px-4 py-2"><div className="flex justify-end gap-1.5">
                  {(REPORT_ACTIONS[r.status] ?? []).filter(([, , ap]) => !ap || hasPermission('approval:write')).map(([label, action]) => (
                    <button key={action} disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action })} className="px-2.5 py-1 rounded-md bg-brand-primary text-white text-[10px] font-bold hover:bg-brand-primary-container disabled:opacity-50">{label}</button>
                  ))}
                </div></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      {/* Dashboard tabs */}
      <div className="flex flex-wrap gap-1.5 bg-brand-surface-container p-1 rounded-lg border border-brand-outline-variant/10 w-fit">
        {TABS.map((t) => { const Icon = t.icon; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${tab === t.key ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant hover:text-brand-primary'}`}><Icon className="w-3.5 h-3.5" /> {t.label}</button>
        ); })}
      </div>

      {!a ? <p className="text-xs text-brand-on-surface-variant">Loading analytics…</p> : (
        <>
          {tab === 'productivity' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Labor Productivity" value={num(a.productivity.labor)} />
                <Kpi label="Equipment Productivity" value={num(a.productivity.equipment)} />
                <Kpi label="Planned Standard" value={num(a.productivity.plannedStandard)} />
                <Kpi label="Productivity Variance" value={`${a.productivity.variancePct}%`} tone={a.productivity.variancePct < 0 ? 'bad' : 'good'} />
              </div>
              <div className="bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-brand-primary text-sm">Productivity Trend</h4>
                  <div className="flex gap-1 bg-brand-surface-container p-0.5 rounded-md">
                    {(['daily', 'weekly', 'monthly'] as const).map((p) => (
                      <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1 rounded text-[10px] font-bold capitalize ${period === p ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant'}`}>{p}</button>
                    ))}
                  </div>
                </div>
                {(a.trends?.[period] ?? []).length === 0 ? <p className="text-xs text-brand-on-surface-variant">No trend data.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={a.trends[period]}><CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" opacity={0.3} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="productivity" stroke="#471519" strokeWidth={2} dot={false} name="Productivity" />
                      <Line type="monotone" dataKey="actual" stroke="#fc6061" strokeWidth={2} dot={false} name="Actual Qty" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="grid lg:grid-cols-3 gap-5">
                <Card title="By Crew"><Bars data={a.productivity.byCrew} /></Card>
                <Card title="By Trade"><Bars data={a.productivity.byTrade ?? []} /></Card>
                <Card title="By Activity"><Bars data={a.productivity.byActivity} /></Card>
              </div>
            </div>
          )}
          {tab === 'resources' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <Kpi label="Labor Efficiency" value={num(a.utilization.laborEfficiency)} tone={a.utilization.laborEfficiency < 1 ? 'warn' : 'good'} />
                <Kpi label="Equipment Utilization" value={`${a.utilization.equipmentUtilizationPct}%`} />
                <Kpi label="Material Consumption" value={num(a.utilization.materialConsumptionRatio)} tone={a.utilization.materialConsumptionRatio > 1 ? 'bad' : 'good'} />
                <Kpi label="Total Labor Hours" value={num(a.totals.totalLaborHours)} />
                <Kpi label="Total Equipment Hours" value={num(a.totals.totalEquipmentHours)} />
                <Kpi label="Entries" value={num(a.totals.entries)} />
              </div>
              <Card title="Labor Hours by Activity (histogram)">
                {(a.histograms?.laborByActivity ?? []).length === 0 ? <p className="text-xs text-brand-on-surface-variant">No data.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={a.histograms.laborByActivity}><CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" opacity={0.3} /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="hours" fill="#c98a2b" radius={[4, 4, 0, 0]} /></BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>
          )}
          {tab === 'delays' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Delayed Activities" value={num(d?.delayedCount)} tone={d?.delayedCount > 0 ? 'bad' : 'good'} />
                <Kpi label="Critical Delayed" value={num(d?.criticalDelayed)} tone={d?.criticalDelayed > 0 ? 'bad' : 'good'} />
                <Kpi label="Max Days Delayed" value={num(d?.maxDaysDelayed)} tone={d?.maxDaysDelayed > 0 ? 'warn' : 'good'} />
                <Kpi label="Total Activities" value={num(d?.totalActivities)} />
              </div>
              {d?.activities?.length > 0 && (
                <Card title="Delay Heatmap (days late)">
                  <div className="flex flex-wrap gap-2">
                    {d.activities.map((x: any) => {
                      const sev = x.daysDelayed >= 14 ? '#b91c1c' : x.daysDelayed >= 7 ? '#dc2626' : x.daysDelayed >= 3 ? '#f59e0b' : '#fbbf24';
                      return (
                        <div key={x.code} title={`${x.name}: ${x.daysDelayed}d late`} className="rounded-md px-2.5 py-2 text-white text-[10px] font-bold min-w-[64px] text-center" style={{ background: sev }}>
                          <div className="font-mono">{x.code}</div><div className="text-[13px]">{x.daysDelayed}d</div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
              <Card title="Delayed Activities">
                {!d?.activities?.length ? <p className="text-xs text-brand-on-surface-variant">No delayed activities. 🎉</p> : (
                  <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[560px]"><thead><tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/15"><th className="px-3 py-2 font-bold">Code</th><th className="px-3 py-2 font-bold">Name</th><th className="px-3 py-2 font-bold text-right">Progress</th><th className="px-3 py-2 font-bold text-right">Days Late</th><th className="px-3 py-2 font-bold">Critical</th></tr></thead>
                    <tbody>{d.activities.map((x: any) => (<tr key={x.code} className={`border-b border-brand-outline-variant/10 last:border-0 ${x.critical ? 'bg-red-50/40' : ''}`}><td className="px-3 py-2 font-mono font-bold text-brand-primary">{x.code}</td><td className="px-3 py-2">{x.name}</td><td className="px-3 py-2 text-right">{x.progressPct}%</td><td className="px-3 py-2 text-right font-bold">{x.daysDelayed}</td><td className="px-3 py-2">{x.critical ? <span className="text-red-600 font-bold">● Yes</span> : 'No'}</td></tr>))}</tbody>
                  </table>
                  </div>
                )}
              </Card>
            </div>
          )}
          {tab === 'profitability' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Budgeted Profit" value={money(a.profitabilityImpact.budgetedProfit)} />
                <Kpi label="Profit Reduction" value={money(a.profitabilityImpact.profitReduction)} tone={a.profitabilityImpact.profitReduction > 0 ? 'bad' : 'good'} />
                <Kpi label="Forecast Profit" value={money(a.profitabilityImpact.forecastProfit)} tone={a.profitabilityImpact.forecastProfit < 0 ? 'bad' : 'good'} />
                <Kpi label="Forecast Margin" value={`${a.profitabilityImpact.forecastMarginPct}%`} tone={a.profitabilityImpact.forecastMarginPct < 5 ? 'bad' : 'good'} />
                <Kpi label="Extra Labor Hours" value={num(a.profitabilityImpact.extraLaborHours)} tone={a.profitabilityImpact.extraLaborHours > 0 ? 'warn' : 'good'} />
                <Kpi label="Add. Labor Cost" value={money(a.profitabilityImpact.additionalLaborCost)} tone={a.profitabilityImpact.additionalLaborCost > 0 ? 'bad' : 'good'} />
                <Kpi label="Add. Equipment Cost" value={money(a.profitabilityImpact.additionalEquipmentCost)} tone={a.profitabilityImpact.additionalEquipmentCost > 0 ? 'bad' : 'good'} />
                <Kpi label="Material Wastage" value={money(a.profitabilityImpact.materialWastageCost)} tone={a.profitabilityImpact.materialWastageCost > 0 ? 'bad' : 'good'} />
                <Kpi label="Delay Cost" value={money(a.profitabilityImpact.delayCost)} tone={a.profitabilityImpact.delayCost > 0 ? 'bad' : 'good'} />
                <Kpi label="Rework Cost" value={money(a.profitabilityImpact.reworkCost)} tone={a.profitabilityImpact.reworkCost > 0 ? 'bad' : 'good'} />
                <Kpi label="Opportunity Cost" value={money(a.profitabilityImpact.opportunityCost)} tone={a.profitabilityImpact.opportunityCost > 0 ? 'warn' : 'good'} />
              </div>
              {(a.trends?.daily ?? []).length > 0 && (
                <Card title="Burndown — cumulative planned vs actual">
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={(() => { let cp = 0; let ca = 0; const total = a.trends.daily.reduce((s: number, t: any) => s + t.planned, 0); return a.trends.daily.map((t: any) => { cp += t.planned; ca += t.actual; return { label: t.label, Remaining: Math.max(0, total - ca), Planned: Math.max(0, total - cp) }; }); })()}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" opacity={0.3} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="Planned" stroke="#9ca3af" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="Remaining" stroke="#471519" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              )}
              <Card title="Progress / Earned Value">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Kpi label="Actual Progress" value={`${a.progress.actualProgressPct}%`} />
                  <Kpi label="Progress Variance" value={`${a.progress.progressVariancePct}%`} tone={a.progress.progressVariancePct < 0 ? 'bad' : 'good'} />
                  <Kpi label="SPI" value={num(a.progress.spi)} tone={a.progress.spi < 1 ? 'bad' : 'good'} />
                  <Kpi label="Earned Value" value={money(a.progress.earnedValue)} />
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
