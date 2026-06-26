import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, FileDown } from 'lucide-react';
import { AppView } from '../types';
import { api } from '../lib/api';
import ErpLayout from './ErpLayout';

export default function ReportsPage({ onNavigate, onLogout }: { onNavigate: (v: AppView) => void; onLogout: () => void }) {
  const { data: projectsResp } = useQuery({
    queryKey: ['projects', 'picker'],
    queryFn: () => api.get<{ id: string; name: string; code: string }[]>('/projects?pageSize=200'),
  });
  const projects = projectsResp?.data ?? [];
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const Card = ({ icon: Icon, title, desc, action, disabled }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string; action: () => void; disabled?: boolean }) => (
    <div className="bg-white rounded-xl border border-brand-outline-variant/20 shadow-sm p-5 flex flex-col gap-3">
      <div className="w-10 h-10 rounded-lg bg-brand-primary/5 flex items-center justify-center text-brand-primary">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h3 className="font-bold text-sm text-brand-primary">{title}</h3>
        <p className="text-xs text-brand-on-surface-variant mt-1">{desc}</p>
      </div>
      <button
        onClick={action}
        disabled={disabled}
        className="mt-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary-container transition-all disabled:opacity-50"
      >
        <FileDown className="w-4 h-4" /> Download
      </button>
    </div>
  );

  return (
    <ErpLayout active={AppView.REPORTS} title="Reports" subtitle="PDF / Excel / CSV exports (Module 8)" onNavigate={onNavigate} onLogout={onLogout}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl">
        <Card
          icon={FileSpreadsheet}
          title="Projects — Excel"
          desc="All projects with status, health, progress and budget."
          disabled={busy === 'xlsx'}
          action={() => run('xlsx', () => api.download('/reports/projects.xlsx', 'projects.xlsx'))}
        />
        <Card
          icon={FileText}
          title="Projects — CSV"
          desc="Portfolio export in CSV for spreadsheets/BI tools."
          disabled={busy === 'csv'}
          action={() => run('csv', () => api.download('/reports/projects.csv', 'projects.csv'))}
        />
        <div className="bg-white rounded-xl border border-brand-outline-variant/20 shadow-sm p-5 flex flex-col gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-primary/5 flex items-center justify-center text-brand-primary">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-brand-primary">Project Status — PDF</h3>
            <p className="text-xs text-brand-on-surface-variant mt-1">Financials, production & compliance summary.</p>
          </div>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold outline-none focus:border-brand-primary"
          >
            <option value="">Select project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
          <button
            onClick={() => projectId && run('pdf', () => api.download(`/reports/project/${projectId}.pdf`, `project-${projectId}.pdf`))}
            disabled={!projectId || busy === 'pdf'}
            className="mt-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary-container transition-all disabled:opacity-50"
          >
            <FileDown className="w-4 h-4" /> Download PDF
          </button>
        </div>
      </div>
    </ErpLayout>
  );
}
