import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { AppView } from '../types';
import { api } from '../lib/api';
import ErpLayout from './ErpLayout';

const money = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function ProfitabilityPage({ onNavigate, onLogout }: { onNavigate: (v: AppView) => void; onLogout: () => void }) {
  const { data } = useQuery({ queryKey: ['profitability'], queryFn: () => api.get<any>('/profitability/analysis') });
  const s = data?.data;

  return (
    <ErpLayout active={AppView.PROFITABILITY} title="Profitability Intelligence" subtitle="Activity-level margin & leakage detection (Module 14)" onNavigate={onNavigate} onLogout={onLogout}>
      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
            <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">Total Revenue</p>
            <p className="font-mono text-xl font-extrabold mt-1 text-brand-primary">{money(s.totals.revenue)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
            <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">Actual Cost</p>
            <p className="font-mono text-xl font-extrabold mt-1 text-brand-primary">{money(s.totals.actualCost)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
            <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">Forecast Margin</p>
            <p className={`font-mono text-xl font-extrabold mt-1 ${s.totals.forecastMargin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(s.totals.forecastMargin)} ({s.totals.forecastMarginPct}%)</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
            <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">At-Risk Projects</p>
            <p className={`font-mono text-xl font-extrabold mt-1 ${s.totals.atRisk > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{s.totals.atRisk}</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {(s?.projects ?? []).map((p: any) => (
          <div key={p.projectId} className="bg-white rounded-xl border border-brand-outline-variant/20 shadow-sm p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h3 className="font-bold text-sm text-brand-primary">{p.code} — {p.name}</h3>
              <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded-full ${p.forecastMarginPct < 5 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                Margin {p.forecastMarginPct}%
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              {[
                ['Revenue', money(p.revenue)], ['Actual Cost', money(p.actualCost)],
                ['Est. Cost @ Completion', money(p.estCostAtCompletion)],
                ['Earned Value', money(p.earnedValue)], ['Forecast Margin', money(p.forecastMargin)],
              ].map(([label, val]) => (
                <div key={label}>
                  <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase">{label}</p>
                  <p className="font-mono font-bold text-brand-primary">{val}</p>
                </div>
              ))}
            </div>
            {p.leakage.length > 0 && (
              <div className="mt-3 space-y-1">
                {p.leakage.map((l: string, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-semibold text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {l}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {s?.projects?.length === 0 && <div className="text-center text-brand-on-surface-variant text-sm py-8">No projects to analyze.</div>}
      </div>
    </ErpLayout>
  );
}
