import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Upload, Camera, FileText, FileSpreadsheet, File, Link2, Trash2, Download, ExternalLink, Clock, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ACCEPT_ANY_DOCUMENT, isAcceptableUrl, kb, type FileKind } from '../lib/upload';
import { attachFile, attachLink, pendingLabel, type PendingAttachment } from '../lib/attachments';

interface Doc {
  id: string;
  fileName: string;
  fileType: FileKind;
  mimeType: string;
  fileSizeBytes?: number | null;
  sourceType: 'FILE' | 'LINK';
  storagePath?: string | null;
  externalUrl?: string | null;
  documentCategory?: string | null;
  description?: string | null;
  createdAt: string;
}

const CATEGORIES = ['progress_photo', 'test_result', 'delivery_note', 'signed_receipt', 'issue_slip', 'attendance_sheet', 'measurement_sheet', 'signed_certificate', 'drawing', 'specification', 'method_statement', 'other'];
const prettyCat = (c?: string | null) => (c ? c.replace(/_/g, ' ') : '—');

function KindIcon({ doc }: { doc: Doc }) {
  if (doc.sourceType === 'LINK') return <Link2 className="w-4 h-4 text-sky-600 shrink-0" />;
  if (doc.fileType === 'photo') return <Camera className="w-4 h-4 text-brand-secondary shrink-0" />;
  if (doc.fileType === 'excel') return <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (doc.fileType === 'pdf') return <FileText className="w-4 h-4 text-red-500 shrink-0" />;
  return <File className="w-4 h-4 text-brand-on-surface-variant shrink-0" />;
}

interface Props {
  module: string;
  /** Omit on a create form — the record has no id yet, so choices are queued. */
  recordId?: string;
  projectId?: string;
  /** Queue state, owned by the parent so it survives until the record is saved. */
  pending?: PendingAttachment[];
  onPendingChange?: (next: PendingAttachment[]) => void;
}

/**
 * Reusable evidence panel (Developer Memo §5.1). Lists everything attached to a
 * specific record and lets authorized users add more — either by uploading a
 * file or by pasting a link to evidence hosted elsewhere (a lab portal, a
 * SharePoint/Drive document, a supplier's certificate page).
 *
 * Two modes:
 * - `recordId` set (edit form): acts immediately on that record.
 * - no `recordId` (create form): the record doesn't exist yet, so uploads have
 *   nothing to attach to. Choices are queued in the parent and replayed by
 *   `flushPending` the moment the record is saved — otherwise users have to
 *   create the record, find the row again and reopen it just to add evidence.
 */
export default function DocumentAttachments({ module, recordId, projectId, pending, onPendingChange }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('document:write');
  const deferred = !recordId;
  const [category, setCategory] = useState('progress_photo');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState<Record<string, number>>({}); // fileName → %
  const [error, setError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [showLink, setShowLink] = useState(false);

  const key = ['/project-documents', module, recordId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<Doc[]>(`/project-documents?module=${module}&recordId=${recordId}&pageSize=200`),
    enabled: !deferred, // nothing to fetch before the record exists
  });
  const docs = data?.data ?? [];
  const queued = pending ?? [];

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/project-documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => setError(errorMessage(e)),
  });

  const queue = (item: PendingAttachment) => onPendingChange?.([...queued, item]);
  const unqueue = (k: string) => onPendingChange?.(queued.filter((p) => p.key !== k));
  // Date.now alone collides when several files are picked in one go.
  const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [busy, setBusy] = useState(false);

  async function submitLink() {
    setError(null);
    const url = linkUrl.trim();
    if (!isAcceptableUrl(url)) {
      setError('Enter a full link starting with http:// or https://');
      return;
    }
    const meta = { documentCategory: category, description: description || undefined };
    if (deferred) {
      queue({ key: newKey(), kind: 'link', url, label: linkLabel, ...meta });
    } else {
      setBusy(true);
      try {
        await attachLink({ module, recordId: recordId!, projectId }, url, linkLabel, meta);
        qc.invalidateQueries({ queryKey: key });
      } catch (e) {
        setError(errorMessage(e)); setBusy(false); return;
      }
      setBusy(false);
    }
    setLinkUrl(''); setLinkLabel(''); setShowLink(false); setDescription('');
  }

  async function upload(file: File) {
    setError(null);
    const meta = { documentCategory: category, description: description || undefined };
    if (deferred) {
      // Hold the File in memory; it is uploaded once the record has an id.
      queue({ key: newKey(), kind: 'file', file, ...meta });
      setDescription('');
      return;
    }
    const name = file.name;
    setProgress((p) => ({ ...p, [name]: 0 }));
    try {
      await attachFile({ module, recordId: recordId!, projectId }, file, meta,
        (pct) => setProgress((p) => ({ ...p, [name]: pct })));
      setDescription('');
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress((p) => { const n = { ...p }; delete n[name]; return n; });
    }
  }

  /** Both kinds resolve through the same endpoint — a stored file to a signed
   *  URL, a link to itself. */
  async function open(id: string) {
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

  const btn = 'flex items-center gap-2 text-[11px] font-bold rounded-lg px-3 py-1.5 cursor-pointer';

  return (
    <div className="mt-4 border-t border-brand-outline-variant/20 pt-4">
      <div className="flex items-center gap-2 mb-3">
        <Paperclip className="w-4 h-4 text-brand-primary" />
        <h4 className="text-xs font-bold text-brand-primary uppercase tracking-wide">Attachments (evidence)</h4>
        <span className="text-[10px] text-brand-on-surface-variant">
          {docs.length + queued.length} item{docs.length + queued.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Queued on a create form — uploaded automatically once the record saves. */}
      {queued.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          {queued.map((p) => (
            <div key={p.key} className="flex items-center gap-2 bg-amber-50 rounded-lg border border-amber-200 px-3 py-2">
              {p.kind === 'link' ? <Link2 className="w-4 h-4 text-sky-600 shrink-0" /> : <File className="w-4 h-4 text-amber-600 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand-on-surface truncate" title={pendingLabel(p)}>{pendingLabel(p)}</p>
                <p className="text-[10px] text-amber-700 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" /> attaches when saved
                  {p.kind === 'file' && kb(p.file.size) ? ` · ${kb(p.file.size)}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => unqueue(p.key)} title="Remove" className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-brand-on-surface-variant animate-pulse">Loading…</p>
      ) : docs.length === 0 ? (
        queued.length === 0 && <p className="text-xs text-brand-on-surface-variant mb-3">Nothing attached yet — upload a file or paste a link.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 bg-brand-surface rounded-lg border border-brand-outline-variant/15 px-3 py-2">
              <KindIcon doc={d} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand-on-surface truncate" title={d.externalUrl ?? d.fileName}>{d.fileName}</p>
                <p className="text-[10px] text-brand-on-surface-variant truncate">
                  {prettyCat(d.documentCategory)}{d.sourceType === 'LINK' ? ' · link' : kb(d.fileSizeBytes) ? ` · ${kb(d.fileSizeBytes)}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => open(d.id)} title={d.sourceType === 'LINK' ? 'Open link' : 'Download'} className="p-1 rounded hover:bg-brand-surface-container text-brand-on-surface-variant">
                {d.sourceType === 'LINK' ? <ExternalLink className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
              </button>
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
            <label className={`${btn} bg-brand-primary text-white hover:bg-brand-primary-container`}>
              <Upload className="w-3.5 h-3.5" /> Upload file
              <input type="file" accept={ACCEPT_ANY_DOCUMENT} multiple className="hidden" onChange={onPick} />
            </label>
            <label className={`${btn} bg-brand-surface-container text-brand-primary border border-brand-outline-variant/20 hover:bg-brand-surface-container-high sm:hidden`}>
              <Camera className="w-3.5 h-3.5" /> Take photo
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
            </label>
            <button type="button" onClick={() => { setShowLink((s) => !s); setError(null); }}
              className={`${btn} bg-brand-surface-container text-brand-primary border border-brand-outline-variant/20 hover:bg-brand-surface-container-high`}>
              <Link2 className="w-3.5 h-3.5" /> Attach link
            </button>
          </div>

          {showLink && (
            <div className="flex flex-wrap gap-2 items-center rounded-lg border border-brand-outline-variant/20 bg-brand-surface p-2">
              <input
                value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitLink(); } }}
                autoFocus placeholder="https://… link to the document"
                className="flex-1 min-w-[180px] h-8 bg-brand-surface-container-lowest border border-brand-outline-variant rounded-lg px-2 text-[11px] outline-none focus:border-brand-primary"
              />
              <input
                value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="Label (optional)"
                className="w-32 h-8 bg-brand-surface-container-lowest border border-brand-outline-variant rounded-lg px-2 text-[11px] outline-none focus:border-brand-primary"
              />
              <button type="button" onClick={() => void submitLink()} disabled={busy}
                className="h-8 px-3 rounded-lg bg-brand-primary text-white text-[11px] font-bold hover:bg-brand-primary-container disabled:opacity-60">
                {busy ? 'Adding…' : 'Add'}
              </button>
            </div>
          )}

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
