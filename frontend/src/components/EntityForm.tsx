import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Field } from './formTypes';
import GeoPicker from './GeoPicker';
import DocumentAttachments from './DocumentAttachments';
import FileOrUrlInput from './FileOrUrlInput';
import { flushPending, type PendingAttachment } from '../lib/attachments';

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

/** Select with preset options that also lets the user add a value not in the
 *  list. Custom additions are remembered per-field in localStorage so they show
 *  up next time (no backend taxonomy table needed). */
function CreatableSelect({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const storeKey = `inspecta.opts.${field.name}`;
  const [custom, setCustom] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch { return []; }
  });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const presets = (field.options ?? []).map((o) => o.value);
  const labelFor = (v: string) => field.options?.find((o) => o.value === v)?.label ?? v;
  const all = Array.from(new Set([...presets, ...custom, ...(value && !presets.includes(value) && !custom.includes(value) ? [value] : [])]));

  const commit = () => {
    const v = draft.trim();
    if (!v) { setAdding(false); return; }
    if (!presets.includes(v) && !custom.includes(v)) {
      const next = [...custom, v];
      setCustom(next);
      try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* ignore */ }
    }
    onChange(v);
    setDraft('');
    setAdding(false);
  };

  const inputCls = 'w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary';
  if (adding) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus value={draft} placeholder={`New ${field.label.toLowerCase()}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setAdding(false); setDraft(''); } }}
          className={inputCls}
        />
        <button type="button" onClick={commit} className="h-10 shrink-0 px-3 rounded-lg bg-brand-primary text-white text-[11px] font-bold hover:bg-brand-primary-container">Add</button>
        <button type="button" onClick={() => { setAdding(false); setDraft(''); }} className="h-10 shrink-0 px-2 rounded-lg border border-brand-outline-variant text-[11px] font-bold text-brand-on-surface-variant">Cancel</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} flex-1 font-semibold`}>
        <option value="">Select…</option>
        {all.map((v) => <option key={v} value={v}>{labelFor(v)}</option>)}
      </select>
      <button type="button" onClick={() => setAdding(true)} title={`Add a ${field.label.toLowerCase()} not listed`}
        className="h-10 shrink-0 flex items-center gap-1 px-2.5 rounded-lg border border-brand-primary/30 bg-brand-primary/5 text-brand-primary text-[11px] font-bold hover:bg-brand-primary/10">
        <Plus className="w-3.5 h-3.5" /> New
      </button>
    </div>
  );
}

function emptyForm(fields: Field[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, '']));
}

/** Fallback guidance text so no input is ever blank/ambiguous. */
function placeholderFor(f: Field): string {
  if (f.placeholder) return f.placeholder;
  if (f.type === 'number') return `e.g. 0`;
  return `Enter ${f.label.replace(/\s*\(.*?\)\s*/g, '').toLowerCase()}`;
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
  // Record just created in this modal. Attachments need an id, so on a module
  // with evidence we stay open afterwards and offer the panel straight away —
  // otherwise the user has to find the row again and re-open it to attach.
  const [justCreated, setJustCreated] = useState<Record<string, any> | null>(null);
  // Evidence chosen before the record existed, uploaded right after it saves.
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [attachErrors, setAttachErrors] = useState<string[]>([]);

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
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: ['options', endpoint] });
      const saved = (res as { data?: Record<string, any> })?.data ?? {};
      onSaved?.(saved);
      if (isEdit || !attachModule || !saved.id) { onClose(); return; }

      // Upload anything queued on the form now that the record has an id. A
      // failed attachment must not read as a failed create — the record is
      // already saved, so surface the problem and keep the panel open.
      if (pending.length) {
        setAttaching(true);
        const errors = await flushPending(
          { module: attachModule, recordId: saved.id, projectId: projectScoped ? projectId : undefined },
          pending,
        );
        setAttaching(false);
        setPending([]);
        setAttachErrors(errors);
        queryClient.invalidateQueries({ queryKey: ['/project-documents', attachModule, saved.id] });
        queryClient.invalidateQueries({ queryKey: ['/project-documents/coverage', attachModule] });
      }
      setJustCreated(saved);
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
    <div key={f.name} className={`space-y-1 ${f.type === 'textarea' || f.type === 'geo' || f.type === 'file' ? 'sm:col-span-2' : ''}`}>
      <label className="text-[11px] font-bold text-brand-on-surface-variant block uppercase tracking-wide">
        {f.label}{f.required && <span className="text-brand-primary"> *</span>}
      </label>
      {f.type === 'file' ? (
        <FileOrUrlInput
          value={form[f.name] ?? ''} required={f.required} accept={f.accept}
          placeholder={f.placeholder} onChange={(v) => set(f.name, v)}
        />
      ) : f.type === 'geo' ? (
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
      ) : f.type === 'select' && f.creatable ? (
        <CreatableSelect field={f} value={form[f.name] ?? ''} onChange={(v) => set(f.name, v)} />
      ) : f.type === 'textarea' ? (
        <textarea
          value={form[f.name] ?? ''} required={f.required} placeholder={placeholderFor(f)}
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
          value={form[f.name] ?? ''} required={f.required} placeholder={f.type === 'date' ? undefined : placeholderFor(f)}
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
      <div className="bg-brand-surface-container-lowest w-full max-w-3xl rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant"><X className="w-5 h-5" /></button>
        <h3 className="font-display text-lg font-extrabold text-brand-primary mb-4">{isEdit ? 'Edit' : 'New'} {entityLabel}</h3>

        {/* Created — offer evidence straight away instead of closing. */}
        {justCreated ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
              {entityLabel} created. Attach any supporting files or links now, or skip — you can add them later from the record.
            </div>
            {attachErrors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
                <p>The {entityLabel.toLowerCase()} saved, but {attachErrors.length} attachment(s) failed — you can retry below:</p>
                <ul className="list-disc pl-4 mt-1 font-normal">{attachErrors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            <DocumentAttachments module={attachModule!} recordId={justCreated.id} projectId={projectScoped ? projectId : undefined} />
            <div className="flex justify-end pt-2">
              <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container">Done</button>
            </div>
          </div>
        ) : (
        <>
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

        <form onSubmit={submit} className="space-y-4">
          {isWizard && current.name && (
            <p className="text-xs font-bold text-brand-on-surface-variant">{current.name}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {(isWizard ? current.fields : visible).map(renderField)}
          </div>

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
                <button type="submit" disabled={save.isPending || attaching} className="px-5 py-2 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container disabled:opacity-60">
                  {attaching ? `Uploading ${pending.length} attachment${pending.length === 1 ? '' : 's'}…`
                    : save.isPending ? 'Saving…'
                    : isEdit ? 'Save changes'
                    : `Create ${entityLabel}${pending.length ? ` + ${pending.length} attachment${pending.length === 1 ? '' : 's'}` : ''}`}
                </button>
              )}
            </div>
          </div>
        </form>

        {attachModule && (isEdit && editing ? (
          <DocumentAttachments module={attachModule} recordId={editing.id} projectId={projectScoped ? projectId : undefined} />
        ) : !isEdit && (
          // Create form: no record id yet, so choices are queued and uploaded
          // on save. Showing the panel here is what makes the feature findable.
          <DocumentAttachments module={attachModule} pending={pending} onPendingChange={setPending} />
        ))}
        </>
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
