import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, X } from 'lucide-react';
import { api } from '../lib/api';

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'select' | 'date' | 'csv';
  options?: { value: string; label: string }[];
  /** Populate a select from a live API list (foreign-key pickers). */
  optionsEndpoint?: string;
  optionLabel?: (row: Record<string, any>) => string;
  required?: boolean;
  placeholder?: string;
}

function DynamicSelect({ field, value, onChange, required }: { field: Field; value: string; onChange: (v: string) => void; required?: boolean }) {
  const { data } = useQuery({
    queryKey: ['options', field.optionsEndpoint],
    queryFn: () => api.get<Record<string, any>[]>(field.optionsEndpoint!),
  });
  const rows = data?.data ?? [];
  return (
    <select
      value={value} required={required}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary font-semibold"
    >
      <option value="">Select…</option>
      {rows.map((r) => (
        <option key={r.id} value={r.id}>{field.optionLabel ? field.optionLabel(r) : r.name ?? r.id}</option>
      ))}
    </select>
  );
}

export interface Column {
  key: string;
  label: string;
  render?: (row: Record<string, any>) => React.ReactNode;
  align?: 'left' | 'right';
}

interface Props {
  endpoint: string;
  entityLabel: string;
  columns: Column[];
  fields: Field[];
  canWrite: boolean;
  projectId?: string;
  projectScoped?: boolean;
}

function emptyForm(fields: Field[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, '']));
}

function buildPayload(fields: Field[], form: Record<string, string>, projectId?: string, projectScoped?: boolean) {
  const payload: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = form[f.name];
    if (raw === '' || raw === undefined) continue;
    if (f.type === 'number') payload[f.name] = Number(raw);
    else if (f.type === 'date') payload[f.name] = new Date(raw).toISOString();
    else if (f.type === 'csv') payload[f.name] = raw.split(',').map((s) => s.trim()).filter(Boolean);
    else payload[f.name] = raw;
  }
  if (projectScoped && projectId) payload.projectId = projectId;
  return payload;
}

export default function ResourceManager({ endpoint, entityLabel, columns, fields, canWrite, projectId, projectScoped }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyForm(fields));
  const [error, setError] = useState<string | null>(null);

  const listKey = [endpoint, projectId ?? 'all'];
  const query = projectId ? `${endpoint}?projectId=${projectId}` : endpoint;

  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get<Record<string, any>[]>(query),
    enabled: !projectScoped || Boolean(projectId),
  });
  const rows = data?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [endpoint] });

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.put(`${endpoint}/${editing}`, payload) : api.post(endpoint, payload),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setEditing(null);
      setForm(emptyForm(fields));
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Save failed'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`${endpoint}/${id}`),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : 'Delete failed'),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(fields));
    setError(null);
    setOpen(true);
  };
  const openEdit = (row: Record<string, any>) => {
    setEditing(row.id);
    setForm(
      Object.fromEntries(
        fields.map((f) => {
          const v = row[f.name];
          if (v === null || v === undefined) return [f.name, ''];
          if (f.type === 'date') return [f.name, String(v).slice(0, 10)];
          if (f.type === 'csv' && Array.isArray(v)) return [f.name, v.join(', ')];
          return [f.name, String(v)];
        }),
      ),
    );
    setError(null);
    setOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(buildPayload(fields, form, projectId, projectScoped));
  };

  return (
    <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-brand-outline-variant/15">
        <h3 className="font-bold text-sm text-brand-primary">{entityLabel}s <span className="text-brand-on-surface-variant font-mono text-xs">({rows.length})</span></h3>
        {canWrite && (
          <button
            onClick={openCreate}
            disabled={projectScoped && !projectId}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary-container transition-all disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add {entityLabel}
          </button>
        )}
      </div>

      {!open && error && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {projectScoped && !projectId ? (
        <div className="p-8 text-center text-brand-on-surface-variant text-xs">Select a project above to view and add {entityLabel.toLowerCase()}s.</div>
      ) : isLoading ? (
        <div className="p-8 text-center text-brand-on-surface-variant text-xs">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-brand-outline-variant/20 text-brand-on-surface-variant font-bold text-left">
                {columns.map((c) => (
                  <th key={c.key} className={`px-5 py-2.5 ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
                ))}
                {canWrite && <th className="px-5 py-2.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={columns.length + 1} className="px-5 py-8 text-center text-brand-on-surface-variant">No records yet.</td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-brand-outline-variant/10 hover:bg-brand-surface/40">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-5 py-2.5 ${c.align === 'right' ? 'text-right font-mono' : ''}`}>
                      {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                    </td>
                  ))}
                  {canWrite && (
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(row)} className="p-1.5 rounded hover:bg-brand-surface text-brand-primary" aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button disabled={remove.isPending} onClick={() => { if (confirm('Delete this record?')) remove.mutate(row.id); }} className="p-1.5 rounded hover:bg-red-50 text-red-600 disabled:opacity-40" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-brand-on-surface/40 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="bg-brand-surface-container-lowest w-full max-w-lg rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setOpen(false)} className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant"><X className="w-5 h-5" /></button>
            <h3 className="font-display text-lg font-extrabold text-brand-primary mb-4">{editing ? 'Edit' : 'New'} {entityLabel}</h3>
            <form onSubmit={submit} className="space-y-3">
              {fields.map((f) => (
                <div key={f.name} className="space-y-1">
                  <label className="text-[11px] font-bold text-brand-on-surface-variant block uppercase tracking-wide">{f.label}</label>
                  {f.optionsEndpoint ? (
                    <DynamicSelect field={f} value={form[f.name] ?? ''} required={f.required} onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))} />
                  ) : f.type === 'textarea' ? (
                    <textarea
                      value={form[f.name] ?? ''} required={f.required}
                      onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                      className="w-full bg-brand-surface border border-brand-outline-variant rounded-lg px-3 py-2 text-xs outline-none focus:border-brand-primary min-h-[70px]"
                    />
                  ) : f.type === 'select' ? (
                    <select
                      value={form[f.name] ?? ''} required={f.required}
                      onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                      className="w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary font-semibold"
                    >
                      <option value="">Select…</option>
                      {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      step={f.type === 'number' ? 'any' : undefined}
                      value={form[f.name] ?? ''} required={f.required} placeholder={f.placeholder}
                      onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                      className="w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary"
                    />
                  )}
                </div>
              ))}
              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</div>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-xs font-semibold text-brand-on-surface-variant hover:bg-brand-surface rounded-lg">Cancel</button>
                <button type="submit" disabled={save.isPending} className="px-5 py-2 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container disabled:opacity-60">
                  {save.isPending ? 'Saving…' : editing ? 'Save changes' : `Create ${entityLabel}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
