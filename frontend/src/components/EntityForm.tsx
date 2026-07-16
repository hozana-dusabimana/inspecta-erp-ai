import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Field } from './formTypes';
import GeoPicker from './GeoPicker';
import DocumentAttachments from './DocumentAttachments';

function DynamicSelect({ field, value, onChange, required, projectId }: { field: Field; value: string; onChange: (v: string) => void; required?: boolean; projectId?: string }) {
  const url = useMemo(() => {
    let u = field.optionsEndpoint!;
    if (field.scopeToProject && projectId) u += (u.includes('?') ? '&' : '?') + 'projectId=' + projectId;
    return u;
  }, [field.optionsEndpoint, field.scopeToProject, projectId]);
  const { data } = useQuery({ queryKey: ['options', url], queryFn: () => api.get<Record<string, any>[]>(url) });
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

function emptyForm(fields: Field[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, '']));
}

function hydrate(fields: Field[], row: Record<string, any>): Record<string, string> {
  return Object.fromEntries(
    fields.map((f) => {
      const v = row[f.name];
      if (v === null || v === undefined) return [f.name, ''];
      if (f.type === 'date') return [f.name, String(v).slice(0, 10)];
      if (f.type === 'csv' && Array.isArray(v)) return [f.name, v.join(', ')];
      return [f.name, String(v)];
    }),
  );
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

interface Props {
  endpoint: string;
  entityLabel: string;
  fields: Field[];
  /** Row being edited, or null/undefined to create. */
  editing?: Record<string, any> | null;
  projectId?: string;
  projectScoped?: boolean;
  attachModule?: string;
  onClose: () => void;
  /** Called with the saved record after a successful create/edit. */
  onSaved?: (saved: Record<string, any>) => void;
}

/**
 * Config-driven create/edit modal shared by ResourceManager (table CRUD) and
 * bespoke callers (e.g. the Dashboard "New Project"). Renders as a multi-step
 * wizard when the field config declares `section`s; otherwise a single page.
 * Backward compatible with plain flat forms.
 */
export default function EntityForm({ endpoint, entityLabel, fields, editing, projectId, projectScoped, attachModule, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(editing);
  const [form, setForm] = useState<Record<string, string>>(() =>
    editing ? hydrate(fields, editing) : emptyForm(fields),
  );
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [createFor, setCreateFor] = useState<Field | null>(null); // inline related-record create

  const visible = fields.filter((f) => (isEdit ? !f.hideOnEdit : !f.hideOnCreate));

  // Group visible fields into ordered sections (first-seen order). Fields without
  // a section fall into a leading "General" group. A single group ⇒ no wizard.
  const sections = useMemo(() => {
    const order: string[] = [];
    const byName = new Map<string, Field[]>();
    for (const f of visible) {
      const key = f.section ?? '';
      if (!byName.has(key)) { byName.set(key, []); order.push(key); }
      byName.get(key)!.push(f);
    }
    return order.map((name) => ({ name, fields: byName.get(name)! }));
  }, [visible]);

  const isWizard = sections.length > 1;
  const current = sections[Math.min(step, sections.length - 1)];

  const set = (name: string, v: string) => setForm((s) => ({ ...s, [name]: v }));

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit ? api.put(`${endpoint}/${editing!.id}`, payload) : api.post(endpoint, payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: ['options', endpoint] });
      onSaved?.((res as { data?: Record<string, any> })?.data ?? {});
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const missingIn = (list: Field[]) =>
    list.find((f) => f.required && !String(form[f.name] ?? '').trim());

  const next = () => {
    const miss = missingIn(current.fields);
    if (miss) { setError(`${miss.label} is required.`); return; }
    setError(null);
    setStep((s) => Math.min(sections.length - 1, s + 1));
  };
  const back = () => { setError(null); setStep((s) => Math.max(0, s - 1)); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const miss = missingIn(visible);
    if (miss) {
      setError(`${miss.label} is required.`);
      const idx = sections.findIndex((sec) => sec.fields.includes(miss));
      if (idx >= 0) setStep(idx);
      return;
    }
    save.mutate(buildPayload(fields, form, projectId, projectScoped));
  };

  const renderField = (f: Field) => (
    <div key={f.name} className="space-y-1">
      <label className="text-[11px] font-bold text-brand-on-surface-variant block uppercase tracking-wide">
        {f.label}{f.required && <span className="text-brand-primary"> *</span>}
      </label>
      {f.type === 'geo' ? (
        <GeoPicker value={form[f.name] || undefined} onChange={(v) => set(f.name, v)} />
      ) : f.optionsEndpoint ? (
        <div className="flex items-center gap-2">
          <div className="flex-1"><DynamicSelect field={f} value={form[f.name] ?? ''} required={f.required} projectId={projectId} onChange={(v) => set(f.name, v)} /></div>
          {f.createConfig && (
            <button type="button" onClick={() => setCreateFor(f)} title={`New ${f.createConfig.entityLabel}`}
              className="h-10 shrink-0 flex items-center gap-1 px-2.5 rounded-lg border border-brand-primary/30 bg-brand-primary/5 text-brand-primary text-[11px] font-bold hover:bg-brand-primary/10">
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          )}
        </div>
      ) : f.type === 'textarea' ? (
        <textarea
          value={form[f.name] ?? ''} required={f.required}
          onChange={(e) => set(f.name, e.target.value)}
          className="w-full bg-brand-surface border border-brand-outline-variant rounded-lg px-3 py-2 text-xs outline-none focus:border-brand-primary min-h-[70px]"
        />
      ) : f.type === 'select' ? (
        <select
          value={form[f.name] ?? ''} required={f.required}
          onChange={(e) => set(f.name, e.target.value)}
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
          readOnly={f.readOnly}
          onClick={(e) => { if (f.type === 'date' && !f.readOnly) { try { (e.currentTarget as unknown as { showPicker: () => void }).showPicker(); } catch { /* unsupported */ } } }}
          onChange={(e) => set(f.name, e.target.value)}
          className={`w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary ${f.type === 'date' ? 'cursor-pointer' : ''} ${f.readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
        />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-brand-on-surface/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-brand-surface-container-lowest w-full max-w-lg rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant"><X className="w-5 h-5" /></button>
        <h3 className="font-display text-lg font-extrabold text-brand-primary mb-4">{isEdit ? 'Edit' : 'New'} {entityLabel}</h3>

        {/* Wizard stepper */}
        {isWizard && (
          <div className="flex items-center gap-1.5 mb-5">
            {sections.map((sec, i) => (
              <React.Fragment key={sec.name || i}>
                <button
                  type="button"
                  onClick={() => { if (i <= step) setStep(i); }}
                  className={`flex items-center gap-1.5 text-[11px] font-bold ${i === step ? 'text-brand-primary' : i < step ? 'text-brand-on-surface-variant' : 'text-brand-on-surface-variant/50'}`}
                >
                  <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] ${i === step ? 'bg-brand-primary text-white' : i < step ? 'bg-brand-primary/15 text-brand-primary' : 'bg-brand-surface border border-brand-outline-variant'}`}>
                    {i < step ? <Check className="w-3 h-3" /> : i + 1}
                  </span>
                  <span className="hidden sm:inline">{sec.name || 'Details'}</span>
                </button>
                {i < sections.length - 1 && <div className="flex-1 h-px bg-brand-outline-variant/40 min-w-[8px]" />}
              </React.Fragment>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          {isWizard && current.name && (
            <p className="text-xs font-bold text-brand-on-surface-variant -mt-1 mb-1">{current.name}</p>
          )}
          {(isWizard ? current.fields : visible).map(renderField)}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</div>}

          <div className="flex justify-between gap-3 pt-2">
            <div>
              {isWizard && step > 0 && (
                <button type="button" onClick={back} className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-brand-on-surface-variant hover:bg-brand-surface rounded-lg">
                  <ChevronLeft className="w-3.5 h-3.5" /> Back
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-brand-on-surface-variant hover:bg-brand-surface rounded-lg">Cancel</button>
              {isWizard && step < sections.length - 1 ? (
                <button type="button" onClick={next} className="flex items-center gap-1 px-5 py-2 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container">
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button type="submit" disabled={save.isPending} className="px-5 py-2 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container disabled:opacity-60">
                  {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : `Create ${entityLabel}`}
                </button>
              )}
            </div>
          </div>
        </form>

        {attachModule && isEdit && editing && (
          <DocumentAttachments module={attachModule} recordId={editing.id} projectId={projectScoped ? projectId : undefined} />
        )}

        {/* Inline "create related record" (e.g. a new Client from the project form) */}
        {createFor?.createConfig && (
          <div className="z-[60]">
            <EntityForm
              endpoint={createFor.createConfig.endpoint}
              entityLabel={createFor.createConfig.entityLabel}
              fields={createFor.createConfig.fields}
              onClose={() => setCreateFor(null)}
              onSaved={(saved) => {
                if (saved?.id) set(createFor.name, saved.id);
                queryClient.invalidateQueries({ queryKey: ['options', createFor.createConfig!.endpoint] });
                setCreateFor(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
