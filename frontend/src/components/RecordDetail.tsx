import React, { useMemo } from 'react';
import { X, Pencil, ExternalLink } from 'lucide-react';
import { Field, Column } from './formTypes';
import DocumentAttachments from './DocumentAttachments';
import { isAcceptableUrl } from '../lib/upload';

interface Props {
  entityLabel: string;
  row: Record<string, any>;
  fields: Field[];
  columns: Column[];
  attachModule?: string;
  projectId?: string;
  projectScoped?: boolean;
  canWrite?: boolean;
  onEdit?: () => void;
  onClose: () => void;
}

const isBlank = (v: unknown) => v === null || v === undefined || v === '';

/** Human-readable date; falls back to the raw string if it isn't one. */
function fmtDate(v: unknown): string {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const hasTime = /T\d\d:/.test(String(v)) && !/T00:00:00/.test(String(v));
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    + (hasTime ? ` ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '');
}

/**
 * Read-only view of a single record — every field the form knows about plus any
 * computed table columns (score, totals) that have no input of their own.
 * Opening the edit form just to read a record is both awkward and risky.
 */
export default function RecordDetail({
  entityLabel, row, fields, columns, attachModule, projectId, projectScoped, canWrite, onEdit, onClose,
}: Props) {
  const value = (f: Field): React.ReactNode => {
    const raw = row[f.name];
    if (isBlank(raw)) return <span className="text-brand-on-surface-variant/60">—</span>;
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';

    // Foreign keys: the API includes the related record, so show its name
    // rather than a cuid the reader cannot interpret.
    if (f.optionsEndpoint) {
      const base = f.name.replace(/Id$/, '');
      const rel = row[base];
      if (rel && typeof rel === 'object') return rel.name ?? rel.title ?? rel.code ?? String(raw);
    }
    if (f.options?.length) {
      const hit = f.options.find((o) => o.value === String(raw));
      if (hit) return hit.label;
    }
    if (f.type === 'date') return fmtDate(raw);
    if (f.type === 'csv' || Array.isArray(raw)) return (Array.isArray(raw) ? raw : String(raw).split(',')).join(', ');
    if (f.type === 'number') return Number(raw).toLocaleString();
    if (f.type === 'file' || isAcceptableUrl(String(raw))) {
      return (
        <a href={String(raw)} target="_blank" rel="noopener noreferrer"
          className="text-brand-primary underline inline-flex items-center gap-1 break-all">
          {String(raw)} <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      );
    }
    return String(raw);
  };

  // Group by the same wizard sections the form uses, so the reading order
  // matches the order things were entered in.
  const sections = useMemo(() => {
    const order: string[] = [];
    const byName = new Map<string, Field[]>();
    for (const f of fields) {
      const key = f.section ?? '';
      if (!byName.has(key)) { byName.set(key, []); order.push(key); }
      byName.get(key)!.push(f);
    }
    return order.map((name) => ({ name, fields: byName.get(name)! }));
  }, [fields]);

  // Table columns with no matching field are computed values (score, variance,
  // totals) — worth showing, and only available via the column renderer.
  const computed = columns.filter((c) => !fields.some((f) => f.name === c.key) && c.key !== 'id');

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-brand-on-surface-variant uppercase tracking-wide">{label}</p>
      <div className="text-xs text-brand-on-surface break-words">{children}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-brand-on-surface/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-brand-surface-container-lowest w-full max-w-3xl rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant" aria-label="Close">
          <X className="w-5 h-5" />
        </button>

        <h3 className="font-display text-lg font-extrabold text-brand-primary mb-1">{entityLabel} details</h3>
        <p className="text-xs text-brand-on-surface-variant mb-5 truncate">
          {row.name ?? row.title ?? row.code ?? row.reference ?? row.id}
        </p>

        <div className="space-y-5">
          {sections.map((sec) => (
            <div key={sec.name || 'general'}>
              {sec.name && <p className="text-xs font-bold text-brand-on-surface-variant mb-2">{sec.name}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                {sec.fields.map((f) => <Row key={f.name} label={f.label}>{value(f)}</Row>)}
              </div>
            </div>
          ))}

          {computed.length > 0 && (
            <div>
              <p className="text-xs font-bold text-brand-on-surface-variant mb-2">Calculated</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                {computed.map((c) => (
                  <Row key={c.key} label={c.label}>
                    {c.render ? c.render(row) : isBlank(row[c.key]) ? <span className="text-brand-on-surface-variant/60">—</span> : String(row[c.key])}
                  </Row>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-brand-outline-variant/20 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {row.createdAt && <Row label="Created">{fmtDate(row.createdAt)}</Row>}
            {row.updatedAt && <Row label="Last updated">{fmtDate(row.updatedAt)}</Row>}
          </div>

          {/* Attachments are part of "everything about this record". */}
          {attachModule && (
            <DocumentAttachments module={attachModule} recordId={row.id} projectId={projectScoped ? projectId : undefined} />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-brand-on-surface-variant hover:bg-brand-surface rounded-lg">Close</button>
          {canWrite && onEdit && (
            <button type="button" onClick={onEdit} className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
