import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Wallet, Boxes, ShieldCheck, AlertTriangle, Bot } from 'lucide-react';
import { AppView } from '../types';
import { api } from '../lib/api';
import ErpLayout from './ErpLayout';

interface Props {
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

const money = (n: unknown) => '$' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const numf = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function light(ok: boolean, warn = false) { return warn ? 'bg-amber-500' : ok ? 'bg-emerald-500' : 'bg-red-500'; }

function Kpi({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="bg-brand-surface-container-lowest p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{label}</p>
        {dot && <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />}
      </div>
      <p className="font-mono text-xl font-extrabold mt-1 text-brand-primary">{value}</p>
    </div>
  );
}
function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold text-brand-primary text-sm mb-3 flex items-center gap-2"><Icon className="w-4 h-4 text-brand-secondary-container" /> {title}</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{children}</div>
    </div>
  );
}

export default function ExecutiveDashboard({ onNavigate, onLogout }: Props) {
  const { data: ex } = useQuery({ queryKey: ['/ai/executive'], queryFn: () => api.get<any>('/ai/executive') });
  const { data: al } = useQuery({ queryKey: ['/ai/alerts'], queryFn: () => api.get<any>('/ai/alerts'), refetchInterval: 60_000 });
  const d = ex?.data; const alerts = al?.data?.alerts ?? [];

  return (
    <ErpLayout active={AppView.EXEC_DASH} title="Executive Intelligence" subtitle="Cross-module performance, AI alerts & forecasts" onNavigate={onNavigate} onLogout={onLogout}
      actions={<button onClick={() => onNavigate(AppView.COPILOT)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container"><Bot className="w-4 h-4" /> Ask Copilot</button>}>
      {!d ? <p className="text-xs text-brand-on-surface-variant">Loading executive intelligence…</p> : (
        <div className="space-y-7">
          {/* AI alert engine */}
          <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-brand-outline-variant/15 font-bold text-brand-primary text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-brand-secondary-container" /> AI Alerts ({alerts.length})</div>
            {alerts.length === 0 ? <p className="px-5 py-4 text-xs text-brand-on-surface-variant">No active alerts across the portfolio. 🎉</p> : (
              <ul className="divide-y divide-brand-outline-variant/10">
                {alerts.map((a: any, i: number) => (
                  <li key={i} className="px-5 py-2.5 text-xs flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${a.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' : a.severity === 'HIGH' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>{a.severity}</span>
                    <span className="font-bold text-brand-primary">{a.type.replace(/_/g, ' ')}</span>
                    <span className="text-brand-on-surface-variant">{a.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Section title="Project Performance" icon={Building2}>
            <Kpi label="Projects" value={numf(d.portfolio.totalProjects)} />
            <Kpi label="Active" value={numf(d.portfolio.active)} />
            <Kpi label="Avg Progress" value={`${d.portfolio.avgProgressPct}%`} dot={light(d.portfolio.avgProgressPct >= 50, d.portfolio.avgProgressPct < 50 && d.portfolio.avgProgressPct >= 25)} />
            <Kpi label="Critical Health" value={numf(d.portfolio.health?.CRITICAL)} dot={light((d.portfolio.health?.CRITICAL ?? 0) === 0)} />
          </Section>

          <Section title="Financial Performance" icon={Wallet}>
            <Kpi label="Budget" value={money(d.finance.budget)} />
            <Kpi label="Actual Cost" value={money(d.finance.actualCost)} dot={light(d.finance.actualCost <= d.finance.budget)} />
            <Kpi label="CPI" value={numf(d.finance.evm?.cpi)} dot={light((d.finance.evm?.cpi ?? 0) >= 1, (d.finance.evm?.cpi ?? 0) >= 0.9)} />
            <Kpi label="EAC" value={money(d.finance.evm?.eac)} dot={light((d.finance.evm?.eac ?? 0) <= d.finance.budget)} />
          </Section>

          <Section title="Inventory Performance" icon={Boxes}>
            <Kpi label="Stock Value" value={money(d.inventory.totalStockValue)} />
            <Kpi label="Reorder Items" value={numf(d.inventory.reorderItems?.length)} dot={light((d.inventory.reorderItems?.length ?? 0) === 0)} />
            <Kpi label="Material Waste" value={numf(d.inventory.materialWaste)} />
            <Kpi label="Waste %" value={`${d.inventory.wastePct}%`} dot={light((d.inventory.wastePct ?? 0) <= 5)} />
          </Section>

          <Section title="Compliance Performance" icon={ShieldCheck}>
            <Kpi label="Open NCRs" value={numf(d.compliance.openNcrs)} dot={light((d.compliance.openNcrs ?? 0) === 0)} />
            <Kpi label="Rework Cost" value={money(d.compliance.reworkCost)} dot={light((d.compliance.reworkCost ?? 0) === 0)} />
            <Kpi label="Incidents" value={numf(d.compliance.incidents)} dot={light((d.compliance.incidents ?? 0) === 0)} />
            <Kpi label="Lost-Time" value={numf(d.compliance.lostTime)} dot={light((d.compliance.lostTime ?? 0) === 0)} />
          </Section>
        </div>
      )}
    </ErpLayout>
  );
}
