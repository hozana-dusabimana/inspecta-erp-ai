import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, FileDown, Building2, Wallet, ShieldCheck, ShoppingCart, ClipboardList, Loader2 } from 'lucide-react';
import { AppView } from '../types';
import { api, errorMessage } from '../lib/api';
import { toast } from '../lib/toast';
import { useCurrentProject } from '../lib/currentProject';
import ErpLayout from './ErpLayout';

type Icon = React.ComponentType<{ className?: string }>;

interface ReportDef {
  id: string;
  title: string;
  icon: Icon;
  format: 'PDF' | 'XLSX' | 'CSV';
  summary: string;
  contents: string[];
  needsProject: boolean;
  path: (projectId: string) => string;
  filename: (code: string) => string;
}

// Designed PDF templates share one look: brand header, KPI tiles, tables, page numbers.
const PDF_REPORTS: ReportDef[] = [
  {
    id: 'portfolio', title: 'Portfolio report', icon: Building2, format: 'PDF', needsProject: false,
    summary: 'The whole company on one document, for management and clients.',
    contents: ['Average progress, SPI, CPI, forecast profit', 'Contract value, cost and billing totals', 'One row per project with its status'],
    path: () => '/reports/portfolio.pdf', filename: () => 'portfolio-report.pdf',
  },
  {
    id: 'project', title: 'Project status report', icon: ClipboardList, format: 'PDF', needsProject: true,
    summary: 'Where one project stands today: progress, money, production and quality.',
    contents: ['Progress, SPI, CPI and forecast profit tiles', 'Contract, budget, actual and committed cost', 'Top cost items by WBS task, production, quality'],
    path: (id) => `/reports/project/${id}.pdf`, filename: (c) => `project-status-${c}.pdf`,
  },
  {
    id: 'cost-wbs', title: 'Cost by WBS', icon: Wallet, format: 'PDF', needsProject: true,
    summary: 'Budget against actual spend and open commitments, task by task.',
    contents: ['Budget, actual, committed and forecast per WBS task', 'What is left of each budget', 'Open purchase orders and approved requests included'],
    path: (id) => `/reports/project/${id}/cost-wbs.pdf`, filename: (c) => `cost-by-wbs-${c}.pdf`,
  },
  {
    id: 'quality', title: 'Quality and safety report', icon: ShieldCheck, format: 'PDF', needsProject: true,
    summary: 'Non-conformances, material tests and incidents with the task each belongs to.',
    contents: ['Open NCRs with severity, status and due date', 'Material test results by batch', 'Incident log'],
    path: (id) => `/reports/project/${id}/quality-safety.pdf`, filename: (c) => `quality-safety-${c}.pdf`,
  },
  {
    id: 'procurement', title: 'Procurement report', icon: ShoppingCart, format: 'PDF', needsProject: true,
    summary: 'What has been requested and ordered, and what is still committed.',
    contents: ['Purchase orders with supplier and value', 'Purchase requests and their status', 'Open commitments'],
    path: (id) => `/reports/project/${id}/procurement.pdf`, filename: (c) => `procurement-${c}.pdf`,
  },
];

const DATA_EXPORTS: ReportDef[] = [
  { id: 'x-projects', title: 'Projects', icon: FileSpreadsheet, format: 'XLSX', needsProject: false, summary: 'Every project with status, progress, budget and forecast profit.', contents: [], path: () => '/reports/projects.xlsx', filename: () => 'projects.xlsx' },
  { id: 'x-executive', title: 'Executive summary', icon: FileSpreadsheet, format: 'XLSX', needsProject: false, summary: 'Portfolio KPIs by project: cost, billing, NCRs, incidents.', contents: [], path: () => '/reports/executive.xlsx', filename: () => 'executive-report.xlsx' },
  { id: 'x-financial', title: 'Financial', icon: FileSpreadsheet, format: 'XLSX', needsProject: true, summary: 'Budget against actual by category, invoices, payments and cash flow.', contents: [], path: (id) => `/reports/financial.xlsx?projectId=${id}`, filename: (c) => `financial-${c}.xlsx` },
  { id: 'x-compliance', title: 'Compliance', icon: FileSpreadsheet, format: 'XLSX', needsProject: true, summary: 'NCRs, inspections, incidents and safety inspections.', contents: [], path: (id) => `/reports/compliance.xlsx?projectId=${id}`, filename: (c) => `compliance-${c}.xlsx` },
  { id: 'x-csv', title: 'Projects (CSV)', icon: FileText, format: 'CSV', needsProject: false, summary: 'The portfolio as CSV for spreadsheets and BI tools.', contents: [], path: () => '/reports/projects.csv', filename: () => 'projects.csv' },
];

const FORMAT_STYLE: Record<ReportDef['format'], string> = {
  PDF: 'bg-red-50 text-red-700',
  XLSX: 'bg-emerald-50 text-emerald-700',
  CSV: 'bg-slate-100 text-slate-600',
};

/** A top-level component (not defined inside the page), so a re-render never replaces its button mid-click. */
function ReportCard({ r, current, busy, onDownload }: { r: ReportDef; current?: { code: string; name: string }; busy: boolean; onDownload: (r: ReportDef) => void }) {
  const Icon = r.icon;
  const blocked = r.needsProject && !current;
  return (
    <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-5 flex flex-col gap-3" data-report={r.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="w-10 h-10 rounded-lg bg-brand-primary/5 flex items-center justify-center text-brand-primary"><Icon className="w-5 h-5" /></div>
        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${FORMAT_STYLE[r.format]}`}>{r.format}</span>
      </div>
      <div>
        <h3 className="font-bold text-sm text-brand-primary">{r.title}</h3>
        <p className="text-xs text-brand-on-surface-variant mt-1">{r.summary}</p>
      </div>
      {r.contents.length > 0 && (
        <ul className="text-[11px] text-brand-on-surface-variant space-y-1 list-disc pl-4">{r.contents.map((c) => <li key={c}>{c}</li>)}</ul>
      )}
      <p className="text-[10px] font-semibold text-brand-on-surface-variant mt-auto">
        {r.needsProject ? (current ? `For ${current.code} — ${current.name}` : 'Needs a project') : 'Covers all your projects'}
      </p>
      <button
        onClick={() => onDownload(r)}
        disabled={busy || blocked}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary-container transition-all disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {busy ? 'Preparing…' : blocked ? 'Choose a project' : 'Download'}
      </button>
    </div>
  );
}

export default function ReportsPage({ onNavigate, onLogout }: { onNavigate: (v: AppView) => void; onLogout: () => void }) {
  const { data: projectsResp } = useQuery({
    queryKey: ['projects', 'picker'],
    queryFn: () => api.get<{ id: string; name: string; code: string }[]>('/projects?pageSize=200'),
  });
  const projects = projectsResp?.data ?? [];
  const { projectId, setProjectId } = useCurrentProject();
  const [busy, setBusy] = useState<string | null>(null);
  const current = projects.find((p) => p.id === projectId);

  const download = async (r: ReportDef) => {
    if (r.needsProject && !current) { toast('Choose a project first.', 'info'); return; }
    setBusy(r.id);
    try {
      await api.download(r.path(projectId), r.filename(current?.code ?? 'all'));
      toast(`${r.title} downloaded.`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ErpLayout active={AppView.REPORTS} title="Reports" subtitle="Designed PDF reports and Excel / CSV exports" onNavigate={onNavigate} onLogout={onLogout}>
      <div className="flex flex-wrap items-center gap-3 mb-6 bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 p-4">
        <label className="text-xs font-bold text-brand-on-surface-variant uppercase tracking-wide" htmlFor="report-project">Project</label>
        <select
          id="report-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}
          className="h-10 min-w-[260px] bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold outline-none focus:border-brand-primary"
        >
          <option value="">All projects (company-wide reports only)</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
        <span className="text-[11px] text-brand-on-surface-variant">Reports use the same numbers as the screens. "No data" means the figure cannot be calculated yet.</span>
      </div>

      <h2 className="font-display text-sm font-extrabold text-brand-primary mb-3">PDF reports</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mb-8">
        {PDF_REPORTS.map((r) => <ReportCard key={r.id} r={r} current={current} busy={busy === r.id} onDownload={download} />)}
      </div>

      <h2 className="font-display text-sm font-extrabold text-brand-primary mb-3">Data exports</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {DATA_EXPORTS.map((r) => <ReportCard key={r.id} r={r} current={current} busy={busy === r.id} onDownload={download} />)}
      </div>
    </ErpLayout>
  );
}
