import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Upload, Camera, FileText, FileSpreadsheet, Trash2, Download, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Doc {
  id: string;
  fileName: string;
  fileType: 'photo' | 'pdf' | 'excel';
  mimeType: string;
  fileSizeBytes?: number | null;
  storagePath: string;
  documentCategory?: string | null;
  description?: string | null;
  createdAt: string;
}

const CATEGORIES = ['progress_photo', 'test_result', 'delivery_note', 'signed_receipt', 'issue_slip', 'attendance_sheet', 'measurement_sheet', 'signed_certificate', 'other'];
const fileTypeFor = (mime: string): Doc['fileType'] => (mime.startsWith('image/') ? 'photo' : mime.includes('pdf') ? 'pdf' : 'excel');
const prettyCat = (c?: string | null) => (c ? c.replace(/_/g, ' ') : '—');
const kb = (n?: number | null) => (n ? `${Math.round(n / 1024)} KB` : '');

/**
 * Reusable evidence panel (Developer Memo §5.1). Lists documents attached to a
 * specific record and lets authorized users upload more. Embed at the bottom of
 * a record's edit form via `module` + `recordId` (+ `projectId`).
 */
export default function DocumentAttachments({ module, recordId, projectId }: { module: string; recordId: string; projectId?: string }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('document:write');
  const [category, setCategory] = useState('progress_photo');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = ['/project-documents', module, recordId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<Doc[]>(`/project-documents?module=${module}&recordId=${recordId}&pageSize=200`),
  });
  const docs = data?.data ?? [];

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/project-documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => setError(errorMessage(e)),
  });

  async function upload(file: File) {
    setError(null);
    setBusy(file.name);
    try {
      // 1. signed upload URL  2. PUT the file  3. register the metadata row
      const signed = await api.post<{ uploadUrl: string; storagePath: string }>(
        '/project-documents/upload-url',
        { module, recordId, projectId, fileName: file.name },
      );
      const put = await fetch(signed.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await api.post('/project-documents', {
        module, recordId, projectId,
        fileName: file.name, fileType: fileTypeFor(file.type), mimeType: file.type || 'application/octet-stream',
        fileSizeBytes: file.size, storagePath: signed.data.storagePath,
        documentCategory: category, description: description || undefined,
      });
      setDescription('');
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function download(id: string) {
    try {
      const r = await api.get<{ downloadUrl: string }>(`/project-documents/${id}/download`);
      window.open(r.data.downloadUrl, '_blank', 'noopener');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => void upload(f));
    e.target.value = '';
  };

  return (
    <div className="mt-4 border-t border-brand-outline-variant/20 pt-4">
      <div className="flex items-center gap-2 mb-3">
        <Paperclip className="w-4 h-4 text-brand-primary" />
        <h4 className="text-xs font-bold text-brand-primary uppercase tracking-wide">Attachments (evidence)</h4>
        <span className="text-[10px] text-brand-on-surface-variant">{docs.length} file{docs.length === 1 ? '' : 's'}</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-brand-on-surface-variant animate-pulse">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-brand-on-surface-variant mb-3">No documents attached yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 bg-brand-surface rounded-lg border border-brand-outline-variant/15 px-3 py-2">
              {d.fileType === 'photo' ? <Camera className="w-4 h-4 text-brand-secondary shrink-0" /> : d.fileType === 'excel' ? <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" /> : <FileText className="w-4 h-4 text-red-500 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand-on-surface truncate">{d.fileName}</p>
                <p className="text-[10px] text-brand-on-surface-variant">{prettyCat(d.documentCategory)} · {kb(d.fileSizeBytes)}</p>
              </div>
              <button type="button" onClick={() => download(d.id)} title="Download" className="p-1 rounded hover:bg-brand-surface-container text-brand-on-surface-variant"><Download className="w-3.5 h-3.5" /></button>
              {canWrite && <button type="button" onClick={() => del.mutate(d.id)} title="Remove" className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-[11px] font-semibold outline-none focus:border-brand-primary">
              {CATEGORIES.map((c) => <option key={c} value={c}>{prettyCat(c)}</option>)}
            </select>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="flex-1 min-w-[120px] h-8 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-[11px] outline-none focus:border-brand-primary" />
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 bg-brand-primary text-white text-[11px] font-bold rounded-lg px-3 py-1.5 cursor-pointer hover:bg-brand-primary-container">
              <Upload className="w-3.5 h-3.5" /> Upload file
              <input type="file" accept="image/*,.pdf,.xlsx,.xls" multiple className="hidden" onChange={onPick} />
            </label>
            <label className="flex items-center gap-2 bg-brand-surface-container text-brand-primary text-[11px] font-bold rounded-lg px-3 py-1.5 border border-brand-outline-variant/20 cursor-pointer hover:bg-brand-surface-container-high sm:hidden">
              <Camera className="w-3.5 h-3.5" /> Take photo
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
            </label>
            {busy && <span className="text-[11px] text-brand-on-surface-variant self-center animate-pulse">Uploading {busy}…</span>}
          </div>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700 flex items-center justify-between"><span>{error}</span><button type="button" onClick={() => setError(null)}><X className="w-3 h-3" /></button></div>}
        </div>
      )}
    </div>
  );
}
