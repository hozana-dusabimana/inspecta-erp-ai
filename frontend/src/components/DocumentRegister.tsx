import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, FileSpreadsheet, Camera, Search } from 'lucide-react';
import { api, errorMessage } from '../lib/api';

interface Doc {
  id: string;
  module: string;
  recordId: string;
  fileName: string;
  fileType: 'photo' | 'pdf' | 'excel';
  documentCategory?: string | null;
  description?: string | null;
  fileSizeBytes?: number | null;
  uploadedBy?: string | null;
  createdAt: string;
}

const MODULES = ['', 'daily_report', 'inspection', 'ncr', 'grn', 'material_issue', 'purchase_order', 'ipc', 'incident'];
const CATEGORIES = ['', 'progress_photo', 'test_result', 'delivery_note', 'signed_receipt', 'issue_slip', 'attendance_sheet', 'measurement_sheet', 'signed_certificate', 'other'];
const TYPES = ['', 'photo', 'pdf', 'excel'];
const pretty = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '—');
const kb = (n?: number | null) => (n ? `${Math.round(n / 1024)} KB` : '—');
const dt = (s: string) => new Date(s).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });

export default function DocumentRegister({ projectId }: { projectId?: string; canWrite: boolean }) {
  const [module, setModule] = useState('');
  const [category, setCategory] = useState('');
  const [fileType, setFileType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const qs = new URLSearchParams({ pageSize: '300' });
  if (projectId) qs.set('projectId', projectId);
  if (module) qs.set('module', module);
  if (category) qs.set('documentCategory', category);
  if (fileType) qs.set('fileType', fileType);
  if (from) qs.set('from', new Date(from).toISOString());
  if (to) qs.set('to', new Date(to).toISOString());
  if (search) qs.set('search', search);

  const { data, isLoading } = useQuery({
    queryKey: ['/project-documents/register', projectId, module, category, fileType, from, to, search],
    queryFn: () => api.get<Doc[]>(`/project-documents?${qs.toString()}`),
    enabled: Boolean(projectId),
  });
  const docs = data?.data ?? [];

  const download = async (id: string) => {
    try { const r = await api.get<{ downloadUrl: string }>(`/project-documents/${id}/download`); window.open(r.data.downloadUrl, '_blank', 'noopener'); }
    catch (e) { setErr(errorMessage(e)); }
  };
  const exportXlsx = () => {
    const eq = new URLSearchParams();
    if (projectId) eq.set('projectId', projectId);
    if (module) eq.set('module', module);
    if (category) eq.set('documentCategory', category);
    if (fileType) eq.set('fileType', fileType);
    api.download(`/project-documents/export.xlsx?${eq.toString()}`, 'document-register.xlsx');
  };

  if (!projectId) return <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-6 text-sm text-brand-on-surface-variant">Select a project to view its document register.</div>;

  const icon = (t: Doc['fileType']) => (t === 'photo' ? <Camera className="w-4 h-4 text-brand-secondary" /> : t === 'excel' ? <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> : <FileText className="w-4 h-4 text-red-500" />);

  return (
    <div className="space-y-4">
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="font-bold text-brand-primary text-sm">Document Register <span className="text-[11px] font-normal text-brand-on-surface-variant">({docs.length})</span></h3>
          <button onClick={exportXlsx} className="flex items-center gap-2 bg-brand-surface-container text-brand-primary text-xs font-bold rounded-lg px-4 py-2 border border-brand-outline-variant/20 hover:bg-brand-surface-container-high"><Download className="w-4 h-4" /> Export register</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <select value={module} onChange={(e) => setModule(e.target.value)} className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs outline-none focus:border-brand-primary">{MODULES.map((m) => <option key={m} value={m}>{m ? pretty(m) : 'All modules'}</option>)}</select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs outline-none focus:border-brand-primary">{CATEGORIES.map((c) => <option key={c} value={c}>{c ? pretty(c) : 'All categories'}</option>)}</select>
          <select value={fileType} onChange={(e) => setFileType(e.target.value)} className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs outline-none focus:border-brand-primary">{TYPES.map((t) => <option key={t} value={t}>{t ? pretty(t) : 'All types'}</option>)}</select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From" className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs outline-none focus:border-brand-primary" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To" className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs outline-none focus:border-brand-primary" />
          <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-brand-on-surface-variant" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full h-9 bg-brand-surface border border-brand-outline-variant rounded-lg pl-7 pr-2 text-xs outline-none focus:border-brand-primary" /></div>
        </div>
        {err && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700">{err}</div>}
      </div>

      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-x-auto">
        {isLoading ? <p className="text-xs text-brand-on-surface-variant p-6 animate-pulse">Loading…</p>
          : docs.length === 0 ? <p className="text-xs text-brand-on-surface-variant p-6">No documents match these filters.</p> : (
          <table className="w-full text-xs min-w-[720px]">
            <thead><tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/15">
              <th className="px-3 py-2 font-bold">Type</th><th className="px-3 py-2 font-bold">File</th><th className="px-3 py-2 font-bold">Module</th><th className="px-3 py-2 font-bold">Category</th><th className="px-3 py-2 font-bold text-right">Size</th><th className="px-3 py-2 font-bold">Uploaded</th><th className="px-3 py-2 font-bold text-right">Actions</th>
            </tr></thead>
            <tbody>{docs.map((d) => (
              <tr key={d.id} className="border-b border-brand-outline-variant/10 last:border-0 hover:bg-brand-surface">
                <td className="px-3 py-2">{icon(d.fileType)}</td>
                <td className="px-3 py-2"><div className="font-semibold text-brand-on-surface truncate max-w-[220px]">{d.fileName}</div>{d.description && <div className="text-[10px] text-brand-on-surface-variant truncate max-w-[220px]">{d.description}</div>}</td>
                <td className="px-3 py-2">{pretty(d.module)}</td>
                <td className="px-3 py-2">{pretty(d.documentCategory)}</td>
                <td className="px-3 py-2 text-right font-mono">{kb(d.fileSizeBytes)}</td>
                <td className="px-3 py-2">{dt(d.createdAt)}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => download(d.id)} className="p-1 rounded hover:bg-brand-surface-container text-brand-primary"><Download className="w-3.5 h-3.5" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
