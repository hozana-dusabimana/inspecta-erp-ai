import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { LayoutDashboard, Boxes, Users, ShoppingCart, Wallet } from 'lucide-react';
import { AppView } from '../types';
import { api } from '../lib/api';
import ErpLayout from './ErpLayout';

interface Props {
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

const money = (n: unknown) => '$' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const num = (n: unknown) => Number(n ?? 0).toLocaleString();
const PIE = ['#00286a', '#ff8a00', '#48c768', '#7c9cff', '#b2c5ff', '#c4c6d3', '#9aa0b4'];

function Kpi({ label, value, tone, light }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad'; light?: string }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-brand-primary';
  const dot = light === 'GREEN' ? 'bg-emerald-500' : light === 'AMBER' ? 'bg-amber-500' : light === 'RED' ? 'bg-red-500' : '';
  return (
    <div className="bg-brand-surface-container-lowest p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{label}</p>
        {dot && <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />}
      </div>
      <p className={`font-mono text-xl font-extrabold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-brand-surface-container-lowest p-5 rounded-xl border border-brand-outline-variant/20 shadow-sm">
      <h3 className="font-bold text-brand-primary text-sm mb-4">{title}</h3>
      {children}
    </div>
  );
}

function toPie(obj: Record<string, number> | undefined) {
  return Object.entries(obj ?? {}).map(([name, value]) => ({ name, value }));
}

function BaselineTab({ projectId }: { projectId: string }) {
  const { data } = useQuery({ queryKey: ['dash-baseline', projectId], queryFn: () => api.get<any>(`/dashboards/baseline${projectId ? `?projectId=${projectId}` : ''}`) });
  const d = data?.data;
  if (!d) return <p className="text-xs text-brand-on-surface-variant animate-pulse p-3">Loading…</p>;
  const chart = [{ name: 'BOQ', Cost: d.boqCost, Budget: d.boqBudget }];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="WBS Items" value={num(d.wbsCount)} />
        <Kpi label="BOQ Items" value={num(d.boqCount)} />
        <Kpi label="BOQ Budget" value={money(d.boqBudget)} />
        <Kpi label="Activities" value={num(d.activitiesCount)} />
        <Kpi label="Milestones" value={num(d.milestonesCount)} />
        <Kpi label="Total Duration (d)" value={num(d.totalDurationDays)} />
        <Kpi label="Planned Span (d)" value={num(d.plannedSpanDays)} />
        <Kpi label="Contract Value" value={d.project ? money(d.project.contractValue) : '—'} />
      </div>
      <Panel title="BOQ Cost vs Budget">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#c4c6d3" opacity={0.3} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
            <Tooltip /><Bar dataKey="Cost" fill="#00286a" radius={[4, 4, 0, 0]} /><Bar dataKey="Budget" fill="#ff8a00" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}

function ResourcesTab() {
  const { data } = useQuery({ queryKey: ['dash-resources'], queryFn: () => api.get<any>('/dashboards/resources') });
  const d = data?.data;
  if (!d) return <p className="text-xs text-brand-on-surface-variant animate-pulse p-3">Loading…</p>;
  const trades = toPie(d.employeesByTrade);
  const ownership = toPie(d.equipmentByOwnership);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Employees" value={num(d.employeesCount)} />
        <Kpi label="Trades" value={num(d.tradesCount)} />
        <Kpi label="Crews" value={num(d.crewsCount)} />
        <Kpi label="Equipment" value={num(d.equipmentCount)} />
        <Kpi label="Productivity Stds" value={num(d.productivityStandards)} />
        <Kpi label="Avg Utilization" value={`${d.avgEquipmentUtilizationPct}%`} light={d.avgUtilizationLight} />
        <Kpi label="Available Days" value={`${num(d.availableDays)}/${num(d.availabilityDays)}`} />
        <Kpi label="Active Staff" value={num(d.activeEmployees)} />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Workforce by Trade">
          {trades.length === 0 ? <p className="text-xs text-brand-on-surface-variant">No employees yet.</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart><Pie data={trades} dataKey="value" nameKey="name" outerRadius={90} label>{trades.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip /></PieChart>
            </ResponsiveContainer>
          )}
        </Panel>
        <Panel title="Equipment by Ownership">
          {ownership.length === 0 ? <p className="text-xs text-brand-on-surface-variant">No equipment yet.</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ownership}><CartesianGrid strokeDasharray="3 3" stroke="#c4c6d3" opacity={0.3} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Bar dataKey="value" fill="#00286a" radius={[4, 4, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ProcurementTab({ projectId }: { projectId: string }) {
  const { data } = useQuery({ queryKey: ['dash-procurement', projectId], queryFn: () => api.get<any>(`/dashboards/procurement${projectId ? `?projectId=${projectId}` : ''}`) });
  const d = data?.data;
  if (!d) return <p className="text-xs text-brand-on-surface-variant animate-pulse p-3">Loading…</p>;
  const prChart = toPie(d.purchaseRequests.byStatus);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Purchase Requests" value={num(d.purchaseRequests.count)} />
        <Kpi label="Pending Approvals" value={num(d.pendingApprovals)} tone={d.pendingApprovals > 0 ? 'warn' : 'good'} />
        <Kpi label="PO Value" value={money(d.purchaseOrders.totalValue)} />
        <Kpi label="POs" value={num(d.purchaseOrders.count)} />
        <Kpi label="RFQs" value={num(d.rfqsCount)} />
        <Kpi label="Quotes (awarded)" value={`${num(d.quotesCount)} (${num(d.awardedQuotes)})`} />
        <Kpi label="Deliveries" value={num(d.deliveries.count)} />
        <Kpi label="Suppliers" value={num(d.suppliersCount)} />
      </div>
      <Panel title="Purchase Requests by Status">
        {prChart.length === 0 ? <p className="text-xs text-brand-on-surface-variant">No purchase requests yet.</p> : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={prChart}><CartesianGrid strokeDasharray="3 3" stroke="#c4c6d3" opacity={0.3} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Bar dataKey="value" fill="#ff8a00" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        )}
      </Panel>
    </div>
  );
}

function BudgetTab({ projectId }: { projectId: string }) {
  const { data } = useQuery({ queryKey: ['dash-budget', projectId], queryFn: () => api.get<any>(`/dashboards/budget${projectId ? `?projectId=${projectId}` : ''}`) });
  const d = data?.data;
  if (!d) return <p className="text-xs text-brand-on-surface-variant animate-pulse p-3">Loading…</p>;
  const chart = [{ name: 'Planned', value: d.plannedCost }, { name: 'Actual', value: d.actualCost }];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Contract Value" value={money(d.contractValue)} />
        <Kpi label="Planned Cost" value={money(d.plannedCost)} />
        <Kpi label="Actual Cost" value={money(d.actualCost)} />
        <Kpi label="Cost Variance" value={money(d.costVariance)} tone={d.costVariance < 0 ? 'bad' : 'good'} />
        <Kpi label="Budget Utilization" value={`${d.budgetUtilizationPct}%`} light={d.budgetLight} />
        <Kpi label="Markup + Contingency" value={money(d.markupAndContingency)} />
        <Kpi label="Profit Margin %" value={d.plannedProfitMargin != null ? `${d.plannedProfitMargin}%` : '—'} />
        <Kpi label="Forecast Profit" value={money(d.forecastProfit)} tone={d.forecastProfit < 0 ? 'bad' : 'good'} />
      </div>
      <Panel title="Planned vs Actual Cost">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#c4c6d3" opacity={0.3} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => money(v)} /><Bar dataKey="value" fill="#00286a" radius={[4, 4, 0, 0]} /></BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}

const TABS = [
  { key: 'baseline', label: 'Baseline', icon: LayoutDashboard },
  { key: 'resources', label: 'Resources', icon: Users },
  { key: 'procurement', label: 'Procurement', icon: ShoppingCart },
  { key: 'budget', label: 'Budget', icon: Wallet },
] as const;

export default function PlanningDashboards({ onNavigate, onLogout }: Props) {
  const [tab, setTab] = useState<'baseline' | 'resources' | 'procurement' | 'budget'>('baseline');
  const [projectId, setProjectId] = useState('');
  const { data: projects } = useQuery({ queryKey: ['projects', 'picker'], queryFn: () => api.get<any[]>('/projects?pageSize=200') });

  const selector = (
    <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
      className="h-10 bg-brand-surface-container-lowest border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary min-w-[220px]">
      <option value="">All projects</option>
      {(projects?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
    </select>
  );

  return (
    <ErpLayout active={AppView.PLANNING_DASH} title="Planning Dashboards" subtitle="Baseline, resources, procurement & budget (Module 1)" onNavigate={onNavigate} onLogout={onLogout} actions={selector}>
      <div className="flex flex-wrap gap-1.5 bg-brand-surface-container p-1 rounded-lg border border-brand-outline-variant/10 mb-6 w-fit">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${tab === t.key ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant hover:text-brand-primary'}`}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'baseline' && <BaselineTab projectId={projectId} />}
      {tab === 'resources' && <ResourcesTab />}
      {tab === 'procurement' && <ProcurementTab projectId={projectId} />}
      {tab === 'budget' && <BudgetTab projectId={projectId} />}
    </ErpLayout>
  );
}
