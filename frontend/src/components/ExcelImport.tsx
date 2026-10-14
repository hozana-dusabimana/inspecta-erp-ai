import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';

/** Where a tab's Excel import lives (paths are relative to the API root). */
export interface ImporterDef {
  /** POST target for the .xlsx upload. */
  path: string;
  /** GET target that downloads the blank, documented template. */
  templatePath: string;
  /** Optional GET target for exporting the current rows in the same layout. */
  exportPath?: string;
  /** Short noun for messages, e.g. "WBS items". */
  label: string;
  /** One line telling people what the sheet needs. */
  hint?: string;
}

export interface ImportOutcome {
  created: number;
  updated?: number;
  skipped: number;
  errors: string[];
  errorCount?: number;
  versionNo?: number;
}

interface Props {
  def: ImporterDef;
  /** Set when the import belongs to one project; the bar waits for a selection. */
  projectId?: string;
  projectScoped?: boolean;
  /** Extra query-string pairs (e.g. a baseline name). */
  extraQuery?: Record<string, string>;
  /** Called after a successful import so the host can refresh its own data. */
  onDone?: (outcome: ImportOutcome) => void;
}

const withQuery = (path: string, params: Record<string, string | undefined>) => {
  const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
  return q ? `${path}${path.includes('?') ? '&' : '?'}${q}` : path;
};

export default function ExcelImportBar({ def, projectId, projectScoped, extraQuery, onDone }: Props) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blocked = Boolean(projectScoped && !projectId);
  const query = { ...(projectScoped ? { projectId } : {}), ...extraQuery };
  const fileBase = def.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const run = async (file: File) => {
    setBusy(true); setError(null); setOutcome(null);
    try {
      const res = await api.upload<ImportOutcome>(withQuery(def.path, query), file);
      setOutcome(res.data);
      qc.invalidateQueries();
      onDone?.(res.data);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const download = (path: string, name: string) =>
    api.download(withQuery(path, projectScoped ? { projectId } : {}), name).catch((e) => setError(e instanceof Error ? e.message : 'Download failed'));

  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold disabled:opacity-50 disabled:cursor-not-allowed';
  const errorCount = outcome ? (outcome.errorCount ?? outcome.errors.length) : 0;

  return (
    <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-4 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <FileSpreadsheet className="w-4 h-4 text-brand-primary" />
        <h3 className="font-bold text-brand-primary text-sm mr-2">Import {def.label} from Excel</h3>
        <button type="button" onClick={() => download(def.templatePath, `${fileBase}-template.xlsx`)} disabled={blocked}
          className={`${btn} bg-brand-primary/5 text-brand-primary border border-brand-primary/10 hover:bg-brand-primary/10`}>
          <Download className="w-3.5 h-3.5" /> Template
        </button>
        {def.exportPath && (
          <button type="button" onClick={() => download(def.exportPath!, `${fileBase}.xlsx`)} disabled={blocked}
            className={`${btn} bg-brand-primary/5 text-brand-primary border border-brand-primary/10 hover:bg-brand-primary/10`}>
            <Download className="w-3.5 h-3.5" /> Export current
          </button>
        )}
        <button type="button" onClick={() => input.current?.click()} disabled={busy || blocked}
          className={`${btn} bg-brand-primary text-white hover:bg-brand-primary-container`}>
          <Upload className="w-3.5 h-3.5" /> {busy ? 'Importing…' : 'Import .xlsx'}
        </button>
        <input ref={input} type="file" accept=".xlsx" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }} />
      </div>

      <p className="text-[11px] text-brand-on-surface-variant mt-2">
        {blocked ? 'Select a project above to import into it. ' : ''}
        {def.hint ?? 'Download the template, fill in the rows, then import. Rows that already exist are skipped, so re-importing is safe.'}
        {' '}You can also ask the Copilot to create a record by chatting.
      </p>

      {error && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {outcome && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${outcome.created + (outcome.updated ?? 0) > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`} role="status">
          <div className="flex items-start justify-between gap-3">
            <p className="font-bold">
              {outcome.created} added
              {outcome.updated ? ` · ${outcome.updated} updated` : ''}
              {outcome.skipped ? ` · ${outcome.skipped} skipped` : ''}
              {outcome.versionNo ? ` · saved as baseline v${outcome.versionNo}` : ''}
            </p>
            <button onClick={() => setOutcome(null)} aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
          </div>
          {outcome.errors.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-y-auto list-disc pl-4">
              {outcome.errors.map((e, i) => <li key={i}>{e}</li>)}
              {errorCount > outcome.errors.length && <li>…and {errorCount - outcome.errors.length} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
