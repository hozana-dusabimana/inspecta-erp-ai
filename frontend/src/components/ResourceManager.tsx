import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, X, Search, ChevronLeft, ChevronRight, Download, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { api, errorMessage } from '../lib/api';

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'select' | 'date' | 'csv';
  options?: { value: string; label: string }[];
  /** Populate a select from a live API list (foreign-key pickers). */
  optionsEndpoint?: string;
  /** Append the current projectId to optionsEndpoint so the picker only lists this project's records. */
  scopeToProject?: boolean;
  optionLabel?: (row: Record<string, any>) => string;
  required?: boolean;
  placeholder?: string;
  /** Read-only display (e.g. an auto-generated code shown on the edit screen). */
  readOnly?: boolean;
  /** Hide this field on the create form (e.g. auto-generated or set-later fields). */
  hideOnCreate?: boolean;
  /** Hide this field on the edit form. */
  hideOnEdit?: boolean;
}

/** Dropdown filter shown in the toolbar (maps to a backend filterField). */
export interface FilterDef {
  field: string;
  label: string;
  options: { value: string; label: string }[];
}

/** Summation card driven by backend `meta.sums` (or record count via key '__count'). */
export interface SummaryCardDef {
  key: string;
  label: string;
  money?: boolean;
}

function DynamicSelect({ field, value, onChange, required, projectId }: { field: Field; value: string; onChange: (v: string) => void; required?: boolean; projectId?: string }) {
  const url = useMemo(() => {
    let u = field.optionsEndpoint!;
    if (field.scopeToProject && projectId) u += (u.includes('?') ? '&' : '?') + 'projectId=' + projectId;
    return u;
  }, [field.optionsEndpoint, field.scopeToProject, projectId]);
  const { data } = useQuery({
    queryKey: ['options', url],
    queryFn: () => api.get<Record<string, any>[]>(url),
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
  /** When true, header is clickable to sort (key must be a real scalar column). */
  sortable?: boolean;
}

interface Props {
  endpoint: string;
  entityLabel: string;
  columns: Column[];
  fields: Field[];
  canWrite: boolean;
  projectId?: string;
  projectScoped?: boolean;
  /** Show the free-text search box (backend filters on its searchField). */
  searchable?: boolean;
  /** Show the from/to date-range picker (backend must set a dateField). */
  dateFilter?: boolean;
  /** Dropdown filters (backend must whitelist these in filterFields). */
  filters?: FilterDef[];
  /** Summation cards from backend meta.sums (+ '__count' for the total). */
  summaryCards?: SummaryCardDef[];
}

const money = (n: unknown) => 'RWF ' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const numFmt = (n: unknown) => Number(n ?? 0).toLocaleString();

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

const PAGE_SIZE = 25;

export default function ResourceManager({ endpoint, entityLabel, columns, fields, canWrite, projectId, projectScoped, searchable = true, dateFilter, filters, summaryCards }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyForm(fields));
  const [error, setError] = useState<string | null>(null);

  // Toolbar state
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [exporting, setExporting] = useState(false);

  // Any filter change returns to page 1.
  useEffect(() => { setPage(1); }, [search, dateFrom, dateTo, projectId, sortBy, sortDir, JSON.stringify(filterValues)]);

  // Shared param builder for both the list query and the export download.
  const buildParams = (withPaging: boolean) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (withPaging) { params.set('page', String(page)); params.set('pageSize', String(PAGE_SIZE)); }
    if (search) params.set('search', search);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (sortBy) { params.set('sortBy', sortBy); params.set('sortDir', sortDir); }
    for (const [k, v] of Object.entries(filterValues)) if (v) params.set(k, String(v));
    return params;
  };

  const queryString = useMemo(() => buildParams(true).toString(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, page, search, dateFrom, dateTo, sortBy, sortDir, filterValues]);

  const toggleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('asc'); }
  };

  const doExport = async (format: 'xlsx' | 'csv') => {
    setExporting(true);
    try {
      const params = buildParams(false);
      params.set('format', format);
      await api.download(`${endpoint}/export?${params.toString()}`, `${entityLabel}.${format}`);
    } catch {
      /* surfaced via the toolbar disabled state; non-fatal */
    } finally {
      setExporting(false);
    }
  };

  const listKey = [endpoint, queryString];

  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get<Record<string, any>[]>(`${endpoint}?${queryString}`),
    enabled: !projectScoped || Boolean(projectId),
  });
  const rows = data?.data ?? [];
  const meta = data?.meta;
  const total = meta?.total ?? rows.length;
  const sums = (meta as any)?.sums as Record<string, number> | undefined;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Invalidate every page/filter variant of this endpoint after a mutation.
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
    onError: (e) => setError(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`${endpoint}/${id}`),
    onSuccess: invalidate,
    onError: (e) => setError(errorMessage(e)),
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

  const cardValue = (c: SummaryCardDef) => {
    if (c.key === '__count') return numFmt(total);
    const v = sums?.[c.key] ?? 0;
    return c.money ? money(v) : numFmt(v);
  };

  return (
    <div className="space-y-4">
      {/* Inline error (shown when the create/edit modal is closed) */}
      {!open && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Summation cards */}
      {summaryCards && summaryCards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {summaryCards.map((c) => (
            <div key={c.key} className="bg-brand-surface-container-lowest p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
              <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{c.label}</p>
              <p className="font-mono text-xl font-extrabold mt-1 text-brand-primary">{cardValue(c)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-3 border-b border-brand-outline-variant/15">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-sm text-brand-primary">{entityLabel}s <span className="text-brand-on-surface-variant font-mono text-xs">({total})</span></h3>
            {canWrite && (
              <button
                onClick={openCreate}
                disabled={projectScoped && !projectId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary-container transition-all disabled:opacity-50 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Add {entityLabel}
              </button>
            )}
          </div>

          {(!projectScoped || projectId) && (
            <div className="flex flex-wrap items-end gap-2">
              {searchable && (
                <form
                  onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); }}
                  className="relative"
                >
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-on-surface-variant" />
                  <input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search…"
                    className="h-9 w-48 bg-brand-surface border border-brand-outline-variant rounded-lg pl-9 pr-3 text-xs outline-none focus:border-brand-primary"
                  />
                  {search && (
                    <button type="button" onClick={() => { setSearch(''); setSearchInput(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-on-surface-variant hover:text-brand-primary"><X className="w-3.5 h-3.5" /></button>
                  )}
                </form>
              )}
              {filters?.map((f) => (
                <div key={f.field} className="flex flex-col gap-0.5">
                  <label className="text-[9px] font-bold text-brand-on-surface-variant uppercase tracking-wide">{f.label}</label>
                  <select
                    value={filterValues[f.field] ?? ''}
                    onChange={(e) => setFilterValues((s) => ({ ...s, [f.field]: e.target.value }))}
                    className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs outline-none focus:border-brand-primary font-semibold"
                  >
                    <option value="">All</option>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
              {dateFilter && (
                <>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] font-bold text-brand-on-surface-variant uppercase tracking-wide">From</label>
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs outline-none focus:border-brand-primary" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] font-bold text-brand-on-surface-variant uppercase tracking-wide">To</label>
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-2 text-xs outline-none focus:border-brand-primary" />
                  </div>
                </>
              )}
              {(dateFrom || dateTo || Object.values(filterValues).some(Boolean)) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); setFilterValues({}); }}
                  className="h-9 px-3 rounded-lg text-[11px] font-bold text-brand-on-surface-variant hover:bg-brand-surface border border-brand-outline-variant"
                >
                  Clear
                </button>
              )}
              {/* Export current (filtered) view */}
              <div className="flex items-end gap-1 ml-auto">
                <button
                  onClick={() => doExport('xlsx')} disabled={exporting || total === 0}
                  className="h-9 flex items-center gap-1.5 px-3 rounded-lg text-[11px] font-bold text-brand-primary border border-brand-primary/20 bg-brand-primary/5 hover:bg-brand-primary/10 disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" /> {exporting ? 'Exporting…' : 'Excel'}
                </button>
                <button
                  onClick={() => doExport('csv')} disabled={exporting || total === 0}
                  className="h-9 px-3 rounded-lg text-[11px] font-bold text-brand-on-surface-variant border border-brand-outline-variant hover:bg-brand-surface disabled:opacity-40"
                >
                  CSV
                </button>
              </div>
            </div>
          )}
        </div>

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
                    <th key={c.key} className={`px-5 py-2.5 ${c.align === 'right' ? 'text-right' : ''}`}>
                      {c.sortable ? (
                        <button
                          onClick={() => toggleSort(c.key)}
                          className={`inline-flex items-center gap-1 hover:text-brand-primary ${c.align === 'right' ? 'flex-row-reverse' : ''} ${sortBy === c.key ? 'text-brand-primary' : ''}`}
                        >
                          {c.label}
                          {sortBy === c.key ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                  {canWrite && <th className="px-5 py-2.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={columns.length + 1} className="px-5 py-8 text-center text-brand-on-surface-variant">No records found.</td></tr>
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

        {/* Pagination footer */}
        {!isLoading && (!projectScoped || projectId) && total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-brand-outline-variant/15 text-xs">
            <span className="text-brand-on-surface-variant">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-brand-outline-variant text-xs font-bold disabled:opacity-40 hover:bg-brand-surface"><ChevronLeft className="w-3.5 h-3.5" /> Prev</button>
              <span className="font-mono text-brand-on-surface-variant">{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-brand-outline-variant text-xs font-bold disabled:opacity-40 hover:bg-brand-surface">Next <ChevronRight className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
      </div>

      {/* Create / edit modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-brand-on-surface/40 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="bg-brand-surface-container-lowest w-full max-w-lg rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setOpen(false)} className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant"><X className="w-5 h-5" /></button>
            <h3 className="font-display text-lg font-extrabold text-brand-primary mb-4">{editing ? 'Edit' : 'New'} {entityLabel}</h3>
            <form onSubmit={submit} className="space-y-3">
              {fields.filter((f) => (editing ? !f.hideOnEdit : !f.hideOnCreate)).map((f) => (
                <div key={f.name} className="space-y-1">
                  <label className="text-[11px] font-bold text-brand-on-surface-variant block uppercase tracking-wide">{f.label}</label>
                  {f.optionsEndpoint ? (
                    <DynamicSelect field={f} value={form[f.name] ?? ''} required={f.required} projectId={projectId} onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))} />
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
                      readOnly={f.readOnly}
                      onClick={(e) => { if (f.type === 'date' && !f.readOnly) { try { (e.currentTarget as unknown as { showPicker: () => void }).showPicker(); } catch { /* unsupported */ } } }}
                      onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                      className={`w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary ${f.type === 'date' ? 'cursor-pointer' : ''} ${f.readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
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
