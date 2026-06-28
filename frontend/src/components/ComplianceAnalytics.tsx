import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Sparkles, Download } from 'lucide-react';
import { api } from '../lib/api';

const money = (n: unknown) => '$' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const numf = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

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

// 5×5 risk matrix heatmap from risk scores.
function RiskMatrix({ risks }: { risks: { score: number; status: string }[] }) {
  const open = risks.filter((r) => r.status !== 'CLOSED');
  const cell = (lo: number, hi: number) => open.filter((r) => r.score >= lo && r.score <= hi).length;
  const bands = [{ l: 1, h: 4, c: '#48c768', label: 'Low' }, { l: 5, h: 9, c: '#fbbf24', label: 'Medium' }, { l: 10, h: 14, c: '#f59e0b', label: 'High' }, { l: 15, h: 19, c: '#dc2626', label: 'Severe' }, { l: 20, h: 25, c: '#b91c1c', label: 'Critical' }];
  return (
    <div className="flex flex-wrap gap-2">
      {bands.map((b) => (
        <div key={b.label} className="rounded-md px-3 py-2 text-white text-center min-w-[84px]" style={{ background: b.c }}>
          <div className="text-[10px] font-bold uppercase">{b.label}</div>
          <div className="text-xl font-extrabold font-mono">{cell(b.l, b.h)}</div>
          <div className="text-[9px] opacity-80">score {b.l}–{b.h}</div>
        </div>
      ))}
    </div>
  );
}

export default function ComplianceAnalytics({ projectId, mode }: { projectId?: string; mode: 'quality' | 'safety' }) {
  const enabled = Boolean(projectId);
  const kpiUrl = mode === 'quality' ? '/qaqc/kpis' : '/hse/kpis';
  const { data } = useQuery({ queryKey: [kpiUrl, projectId], queryFn: () => api.get<any>(`${kpiUrl}?projectId=${projectId}`), enabled });
  const { data: ai } = useQuery({ queryKey: ['/compliance/ai-risk', projectId], queryFn: () => api.get<any>(`/compliance/ai-risk?projectId=${projectId}`), enabled: enabled && mode === 'quality' });

  if (!projectId) return <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-6 text-sm text-brand-on-surface-variant mb-6">Select a project to view {mode} analytics.</div>;
  const k = data?.data; if (!k) return null;
  const a = ai?.data;

  return (
    <div className="space-y-5 mb-6">
      <div className="flex justify-end">
        <button onClick={() => api.download(`/reports/compliance.xlsx?projectId=${projectId}`, 'compliance-report.xlsx')} className="flex items-center gap-2 bg-brand-surface-container text-brand-primary text-xs font-bold rounded-lg px-4 py-2 border border-brand-outline-variant/20 hover:bg-brand-surface-container-high">
          <Download className="w-4 h-4" /> Export Compliance Report
        </button>
      </div>
      {mode === 'quality' && a && (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold text-brand-primary text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-secondary-container" /> Compliance Insights</h4>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${a.complianceScore >= 80 ? 'bg-emerald-100 text-emerald-700' : a.complianceScore >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>Compliance Score {a.complianceScore}</span>
          </div>
          <ul className="space-y-1.5">
            {a.insights.map((i: any, idx: number) => (
              <li key={idx} className="text-xs flex items-start gap-2">
                <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${i.severity === 'HIGH' ? 'bg-red-100 text-red-700' : i.severity === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{i.severity}</span>
                <span><strong className="text-brand-primary">{i.title}.</strong> <span className="text-brand-on-surface-variant">{i.detail}</span> <em className="text-brand-secondary block text-[11px]">→ {i.recommendation}</em></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'quality' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Inspections" value={numf(k.inspections)} />
            <Kpi label="Defect Rate %" value={`${k.defectRate}%`} tone={k.defectRate > 10 ? 'bad' : 'good'} />
            <Kpi label="Test Pass Rate" value={`${k.testPassRate}%`} tone={k.testPassRate < 90 ? 'warn' : 'good'} />
            <Kpi label="Failed Tests" value={numf(k.testsFailed)} tone={k.testsFailed > 0 ? 'bad' : 'good'} />
            <Kpi label="Open NCRs" value={numf(k.openNcrs)} tone={k.openNcrs > 0 ? 'warn' : 'good'} />
            <Kpi label="Critical NCRs" value={numf(k.criticalNcrs)} tone={k.criticalNcrs > 0 ? 'bad' : 'good'} />
            <Kpi label="Rework Cost" value={money(k.reworkCost)} tone={k.reworkCost > 0 ? 'bad' : 'good'} />
            <Kpi label="Rework Cost %" value={`${k.reworkCostPct}%`} tone={k.reworkCostPct > 3 ? 'bad' : 'good'} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="Defect Heatmap by Inspection Type">
              {(k.defectsByType ?? []).length === 0 ? <p className="text-xs text-brand-on-surface-variant">No inspection data.</p> : (
                <ResponsiveContainer width="100%" height={220}><BarChart data={k.defectsByType}><CartesianGrid strokeDasharray="3 3" stroke="#c4c6d3" opacity={0.3} /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} /><Tooltip /><Bar dataKey="defects" fill="#dc2626" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              )}
            </Card>
            <Card title="NCRs by Status">
              {(k.ncrByStatus ?? []).length === 0 ? <p className="text-xs text-brand-on-surface-variant">No NCRs.</p> : (
                <ResponsiveContainer width="100%" height={220}><BarChart data={k.ncrByStatus}><CartesianGrid strokeDasharray="3 3" stroke="#c4c6d3" opacity={0.3} /><XAxis dataKey="status" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#00286a" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              )}
            </Card>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Safety Score" value={String(k.safetyScore)} tone={k.safetyScore >= 80 ? 'good' : k.safetyScore >= 60 ? 'warn' : 'bad'} />
            <Kpi label="Incidents" value={numf(k.incidents)} tone={k.incidents > 0 ? 'warn' : 'good'} />
            <Kpi label="Near Misses" value={numf(k.nearMiss)} />
            <Kpi label="Lost-Time Injuries" value={numf(k.lostTimeInjuries)} tone={k.lostTimeInjuries > 0 ? 'bad' : 'good'} />
            <Kpi label="Incident Freq. Rate" value={numf(k.incidentFrequencyRate)} tone={k.incidentFrequencyRate > 0 ? 'warn' : 'good'} />
            <Kpi label="Toolbox Talks" value={numf(k.toolboxTalks)} />
            <Kpi label="Safety Inspections" value={numf(k.safetyInspections)} />
            <Kpi label="PPE Expiring (30d)" value={numf(k.ppeExpiringSoon)} tone={k.ppeExpiringSoon > 0 ? 'warn' : 'good'} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="Risk Matrix (open risks)"><RiskMatrix risks={k.riskMatrix ?? []} /></Card>
            <Card title="Incidents by Type">
              {(k.incidentsByType ?? []).length === 0 ? <p className="text-xs text-brand-on-surface-variant">No incidents. 🎉</p> : (
                <ResponsiveContainer width="100%" height={200}><BarChart data={k.incidentsByType}><CartesianGrid strokeDasharray="3 3" stroke="#c4c6d3" opacity={0.3} /><XAxis dataKey="name" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
