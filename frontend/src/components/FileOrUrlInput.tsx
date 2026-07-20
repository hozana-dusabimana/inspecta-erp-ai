import React, { useState } from 'react';
import { Upload, Link2, Camera, X, ExternalLink, FileText } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { ACCEPT_ANY_DOCUMENT, compressImage, isAcceptableUrl, uploadToCloudinary, withRetry, type SignedUpload } from '../lib/upload';

/**
 * A single form field whose value is a URL, filled either by uploading a file
 * (PUT straight to remote storage, we keep the resulting public URL) or by
 * pasting a link to a document that already lives somewhere else.
 *
 * Used for the plain URL columns — Document.url, ComplianceDocument.fileUrl,
 * Contract.documentsUrl, photo/logo URLs — which previously forced the user to
 * find a URL for a file sitting on their desktop.
 */
export default function FileOrUrlInput({
  value,
  onChange,
  required,
  placeholder,
  accept = ACCEPT_ANY_DOCUMENT,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  accept?: string;
}) {
  const [mode, setMode] = useState<'upload' | 'link'>('link');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function upload(original: File) {
    setError(null);
    try {
      const file = await compressImage(original);
      setProgress(0);
      const signed = await withRetry(() =>
        api.post<SignedUpload>('/documents/upload-url', { filename: file.name }),
      );
      const asset = await withRetry(() => uploadToCloudinary(signed.data, file, setProgress));
      setFileName(file.name);
      onChange(asset.secureUrl);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void upload(f);
    e.target.value = '';
  };

  const tab = (m: 'upload' | 'link', label: string, Icon: typeof Upload) => (
    <button
      type="button"
      onClick={() => { setMode(m); setError(null); }}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
        mode === m ? 'bg-brand-primary text-white' : 'text-brand-on-surface-variant hover:bg-brand-surface'
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        {tab('link', 'Paste link', Link2)}
        {tab('upload', 'Upload file', Upload)}
      </div>

      {mode === 'link' ? (
        <input
          type="text"
          value={value ?? ''}
          required={required}
          placeholder={placeholder ?? 'https://… or http://…'}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary"
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 bg-brand-primary text-white text-[11px] font-bold rounded-lg px-3 py-1.5 cursor-pointer hover:bg-brand-primary-container">
            <Upload className="w-3.5 h-3.5" /> Choose file
            <input type="file" accept={accept} className="hidden" onChange={onPick} />
          </label>
          <label className="flex items-center gap-2 bg-brand-surface-container text-brand-primary text-[11px] font-bold rounded-lg px-3 py-1.5 border border-brand-outline-variant/20 cursor-pointer hover:bg-brand-surface-container-high sm:hidden">
            <Camera className="w-3.5 h-3.5" /> Take photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
          </label>
        </div>
      )}

      {progress !== null && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-brand-surface-container overflow-hidden">
            <div className="h-full rounded-full bg-brand-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[10px] font-mono text-brand-on-surface-variant w-9 text-right">{progress}%</span>
        </div>
      )}

      {/* Whatever the source, the field's value is one URL — show it plainly so
          the user can confirm what will actually be saved. */}
      {value && (
        <div className="flex items-center gap-2 bg-brand-surface rounded-lg border border-brand-outline-variant/15 px-2.5 py-1.5">
          <FileText className="w-3.5 h-3.5 text-brand-primary shrink-0" />
          <span className="text-[11px] text-brand-on-surface truncate flex-1" title={value}>{fileName ?? value}</span>
          {isAcceptableUrl(value) && (
            <a href={value} target="_blank" rel="noopener noreferrer" title="Open" className="p-1 rounded hover:bg-brand-surface-container text-brand-on-surface-variant">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button type="button" onClick={() => { onChange(''); setFileName(null); }} title="Clear" className="p-1 rounded hover:bg-red-50 text-red-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {value && !isAcceptableUrl(value) && (
        <p className="text-[10px] font-semibold text-amber-600">Enter a full link starting with http:// or https://</p>
      )}
      {error && <p className="text-[10px] font-semibold text-red-600">{error}</p>}
    </div>
  );
}
