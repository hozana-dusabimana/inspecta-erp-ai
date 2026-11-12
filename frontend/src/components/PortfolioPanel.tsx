import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { StatusBadge, orNoData } from './StatusBadge';

const money = (n: number) => 'RWF ' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

/**
 * Shown by every project-scoped module when no project is selected: portfolio-wide totals
 * (demo/test projects excluded) plus one row per project. Replaces the empty "All projects" zeros.
 */
export default function PortfolioPanel({ onSelect }: { onSelect: (projectId: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['/portfolio/comparison'], queryFn: () => api.get<any>('/portfolio/comparison') });
  const d = data?.data;
  if (isLoading) return <div className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-6 text-xs text-brand-on-surface-variant">Loading portfolio…</div>;
  if (!d || d.projects.length === 0) return null;
  const c = d.company;
  const live = d.projects.filter((p: any) => !p.isDemo);
  const cards: [string, string][] = [
    ['Projects', String(c.totalProjects)],
    ['Avg progress', orNoData(c.avgProgressPct, (n) => `${n}%`)],
    ['SPI', orNoData(c.spi, (n) => n.toFixed(2))],
    ['CPI', orNoData(c.cpi, (n) => n.toFixed(2))],
    ['Forecast profit', orNoData(c.forecastProfit, money)],
    ['Open NCRs', String(live.reduce((s: number, p: any) => s + (p.openNcrs ?? 0), 0))],
    ['Incidents', String(live.reduce((s: number, p: any) => s + (p.incidents ?? 0), 0))],
  ];
  return (
    <div className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-brand-outline-variant/15 flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-sm text-brand-primary">All projects</h3>
        <span className="text-[11px] text-brand-on-surface-variant">Portfolio totals (demo/test projects excluded). Pick a project to add or edit records.</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 p-4">
        {cards.map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-on-surface-variant">{label}</p>
            <p className="font-mono text-sm font-extrabold text-brand-primary">{value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-brand-on-surface-variant font-bold border-y border-brand-outline-variant/15 bg-brand-surface/40">
              <th className="px-4 py-2">Project</th><th className="px-3 py-2 text-right">Progress</th><th className="px-3 py-2 text-right">SPI</th>
              <th className="px-3 py-2 text-right">Forecast profit</th><th className="px-3 py-2 text-right">Open NCRs</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {d.projects.map((p: any) => (
              <tr key={p.projectId} className="border-b border-brand-outline-variant/10 hover:bg-brand-surface/40">
                <td className="px-4 py-2 font-semibold text-brand-primary">{p.code} — {p.name}{p.isDemo && <span className="ml-2 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-brand-surface-container text-brand-on-surface-variant">demo</span>}</td>
                <td className="px-3 py-2 text-right font-mono">{p.hasProgress ? `${p.progressPct}%` : 'No data'}</td>
                <td className="px-3 py-2 text-right font-mono">{orNoData(p.spi, (n) => n.toFixed(2))}</td>
                <td className="px-3 py-2 text-right font-mono">{orNoData(p.forecastProfit, money)}</td>
                <td className="px-3 py-2 text-right font-mono">{p.openNcrs ?? 0}</td>
                <td className="px-3 py-2"><StatusBadge status={p.healthStatus} /></td>
                <td className="px-3 py-2 text-right"><button onClick={() => onSelect(p.projectId)} className="px-2.5 py-1 rounded-md bg-brand-primary/5 text-brand-primary border border-brand-primary/10 text-[11px] font-bold hover:bg-brand-primary/10">Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
