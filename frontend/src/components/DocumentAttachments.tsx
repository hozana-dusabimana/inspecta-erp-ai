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

// Client-side compression so a 10–20MB phone photo doesn't choke a weak site
// connection. HEIC/HEIF is stored as-is (browsers can't reliably decode it).
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || /heic|heif/i.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1920;
    let { width, height } = bitmap;
    if (Math.max(width, height) > maxDim) {
      const s = maxDim / Math.max(width, height);
      width = Math.round(width * s); height = Math.round(height * s);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    for (const q of [0.8, 0.6, 0.45, 0.3]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', q));
      if (blob && (blob.size <= 2 * 1024 * 1024 || q === 0.3)) {
        return new File([blob], file.name.replace(/\.(png|heic|heif|webp|jpeg)$/i, '.jpg'), { type: 'image/jpeg' });
      }
    }
    return file;
  } catch {
    return file;
  }
}

// PUT with per-file progress (fetch can't report upload progress).
function putWithProgress(url: string, blob: Blob, contentType: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(blob);
  });
}

// Retry flaky steps (site internet is unreliable) with a short backoff.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
  throw lastErr;
}

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
  const [progress, setProgress] = useState<Record<string, number>>({}); // fileName → %
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

  async function upload(original: File) {
    setError(null);
    const file = await compressImage(original); // resize/HEIC-passthrough before upload
    const name = file.name;
    const contentType = file.type || 'application/octet-stream';
    setProgress((p) => ({ ...p, [name]: 0 }));
    try {
      // 1. signed upload URL  2. PUT the file (with progress)  3. register metadata — each retried
      const signed = await withRetry(() => api.post<{ uploadUrl: string; storagePath: string }>(
        '/project-documents/upload-url', { module, recordId, projectId, fileName: name },
      ));
      await withRetry(() => putWithProgress(signed.data.uploadUrl, file, contentType, (pct) => setProgress((p) => ({ ...p, [name]: pct }))));
      await withRetry(() => api.post('/project-documents', {
        module, recordId, projectId,
        fileName: name, fileType: fileTypeFor(contentType), mimeType: contentType,
        fileSizeBytes: file.size, storagePath: signed.data.storagePath,
        documentCategory: category, description: description || undefined,
      }));
      setDescription('');
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress((p) => { const n = { ...p }; delete n[name]; return n; });
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
          </div>
          {Object.entries(progress).map(([name, pct]) => (
            <div key={name} className="flex items-center gap-2">
              <span className="text-[10px] text-brand-on-surface-variant truncate max-w-[140px]">{name}</span>
              <div className="flex-1 h-1.5 rounded-full bg-brand-surface-container overflow-hidden">
                <div className="h-full rounded-full bg-brand-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] font-mono text-brand-on-surface-variant w-9 text-right">{pct}%</span>
            </div>
          ))}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700 flex items-center justify-between"><span>{error}</span><button type="button" onClick={() => setError(null)}><X className="w-3 h-3" /></button></div>}
        </div>
      )}
    </div>
  );
}
