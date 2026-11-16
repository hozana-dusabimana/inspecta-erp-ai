import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Eye, X, Search, ChevronLeft, ChevronRight, Download, ArrowUp, ArrowDown, ArrowUpDown, Ban } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Field, FilterDef, SummaryCardDef, Column, PostingDef, RowAction } from './formTypes';
import EntityForm from './EntityForm';
import RecordDetail from './RecordDetail';
import { useEvidenceRules } from '../lib/evidence';
import { NoAccessPanel, Skeleton } from './AccessPages';

// Re-exported so existing imports (`from './ResourceManager'`) keep working.
export type { Field, FilterDef, SummaryCardDef, Column, PostingDef, RowAction } from './formTypes';

interface Props {
  endpoint: string;
  entityLabel: string;
  columns: Column[];
  fields: Field[];
  canWrite: boolean;
  projectId?: string;
  /** Project to hand the create/edit form (WBS scoping, payload) when the tab itself isn't project-scoped
   *  — e.g. a company-wide ledger whose list spans every project, but a new entry can still optionally
   *  tie to whichever project is currently selected. Defaults to `projectId`. */
  formProjectId?: string;
  projectScoped?: boolean;
  /** Show the free-text search box (backend filters on its searchField). */
  searchable?: boolean;
  /** Show the from/to date-range picker (backend must set a dateField). */
  dateFilter?: boolean;
  /** Dropdown filters (backend must whitelist these in filterFields). */
  filters?: FilterDef[];
  /** Summation cards from backend meta.sums (+ '__count' for the total). */
  summaryCards?: SummaryCardDef[];
  /** When set, show a document-attachments panel on the edit form (project_documents module key). */
  attachModule?: string;
  /** Posted records (cost, stock, invoices, payments): no Delete, Cancel with a reason instead. */
  posting?: PostingDef;
  /** Extra per-row actions with their own dialog. */
  rowActions?: RowAction[];
}

const money = (n: unknown) => 'RWF ' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const numFmt = (n: unknown) => Number(n ?? 0).toLocaleString();

const PAGE_SIZE = 25;

/** English plural for record names: Activity -> Activities, Diary Entry -> Diary Entries. */
export function plural(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return label.slice(0, -1) + 'ies';
  if (/(s|x|ch|sh)$/i.test(label)) return label + 'es';
  return label + 's';
}

// Modules where the server refuses to confirm/close the record without evidence.
const EVIDENCE_REQUIRED: Record<string, string> = { grn: 'to confirm the GRN', material_issue: 'to confirm the issue', ncr: 'to close the NCR' };

export default function ResourceManager({ endpoint, entityLabel, columns, fields, canWrite: canWriteProp, projectId, formProjectId, projectScoped, searchable = true, dateFilter, filters, summaryCards, attachModule, posting, rowActions }: Props) {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Record<string, any> | null>(null);
  const [viewingRow, setViewingRow] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Record<string, any> | null>(null);
  const [reason, setReason] = useState('');
  const [actionDialog, setActionDialog] = useState<{ a: RowAction; row: Record<string, any> } | null>(null);

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
  const portfolioView = Boolean(projectScoped && !projectId);
  // Records are added/edited inside one project; the portfolio view is read-only.
  const canWrite = canWriteProp && !portfolioView;

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

  const { data, isLoading, error: listError } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get<Record<string, any>[]>(`${endpoint}?${queryString}`),
    enabled: true, // no project selected = portfolio view across all projects (read-only)
  });
  const rows = data?.data ?? [];
  const meta = data?.meta;

  // Evidence coverage — which listed records already have a document attached.
  const { data: coverageData } = useQuery({
    queryKey: ['/project-documents/coverage', attachModule, projectId],
    queryFn: () => api.get<{ recordIds: string[] }>(`/project-documents/coverage?module=${attachModule}${projectId ? `&projectId=${projectId}` : ''}`),
    enabled: Boolean(attachModule),
  });
  const covered = useMemo(() => new Set(coverageData?.data.recordIds ?? []), [coverageData]);
  const evidenceRules = useEvidenceRules().data;
  const total = meta?.total ?? rows.length;
  const sums = (meta as any)?.sums as Record<string, number> | undefined;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [endpoint] });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`${endpoint}/${id}`),
    onSuccess: invalidate,
    onError: (e) => setError(errorMessage(e)),
  });

  const cancel = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => api.post(`${endpoint}/${id}/cancel`, { reason: why }),
    onSuccess: () => { setCancelling(null); setReason(''); invalidate(); queryClient.invalidateQueries(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const isPosted = (row: Record<string, any>) => Boolean(posting) && (!posting!.isPosted || posting!.isPosted(row));

  const openCreate = () => { setEditingRow(null); setError(null); setFormOpen(true); };
  const openEdit = (row: Record<string, any>) => { setEditingRow(row); setError(null); setFormOpen(true); };

  const cardValue = (c: SummaryCardDef): React.ReactNode => {
    // Never show 0 before the request has answered (T1-09).
    if (isLoading || !data) return <Skeleton className="h-6 w-20" />;
    if (c.key === '__count') return numFmt(total);
    const v = sums?.[c.key] ?? 0;
    return c.money ? money(v) : numFmt(v);
  };

  return (
    <div className="space-y-4">
      {/* Inline error (e.g. a failed delete) */}
      {error && (
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
            <h3 className="font-bold text-sm text-brand-primary">{plural(entityLabel)} <span className="text-brand-on-surface-variant font-mono text-xs">({total})</span></h3>
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

        {portfolioView && (
          <div className="px-5 py-2 text-[11px] font-semibold text-brand-on-surface-variant bg-brand-surface-container-low border-b border-brand-outline-variant/15">
            Showing {plural(entityLabel).toLowerCase()} across all projects. Pick a project above to add or edit.
          </div>
        )}
        {isLoading ? (
          <div className="space-y-2 p-5" aria-busy="true" aria-label="Loading">{[0, 1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-brand-surface-container-low" />)}</div>
        ) : listError ? (
          (listError as { status?: number }).status === 403
            ? <div className="p-6"><NoAccessPanel what={plural(entityLabel).toLowerCase()} /></div>
            : <div role="alert" className="p-8 text-center text-xs font-semibold text-red-700">Could not load {plural(entityLabel).toLowerCase()}: {errorMessage(listError)}</div>
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
                  {attachModule && <th className="px-5 py-2.5" title="Proof attached to the record (file or link)">Evidence</th>}
                  {/* Always present: viewing a record is available to read-only users too. */}
                  <th className="px-5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={columns.length + (attachModule ? 1 : 0) + 1} className="px-5 py-8 text-center text-brand-on-surface-variant">No records.</td></tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className={`border-b border-brand-outline-variant/10 hover:bg-brand-surface/40 ${row.cancelledAt ? 'opacity-60' : ''}`}>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-5 py-2.5 ${c.align === 'right' ? 'text-right font-mono' : ''}`}>
                        {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                      </td>
                    ))}
                    {attachModule && (
                      <td className="px-5 py-2.5">
                        {covered.has(row.id)
                          ? <span className="text-emerald-600 font-bold" title="Documents attached">✓</span>
                          : (EVIDENCE_REQUIRED[attachModule] || evidenceRules?.rules?.[attachModule])
                            ? <span className="text-amber-600 font-bold" title={`No evidence yet. Required ${EVIDENCE_REQUIRED[attachModule] ?? 'by your company evidence settings'}.`}>⚠ Required</span>
                            : <span className="text-brand-on-surface-variant font-semibold text-[11px]" title="Optional: attach a photo, file or link as proof.">Optional</span>}
                      </td>
                    )}
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      {row.cancelledAt && (
                        <span className="mr-1 inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700" title={`Cancelled ${new Date(row.cancelledAt).toLocaleString()}: ${row.cancelReason ?? ''}`}>Cancelled</span>
                      )}
                      {row.reversalOfId && (
                        <span className="mr-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800" title="Equal and opposite entry that reverses a cancelled record">Reversal</span>
                      )}
                      {canWrite && (rowActions ?? []).filter((a) => !a.show || a.show(row)).map((a) => (
                        <button key={a.label} onClick={() => setActionDialog({ a, row })} className="mr-1 rounded border border-brand-primary/30 px-2 py-0.5 text-[10px] font-bold text-brand-primary hover:bg-brand-primary/5">{a.label}</button>
                      ))}
                      <button onClick={() => setViewingRow(row)} className="p-1.5 rounded hover:bg-brand-surface text-brand-on-surface-variant" aria-label="View details" title="View all details"><Eye className="w-3.5 h-3.5" /></button>
                      {canWrite && !row.cancelledAt && !row.reversalOfId && <>
                        {!(isPosted(row) && posting?.lockEdit) && (
                          <button onClick={() => openEdit(row)} className="p-1.5 rounded hover:bg-brand-surface text-brand-primary" aria-label="Edit" title={isPosted(row) ? 'Edit notes (amounts are locked once posted)' : 'Edit'}><Pencil className="w-3.5 h-3.5" /></button>
                        )}
                        {isPosted(row) ? (
                          <button onClick={() => { setCancelling(row); setReason(''); setError(null); }} className="p-1.5 rounded hover:bg-red-50 text-red-600" aria-label="Cancel record" title="Cancel with a reason (the record stays visible and its effect is reversed)"><Ban className="w-3.5 h-3.5" /></button>
                        ) : (
                          <button disabled={remove.isPending} onClick={() => { if (confirm('Delete this record?')) remove.mutate(row.id); }} className="p-1.5 rounded hover:bg-red-50 text-red-600 disabled:opacity-40" aria-label="Delete" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </>}
                    </td>
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

      {/* Create / edit modal (shared wizard-capable form) */}
      {formOpen && (
        <EntityForm
          endpoint={endpoint}
          entityLabel={entityLabel}
          fields={fields}
          editing={editingRow}
          projectId={formProjectId ?? projectId}
          projectScoped={projectScoped}
          attachModule={attachModule}
          onClose={() => setFormOpen(false)}
        />
      )}

      {actionDialog && actionDialog.a.dialog(actionDialog.row, () => { setActionDialog(null); invalidate(); })}

      {/* Cancel a posted record: a reason is mandatory and recorded in the audit log. */}
      {cancelling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Cancel ${entityLabel}`}>
          <form
            onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 5) cancel.mutate({ id: cancelling.id, why: reason.trim() }); }}
            className="w-full max-w-md space-y-3 rounded-xl bg-brand-surface-container-lowest p-5 shadow-xl"
          >
            <h3 className="text-sm font-bold text-brand-primary">Cancel {entityLabel}</h3>
            <p className="text-xs text-brand-on-surface-variant">
              Posted records are never deleted. Cancelling keeps this record visible, marks it cancelled and posts an equal and opposite entry, so cost and stock return to what they were. This is recorded with your name and the reason.
            </p>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-brand-on-surface-variant" htmlFor="cancel-reason">Reason (required)</label>
            <textarea id="cancel-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded-lg border border-brand-outline-variant bg-brand-surface p-2 text-xs outline-none focus:border-brand-primary" placeholder="e.g. Issued to the wrong slab, re-entered as ISS-0002" />
            {reason.trim().length > 0 && reason.trim().length < 5 && <p className="text-[11px] text-red-600">Give a reason of at least 5 characters.</p>}
            {error && <p className="text-[11px] font-semibold text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCancelling(null)} className="rounded-lg border border-brand-outline-variant px-3 py-1.5 text-xs font-bold">Keep it</button>
              <button type="submit" disabled={reason.trim().length < 5 || cancel.isPending} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">{cancel.isPending ? 'Cancelling…' : 'Cancel record'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Read-only "view everything" for a single record */}
      {viewingRow && (
        <RecordDetail
          entityLabel={entityLabel}
          row={viewingRow}
          fields={fields}
          columns={columns}
          attachModule={attachModule}
          projectId={projectId}
          projectScoped={projectScoped}
          canWrite={canWrite && !viewingRow.cancelledAt && !viewingRow.reversalOfId && !(isPosted(viewingRow) && posting?.lockEdit)}
          onEdit={() => { const r = viewingRow; setViewingRow(null); openEdit(r); }}
          onClose={() => setViewingRow(null)}
        />
      )}
    </div>
  );
}
