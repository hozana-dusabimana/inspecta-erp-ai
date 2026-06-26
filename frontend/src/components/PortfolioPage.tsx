import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppView } from '../types';
import { api } from '../lib/api';
import ErpLayout from './ErpLayout';

const money = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const healthDot = (h: string) =>
  h === 'CRITICAL' ? 'bg-red-500' : h === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500';

export default function PortfolioPage({ onNavigate, onLogout }: { onNavigate: (v: AppView) => void; onLogout: () => void }) {
  const { data } = useQuery({ queryKey: ['portfolio'], queryFn: () => api.get<any>('/portfolio/comparison') });
  const s = data?.data;

  return (
    <ErpLayout active={AppView.PORTFOLIO} title="Portfolio Management" subtitle="Multi-project comparison & company KPIs (Module 23)" onNavigate={onNavigate} onLogout={onLogout}>
      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          {[
            ['Projects', String(s.company.totalProjects)],
            ['Total Budget', money(s.company.totalBudget)],
            ['Actual Cost', money(s.company.totalActualCost)],
            ['Avg Progress', `${s.company.avgProgressPct}%`],
            ['At Risk', String(s.company.atRiskProjects)],
          ].map(([label, val], i) => (
            <div key={label} className="bg-white p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
              <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{label}</p>
              <p className={`font-mono text-xl font-extrabold mt-1 ${i === 4 && Number(val) > 0 ? 'text-red-600' : 'text-brand-primary'}`}>{val}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-brand-outline-variant/20 text-brand-on-surface-variant font-bold text-left">
              {['Project', 'Client', 'Health', 'Progress', 'Budget', 'Actual', 'Cost Var.', 'Util %', 'NCRs', 'Incidents', 'Top Risk'].map((h) => (
                <th key={h} className="px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(s?.projects ?? []).map((p: any) => (
              <tr key={p.projectId} className="border-b border-brand-outline-variant/10 hover:bg-brand-surface/40">
                <td className="px-4 py-2.5 font-bold text-brand-primary">{p.code} — {p.name}</td>
                <td className="px-4 py-2.5 text-brand-on-surface-variant">{p.client ?? '—'}</td>
                <td className="px-4 py-2.5"><span className={`inline-block w-2.5 h-2.5 rounded-full ${healthDot(p.health)}`} /></td>
                <td className="px-4 py-2.5 font-mono">{p.progressPct}%</td>
                <td className="px-4 py-2.5 font-mono">{money(p.budget)}</td>
                <td className="px-4 py-2.5 font-mono">{money(p.actualCost)}</td>
                <td className={`px-4 py-2.5 font-mono font-bold ${p.costVariance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(p.costVariance)}</td>
                <td className="px-4 py-2.5 font-mono">{p.budgetUtilizationPct}%</td>
                <td className="px-4 py-2.5 text-center">{p.openNcrs}</td>
                <td className="px-4 py-2.5 text-center">{p.incidents}</td>
                <td className={`px-4 py-2.5 text-center font-bold ${p.topRiskScore >= 15 ? 'text-red-600' : p.topRiskScore >= 8 ? 'text-amber-600' : 'text-emerald-600'}`}>{p.topRiskScore}</td>
              </tr>
            ))}
            {s?.projects?.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-brand-on-surface-variant">No projects yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </ErpLayout>
  );
}
