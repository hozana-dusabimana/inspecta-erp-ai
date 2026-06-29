import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppView } from './types';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import { ModuleDef } from './components/ModuleWorkspace';
import GanttChart from './components/GanttChart';
import WbsTree from './components/WbsTree';
import BoqVersions from './components/BoqVersions';
import ProductionAnalytics from './components/ProductionAnalytics';
import FinanceAnalytics from './components/FinanceAnalytics';
import ComplianceAnalytics from './components/ComplianceAnalytics';
import PayrollWorkspace from './components/PayrollWorkspace';
import PosWorkspace from './components/PosWorkspace';

const opt = (vals: string[]) => vals.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
const money = (n: unknown) => 'RWF ' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const num = (n: unknown) => Number(n ?? 0).toLocaleString();
const date = (d: unknown) => (d ? String(d).slice(0, 10) : '—');

const COST_CATEGORIES = opt(['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCONTRACTOR', 'OVERHEAD', 'OTHER']);
const SEVERITY = opt(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-brand-primary';
  return (
    <div className="bg-brand-surface-container-lowest p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
      <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{label}</p>
      <p className={`font-mono text-xl font-extrabold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

// ── Summary banners (real aggregate endpoints) ────────────────
function FinanceSummary({ projectId }: { projectId?: string }) {
  const { data } = useQuery({
    queryKey: ['finance-summary', projectId ?? 'all'],
    queryFn: () => api.get<any>(`/finance/summary${projectId ? `?projectId=${projectId}` : ''}`),
  });
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard label="Budget" value={money(s.budget)} />
      <StatCard label="Actual Cost" value={money(s.actualCost)} tone={s.actualCost > s.budget ? 'bad' : 'good'} />
      <StatCard label="Cost Variance" value={money(s.costVariance)} tone={s.costVariance < 0 ? 'bad' : 'good'} />
      <StatCard label="Outstanding" value={money(s.outstanding)} tone={s.outstanding > 0 ? 'warn' : 'good'} />
      <StatCard label="Forecast Profit" value={money(s.forecastProfit)} tone={s.forecastProfit < 0 ? 'bad' : 'good'} />
    </div>
  );
}

function ProductionSummary({ projectId }: { projectId?: string }) {
  const { data } = useQuery({
    queryKey: ['production-summary', projectId ?? 'all'],
    queryFn: () => api.get<any>(`/production/summary/metrics${projectId ? `?projectId=${projectId}` : ''}`),
  });
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard label="Entries" value={num(s.entries)} />
      <StatCard label="Planned Qty" value={num(s.totalPlanned)} />
      <StatCard label="Actual Qty" value={num(s.totalActual)} />
      <StatCard label="Productivity Index" value={String(s.productivityIndex)} />
      <StatCard label="Variance %" value={`${s.variancePct}%`} tone={s.variancePct < 0 ? 'bad' : 'good'} />
    </div>
  );
}

function CpmPanel({ projectId }: { projectId?: string }) {
  const { data } = useQuery({
    queryKey: ['cpm', projectId ?? 'none'],
    queryFn: () => api.get<any>(`/scheduling/cpm?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
  if (!projectId) return <div className="text-xs text-brand-on-surface-variant">Select a project to compute the critical path.</div>;
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Activities" value={num(s.activities.length)} />
        <StatCard label="Project Duration (days)" value={num(s.projectDuration)} />
        <StatCard label="Critical Path" value={s.criticalPath.join(' → ') || '—'} tone={s.criticalPath.length ? 'warn' : 'good'} />
      </div>
      {s.activities.length > 0 && (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-brand-outline-variant/20 text-brand-on-surface-variant font-bold text-left">
                {['Code', 'Name', 'Dur', 'ES', 'EF', 'LS', 'LF', 'Float', 'Critical'].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {s.activities.map((a: any) => (
                <tr key={a.code} className={`border-b border-brand-outline-variant/10 ${a.critical ? 'bg-red-50/50' : ''}`}>
                  <td className="px-4 py-2 font-bold">{a.code}</td>
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-4 py-2">{a.duration}</td>
                  <td className="px-4 py-2">{a.es}</td><td className="px-4 py-2">{a.ef}</td>
                  <td className="px-4 py-2">{a.ls}</td><td className="px-4 py-2">{a.lf}</td>
                  <td className="px-4 py-2 font-mono">{a.float}</td>
                  <td className="px-4 py-2">{a.critical ? <span className="text-red-600 font-bold">● Yes</span> : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InventorySummary() {
  const [method, setMethod] = useState<'wavg' | 'fifo'>('wavg');
  const { data } = useQuery({ queryKey: ['inventory-dashboard'], queryFn: () => api.get<any>('/dashboards/inventory') });
  const { data: val } = useQuery({ queryKey: ['inventory-valuation', method], queryFn: () => api.get<any>(`/inventory/valuation?method=${method}`) });
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="space-y-4 mb-2">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Materials" value={num(s.materialsCount)} />
        <StatCard label="Stock Value" value={money(s.totalStockValue)} />
        <StatCard label="Reorder Alerts" value={num(s.reorderCount)} tone={s.reorderCount > 0 ? 'bad' : 'good'} />
        <StatCard label="Dead Stock" value={num(s.deadStockCount)} tone={s.deadStockCount > 0 ? 'warn' : 'good'} />
        <StatCard label="Material Waste %" value={`${s.wastePct}%`} tone={s.wastePct > 5 ? 'bad' : 'good'} />
      </div>
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-brand-outline-variant/15 flex items-center justify-between gap-3">
          <span className="font-bold text-brand-primary text-sm">Inventory Valuation — {money(val?.data?.totalValue)}</span>
          <div className="flex gap-1 bg-brand-surface-container p-0.5 rounded-md">
            {(['wavg', 'fifo'] as const).map((m) => (
              <button key={m} onClick={() => setMethod(m)} className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase ${method === m ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant'}`}>{m === 'wavg' ? 'Weighted Avg' : 'FIFO'}</button>
            ))}
          </div>
        </div>
        {(val?.data?.rows ?? []).length === 0 ? <p className="px-5 py-4 text-xs text-brand-on-surface-variant">No stock yet.</p> : (
          <table className="w-full text-xs"><thead><tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/15"><th className="px-4 py-2 font-bold">Material</th><th className="px-4 py-2 font-bold text-right">Qty</th><th className="px-4 py-2 font-bold text-right">Avg Cost</th><th className="px-4 py-2 font-bold text-right">Value</th></tr></thead>
            <tbody>{(val?.data?.rows ?? []).filter((r: any) => r.quantity !== 0).map((r: any) => (<tr key={r.id} className="border-b border-brand-outline-variant/10 last:border-0"><td className="px-4 py-2">{r.code} — {r.name}</td><td className="px-4 py-2 text-right font-mono">{num(r.quantity)}</td><td className="px-4 py-2 text-right font-mono">{money(r.avgCost)}</td><td className="px-4 py-2 text-right font-mono">{money(r.value)}</td></tr>))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const productivity = (row: Record<string, any>) => {
  const lh = Number(row.laborHours ?? 0);
  return lh > 0 ? (Number(row.actualQty) / lh).toFixed(3) : '—';
};

// Procurement workflow (PR approvals) + MRP — the generic table can't drive
// status transitions, so this panel renders the action buttons and MRP view.
const PR_STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-brand-surface text-brand-on-surface-variant',
  SUBMITTED: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  ORDERED: 'bg-sky-100 text-sky-700',
  DELIVERED: 'bg-violet-100 text-violet-700',
  CLOSED: 'bg-brand-surface text-brand-on-surface-variant',
};
// Allowed actions per status → [label, endpoint action, needs approval perm].
const PR_ACTIONS: Record<string, Array<[string, string, boolean]>> = {
  DRAFT: [['Submit', 'submit', false]],
  SUBMITTED: [['Approve', 'approve', true], ['Reject', 'reject', true]],
  APPROVED: [['Order', 'order', false]],
  ORDERED: [['Mark Delivered', 'deliver', false]],
  DELIVERED: [['Close', 'close', false]],
  REJECTED: [],
  CLOSED: [],
};

function ProcurementPanel() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const [mrpProject, setMrpProject] = useState('');

  const { data: prData } = useQuery({
    queryKey: ['/procurement/purchase-requests', 'all'],
    queryFn: () => api.get<any[]>('/procurement/purchase-requests'),
  });
  const prs = prData?.data ?? [];

  const { data: projects } = useQuery({
    queryKey: ['projects', 'picker'],
    queryFn: () => api.get<any[]>('/projects?pageSize=200'),
  });

  const { data: mrp } = useQuery({
    queryKey: ['/procurement/mrp', mrpProject],
    queryFn: () => api.get<any>(`/procurement/mrp?projectId=${mrpProject}`),
    enabled: Boolean(mrpProject),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api.post(`/procurement/purchase-requests/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/procurement/purchase-requests', 'all'] }),
  });

  const m = mrp?.data;
  return (
    <div className="space-y-6 mb-2">
      {/* PR approval workflow */}
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-brand-outline-variant/15 font-bold text-brand-primary text-sm">
          Purchase Request Workflow
        </div>
        {prs.length === 0 ? (
          <p className="px-5 py-4 text-xs text-brand-on-surface-variant">No purchase requests yet. Create one in the tab below, then drive it through the approval workflow.</p>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/15">
              <th className="px-4 py-2 font-bold">Number</th><th className="px-4 py-2 font-bold">Title</th>
              <th className="px-4 py-2 font-bold text-right">Total</th><th className="px-4 py-2 font-bold">Status</th>
              <th className="px-4 py-2 font-bold text-right">Actions</th>
            </tr></thead>
            <tbody>
              {prs.map((pr) => (
                <tr key={pr.id} className="border-b border-brand-outline-variant/10 last:border-0">
                  <td className="px-4 py-2 font-bold text-brand-primary">{pr.number}</td>
                  <td className="px-4 py-2">{pr.title ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">{money(pr.total)}</td>
                  <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PR_STATUS_TONE[pr.status] ?? ''}`}>{pr.status}</span></td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1.5">
                      {(PR_ACTIONS[pr.status] ?? []).filter(([, , needsApproval]) => !needsApproval || hasPermission('approval:write')).map(([label, action]) => (
                        <button key={action} disabled={act.isPending}
                          onClick={() => act.mutate({ id: pr.id, action })}
                          className="px-2.5 py-1 rounded-md bg-brand-primary text-white text-[10px] font-bold hover:bg-brand-primary-container disabled:opacity-50">
                          {label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* MRP */}
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-brand-outline-variant/15 flex items-center justify-between gap-3">
          <span className="font-bold text-brand-primary text-sm">MRP — Net Material Requirements</span>
          <select value={mrpProject} onChange={(e) => setMrpProject(e.target.value)}
            className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary">
            <option value="">Select a project…</option>
            {(projects?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        {!mrpProject ? (
          <p className="px-5 py-4 text-xs text-brand-on-surface-variant">Pick a project to compute net requirements (planned − stock on hand).</p>
        ) : !m || m.rows.length === 0 ? (
          <p className="px-5 py-4 text-xs text-brand-on-surface-variant">No material requirements planned for this project.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
              <StatCard label="Items to Procure" value={num(m.itemsToProcure)} tone={m.itemsToProcure > 0 ? 'warn' : 'good'} />
              <StatCard label="Est. Net Cost" value={money(m.totalNetCost)} />
              <StatCard label="Requirements" value={num(m.rows.length)} />
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-brand-on-surface-variant border-y border-brand-outline-variant/15">
                <th className="px-4 py-2 font-bold">Material</th><th className="px-4 py-2 font-bold text-right">Planned</th>
                <th className="px-4 py-2 font-bold text-right">On Hand</th><th className="px-4 py-2 font-bold text-right">Net</th>
                <th className="px-4 py-2 font-bold text-right">Est. Cost</th>
              </tr></thead>
              <tbody>
                {m.rows.map((r: any) => (
                  <tr key={r.materialId} className={`border-b border-brand-outline-variant/10 last:border-0 ${r.toProcure ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-4 py-2">{r.code} — {r.name}</td>
                    <td className="px-4 py-2 text-right font-mono">{num(r.plannedQuantity)} {r.unit}</td>
                    <td className="px-4 py-2 text-right font-mono">{num(r.onHand)}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold">{num(r.netRequirement)}</td>
                    <td className="px-4 py-2 text-right font-mono">{money(r.estimatedCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// WBS/BOQ Excel import & export for the selected project.
function PlanningIO({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!projectId) {
    return (
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-4 mb-2 text-xs text-brand-on-surface-variant">
        Select a project above to import/export WBS & BOQ from Excel.
      </div>
    );
  }

  const doExport = (kind: 'wbs' | 'boq') =>
    api.download(`/planning/io/${kind}/export.xlsx?projectId=${projectId}`, `${kind}.xlsx`);

  const doImport = async (kind: 'wbs' | 'boq', file: File) => {
    setBusy(true); setMsg(null);
    try {
      const res = await api.upload<{ created: number; skipped: number; errors: string[] }>(`/planning/io/${kind}/import?projectId=${projectId}`, file);
      const d = res.data;
      setMsg(`${kind.toUpperCase()}: imported ${d.created}${d.skipped ? `, skipped ${d.skipped}` : ''}.${d.errors?.length ? ' ' + d.errors[0] : ''}`);
      qc.invalidateQueries({ queryKey: [`/planning/${kind}`] });
    } catch (e) {
      setMsg(`Import failed: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ kind, label }: { kind: 'wbs' | 'boq'; label: string }) => (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-bold text-brand-primary w-10">{label}</span>
      <button onClick={() => doExport(kind)} className="px-3 py-1.5 rounded-md bg-brand-primary/5 text-brand-primary border border-brand-primary/10 text-[11px] font-bold hover:bg-brand-primary/10">Export .xlsx</button>
      <label className={`px-3 py-1.5 rounded-md bg-brand-primary text-white text-[11px] font-bold cursor-pointer hover:bg-brand-primary-container ${busy ? 'opacity-50' : ''}`}>
        Import .xlsx
        <input type="file" accept=".xlsx" className="hidden" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(kind, f); e.target.value = ''; }} />
      </label>
    </div>
  );

  return (
    <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-4 mb-2 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-brand-primary text-sm">Excel Import / Export</h3>
        {msg && <span className="text-[11px] font-semibold text-brand-on-surface-variant">{msg}</span>}
      </div>
      <Row kind="wbs" label="WBS" />
      <Row kind="boq" label="BOQ" />
      <p className="text-[10px] text-brand-on-surface-variant">Tip: export to get the exact column template, fill rows, then import.</p>
    </div>
  );
}

// KPI banners shown above the tabs (consistent with Finance/Inventory).
function PosSummary() {
  const { data } = useQuery({ queryKey: ['/pos/summary'], queryFn: () => api.get<any>('/pos/summary') });
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Total Sales" value={money(s.totalSales)} />
      <StatCard label="VAT Collected" value={money(s.totalVat)} />
      <StatCard label="Transactions" value={num(s.transactions)} />
      <StatCard label="Open Tills" value={num(s.openSessions)} />
    </div>
  );
}

function PayrollSummary() {
  const { data } = useQuery({ queryKey: ['/payroll/summary'], queryFn: () => api.get<any>('/payroll/summary') });
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Active Employees" value={num(s.activeEmployees)} />
      <StatCard label="Payroll Runs" value={num(s.totalRuns)} />
      <StatCard label="Latest Net Pay" value={money(s.latestRun?.totalNet)} />
      <StatCard label="Latest PAYE" value={money(s.latestRun?.totalPaye)} />
    </div>
  );
}

export const MODULES: Record<string, ModuleDef> = {
  [AppView.PLANNING]: {
    view: AppView.PLANNING,
    title: 'Planning & Resources',
    subtitle: 'Project setup, WBS, BOQ & resource baseline (Module 1)',
    summary: (pid) => <PlanningIO projectId={pid} />,
    tabs: [
      {
        key: 'projects', label: 'Project Setup', endpoint: '/projects', entityLabel: 'Project',
        filters: [{ field: 'status', label: 'Status', options: opt(['PLANNING', 'ACTIVE', 'ON_HOLD', 'AT_RISK', 'COMPLETED', 'CANCELLED']) }],
        readPerm: 'project:read', writePerm: 'project:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name', sortable: true },
          { key: 'status', label: 'Status' },
          { key: 'groundSurface', label: 'Ground', align: 'right', render: (r) => r.groundSurface != null ? `${num(r.groundSurface)} ${r.groundSurfaceUnit ?? 'm²'}` : '—' },
          { key: 'buildingSurface', label: 'Building (m²)', align: 'right', render: (r) => r.buildingSurface != null ? num(r.buildingSurface) : '—' },
          { key: 'budget', label: 'Contract Value', align: 'right', render: (r) => money(r.budget) },
          { key: 'progressPct', label: 'Progress', align: 'right', render: (r) => `${num(r.progressPct)}%` },
        ],
        fields: [
          { name: 'code', label: 'Project Code (auto-generated)', hideOnCreate: true, readOnly: true },
          { name: 'name', label: 'Project Name', required: true },
          { name: 'projectType', label: 'Project Type' },
          { name: 'category', label: 'Category' },
          { name: 'applicationNumber', label: 'Application Number' },
          { name: 'permitNumber', label: 'Permit Number' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['PLANNING', 'ACTIVE', 'ON_HOLD', 'AT_RISK', 'COMPLETED', 'CANCELLED']) },
          { name: 'clientId', label: 'Client', type: 'select', optionsEndpoint: '/clients', optionLabel: (r) => r.name },
          { name: 'managerId', label: 'Project Manager', type: 'select', optionsEndpoint: '/users', optionLabel: (r) => r.fullName },
          { name: 'budget', label: 'Contract Value', type: 'number' },
          { name: 'currency', label: 'Currency (e.g. RWF)' },
          { name: 'plannedProfitMargin', label: 'Planned Profit Margin %', type: 'number', placeholder: 'Percentage 0–100 (e.g. 15)' },
          { name: 'startDate', label: 'Start Date', type: 'date' },
          { name: 'endDate', label: 'Planned End Date', type: 'date' },
          { name: 'forecastFinishDate', label: 'Forecast Finish Date', type: 'date', hideOnCreate: true },
          { name: 'actualEndDate', label: 'Actual End Date', type: 'date', hideOnCreate: true },
          { name: 'location', label: 'Location' },
          { name: 'groundSurface', label: 'Ground Surface', type: 'number' },
          { name: 'groundSurfaceUnit', label: 'Ground Surface Unit', type: 'select', options: opt(['m²', 'are', 'ha', 'ft²', 'acre']) },
          { name: 'buildingSurface', label: 'Building Surface (m²)', type: 'number' },
          { name: 'description', label: 'Description', type: 'textarea' },
        ],
      },
      {
        key: 'clients', label: 'Clients', endpoint: '/clients', entityLabel: 'Client',
        readPerm: 'client:read', writePerm: 'client:write',
        columns: [
          { key: 'name', label: 'Name', sortable: true }, { key: 'contactName', label: 'Contact' },
          { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
        ],
        fields: [
          { name: 'name', label: 'Client Name', required: true },
          { name: 'clientType', label: 'Client Type', type: 'select', options: opt(['private', 'government', 'individual']) },
          { name: 'contactName', label: 'Contact Person' },
          { name: 'phone', label: 'Phone' },
          { name: 'email', label: 'Email' },
          { name: 'taxNumber', label: 'Tax Number (TIN)' },
          { name: 'address', label: 'Address', type: 'textarea' },
        ],
      },
      {
        key: 'contracts', label: 'Contracts', endpoint: '/contracts', entityLabel: 'Contract',
        readPerm: 'contract:read', writePerm: 'contract:write',
        columns: [
          { key: 'reference', label: 'Reference' },
          { key: 'type', label: 'Type', render: (r) => String(r.type).replace(/_/g, ' ') },
          { key: 'status', label: 'Status' },
          { key: 'value', label: 'Value', align: 'right', render: (r) => money(r.value) },
        ],
        fields: [
          { name: 'reference', label: 'Reference', required: true },
          { name: 'contractNumber', label: 'Contract Number' },
          { name: 'clientId', label: 'Client', type: 'select', optionsEndpoint: '/clients', optionLabel: (r) => r.name, required: true },
          { name: 'projectId', label: 'Project', type: 'select', optionsEndpoint: '/projects', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'type', label: 'Contract Type', type: 'select', options: opt(['LUMP_SUM', 'UNIT_PRICE', 'COST_PLUS', 'TIME_AND_MATERIAL']) },
          { name: 'status', label: 'Status', type: 'select', options: opt(['DRAFT', 'ACTIVE', 'CLOSED']) },
          { name: 'value', label: 'Contract Value', type: 'number' },
          { name: 'currency', label: 'Currency (e.g. RWF)' },
          { name: 'contractDate', label: 'Contract Date', type: 'date' },
          { name: 'commencementDate', label: 'Commencement Date', type: 'date' },
          { name: 'signedDate', label: 'Signed Date', type: 'date' },
          { name: 'startDate', label: 'Start Date', type: 'date' },
          { name: 'endDate', label: 'End Date', type: 'date' },
          { name: 'defectsLiabilityMonths', label: 'Defects Liability (months)', type: 'number' },
          { name: 'retentionPct', label: 'Retention %', type: 'number' },
          { name: 'advancePayment', label: 'Advance Payment', type: 'number' },
          { name: 'documentsUrl', label: 'Contract Documents (URL)' },
        ],
      },
      {
        key: 'wbs', label: 'WBS', endpoint: '/planning/wbs', entityLabel: 'WBS Item',
        projectScoped: true, readPerm: 'planning:read', writePerm: 'planning:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Activity' },
          { key: 'level', label: 'Level' }, { key: 'unit', label: 'Unit' },
          { key: 'quantity', label: 'Qty', align: 'right', render: (r) => (r.quantity != null ? num(r.quantity) : '—') },
          { key: 'progressPct', label: 'Progress', align: 'right', render: (r) => `${num(r.progressPct)}%` },
          { key: 'weightPct', label: 'Weight %', align: 'right' },
        ],
        fields: [
          { name: 'code', label: 'Activity Code', required: true },
          { name: 'name', label: 'Activity Name', required: true },
          { name: 'parentId', label: 'Parent (for hierarchy)', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'unit', label: 'Unit' },
          { name: 'quantity', label: 'Quantity', type: 'number' },
          { name: 'level', label: 'Level', type: 'number' },
          { name: 'weightPct', label: 'Weight %', type: 'number' },
          { name: 'progressPct', label: 'Progress %', type: 'number' },
        ],
      },
      {
        key: 'wbs-tree', label: 'WBS Tree', endpoint: '/planning/wbs', entityLabel: 'WBS Item',
        projectScoped: true, readPerm: 'planning:read', writePerm: 'planning:write',
        component: WbsTree, columns: [], fields: [],
      },
      {
        key: 'boq', label: 'BOQ', endpoint: '/planning/boq', entityLabel: 'BOQ Item',
        projectScoped: true, readPerm: 'planning:read', writePerm: 'planning:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'category', label: 'Category' },
          { key: 'description', label: 'Description' },
          { key: 'unit', label: 'Unit' }, { key: 'quantity', label: 'Qty', align: 'right', render: (r) => num(r.quantity) },
          { key: 'rate', label: 'Rate', align: 'right', render: (r) => money(r.rate) },
          { key: 'amount', label: 'Cost', align: 'right', render: (r) => money(r.amount) },
          { key: 'budget', label: 'Budget', align: 'right', render: (r) => money(r.budget) },
          { key: 'revision', label: 'Rev', align: 'right' },
        ],
        fields: [
          { name: 'code', label: 'Code', required: true },
          { name: 'category', label: 'Category' },
          { name: 'description', label: 'Description', required: true },
          { name: 'wbsItemId', label: 'WBS Activity', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'unit', label: 'Unit' },
          { name: 'quantity', label: 'Quantity', type: 'number', required: true },
          { name: 'rate', label: 'Rate', type: 'number', required: true },
          { name: 'markupPct', label: 'Markup %', type: 'number' },
          { name: 'contingencyPct', label: 'Contingency %', type: 'number' },
        ],
      },
      {
        key: 'boq-versions', label: 'BOQ Versions', endpoint: '/planning/boq-versions', entityLabel: 'BOQ Version',
        projectScoped: true, readPerm: 'planning:read', writePerm: 'planning:write',
        component: BoqVersions, columns: [], fields: [],
      },
      {
        key: 'productivity', label: 'Productivity', endpoint: '/planning/productivity', entityLabel: 'Productivity Standard',
        readPerm: 'productivity:read', writePerm: 'productivity:write',
        columns: [
          { key: 'activity', label: 'Activity' }, { key: 'unit', label: 'Unit' },
          { key: 'productivityRate', label: 'Rate (units/crew-day)', align: 'right', render: (r) => num(r.productivityRate) },
          { key: 'companyStandard', label: 'Company Std', align: 'right', render: (r) => (r.companyStandard != null ? num(r.companyStandard) : '—') },
          { key: 'benchmarkSource', label: 'Source' },
        ],
        fields: [
          { name: 'activity', label: 'Activity', required: true },
          { name: 'unit', label: 'Unit', required: true },
          { name: 'productivityRate', label: 'Planned Productivity Rate (units/crew-day)', type: 'number', required: true },
          { name: 'companyStandard', label: 'Company Standard', type: 'number' },
          { name: 'historicalStandard', label: 'Historical Standard', type: 'number' },
          { name: 'benchmarkSource', label: 'Benchmark Source' },
        ],
      },
    ],
  },

  [AppView.HR]: {
    view: AppView.HR,
    title: 'Human Resources',
    subtitle: 'Employee register, trades, wages, crews & availability (Module 1)',
    tabs: [
      {
        key: 'employees', label: 'Employees', endpoint: '/hr/employees', entityLabel: 'Employee',
        filters: [{ field: 'status', label: 'Status', options: opt(['active', 'on_leave', 'terminated']) }],
        summaryCards: [{ key: '__count', label: 'Employees' }, { key: 'grossMonthlySalary', label: 'Monthly Wage Bill', money: true }],
        readPerm: 'hr:read', writePerm: 'hr:write',
        columns: [
          { key: 'employeeNo', label: 'No.' }, { key: 'fullName', label: 'Name' },
          { key: 'trade', label: 'Trade', render: (r) => r.trade?.name ?? '—' },
          { key: 'status', label: 'Status' },
          { key: 'dailyWage', label: 'Daily Wage', align: 'right', render: (r) => (r.dailyWage != null ? money(r.dailyWage) : '—') },
        ],
        fields: [
          { name: 'fullName', label: 'Full Name', required: true },
          { name: 'employeeNo', label: 'Employee No. (auto)', hideOnCreate: true, readOnly: true },
          { name: 'nationalId', label: 'National ID' },
          { name: 'tradeId', label: 'Trade', type: 'select', optionsEndpoint: '/hr/trades', optionLabel: (r) => r.name },
          { name: 'crewId', label: 'Crew', type: 'select', optionsEndpoint: '/hr/crews', optionLabel: (r) => r.name },
          { name: 'projectId', label: 'Project', type: 'select', optionsEndpoint: '/projects', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'phone', label: 'Phone' },
          { name: 'email', label: 'Email' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['active', 'on_leave', 'terminated']) },
          { name: 'dailyWage', label: 'Daily Wage', type: 'number' },
          { name: 'grossMonthlySalary', label: 'Gross Monthly Salary (payroll)', type: 'number' },
          { name: 'medicalScheme', label: 'Medical Scheme', type: 'select', options: opt(['rama', 'private', 'none']) },
          { name: 'hireDate', label: 'Hire Date', type: 'date' },
          { name: 'bankAccountNumber', label: 'Bank Account Number' },
          { name: 'skills', label: 'Skills (comma-separated)', type: 'csv', placeholder: 'Formwork, Rebar' },
          { name: 'certifications', label: 'Certifications (comma-separated)', type: 'csv' },
        ],
      },
      {
        key: 'trades', label: 'Trades', endpoint: '/hr/trades', entityLabel: 'Trade',
        readPerm: 'hr:read', writePerm: 'hr:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name', sortable: true }, { key: 'description', label: 'Description' },
        ],
        fields: [
          { name: 'name', label: 'Trade Name', required: true },
          { name: 'code', label: 'Code (auto)', hideOnCreate: true, readOnly: true },
          { name: 'description', label: 'Description', type: 'textarea' },
        ],
      },
      {
        key: 'wages', label: 'Wage Rates', endpoint: '/hr/wage-rates', entityLabel: 'Wage Rate',
        readPerm: 'hr:read', writePerm: 'hr:write',
        columns: [
          { key: 'trade', label: 'Trade', render: (r) => r.trade?.name ?? '—' },
          { key: 'rateType', label: 'Type' },
          { key: 'amount', label: 'Amount', align: 'right', sortable: true, render: (r) => money(r.amount) },
          { key: 'currency', label: 'Currency' },
          { key: 'effectiveDate', label: 'Effective', render: (r) => date(r.effectiveDate) },
        ],
        fields: [
          { name: 'tradeId', label: 'Trade', type: 'select', optionsEndpoint: '/hr/trades', optionLabel: (r) => r.name, required: true },
          { name: 'rateType', label: 'Rate Type', type: 'select', options: opt(['DAILY', 'HOURLY']) },
          { name: 'amount', label: 'Amount', type: 'number', required: true },
          { name: 'currency', label: 'Currency (e.g. RWF)' },
          { name: 'effectiveDate', label: 'Effective Date', type: 'date' },
        ],
      },
      {
        key: 'crews', label: 'Crews', endpoint: '/hr/crews', entityLabel: 'Crew',
        readPerm: 'hr:read', writePerm: 'hr:write',
        columns: [
          { key: 'name', label: 'Crew' }, { key: 'description', label: 'Description' },
          { key: 'members', label: 'Members', align: 'right', render: (r) => num(r._count?.members ?? 0) },
        ],
        fields: [
          { name: 'name', label: 'Crew Name', required: true },
          { name: 'projectId', label: 'Project', type: 'select', optionsEndpoint: '/projects', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'foremanId', label: 'Foreman', type: 'select', optionsEndpoint: '/hr/employees', optionLabel: (r) => r.fullName },
          { name: 'description', label: 'Description', type: 'textarea' },
        ],
      },
      {
        key: 'crew-members', label: 'Crew Members', endpoint: '/hr/crew-members', entityLabel: 'Crew Member',
        readPerm: 'hr:read', writePerm: 'hr:write',
        columns: [
          { key: 'crew', label: 'Crew', render: (r) => r.crew?.name ?? '—' },
          { key: 'employee', label: 'Employee', render: (r) => r.employee?.fullName ?? '—' },
          { key: 'roleInCrew', label: 'Role' },
        ],
        fields: [
          { name: 'crewId', label: 'Crew', type: 'select', optionsEndpoint: '/hr/crews', optionLabel: (r) => r.name, required: true },
          { name: 'employeeId', label: 'Employee', type: 'select', optionsEndpoint: '/hr/employees', optionLabel: (r) => r.fullName, required: true },
          { name: 'roleInCrew', label: 'Role in Crew' },
        ],
      },
      {
        key: 'availability', label: 'Availability', endpoint: '/hr/availability', entityLabel: 'Availability',
        readPerm: 'hr:read', writePerm: 'hr:write',
        columns: [
          { key: 'employee', label: 'Employee', render: (r) => r.employee?.fullName ?? '—' },
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'available', label: 'Available', render: (r) => (r.available ? 'Yes' : 'No') },
          { key: 'hoursAvailable', label: 'Hours', align: 'right' },
        ],
        fields: [
          { name: 'employeeId', label: 'Employee', type: 'select', optionsEndpoint: '/hr/employees', optionLabel: (r) => r.fullName, required: true },
          { name: 'date', label: 'Date', type: 'date', required: true },
          { name: 'available', label: 'Available?', type: 'select', options: [{ value: 'true', label: 'Available' }, { value: 'false', label: 'Unavailable' }] },
          { name: 'hoursAvailable', label: 'Hours Available', type: 'number' },
          { name: 'note', label: 'Note' },
        ],
      },
    ],
  },

  [AppView.PAYROLL]: {
    view: AppView.PAYROLL,
    title: 'Labor & Payroll',
    subtitle: 'Rwanda RRA PAYE / RSSB payroll runs, payslips & statutory rates (Module 05)',
    summary: () => <PayrollSummary />,
    tabs: [
      {
        key: 'runs', label: 'Payroll Runs', endpoint: '/payroll/runs', entityLabel: 'Payroll Run',
        readPerm: 'payroll:read', writePerm: 'payroll:write',
        columns: [], fields: [],
        component: PayrollWorkspace,
      },
      {
        key: 'statutory', label: 'Statutory Rates', endpoint: '/payroll/statutory-rates', entityLabel: 'Statutory Rate',
        filters: [{ field: 'rateType', label: 'Rate Type', options: opt(['paye_band', 'rssb_pension', 'rssb_maternity', 'rssb_medical', 'rssb_cbhi']) }],
        readPerm: 'payroll:read', writePerm: 'payroll:write',
        columns: [
          { key: 'rateType', label: 'Type', render: (r) => String(r.rateType).replace(/_/g, ' ') },
          { key: 'bandFrom', label: 'Band From', align: 'right', render: (r) => (r.bandFrom != null ? money(r.bandFrom) : '—') },
          { key: 'bandTo', label: 'Band To', align: 'right', render: (r) => (r.bandTo != null ? money(r.bandTo) : '—') },
          { key: 'employeePct', label: 'Emp %', align: 'right', render: (r) => (r.employeePct != null ? `${num(r.employeePct)}%` : '—') },
          { key: 'employerPct', label: 'Empr %', align: 'right', render: (r) => (r.employerPct != null ? `${num(r.employerPct)}%` : '—') },
          { key: 'effectiveFrom', label: 'Effective', render: (r) => date(r.effectiveFrom) },
        ],
        fields: [
          { name: 'rateType', label: 'Rate Type', type: 'select', options: opt(['paye_band', 'rssb_pension', 'rssb_maternity', 'rssb_medical', 'rssb_cbhi']), required: true },
          { name: 'bandFrom', label: 'Band From (PAYE only)', type: 'number' },
          { name: 'bandTo', label: 'Band To (blank = top band)', type: 'number' },
          { name: 'employeePct', label: 'Employee %', type: 'number' },
          { name: 'employerPct', label: 'Employer %', type: 'number' },
          { name: 'effectiveFrom', label: 'Effective From', type: 'date', required: true },
          { name: 'note', label: 'Note' },
        ],
      },
    ],
  },

  [AppView.POS]: {
    view: AppView.POS,
    title: 'Point of Sale',
    subtitle: 'Till sessions, retail sales, VAT receipts & service invoices (Module 09)',
    summary: () => <PosSummary />,
    tabs: [
      {
        key: 'terminal', label: 'Till & Sales', endpoint: '/pos/transactions', entityLabel: 'Sale',
        readPerm: 'pos:read', writePerm: 'pos:write',
        columns: [], fields: [],
        component: PosWorkspace,
      },
      {
        key: 'products', label: 'Products', endpoint: '/pos/products', entityLabel: 'Product',
        filters: [{ field: 'productType', label: 'Type', options: opt(['material', 'equipment_rental', 'service']) }],
        readPerm: 'pos:read', writePerm: 'pos:write',
        columns: [
          { key: 'name', label: 'Name', sortable: true }, { key: 'productType', label: 'Type', render: (r) => String(r.productType).replace(/_/g, ' ') },
          { key: 'unit', label: 'Unit' },
          { key: 'unitPrice', label: 'Price', align: 'right', render: (r) => money(r.unitPrice) },
          { key: 'vatApplicable', label: 'VAT', render: (r) => (r.vatApplicable ? 'Yes' : 'No') },
        ],
        fields: [
          { name: 'name', label: 'Product Name', required: true },
          { name: 'productType', label: 'Type', type: 'select', options: opt(['material', 'equipment_rental', 'service']) },
          { name: 'materialId', label: 'Linked Material (draws down stock)', type: 'select', optionsEndpoint: '/inventory/materials', optionLabel: (m) => `${m.code} — ${m.name}` },
          { name: 'unit', label: 'Unit' },
          { name: 'unitPrice', label: 'Unit Price', type: 'number', required: true },
          { name: 'vatApplicable', label: 'VAT Applicable?', type: 'select', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
        ],
      },
      {
        key: 'service-invoices', label: 'Service Invoices', endpoint: '/pos/service-invoices', entityLabel: 'Service Invoice',
        dateFilter: true, filters: [{ field: 'status', label: 'Status', options: opt(['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']) }],
        summaryCards: [{ key: 'totalAmount', label: 'Total Billed', money: true }, { key: '__count', label: 'Invoices' }],
        readPerm: 'pos:read', writePerm: 'pos:write',
        columns: [
          { key: 'invoiceNumber', label: 'Number' },
          { key: 'client', label: 'Client', render: (r) => r.client?.name ?? r.clientNameFreetext ?? '—' },
          { key: 'description', label: 'Description' },
          { key: 'totalAmount', label: 'Total', align: 'right', render: (r) => money(r.totalAmount) },
          { key: 'status', label: 'Status' },
        ],
        fields: [
          { name: 'invoiceNumber', label: 'Invoice Number', required: true },
          { name: 'clientId', label: 'Client', type: 'select', optionsEndpoint: '/clients', optionLabel: (r) => r.name },
          { name: 'clientNameFreetext', label: 'Client Name (one-off)' },
          { name: 'description', label: 'Description', type: 'textarea', required: true },
          { name: 'amount', label: 'Amount (excl. VAT)', type: 'number', required: true },
          { name: 'vatApplicable', label: 'VAT Applicable?', type: 'select', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
          { name: 'dueDate', label: 'Due Date', type: 'date' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']) },
        ],
      },
    ],
  },

  [AppView.EQUIPMENT]: {
    view: AppView.EQUIPMENT,
    title: 'Equipment Planning',
    subtitle: 'Register, categories, rates, utilization & maintenance (Module 1)',
    tabs: [
      {
        key: 'register', label: 'Register', endpoint: '/equipment/register', entityLabel: 'Equipment',
        readPerm: 'equipment:read', writePerm: 'equipment:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name', sortable: true },
          { key: 'category', label: 'Category', render: (r) => r.category?.name ?? '—' },
          { key: 'ownershipStatus', label: 'Ownership' }, { key: 'status', label: 'Status' },
          { key: 'dailyRate', label: 'Daily Rate', align: 'right', render: (r) => (r.dailyRate != null ? money(r.dailyRate) : '—') },
        ],
        fields: [
          { name: 'name', label: 'Equipment Name', required: true },
          { name: 'code', label: 'Code (auto)', hideOnCreate: true, readOnly: true },
          { name: 'categoryId', label: 'Category', type: 'select', optionsEndpoint: '/equipment/categories', optionLabel: (r) => r.name },
          { name: 'ownershipStatus', label: 'Ownership', type: 'select', options: opt(['OWNED', 'RENTED', 'LEASED']) },
          { name: 'status', label: 'Status', type: 'select', options: opt(['AVAILABLE', 'IN_USE', 'MAINTENANCE']) },
          { name: 'fuelType', label: 'Fuel Type', type: 'select', options: opt(['diesel', 'petrol', 'electric', 'none']) },
          { name: 'primaryProjectId', label: 'Primary Project', type: 'select', optionsEndpoint: '/projects', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'hourlyRate', label: 'Hourly Rate', type: 'number' },
          { name: 'dailyRate', label: 'Daily Rate', type: 'number' },
        ],
      },
      {
        key: 'categories', label: 'Categories', endpoint: '/equipment/categories', entityLabel: 'Category',
        readPerm: 'equipment:read', writePerm: 'equipment:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name', sortable: true }, { key: 'description', label: 'Description' },
        ],
        fields: [
          { name: 'name', label: 'Category Name', required: true },
          { name: 'code', label: 'Code (auto)', hideOnCreate: true, readOnly: true },
          { name: 'description', label: 'Description', type: 'textarea' },
        ],
      },
      {
        key: 'utilization', label: 'Utilization', endpoint: '/equipment/utilization', entityLabel: 'Utilization',
        readPerm: 'equipment:read', writePerm: 'equipment:write',
        columns: [
          { key: 'equipment', label: 'Equipment', render: (r) => r.equipment?.name ?? '—' },
          { key: 'periodStart', label: 'Period', render: (r) => date(r.periodStart) },
          { key: 'plannedHours', label: 'Planned h', align: 'right', render: (r) => num(r.plannedHours) },
          { key: 'availableHours', label: 'Available h', align: 'right', render: (r) => num(r.availableHours) },
          { key: 'utilizationPct', label: 'Utilization', align: 'right', render: (r) => `${num(r.utilizationPct)}%` },
        ],
        fields: [
          { name: 'equipmentId', label: 'Equipment', type: 'select', optionsEndpoint: '/equipment/register', optionLabel: (r) => r.name, required: true },
          { name: 'projectId', label: 'Project', type: 'select', optionsEndpoint: '/projects', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'periodStart', label: 'Period Start', type: 'date' },
          { name: 'plannedHours', label: 'Planned Hours', type: 'number', required: true },
          { name: 'availableHours', label: 'Available Hours', type: 'number', required: true },
          { name: 'note', label: 'Note' },
        ],
      },
      {
        key: 'maintenance', label: 'Maintenance', endpoint: '/equipment/maintenance', entityLabel: 'Maintenance',
        dateFilter: true, filters: [{ field: 'status', label: 'Status', options: opt(['SCHEDULED', 'DONE', 'OVERDUE']) }],
        summaryCards: [{ key: 'cost', label: 'Total Cost', money: true }, { key: 'downtimeHours', label: 'Downtime (h)' }],
        readPerm: 'equipment:read', writePerm: 'equipment:write',
        columns: [
          { key: 'equipment', label: 'Equipment', render: (r) => r.equipment?.name ?? '—' },
          { key: 'type', label: 'Type' },
          { key: 'scheduledDate', label: 'Scheduled', render: (r) => date(r.scheduledDate) },
          { key: 'status', label: 'Status' },
          { key: 'cost', label: 'Cost', align: 'right', render: (r) => (r.cost != null ? money(r.cost) : '—') },
        ],
        fields: [
          { name: 'equipmentId', label: 'Equipment', type: 'select', optionsEndpoint: '/equipment/register', optionLabel: (r) => r.name, required: true },
          { name: 'type', label: 'Maintenance Type', type: 'select', options: opt(['scheduled', 'breakdown_repair']) },
          { name: 'scheduledDate', label: 'Scheduled Date', type: 'date' },
          { name: 'completedDate', label: 'Completed Date', type: 'date' },
          { name: 'nextDueDate', label: 'Next Due Date', type: 'date' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['SCHEDULED', 'DONE', 'OVERDUE']) },
          { name: 'cost', label: 'Cost', type: 'number' },
          { name: 'downtimeHours', label: 'Downtime Hours', type: 'number' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'fuel', label: 'Fuel Logs', endpoint: '/equipment/fuel-logs', entityLabel: 'Fuel Log',
        dateFilter: true,
        summaryCards: [{ key: 'liters', label: 'Total Liters' }, { key: 'totalCost', label: 'Total Fuel Cost', money: true }],
        readPerm: 'equipment:read', writePerm: 'equipment:write',
        columns: [
          { key: 'equipment', label: 'Equipment', render: (r) => r.equipment?.name ?? '—' },
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'liters', label: 'Liters', align: 'right', render: (r) => num(r.liters) },
          { key: 'costPerLiter', label: 'Cost/L', align: 'right', render: (r) => (r.costPerLiter != null ? money(r.costPerLiter) : '—') },
          { key: 'totalCost', label: 'Total', align: 'right', render: (r) => money(r.totalCost) },
        ],
        fields: [
          { name: 'equipmentId', label: 'Equipment', type: 'select', optionsEndpoint: '/equipment/register', optionLabel: (r) => r.name, required: true },
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'liters', label: 'Liters', type: 'number', required: true },
          { name: 'costPerLiter', label: 'Cost per Liter', type: 'number' },
          { name: 'odometerReading', label: 'Odometer / Hour Reading', type: 'number' },
          { name: 'supplier', label: 'Supplier' },
          { name: 'note', label: 'Note' },
        ],
      },
      {
        key: 'usage', label: 'Usage Logs', endpoint: '/equipment/usage-logs', entityLabel: 'Usage Log',
        dateFilter: true,
        summaryCards: [{ key: 'hoursUsed', label: 'Total Hours' }, { key: '__count', label: 'Logs' }],
        readPerm: 'equipment:read', writePerm: 'equipment:write',
        columns: [
          { key: 'equipment', label: 'Equipment', render: (r) => r.equipment?.name ?? '—' },
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'hoursUsed', label: 'Hours', align: 'right', render: (r) => num(r.hoursUsed) },
          { key: 'note', label: 'Note' },
        ],
        fields: [
          { name: 'equipmentId', label: 'Equipment', type: 'select', optionsEndpoint: '/equipment/register', optionLabel: (r) => r.name, required: true },
          { name: 'projectId', label: 'Project', type: 'select', optionsEndpoint: '/projects', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'wbsItemId', label: 'WBS Item (cost allocation)', type: 'text' },
          { name: 'operatorId', label: 'Operator', type: 'select', optionsEndpoint: '/hr/employees', optionLabel: (r) => r.fullName },
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'hoursUsed', label: 'Hours Used', type: 'number', required: true },
          { name: 'note', label: 'Note' },
        ],
      },
    ],
  },

  [AppView.PRODUCTION]: {
    view: AppView.PRODUCTION,
    title: 'Production & Profitability Control',
    subtitle: 'Daily reports, productivity, EVM, delays & profitability impact (Module 2)',
    summary: (pid) => <ProductionAnalytics projectId={pid} />,
    tabs: [
      {
        key: 'reports', label: 'Daily Reports', endpoint: '/production/daily-reports', entityLabel: 'Daily Report',
        projectScoped: true, readPerm: 'production:read', writePerm: 'production:write',
        columns: [
          { key: 'reportNumber', label: 'Number' },
          { key: 'reportDate', label: 'Date', render: (r) => date(r.reportDate) },
          { key: 'shift', label: 'Shift' }, { key: 'weather', label: 'Weather' },
          { key: 'entries', label: 'Entries', align: 'right', render: (r) => num(r._count?.entries ?? 0) },
          { key: 'status', label: 'Status' },
        ],
        fields: [
          { name: 'reportNumber', label: 'Report Number', required: true },
          { name: 'reportDate', label: 'Report Date', type: 'date' },
          { name: 'shift', label: 'Shift', type: 'select', options: opt(['DAY', 'NIGHT']) },
          { name: 'weather', label: 'Weather' },
          { name: 'temperature', label: 'Temperature (°C)', type: 'number' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'entries', label: 'Daily Entries', endpoint: '/production', entityLabel: 'Production Entry',
        dateFilter: true,
        summaryCards: [{ key: 'actualQty', label: 'Actual Qty' }, { key: 'plannedQty', label: 'Planned Qty' }, { key: 'laborHours', label: 'Labor Hours' }],
        projectScoped: true, readPerm: 'production:read', writePerm: 'production:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'wbsActivity', label: 'Activity' },
          { key: 'plannedQty', label: 'Planned', align: 'right', render: (r) => num(r.plannedQty) },
          { key: 'actualQty', label: 'Actual', align: 'right', render: (r) => num(r.actualQty) },
          { key: 'remainingQty', label: 'Remaining', align: 'right', render: (r) => (r.remainingQty != null ? num(r.remainingQty) : '—') },
          { key: 'laborHours', label: 'Labor h', align: 'right', render: (r) => num(r.laborHours) },
          { key: 'equipmentHours', label: 'Equip h', align: 'right', render: (r) => num(r.equipmentHours) },
          { key: 'prod', label: 'Productivity', align: 'right', render: productivity },
        ],
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'dailyReportId', label: 'Daily Report', type: 'select', optionsEndpoint: '/production/daily-reports', optionLabel: (r) => r.reportNumber },
          { name: 'wbsActivity', label: 'WBS Activity', required: true },
          { name: 'wbsItemId', label: 'WBS Item (link)', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'productivityStandardId', label: 'Productivity Standard', type: 'select', optionsEndpoint: '/planning/productivity', optionLabel: (r) => `${r.activity} (${r.productivityRate}/h)` },
          { name: 'crewId', label: 'Crew', type: 'select', optionsEndpoint: '/hr/crews', optionLabel: (r) => r.name },
          { name: 'tradeId', label: 'Trade', type: 'select', optionsEndpoint: '/hr/trades', optionLabel: (r) => r.name },
          { name: 'equipmentId', label: 'Equipment', type: 'select', optionsEndpoint: '/equipment/register', optionLabel: (r) => r.name },
          { name: 'unit', label: 'Unit' },
          { name: 'plannedQty', label: 'Planned Qty', type: 'number', required: true },
          { name: 'actualQty', label: 'Actual Qty', type: 'number', required: true },
          { name: 'remainingQty', label: 'Remaining Qty', type: 'number' },
          { name: 'laborHours', label: 'Labor Hours', type: 'number' },
          { name: 'equipmentHours', label: 'Equipment Hours', type: 'number' },
          { name: 'weatherCondition', label: 'Weather' },
          { name: 'issues', label: 'Issues', type: 'textarea' },
          { name: 'delays', label: 'Delays', type: 'textarea' },
          { name: 'remarks', label: 'Remarks', type: 'textarea' },
        ],
      },
      {
        key: 'materials', label: 'Material Use', endpoint: '/production/materials', entityLabel: 'Material Consumption',
        readPerm: 'production:read', writePerm: 'production:write',
        columns: [
          { key: 'materialId', label: 'Material' },
          { key: 'plannedQty', label: 'Planned', align: 'right', render: (r) => num(r.plannedQty) },
          { key: 'qtyUsed', label: 'Used', align: 'right', render: (r) => num(r.qtyUsed) },
          { key: 'wasteQty', label: 'Waste', align: 'right', render: (r) => num(r.wasteQty) },
        ],
        fields: [
          { name: 'productionEntryId', label: 'Production Entry ID', required: true },
          { name: 'materialId', label: 'Material', type: 'select', optionsEndpoint: '/inventory/materials', optionLabel: (r) => `${r.code} — ${r.name}`, required: true },
          { name: 'plannedQty', label: 'Planned Qty', type: 'number' },
          { name: 'qtyUsed', label: 'Qty Used', type: 'number' },
          { name: 'wasteQty', label: 'Waste Qty', type: 'number' },
        ],
      },
    ],
  },

  [AppView.FINANCE]: {
    view: AppView.FINANCE,
    title: 'Finance & Cost Control',
    subtitle: 'Budgets, costs, cash flow, EVM, billing & inventory (Module 3)',
    summary: (pid) => <FinanceAnalytics projectId={pid} />,
    tabs: [
      {
        key: 'budget', label: 'Budget', endpoint: '/finance/budget', entityLabel: 'Budget Line',
        filters: [{ field: 'category', label: 'Category', options: COST_CATEGORIES }],
        summaryCards: [{ key: 'amount', label: 'Total Budget', money: true }, { key: '__count', label: 'Lines' }],
        projectScoped: true, readPerm: 'finance:read', writePerm: 'finance:write',
        columns: [
          { key: 'budgetType', label: 'Type' }, { key: 'category', label: 'Category' },
          { key: 'description', label: 'Description' },
          { key: 'amount', label: 'Amount', align: 'right', sortable: true, render: (r) => money(r.amount) },
        ],
        fields: [
          { name: 'description', label: 'Description', required: true },
          { name: 'budgetType', label: 'Budget Type', type: 'select', options: opt(['ORIGINAL', 'REVISED', 'FORECAST', 'CONTINGENCY']) },
          { name: 'category', label: 'Category', type: 'select', options: COST_CATEGORIES },
          { name: 'wbsItemId', label: 'WBS Item', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'costCode', label: 'Cost Code' },
          { name: 'amount', label: 'Amount', type: 'number', required: true },
        ],
      },
      {
        key: 'costs', label: 'Actual Costs', endpoint: '/finance/costs', entityLabel: 'Cost Entry',
        dateFilter: true, filters: [{ field: 'category', label: 'Category', options: COST_CATEGORIES }],
        summaryCards: [{ key: 'amount', label: 'Total Cost', money: true }, { key: '__count', label: 'Entries' }],
        projectScoped: true, readPerm: 'finance:read', writePerm: 'finance:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
          { key: 'source', label: 'Source' },
          { key: 'amount', label: 'Amount', align: 'right', sortable: true, render: (r) => money(r.amount) },
        ],
        fields: [
          { name: 'category', label: 'Category', type: 'select', options: COST_CATEGORIES },
          { name: 'description', label: 'Description', required: true },
          { name: 'wbsItemId', label: 'WBS Item', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'amount', label: 'Amount', type: 'number', required: true },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
      {
        key: 'cashflow', label: 'Cash Flow', endpoint: '/finance/cash-flow-entries', entityLabel: 'Cash Movement',
        dateFilter: true, filters: [{ field: 'direction', label: 'Direction', options: opt(['IN', 'OUT']) }],
        summaryCards: [{ key: 'amount', label: 'Total Movement', money: true }, { key: '__count', label: 'Entries' }],
        readPerm: 'finance:read', writePerm: 'finance:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'direction', label: 'Direction' }, { key: 'category', label: 'Category' },
          { key: 'amount', label: 'Amount', align: 'right', sortable: true, render: (r) => money(r.amount) },
          { key: 'reference', label: 'Reference' },
        ],
        fields: [
          { name: 'direction', label: 'Direction', type: 'select', options: opt(['IN', 'OUT']), required: true },
          { name: 'category', label: 'Category', type: 'select', options: opt(['CLIENT_PAYMENT', 'ADVANCE', 'RETENTION_RELEASE', 'OTHER_INCOME', 'PAYROLL', 'SUPPLIER', 'EQUIPMENT', 'SUBCONTRACTOR', 'OVERHEAD', 'OTHER']), required: true },
          { name: 'amount', label: 'Amount', type: 'number', required: true },
          { name: 'isForecast', label: 'Type', type: 'select', options: [{ value: 'false', label: 'Actual / realized' }, { value: 'true', label: 'Forecast / projected' }] },
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'reference', label: 'Reference' },
          { name: 'note', label: 'Note', type: 'textarea' },
        ],
      },
      {
        key: 'invoices', label: 'Invoices / IPC', endpoint: '/finance/invoices', entityLabel: 'Invoice',
        dateFilter: true, filters: [{ field: 'status', label: 'Status', options: opt(['DRAFT', 'SUBMITTED', 'CERTIFIED', 'APPROVED', 'PAID', 'REJECTED']) }],
        summaryCards: [{ key: 'amount', label: 'Billed', money: true }, { key: 'netAmount', label: 'Net (IPC)', money: true }, { key: '__count', label: 'Invoices' }],
        projectScoped: true, readPerm: 'finance:read', writePerm: 'finance:write',
        columns: [
          { key: 'number', label: 'Number', sortable: true }, { key: 'description', label: 'Description' },
          { key: 'status', label: 'Status' },
          { key: 'amount', label: 'Amount', align: 'right', sortable: true, render: (r) => money(r.amount) },
          { key: 'issueDate', label: 'Issued', render: (r) => date(r.issueDate) },
        ],
        fields: [
          { name: 'number', label: 'Invoice Number (auto)', hideOnCreate: true, readOnly: true },
          { name: 'description', label: 'Description' },
          { name: 'amount', label: 'Amount (if not an IPC)', type: 'number', required: true },
          { name: 'status', label: 'Status', type: 'select', options: opt(['DRAFT', 'SUBMITTED', 'CERTIFIED', 'APPROVED', 'PAID', 'REJECTED']) },
          { name: 'isIpc', label: 'Is IPC?', type: 'select', options: [{ value: 'false', label: 'Invoice' }, { value: 'true', label: 'IPC / Certificate' }] },
          { name: 'certificateNumber', label: 'Certificate No.' },
          { name: 'periodStart', label: 'Period Start (IPC)', type: 'date' },
          { name: 'periodEnd', label: 'Period End (IPC)', type: 'date' },
          { name: 'grossValuation', label: 'Gross Valuation (IPC)', type: 'number' },
          { name: 'previousCertified', label: 'Previously Certified', type: 'number' },
          { name: 'retentionPct', label: 'Retention %', type: 'number' },
          { name: 'advanceDeduction', label: 'Advance Deduction', type: 'number' },
          { name: 'taxPct', label: 'Tax %', type: 'number' },
          { name: 'certifiedAmount', label: 'Certified Amount', type: 'number' },
          { name: 'issueDate', label: 'Issue Date', type: 'date' },
          { name: 'submittedDate', label: 'Submitted Date', type: 'date' },
          { name: 'paidDate', label: 'Paid Date', type: 'date' },
          { name: 'dueDate', label: 'Due Date', type: 'date' },
        ],
      },
      {
        key: 'payments', label: 'Payments', endpoint: '/finance/payments', entityLabel: 'Payment',
        dateFilter: true,
        summaryCards: [{ key: 'amount', label: 'Total Received', money: true }, { key: '__count', label: 'Payments' }],
        projectScoped: true, readPerm: 'finance:read', writePerm: 'finance:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'reference', label: 'Reference' },
          { key: 'amount', label: 'Amount', align: 'right', sortable: true, render: (r) => money(r.amount) },
        ],
        fields: [
          { name: 'reference', label: 'Reference (auto)', hideOnCreate: true, readOnly: true },
          { name: 'amount', label: 'Amount', type: 'number', required: true },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
    ],
  },

  [AppView.INVENTORY]: {
    view: AppView.INVENTORY,
    title: 'Inventory Control',
    subtitle: 'Material register, stock ledger & reorder alerts (Module 4)',
    summary: () => <InventorySummary />,
    tabs: [
      {
        key: 'materials', label: 'Materials', endpoint: '/inventory/materials', entityLabel: 'Material',
        readPerm: 'inventory:read', writePerm: 'inventory:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name', sortable: true }, { key: 'unit', label: 'Unit' },
          { key: 'reorderLevel', label: 'Reorder', align: 'right', render: (r) => num(r.reorderLevel) },
          { key: 'unitCost', label: 'Unit Cost', align: 'right', render: (r) => money(r.unitCost) },
        ],
        fields: [
          { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true },
          { name: 'category', label: 'Category' },
          { name: 'supplierId', label: 'Supplier', type: 'select', optionsEndpoint: '/procurement/suppliers', optionLabel: (r) => r.name },
          { name: 'unit', label: 'Unit' }, { name: 'reorderLevel', label: 'Reorder Level', type: 'number' },
          { name: 'unitCost', label: 'Unit Cost', type: 'number' },
          { name: 'standardCost', label: 'Standard Cost', type: 'number' },
        ],
      },
      {
        key: 'movements', label: 'Stock Movements', endpoint: '/inventory/movements', entityLabel: 'Movement',
        dateFilter: true, filters: [{ field: 'type', label: 'Type', options: opt(['OPENING', 'RECEIPT', 'ISSUE', 'POS_SALE', 'ADJUSTMENT', 'TRANSFER', 'RETURN', 'WASTE']) }],
        summaryCards: [{ key: 'quantity', label: 'Total Qty Moved' }, { key: '__count', label: 'Movements' }],
        readPerm: 'inventory:read', writePerm: 'inventory:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'material', label: 'Material', render: (r) => r.material?.name ?? '—' },
          { key: 'type', label: 'Type' },
          { key: 'quantity', label: 'Qty', align: 'right', render: (r) => num(r.quantity) },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'reference', label: 'Reference' },
        ],
        fields: [
          { name: 'materialId', label: 'Material', optionsEndpoint: '/inventory/materials', optionLabel: (m) => `${m.code} — ${m.name}`, required: true },
          { name: 'type', label: 'Type', type: 'select', options: opt(['OPENING', 'RECEIPT', 'ISSUE', 'POS_SALE', 'ADJUSTMENT', 'TRANSFER', 'RETURN', 'WASTE']), required: true },
          { name: 'quantity', label: 'Quantity', type: 'number', required: true },
          { name: 'unitCost', label: 'Unit Cost', type: 'number' },
          { name: 'reference', label: 'Reference (GRN/Issue No.)' },
          { name: 'wbsItemId', label: 'WBS Item (cost allocation)' },
          { name: 'warehouse', label: 'Warehouse' },
          { name: 'requestedBy', label: 'Requested By' },
          { name: 'approvedBy', label: 'Approved By' },
          { name: 'note', label: 'Note', type: 'textarea' },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
      {
        key: 'requirements', label: 'Material Planning', endpoint: '/inventory/requirements', entityLabel: 'Material Requirement',
        projectScoped: true, readPerm: 'inventory:read', writePerm: 'inventory:write',
        columns: [
          { key: 'material', label: 'Material', render: (r) => r.material?.name ?? '—' },
          { key: 'plannedQuantity', label: 'Planned Qty', align: 'right', render: (r) => num(r.plannedQuantity) },
          { key: 'requiredByDate', label: 'Required By', render: (r) => date(r.requiredByDate) },
          { key: 'leadTimeDays', label: 'Lead (days)', align: 'right' },
          { key: 'status', label: 'Status' },
        ],
        fields: [
          { name: 'materialId', label: 'Material', type: 'select', optionsEndpoint: '/inventory/materials', optionLabel: (m) => `${m.code} — ${m.name}`, required: true },
          { name: 'plannedQuantity', label: 'Planned Quantity', type: 'number', required: true },
          { name: 'requiredByDate', label: 'Required By', type: 'date' },
          { name: 'supplierId', label: 'Preferred Supplier', type: 'select', optionsEndpoint: '/procurement/suppliers', optionLabel: (r) => r.name },
          { name: 'leadTimeDays', label: 'Lead Time (days)', type: 'number' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['PLANNED', 'REQUESTED', 'ORDERED', 'FULFILLED']) },
          { name: 'note', label: 'Note', type: 'textarea' },
        ],
      },
      {
        key: 'grn', label: 'Goods Received (GRN)', endpoint: '/inventory/grn', entityLabel: 'GRN',
        dateFilter: true,
        summaryCards: [{ key: 'quantityReceived', label: 'Total Received' }, { key: '__count', label: 'GRNs' }],
        readPerm: 'inventory:read', writePerm: 'inventory:write',
        columns: [
          { key: 'grnNumber', label: 'GRN No.' },
          { key: 'dateReceived', label: 'Received', render: (r) => date(r.dateReceived) },
          { key: 'quantityReceived', label: 'Qty', align: 'right', render: (r) => num(r.quantityReceived) },
          { key: 'supplierName', label: 'Supplier' },
        ],
        fields: [
          { name: 'materialId', label: 'Material', type: 'select', optionsEndpoint: '/inventory/materials', optionLabel: (m) => `${m.code} — ${m.name}`, required: true },
          { name: 'grnNumber', label: 'GRN Number' },
          { name: 'quantityReceived', label: 'Quantity Received', type: 'number', required: true },
          { name: 'unitCost', label: 'Unit Cost', type: 'number' },
          { name: 'dateReceived', label: 'Date Received', type: 'date' },
          { name: 'purchaseOrderId', label: 'Purchase Order', type: 'select', optionsEndpoint: '/procurement/purchase-orders', optionLabel: (r) => r.number },
          { name: 'supplierName', label: 'Supplier Name' },
          { name: 'receivedBy', label: 'Received By' },
          { name: 'note', label: 'Note' },
        ],
      },
      {
        key: 'issues', label: 'Material Issues', endpoint: '/inventory/material-issues', entityLabel: 'Material Issue',
        dateFilter: true,
        summaryCards: [{ key: 'quantityIssued', label: 'Total Issued' }, { key: '__count', label: 'Issues' }],
        projectScoped: true, readPerm: 'inventory:read', writePerm: 'inventory:write',
        columns: [
          { key: 'issueNumber', label: 'Issue No.' },
          { key: 'dateIssued', label: 'Issued', render: (r) => date(r.dateIssued) },
          { key: 'quantityIssued', label: 'Qty', align: 'right', render: (r) => num(r.quantityIssued) },
          { key: 'issuedTo', label: 'Issued To' },
        ],
        fields: [
          { name: 'materialId', label: 'Material', type: 'select', optionsEndpoint: '/inventory/materials', optionLabel: (m) => `${m.code} — ${m.name}`, required: true },
          { name: 'issueNumber', label: 'Issue Number' },
          { name: 'quantityIssued', label: 'Quantity Issued', type: 'number', required: true },
          { name: 'wbsItemId', label: 'WBS Item (cost allocation)' },
          { name: 'dateIssued', label: 'Date Issued', type: 'date' },
          { name: 'issuedTo', label: 'Issued To' },
          { name: 'note', label: 'Note' },
        ],
      },
    ],
  },

  [AppView.PROCUREMENT]: {
    view: AppView.PROCUREMENT,
    title: 'Procurement Planning',
    subtitle: 'Requests, RFQs, orders, deliveries, approvals & MRP (Module 1 / 17)',
    summary: () => <ProcurementPanel />,
    tabs: [
      {
        key: 'suppliers', label: 'Suppliers', endpoint: '/procurement/suppliers', entityLabel: 'Supplier',
        readPerm: 'procurement:read', writePerm: 'procurement:write',
        columns: [
          { key: 'name', label: 'Name', sortable: true }, { key: 'contactName', label: 'Contact' },
          { key: 'rating', label: 'Rating', align: 'right' },
          { key: 'leadTimeDays', label: 'Lead (days)', align: 'right' },
        ],
        fields: [
          { name: 'name', label: 'Name', required: true }, { name: 'category', label: 'Category', placeholder: 'Cement & Concrete' },
          { name: 'contactName', label: 'Contact Name' },
          { name: 'email', label: 'Email' }, { name: 'phone', label: 'Phone' },
          { name: 'tinNumber', label: 'TIN Number' }, { name: 'paymentTerms', label: 'Payment Terms', placeholder: 'Net 30' },
          { name: 'rating', label: 'Rating (0-5)', type: 'number' }, { name: 'leadTimeDays', label: 'Lead Time (days)', type: 'number' },
        ],
      },
      {
        key: 'pos', label: 'Purchase Orders', endpoint: '/procurement/purchase-orders', entityLabel: 'Purchase Order',
        dateFilter: true, filters: [{ field: 'status', label: 'Status', options: opt(['DRAFT', 'ISSUED', 'PARTIAL', 'RECEIVED', 'CANCELLED']) }],
        summaryCards: [{ key: 'total', label: 'Total PO Value', money: true }, { key: '__count', label: 'POs' }],
        readPerm: 'procurement:read', writePerm: 'procurement:write',
        columns: [
          { key: 'number', label: 'Number', sortable: true },
          { key: 'supplier', label: 'Supplier', render: (r) => r.supplier?.name ?? '—' },
          { key: 'status', label: 'Status' },
          { key: 'total', label: 'Total', align: 'right', sortable: true, render: (r) => money(r.total) },
        ],
        fields: [
          { name: 'number', label: 'PO Number (auto)', hideOnCreate: true, readOnly: true },
          { name: 'supplierId', label: 'Supplier', optionsEndpoint: '/procurement/suppliers', optionLabel: (s) => s.name, required: true },
          { name: 'purchaseRequestId', label: 'From Purchase Request', type: 'select', optionsEndpoint: '/procurement/purchase-requests', optionLabel: (r) => r.number },
          { name: 'projectId', label: 'Project', type: 'select', optionsEndpoint: '/projects', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'status', label: 'Status', type: 'select', options: opt(['DRAFT', 'ISSUED', 'PARTIAL', 'RECEIVED', 'CANCELLED']) },
          { name: 'expectedDate', label: 'Expected Date', type: 'date' },
        ],
      },
      {
        key: 'prs', label: 'Purchase Requests', endpoint: '/procurement/purchase-requests', entityLabel: 'Purchase Request',
        filters: [{ field: 'status', label: 'Status', options: opt(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'DELIVERED', 'CLOSED']) }],
        summaryCards: [{ key: 'total', label: 'Total Requested', money: true }, { key: '__count', label: 'Requests' }],
        readPerm: 'procurement:read', writePerm: 'procurement:write',
        columns: [
          { key: 'number', label: 'Number', sortable: true }, { key: 'title', label: 'Title' },
          { key: 'status', label: 'Status' },
          { key: 'total', label: 'Total', align: 'right', sortable: true, render: (r) => money(r.total) },
        ],
        fields: [
          { name: 'number', label: 'PR Number', required: true },
          { name: 'title', label: 'Title' },
          { name: 'projectId', label: 'Project', type: 'select', optionsEndpoint: '/projects', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'neededByDate', label: 'Needed By', type: 'date' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'rfqs', label: 'RFQs', endpoint: '/procurement/rfqs', entityLabel: 'RFQ',
        readPerm: 'procurement:read', writePerm: 'procurement:write',
        columns: [
          { key: 'number', label: 'Number', sortable: true }, { key: 'status', label: 'Status' },
          { key: 'dueDate', label: 'Due', render: (r) => date(r.dueDate) },
        ],
        fields: [
          { name: 'number', label: 'RFQ Number (auto)', hideOnCreate: true, readOnly: true },
          { name: 'purchaseRequestId', label: 'From Purchase Request', type: 'select', optionsEndpoint: '/procurement/purchase-requests', optionLabel: (r) => r.number },
          { name: 'status', label: 'Status', type: 'select', options: opt(['DRAFT', 'SENT', 'AWARDED', 'CLOSED']) },
          { name: 'dueDate', label: 'Due Date', type: 'date' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'quotes', label: 'Quotes', endpoint: '/procurement/rfq-quotes', entityLabel: 'Quote',
        readPerm: 'procurement:read', writePerm: 'procurement:write',
        columns: [
          { key: 'rfq', label: 'RFQ', render: (r) => r.rfq?.number ?? '—' },
          { key: 'totalAmount', label: 'Amount', align: 'right', render: (r) => money(r.totalAmount) },
          { key: 'leadTimeDays', label: 'Lead (days)', align: 'right' },
          { key: 'awarded', label: 'Awarded', render: (r) => (r.awarded ? '★ Yes' : 'No') },
        ],
        fields: [
          { name: 'rfqId', label: 'RFQ', type: 'select', optionsEndpoint: '/procurement/rfqs', optionLabel: (r) => r.number, required: true },
          { name: 'supplierId', label: 'Supplier', type: 'select', optionsEndpoint: '/procurement/suppliers', optionLabel: (r) => r.name, required: true },
          { name: 'totalAmount', label: 'Quoted Amount', type: 'number', required: true },
          { name: 'leadTimeDays', label: 'Lead Time (days)', type: 'number' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'deliveries', label: 'Deliveries', endpoint: '/procurement/deliveries', entityLabel: 'Delivery',
        dateFilter: true, filters: [{ field: 'status', label: 'Status', options: opt(['PENDING', 'PARTIAL', 'RECEIVED']) }],
        readPerm: 'procurement:read', writePerm: 'procurement:write',
        columns: [
          { key: 'number', label: 'Number', sortable: true },
          { key: 'purchaseOrder', label: 'PO', render: (r) => r.purchaseOrder?.number ?? '—' },
          { key: 'status', label: 'Status' },
          { key: 'deliveryDate', label: 'Date', render: (r) => date(r.deliveryDate) },
        ],
        fields: [
          { name: 'number', label: 'Delivery Note No. (auto)', hideOnCreate: true, readOnly: true },
          { name: 'purchaseOrderId', label: 'Purchase Order', type: 'select', optionsEndpoint: '/procurement/purchase-orders', optionLabel: (r) => r.number },
          { name: 'status', label: 'Status', type: 'select', options: opt(['PENDING', 'PARTIAL', 'RECEIVED']) },
          { name: 'deliveryDate', label: 'Delivery Date', type: 'date' },
          { name: 'receivedBy', label: 'Received By' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
    ],
  },

  [AppView.QAQC]: {
    view: AppView.QAQC,
    title: 'Quality & Compliance',
    subtitle: 'Inspections, material testing, NCRs, corrective actions & rework (Module 4)',
    summary: (pid) => <ComplianceAnalytics projectId={pid} mode="quality" />,
    tabs: [
      {
        key: 'inspections', label: 'Inspections', endpoint: '/qaqc/inspections', entityLabel: 'Inspection',
        dateFilter: true, filters: [{ field: 'result', label: 'Result', options: opt(['PASS', 'FAIL', 'PENDING']) }],
        projectScoped: true, readPerm: 'qaqc:read', writePerm: 'qaqc:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'title', label: 'Title' }, { key: 'type', label: 'Type' },
          { key: 'result', label: 'Result' }, { key: 'defects', label: 'Defects', align: 'right' },
          { key: 'inspector', label: 'Inspector' },
        ],
        fields: [
          { name: 'title', label: 'Title', required: true }, { name: 'type', label: 'Type' },
          { name: 'wbsItemId', label: 'WBS Activity', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'result', label: 'Result', type: 'select', options: opt(['PASS', 'FAIL', 'PENDING']) },
          { name: 'defects', label: 'Defects', type: 'number' },
          { name: 'inspector', label: 'Inspector' }, { name: 'date', label: 'Date', type: 'date' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'tests', label: 'Material Tests', endpoint: '/qaqc/material-tests', entityLabel: 'Material Test',
        filters: [{ field: 'result', label: 'Result', options: opt(['PASS', 'FAIL', 'PENDING']) }, { field: 'testType', label: 'Type', options: opt(['CONCRETE', 'SOIL', 'ASPHALT', 'STEEL', 'OTHER']) }],
        projectScoped: true, readPerm: 'qaqc:read', writePerm: 'qaqc:write',
        columns: [
          { key: 'sampleDate', label: 'Sampled', render: (r) => date(r.sampleDate) },
          { key: 'testType', label: 'Type' }, { key: 'batchNumber', label: 'Batch' },
          { key: 'result', label: 'Result' }, { key: 'certificateNumber', label: 'Cert No.' },
        ],
        fields: [
          { name: 'testType', label: 'Test Type', type: 'select', options: opt(['CONCRETE', 'SOIL', 'ASPHALT', 'STEEL', 'OTHER']) },
          { name: 'materialId', label: 'Material', type: 'select', optionsEndpoint: '/inventory/materials', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'supplierId', label: 'Supplier', type: 'select', optionsEndpoint: '/procurement/suppliers', optionLabel: (r) => r.name },
          { name: 'batchNumber', label: 'Batch Number' },
          { name: 'sampleDate', label: 'Sample Date', type: 'date' },
          { name: 'resultDate', label: 'Result Date', type: 'date' },
          { name: 'result', label: 'Result', type: 'select', options: opt(['PASS', 'FAIL', 'PENDING']) },
          { name: 'labName', label: 'Laboratory' },
          { name: 'certificateNumber', label: 'Certificate Number' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'ncrs', label: 'NCR Register', endpoint: '/qaqc/ncrs', entityLabel: 'NCR',
        filters: [{ field: 'status', label: 'Status', options: opt(['DRAFT', 'OPEN', 'IN_PROGRESS', 'INVESTIGATING', 'CORRECTIVE_ACTION', 'CLOSED']) }, { field: 'severity', label: 'Severity', options: SEVERITY }],
        projectScoped: true, readPerm: 'qaqc:read', writePerm: 'qaqc:write',
        columns: [
          { key: 'number', label: 'Number', sortable: true }, { key: 'description', label: 'Description' },
          { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status' },
          { key: 'responsiblePerson', label: 'Responsible' },
        ],
        fields: [
          { name: 'number', label: 'NCR Number (auto)', hideOnCreate: true, readOnly: true },
          { name: 'description', label: 'Description', type: 'textarea', required: true },
          { name: 'wbsItemId', label: 'WBS Activity', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'severity', label: 'Severity', type: 'select', options: SEVERITY },
          { name: 'status', label: 'Status', type: 'select', options: opt(['DRAFT', 'OPEN', 'IN_PROGRESS', 'INVESTIGATING', 'CORRECTIVE_ACTION', 'CLOSED']) },
          { name: 'rootCause', label: 'Root Cause', type: 'textarea' },
          { name: 'correctiveAction', label: 'Corrective Action', type: 'textarea' },
          { name: 'responsiblePerson', label: 'Responsible Person' },
          { name: 'dueDate', label: 'Due Date', type: 'date' },
          { name: 'raisedBy', label: 'Raised By' },
        ],
      },
      {
        key: 'corrective', label: 'Corrective Actions', endpoint: '/qaqc/corrective-actions', entityLabel: 'Corrective Action',
        readPerm: 'qaqc:read', writePerm: 'qaqc:write',
        columns: [
          { key: 'description', label: 'Action' }, { key: 'responsiblePerson', label: 'Responsible' },
          { key: 'dueDate', label: 'Due', render: (r) => date(r.dueDate) }, { key: 'status', label: 'Status' },
        ],
        fields: [
          { name: 'ncrId', label: 'NCR', type: 'select', optionsEndpoint: '/qaqc/ncrs', optionLabel: (r) => r.number },
          { name: 'description', label: 'Action Plan', type: 'textarea', required: true },
          { name: 'responsiblePerson', label: 'Responsible Person' },
          { name: 'dueDate', label: 'Due Date', type: 'date' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['OPEN', 'IN_PROGRESS', 'VERIFIED', 'CLOSED']) },
          { name: 'verification', label: 'Verification', type: 'textarea' },
        ],
      },
      {
        key: 'rework', label: 'Rework', endpoint: '/qaqc/reworks', entityLabel: 'Rework',
        filters: [{ field: 'status', label: 'Status', options: opt(['OPEN', 'IN_PROGRESS', 'DONE']) }],
        summaryCards: [{ key: 'reworkCost', label: 'Total Rework Cost', money: true }, { key: '__count', label: 'Items' }],
        projectScoped: true, readPerm: 'qaqc:read', writePerm: 'qaqc:write',
        columns: [
          { key: 'activity', label: 'Activity' }, { key: 'quantity', label: 'Qty', align: 'right', render: (r) => num(r.quantity) },
          { key: 'reworkCost', label: 'Rework Cost', align: 'right', render: (r) => money(r.reworkCost) },
          { key: 'delayDays', label: 'Delay (d)', align: 'right' }, { key: 'status', label: 'Status' },
        ],
        fields: [
          { name: 'activity', label: 'Rework Activity', required: true },
          { name: 'wbsItemId', label: 'WBS Activity', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'ncrId', label: 'Related NCR', type: 'select', optionsEndpoint: '/qaqc/ncrs', optionLabel: (r) => r.number },
          { name: 'quantity', label: 'Rework Quantity', type: 'number' },
          { name: 'laborCost', label: 'Labor Cost', type: 'number' },
          { name: 'equipmentCost', label: 'Equipment Cost', type: 'number' },
          { name: 'delayDays', label: 'Delay Impact (days)', type: 'number' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['OPEN', 'IN_PROGRESS', 'DONE']) },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'compliance-docs', label: 'Compliance Docs', endpoint: '/compliance/documents', entityLabel: 'Compliance Document',
        readPerm: 'document:read', writePerm: 'document:write',
        columns: [
          { key: 'docType', label: 'Type' }, { key: 'title', label: 'Title' },
          { key: 'version', label: 'Ver' }, { key: 'status', label: 'Status' },
          { key: 'expiryDate', label: 'Expiry', render: (r) => date(r.expiryDate) },
        ],
        fields: [
          { name: 'docType', label: 'Document Type', type: 'select', options: opt(['METHOD_STATEMENT', 'ITP', 'PERMIT', 'CERTIFICATION', 'REGULATORY']) },
          { name: 'title', label: 'Title', required: true },
          { name: 'reference', label: 'Reference' }, { name: 'version', label: 'Version' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['DRAFT', 'SUBMITTED', 'APPROVED', 'EXPIRED']) },
          { name: 'issueDate', label: 'Issue Date', type: 'date' },
          { name: 'expiryDate', label: 'Expiry Date', type: 'date' },
          { name: 'fileUrl', label: 'File URL' },
        ],
      },
    ],
  },

  [AppView.HSE]: {
    view: AppView.HSE,
    title: 'Safety (HSE)',
    subtitle: 'Incidents, near-miss, toolbox talks, PPE & safety inspections (Module 4)',
    summary: (pid) => <ComplianceAnalytics projectId={pid} mode="safety" />,
    tabs: [
      {
        key: 'incidents', label: 'Incidents', endpoint: '/hse/incidents', entityLabel: 'Incident',
        dateFilter: true, filters: [{ field: 'type', label: 'Type', options: opt(['NEAR_MISS', 'FIRST_AID', 'MEDICAL', 'LOST_TIME', 'FATALITY', 'PROPERTY_DAMAGE']) }, { field: 'severity', label: 'Severity', options: SEVERITY }],
        projectScoped: true, readPerm: 'hse:read', writePerm: 'hse:write',
        columns: [
          { key: 'number', label: 'No.', render: (r) => r.number ?? '—' },
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'type', label: 'Type' }, { key: 'severity', label: 'Severity' },
          { key: 'description', label: 'Description' }, { key: 'location', label: 'Location' },
        ],
        fields: [
          { name: 'number', label: 'Incident Number (auto)', hideOnCreate: true, readOnly: true },
          { name: 'type', label: 'Type', type: 'select', options: opt(['NEAR_MISS', 'FIRST_AID', 'MEDICAL', 'LOST_TIME', 'FATALITY', 'PROPERTY_DAMAGE']) },
          { name: 'severity', label: 'Severity', type: 'select', options: SEVERITY },
          { name: 'description', label: 'Description', type: 'textarea', required: true },
          { name: 'location', label: 'Location' },
          { name: 'hazard', label: 'Hazard (for near-miss)' },
          { name: 'investigation', label: 'Investigation', type: 'textarea' },
          { name: 'rootCause', label: 'Root Cause', type: 'textarea' },
          { name: 'correctiveAction', label: 'Corrective Action', type: 'textarea' },
          { name: 'reportedBy', label: 'Reported By' },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
      {
        key: 'ppe', label: 'PPE', endpoint: '/hse/ppe', entityLabel: 'PPE Issue',
        readPerm: 'hse:read', writePerm: 'hse:write',
        columns: [
          { key: 'ppeType', label: 'PPE Type' }, { key: 'quantity', label: 'Qty', align: 'right' },
          { key: 'issueDate', label: 'Issued', render: (r) => date(r.issueDate) },
          { key: 'expiryDate', label: 'Expiry', render: (r) => date(r.expiryDate) },
        ],
        fields: [
          { name: 'ppeType', label: 'PPE Type', required: true },
          { name: 'employeeId', label: 'Employee', type: 'select', optionsEndpoint: '/hr/employees', optionLabel: (r) => r.fullName },
          { name: 'quantity', label: 'Quantity', type: 'number' },
          { name: 'issueDate', label: 'Issue Date', type: 'date' },
          { name: 'expiryDate', label: 'Expiry Date', type: 'date' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'safety-inspections', label: 'Safety Inspections', endpoint: '/hse/safety-inspections', entityLabel: 'Safety Inspection',
        dateFilter: true, filters: [{ field: 'result', label: 'Result', options: opt(['PASS', 'FAIL', 'PENDING']) }],
        projectScoped: true, readPerm: 'hse:read', writePerm: 'hse:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'title', label: 'Title' }, { key: 'result', label: 'Result' },
          { key: 'score', label: 'Score', align: 'right' }, { key: 'inspector', label: 'Inspector' },
        ],
        fields: [
          { name: 'title', label: 'Title', required: true },
          { name: 'template', label: 'Template/Checklist' },
          { name: 'inspector', label: 'Inspector' },
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'result', label: 'Result', type: 'select', options: opt(['PASS', 'FAIL', 'PENDING']) },
          { name: 'score', label: 'Score (0-100)', type: 'number' },
          { name: 'findings', label: 'Findings', type: 'textarea' },
          { name: 'correctiveAction', label: 'Corrective Action', type: 'textarea' },
        ],
      },
      {
        key: 'talks', label: 'Toolbox Talks', endpoint: '/hse/toolbox-talks', entityLabel: 'Toolbox Talk',
        projectScoped: true, readPerm: 'hse:read', writePerm: 'hse:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'topic', label: 'Topic' }, { key: 'presenter', label: 'Presenter' },
          { key: 'attendees', label: 'Attendees', align: 'right' },
        ],
        fields: [
          { name: 'topic', label: 'Topic', required: true }, { name: 'presenter', label: 'Presenter' },
          { name: 'attendees', label: 'Attendees', type: 'number' }, { name: 'date', label: 'Date', type: 'date' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'risk-assessments', label: 'Risk Assessments', endpoint: '/hse/risk-assessments', entityLabel: 'Risk Assessment',
        projectScoped: true, readPerm: 'hse:read', writePerm: 'hse:write',
        columns: [
          { key: 'activityName', label: 'Activity' },
          { key: 'riskLevel', label: 'Level' },
          { key: 'validUntil', label: 'Valid Until', render: (r) => date(r.validUntil) },
          { key: 'approvedBy', label: 'Approved By' },
        ],
        fields: [
          { name: 'activityName', label: 'Activity', required: true },
          { name: 'riskLevel', label: 'Risk Level', type: 'select', options: opt(['low', 'medium', 'high']) },
          { name: 'controls', label: 'Controls', type: 'textarea' },
          { name: 'validFrom', label: 'Valid From', type: 'date' },
          { name: 'validUntil', label: 'Valid Until', type: 'date' },
          { name: 'approvedBy', label: 'Approved By' },
        ],
      },
      {
        key: 'ppe-checks', label: 'PPE Checks', endpoint: '/hse/ppe-checks', entityLabel: 'PPE Check',
        dateFilter: true, filters: [{ field: 'result', label: 'Result', options: opt(['PASS', 'FAIL']) }],
        projectScoped: true, readPerm: 'hse:read', writePerm: 'hse:write',
        columns: [
          { key: 'checkDate', label: 'Date', render: (r) => date(r.checkDate) },
          { key: 'result', label: 'Result', render: (r) => <span className={`font-bold ${r.result === 'FAIL' ? 'text-red-600' : 'text-emerald-600'}`}>{r.result}</span> },
          { key: 'notes', label: 'Notes' },
        ],
        fields: [
          { name: 'employeeId', label: 'Employee', type: 'select', optionsEndpoint: '/hr/employees', optionLabel: (r) => r.fullName },
          { name: 'checkDate', label: 'Check Date', type: 'date' },
          { name: 'result', label: 'Result', type: 'select', options: opt(['PASS', 'FAIL']) },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
    ],
  },

  [AppView.RISK]: {
    view: AppView.RISK,
    title: 'Risk Register',
    subtitle: 'Risk scoring & mitigation tracking (Module 24)',
    tabs: [
      {
        key: 'risks', label: 'Risks', endpoint: '/risk', entityLabel: 'Risk',
        projectScoped: true, readPerm: 'risk:read', writePerm: 'risk:write',
        columns: [
          { key: 'title', label: 'Title' }, { key: 'category', label: 'Category' },
          { key: 'probability', label: 'P', align: 'right' }, { key: 'impact', label: 'I', align: 'right' },
          { key: 'score', label: 'Score', align: 'right', render: (r) => <span className={`font-bold ${Number(r.score) >= 15 ? 'text-red-600' : Number(r.score) >= 8 ? 'text-amber-600' : 'text-emerald-600'}`}>{r.score}</span> },
          { key: 'status', label: 'Status' },
        ],
        fields: [
          { name: 'title', label: 'Title', required: true }, { name: 'category', label: 'Category' },
          { name: 'probability', label: 'Probability (1-5)', type: 'number', required: true },
          { name: 'impact', label: 'Impact (1-5)', type: 'number', required: true },
          { name: 'status', label: 'Status', type: 'select', options: opt(['OPEN', 'MITIGATING', 'CLOSED']) },
          { name: 'mitigation', label: 'Mitigation', type: 'textarea' }, { name: 'owner', label: 'Owner' },
        ],
      },
    ],
  },

  [AppView.SCHEDULING]: {
    view: AppView.SCHEDULING,
    title: 'Scheduling (CPM)',
    subtitle: 'Activities, dependencies & critical path (Module 13)',
    summary: (pid) => (
      <>
        <GanttChart projectId={pid} />
        <CpmPanel projectId={pid} />
      </>
    ),
    tabs: [
      {
        key: 'activities', label: 'Activities', endpoint: '/scheduling', entityLabel: 'Activity',
        projectScoped: true, readPerm: 'scheduling:read', writePerm: 'scheduling:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name', sortable: true },
          { key: 'wbsItem', label: 'WBS', render: (r) => (r.wbsItem ? `${r.wbsItem.code}` : '—') },
          { key: 'milestone', label: 'Type', render: (r) => (r.milestone ? '◆ Milestone' : 'Task') },
          { key: 'durationDays', label: 'Duration', align: 'right' },
          { key: 'startDate', label: 'Start', render: (r) => date(r.startDate) },
          { key: 'finishDate', label: 'Finish', render: (r) => date(r.finishDate) },
          { key: 'predecessors', label: 'Predecessors', render: (r) => (r.predecessors ?? []).join(', ') || '—' },
          { key: 'progressPct', label: 'Progress %', align: 'right' },
        ],
        fields: [
          { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true },
          { name: 'wbsItemId', label: 'WBS Activity', type: 'select', optionsEndpoint: '/planning/wbs?pageSize=500', scopeToProject: true, optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'durationDays', label: 'Duration (days)', type: 'number', required: true },
          { name: 'startDate', label: 'Start Date', type: 'date' },
          { name: 'milestone', label: 'Milestone?', type: 'select', options: [{ value: 'false', label: 'Task' }, { value: 'true', label: 'Milestone' }] },
          { name: 'predecessors', label: 'Legacy predecessor codes (FS)', type: 'csv', placeholder: 'A10, A20' },
          { name: 'progressPct', label: 'Progress %', type: 'number' },
        ],
      },
      {
        key: 'dependencies', label: 'Dependencies', endpoint: '/scheduling/dependencies', entityLabel: 'Dependency',
        projectScoped: true, readPerm: 'scheduling:read', writePerm: 'scheduling:write',
        columns: [
          { key: 'activity', label: 'Activity', render: (r) => r.activity ? `${r.activity.code} — ${r.activity.name}` : '—' },
          { key: 'predecessor', label: 'Depends On', render: (r) => r.predecessor ? `${r.predecessor.code} — ${r.predecessor.name}` : '—' },
          { key: 'type', label: 'Type' },
          { key: 'lagDays', label: 'Lag (days)', align: 'right' },
        ],
        fields: [
          { name: 'activityId', label: 'Activity', type: 'select', optionsEndpoint: '/scheduling', scopeToProject: true, optionLabel: (r) => `${r.code} — ${r.name}`, required: true },
          { name: 'predecessorId', label: 'Predecessor (depends on)', type: 'select', optionsEndpoint: '/scheduling', scopeToProject: true, optionLabel: (r) => `${r.code} — ${r.name}`, required: true },
          { name: 'type', label: 'Relationship', type: 'select', options: [
            { value: 'FS', label: 'Finish → Start (FS)' },
            { value: 'SS', label: 'Start → Start (SS)' },
            { value: 'FF', label: 'Finish → Finish (FF)' },
            { value: 'SF', label: 'Start → Finish (SF)' },
          ] },
          { name: 'lagDays', label: 'Lag (days)', type: 'number' },
        ],
      },
    ],
  },

  [AppView.FIELDOPS]: {
    view: AppView.FIELDOPS,
    title: 'Field Operations',
    subtitle: 'Site diary, task assignment & attendance (Module 16)',
    tabs: [
      {
        key: 'diary', label: 'Site Diary', endpoint: '/fieldops/diary', entityLabel: 'Diary Entry',
        projectScoped: true, readPerm: 'fieldops:read', writePerm: 'fieldops:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'weather', label: 'Weather' }, { key: 'workforce', label: 'Workforce', align: 'right' },
          { key: 'notes', label: 'Notes' },
        ],
        fields: [
          { name: 'date', label: 'Date', type: 'date' }, { name: 'weather', label: 'Weather' },
          { name: 'workforce', label: 'Workforce', type: 'number' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: true },
        ],
      },
      {
        key: 'tasks', label: 'Tasks', endpoint: '/fieldops/tasks', entityLabel: 'Task',
        filters: [{ field: 'status', label: 'Status', options: opt(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED']) }],
        projectScoped: true, readPerm: 'fieldops:read', writePerm: 'fieldops:write',
        columns: [
          { key: 'title', label: 'Title' }, { key: 'assignee', label: 'Assignee' },
          { key: 'status', label: 'Status' }, { key: 'dueDate', label: 'Due', render: (r) => date(r.dueDate) },
        ],
        fields: [
          { name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'assignee', label: 'Assignee' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED']) },
          { name: 'dueDate', label: 'Due Date', type: 'date' },
        ],
      },
      {
        key: 'attendance', label: 'Attendance', endpoint: '/fieldops/attendance', entityLabel: 'Attendance',
        dateFilter: true, filters: [{ field: 'status', label: 'Status', options: opt(['present', 'half_day', 'absent', 'leave']) }],
        summaryCards: [{ key: 'hoursWorked', label: 'Total Hours' }, { key: '__count', label: 'Records' }],
        projectScoped: true, readPerm: 'fieldops:read', writePerm: 'fieldops:write',
        columns: [
          { key: 'date', label: 'Date', sortable: true, render: (r) => date(r.date) },
          { key: 'workerName', label: 'Worker' }, { key: 'trade', label: 'Trade' },
          { key: 'hoursWorked', label: 'Hours', align: 'right', render: (r) => num(r.hoursWorked) },
          { key: 'present', label: 'Present', render: (r) => (r.present ? 'Yes' : 'No') },
        ],
        fields: [
          { name: 'workerName', label: 'Worker Name', required: true }, { name: 'trade', label: 'Trade' },
          { name: 'hoursWorked', label: 'Hours Worked', type: 'number' },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
    ],
  },

  [AppView.DOCUMENTS]: {
    view: AppView.DOCUMENTS,
    title: 'Documents',
    subtitle: 'Drawings, contracts & reports register (Module 7)',
    tabs: [
      {
        key: 'documents', label: 'Documents', endpoint: '/documents', entityLabel: 'Document',
        readPerm: 'document:read', writePerm: 'document:write',
        columns: [
          { key: 'name', label: 'Name', sortable: true }, { key: 'category', label: 'Category' },
          { key: 'version', label: 'Ver.', align: 'right' },
          { key: 'url', label: 'Link', render: (r) => <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-primary underline">open</a> },
        ],
        fields: [
          { name: 'name', label: 'Name', required: true }, { name: 'category', label: 'Category' },
          { name: 'url', label: 'File URL', required: true, placeholder: 'https://…' },
          { name: 'version', label: 'Version', type: 'number' },
        ],
      },
    ],
  },
};
