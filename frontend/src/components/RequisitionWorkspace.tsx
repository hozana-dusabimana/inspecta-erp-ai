import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, AlertTriangle, Check } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Material requisitions: the site asking the company store for materials.
 *
 * The chain is deliberately three separate hands — the foreman raises it, the
 * site engineer approves it, the store issues it — so this screen shows each
 * user only the actions their role actually grants. The generic table can't
 * express line items or status transitions, hence a bespoke workspace.
 */

interface Material {
  id: string;
  code: string;
  name: string;
  unit: string;
}

interface Line {
  id: string;
  materialId: string;
  material: Material;
  unit: string;
  quantityRequested: string | number;
  quantityApproved: string | number;
  quantityIssued: string | number;
  note: string | null;
  /** Only present on the /board response. */
  outstanding?: number;
  onHand?: number;
  shortfall?: number;
}

interface Requisition {
  id: string;
  number: string;
  title: string | null;
  location: string | null;
  status: string;
  projectId: string;
  requiredByDate: string | null;
  dateRequested: string;
  decisionNote: string | null;
  notes: string | null;
  items: Line[];
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-brand-surface text-brand-on-surface-variant',
  SUBMITTED: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  PARTIALLY_ISSUED: 'bg-sky-100 text-sky-700',
  ISSUED: 'bg-violet-100 text-violet-700',
  CANCELLED: 'bg-brand-surface text-brand-on-surface-variant',
  CLOSED: 'bg-brand-surface text-brand-on-surface-variant',
};

const inputCls =
  'w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary transition-all';
const labelCls = 'font-sans text-[10px] font-bold text-brand-on-surface-variant block mb-1';
const btnCls =
  'px-2.5 py-1 rounded-md bg-brand-primary text-white text-[10px] font-bold hover:bg-brand-primary-container disabled:opacity-50';

const n = (v: unknown) => Number(v ?? 0);
const fmt = (v: unknown) => n(v).toLocaleString(undefined, { maximumFractionDigits: 3 });
const day = (d: string | null) => (d ? String(d).slice(0, 10) : '—');

export default function RequisitionWorkspace({ projectId, canWrite }: { projectId?: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('requisition:approve');
  const canIssue = hasPermission('inventory:write');

  const [creating, setCreating] = useState(false);
  const [decide, setDecide] = useState<{ req: Requisition; mode: 'approve' | 'reject' } | null>(null);
  const [issuing, setIssuing] = useState<Requisition | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['/requisitions/board'],
    queryFn: () => api.get<{ requisitions: Requisition[]; counts: Record<string, number> }>('/requisitions/board'),
  });
  const { data: allData } = useQuery({
    queryKey: ['/requisitions', projectId ?? 'all'],
    queryFn: () =>
      api.get<Requisition[]>(`/requisitions?pageSize=200${projectId ? `&projectId=${projectId}` : ''}`),
  });

  const board = data?.data.requisitions ?? [];
  const counts = data?.data.counts ?? {};
  const history = (allData?.data ?? []).filter(
    (r) => !['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_ISSUED'].includes(r.status),
  );

  const visible = projectId ? board.filter((r) => r.projectId === projectId) : board;

  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: unknown }) =>
      api.post(`/requisitions/${id}/${action}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/requisitions/board'] });
      qc.invalidateQueries({ queryKey: ['/requisitions'] });
      // Issuing moves stock, so the ledger views are stale too.
      qc.invalidateQueries({ queryKey: ['/inventory/stock'] });
    },
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Action failed'),
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Drafts" value={counts.draft ?? 0} />
        <Stat label="Awaiting Approval" value={counts.awaitingApproval ?? 0} tone={counts.awaitingApproval ? 'warn' : undefined} />
        <Stat label="Awaiting Issue" value={counts.awaitingIssue ?? 0} />
        <Stat label="With Shortfalls" value={counts.shortfalls ?? 0} tone={counts.shortfalls ? 'bad' : undefined} />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-brand-on-surface-variant text-xs">
          Foreman raises a requisition → site engineer approves it → the store issues it from stock.
        </p>
        {canWrite && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 bg-brand-primary text-white font-bold text-xs rounded-lg px-4 py-2.5 hover:bg-brand-primary-container transition-all">
            <Plus className="w-4 h-4" /> New Requisition
          </button>
        )}
      </div>

      {isLoading && <p className="text-brand-on-surface-variant text-xs">Loading requisitions…</p>}
      {!isLoading && visible.length === 0 && (
        <p className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 p-6 text-center text-xs text-brand-on-surface-variant">
          Nothing in flight. Raise a requisition to ask the store for materials.
        </p>
      )}

      <div className="space-y-4">
        {visible.map((r) => (
          <RequisitionCard
            key={r.id}
            req={r}
            busy={act.isPending}
            canWrite={canWrite}
            canApprove={canApprove}
            canIssue={canIssue}
            onSubmit={() => act.mutate({ id: r.id, action: 'submit' })}
            onCancel={() => { if (confirm(`Cancel ${r.number}?`)) act.mutate({ id: r.id, action: 'cancel' }); }}
            onDecide={(mode) => setDecide({ req: r, mode })}
            onIssue={() => setIssuing(r)}
            onClose={() => act.mutate({ id: r.id, action: 'close' })}
          />
        ))}
      </div>

      {history.length > 0 && (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-brand-outline-variant/15 font-bold text-brand-primary text-sm">Closed & Rejected</div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/15">
              <th className="px-4 py-2 font-bold">Number</th><th className="px-4 py-2 font-bold">Title</th>
              <th className="px-4 py-2 font-bold">Status</th><th className="px-4 py-2 font-bold">Decision</th>
            </tr></thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-b border-brand-outline-variant/10 last:border-0">
                  <td className="px-4 py-2 font-bold text-brand-primary">{r.number}</td>
                  <td className="px-4 py-2">{r.title ?? '—'}</td>
                  <td className="px-4 py-2"><StatusChip status={r.status} /></td>
                  <td className="px-4 py-2 text-brand-on-surface-variant">{r.decisionNote ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateModal projectId={projectId} onClose={() => setCreating(false)} />}
      {decide && <DecisionModal state={decide} onClose={() => setDecide(null)} />}
      {issuing && <IssueModal req={issuing} onClose={() => setIssuing(null)} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-brand-primary';
  return (
    <div className="bg-brand-surface-container-lowest p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
      <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{label}</p>
      <p className={`font-mono text-2xl font-extrabold ${color}`}>{value}</p>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_TONE[status] ?? ''}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function RequisitionCard({
  req, busy, canWrite, canApprove, canIssue, onSubmit, onCancel, onDecide, onIssue, onClose,
}: {
  req: Requisition; busy: boolean; canWrite: boolean; canApprove: boolean; canIssue: boolean;
  onSubmit: () => void; onCancel: () => void; onDecide: (m: 'approve' | 'reject') => void;
  onIssue: () => void; onClose: () => void;
}) {
  const shortfalls = req.items.filter((i) => (i.shortfall ?? 0) > 0);
  return (
    <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-brand-outline-variant/15 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-primary text-sm">{req.number}</span>
            <StatusChip status={req.status} />
            {shortfalls.length > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
                <AlertTriangle className="w-3 h-3" /> {shortfalls.length} short
              </span>
            )}
          </div>
          <p className="text-[11px] text-brand-on-surface-variant mt-0.5">
            {req.title ?? 'Untitled'}{req.location ? ` · ${req.location}` : ''} · needed by {day(req.requiredByDate)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {req.status === 'DRAFT' && canWrite && (
            <>
              <button disabled={busy} onClick={onSubmit} className={btnCls}>Submit for approval</button>
              <button disabled={busy} onClick={onCancel} className={`${btnCls} bg-brand-surface !text-brand-on-surface-variant hover:bg-brand-surface`}>Cancel</button>
            </>
          )}
          {req.status === 'SUBMITTED' && canApprove && (
            <>
              <button disabled={busy} onClick={() => onDecide('approve')} className={btnCls}>Approve</button>
              <button disabled={busy} onClick={() => onDecide('reject')} className={`${btnCls} bg-red-600 hover:bg-red-700`}>Reject</button>
            </>
          )}
          {(req.status === 'APPROVED' || req.status === 'PARTIALLY_ISSUED') && canIssue && (
            <button disabled={busy} onClick={onIssue} className={btnCls}>Issue from store</button>
          )}
          {req.status === 'PARTIALLY_ISSUED' && canWrite && (
            <button disabled={busy} onClick={onClose} className={`${btnCls} bg-brand-surface !text-brand-on-surface-variant`}>Close short</button>
          )}
        </div>
      </div>

      <table className="w-full text-xs">
        <thead><tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/15">
          <th className="px-4 py-2 font-bold">Material</th>
          <th className="px-4 py-2 font-bold text-right">Requested</th>
          <th className="px-4 py-2 font-bold text-right">Approved</th>
          <th className="px-4 py-2 font-bold text-right">Issued</th>
          <th className="px-4 py-2 font-bold text-right">On hand</th>
        </tr></thead>
        <tbody>
          {req.items.map((i) => {
            const short = (i.shortfall ?? 0) > 0;
            return (
              <tr key={i.id} className="border-b border-brand-outline-variant/10 last:border-0">
                <td className="px-4 py-2">
                  <span className="font-bold text-brand-primary">{i.material.code}</span>
                  <span className="text-brand-on-surface-variant"> — {i.material.name}</span>
                </td>
                <td className="px-4 py-2 text-right font-mono">{fmt(i.quantityRequested)} {i.unit}</td>
                <td className="px-4 py-2 text-right font-mono">{fmt(i.quantityApproved)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmt(i.quantityIssued)}</td>
                <td className={`px-4 py-2 text-right font-mono ${short ? 'text-red-600 font-bold' : ''}`}>
                  {i.onHand === undefined ? '—' : fmt(i.onHand)}
                  {short && <span className="ml-1 text-[10px]">(short {fmt(i.shortfall)})</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {req.decisionNote && (
        <p className="px-5 py-2 text-[11px] text-brand-on-surface-variant border-t border-brand-outline-variant/15">
          <strong>Decision:</strong> {req.decisionNote}
        </p>
      )}
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────
function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-brand-on-surface/50 backdrop-blur-md flex items-center justify-center px-4 py-8">
      <div className={`bg-brand-surface-container-lowest ${wide ? 'max-w-2xl' : 'max-w-md'} w-full max-h-full overflow-y-auto rounded-2xl p-6 shadow-2xl relative border border-brand-outline-variant/30`}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant">
          <X className="w-5 h-5" />
        </button>
        <h3 className="font-display text-lg font-extrabold text-brand-primary mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────
function CreateModal({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ projectId: projectId ?? '', title: '', location: '', requiredByDate: '', notes: '' });
  const [lines, setLines] = useState<{ materialId: string; quantityRequested: string }[]>([
    { materialId: '', quantityRequested: '' },
  ]);

  const { data: projects } = useQuery({
    queryKey: ['projects', 'picker'],
    queryFn: () => api.get<{ id: string; name: string; code: string }[]>('/projects?pageSize=200'),
  });
  const { data: materials } = useQuery({
    queryKey: ['/inventory/materials', 'picker'],
    queryFn: () => api.get<Material[]>('/inventory/materials?pageSize=500'),
  });
  const materialById = useMemo(
    () => new Map((materials?.data ?? []).map((m) => [m.id, m])),
    [materials],
  );

  const save = useMutation({
    mutationFn: () =>
      api.post('/requisitions', {
        projectId: form.projectId,
        title: form.title || undefined,
        location: form.location || undefined,
        // The API takes full ISO; the date input gives a bare day.
        requiredByDate: form.requiredByDate ? new Date(form.requiredByDate).toISOString() : undefined,
        notes: form.notes || undefined,
        items: lines
          .filter((l) => l.materialId && Number(l.quantityRequested) > 0)
          .map((l) => ({
            materialId: l.materialId,
            unit: materialById.get(l.materialId)?.unit ?? 'unit',
            quantityRequested: Number(l.quantityRequested),
          })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/requisitions/board'] });
      qc.invalidateQueries({ queryKey: ['/requisitions'] });
      onClose();
    },
  });
  const err = save.error instanceof ApiError ? save.error.message : save.isError ? 'Failed to create requisition' : null;
  const valid = form.projectId && lines.some((l) => l.materialId && Number(l.quantityRequested) > 0);

  return (
    <Sheet title="New material requisition" onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>PROJECT</label>
            <select className={inputCls} required value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">Select a project…</option>
              {(projects?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>NEEDED BY</label>
            <input type="date" className={inputCls} value={form.requiredByDate} onChange={(e) => setForm({ ...form, requiredByDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>TITLE</label>
            <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Level 3 slab pour" />
          </div>
          <div>
            <label className={labelCls}>LOCATION ON SITE</label>
            <input className={inputCls} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Block A, Level 3" />
          </div>
        </div>

        <div>
          <label className={labelCls}>MATERIALS</label>
          <div className="space-y-2">
            {lines.map((l, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <select
                  className={inputCls}
                  value={l.materialId}
                  onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, materialId: e.target.value } : x)))}
                >
                  <option value="">Select a material…</option>
                  {(materials?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                </select>
                <input
                  type="number" min="0" step="any" placeholder="Qty"
                  className={`${inputCls} w-28`}
                  value={l.quantityRequested}
                  onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, quantityRequested: e.target.value } : x)))}
                />
                <span className="text-[10px] font-bold text-brand-on-surface-variant w-10 shrink-0">
                  {materialById.get(l.materialId)?.unit ?? ''}
                </span>
                <button
                  type="button"
                  onClick={() => setLines(lines.length === 1 ? [{ materialId: '', quantityRequested: '' }] : lines.filter((_, i) => i !== idx))}
                  className="p-1.5 rounded-lg hover:bg-brand-surface text-brand-on-surface-variant hover:text-red-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLines([...lines, { materialId: '', quantityRequested: '' }])} className="mt-2 text-[11px] font-bold text-brand-primary hover:underline">
            + Add line
          </button>
        </div>

        <div>
          <label className={labelCls}>NOTES</label>
          <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <p className="text-brand-on-surface-variant text-[10px]">
          Saved as a draft. Submit it to send it to the site engineer for approval.
        </p>
        <button type="submit" disabled={!valid || save.isPending} className="w-full h-11 bg-brand-primary text-white font-bold text-xs rounded-lg hover:bg-brand-primary-container disabled:opacity-60">
          {save.isPending ? 'Saving…' : 'Create Draft'}
        </button>
      </form>
    </Sheet>
  );
}

// ── Approve / reject ──────────────────────────────────────────
function DecisionModal({ state, onClose }: { state: { req: Requisition; mode: 'approve' | 'reject' }; onClose: () => void }) {
  const qc = useQueryClient();
  const { req, mode } = state;
  const [note, setNote] = useState('');
  // The approver can cut a line back rather than reject the whole requisition.
  const [qty, setQty] = useState<Record<string, string>>(
    () => Object.fromEntries(req.items.map((i) => [i.id, String(n(i.quantityApproved))])),
  );

  const save = useMutation({
    mutationFn: () =>
      api.post(`/requisitions/${req.id}/${mode}`, mode === 'approve'
        ? { note: note || undefined, lines: req.items.map((i) => ({ id: i.id, quantityApproved: Number(qty[i.id] ?? 0) })) }
        : { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/requisitions/board'] });
      qc.invalidateQueries({ queryKey: ['/requisitions'] });
      onClose();
    },
  });
  const err = save.error instanceof ApiError ? save.error.message : save.isError ? 'Failed to record the decision' : null;

  return (
    <Sheet title={`${mode === 'approve' ? 'Approve' : 'Reject'} ${req.number}`} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        {mode === 'approve' && (
          <div>
            <label className={labelCls}>APPROVED QUANTITIES</label>
            <p className="text-brand-on-surface-variant text-[10px] mb-2">
              Trim a line to approve less than was asked for. Zero on every line is a rejection.
            </p>
            <div className="space-y-2">
              {req.items.map((i) => (
                <div key={i.id} className="flex items-center gap-3">
                  <span className="flex-1 text-xs">
                    <span className="font-bold text-brand-primary">{i.material.code}</span>
                    <span className="text-brand-on-surface-variant"> — asked {fmt(i.quantityRequested)} {i.unit}, {fmt(i.onHand)} on hand</span>
                  </span>
                  <input
                    type="number" min="0" max={n(i.quantityRequested)} step="any"
                    className={`${inputCls} w-28`}
                    value={qty[i.id] ?? ''}
                    onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className={labelCls}>{mode === 'reject' ? 'REASON (REQUIRED)' : 'NOTE'}</label>
          <input className={inputCls} required={mode === 'reject'} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={save.isPending} className={`w-full h-11 text-white font-bold text-xs rounded-lg disabled:opacity-60 ${mode === 'approve' ? 'bg-brand-primary hover:bg-brand-primary-container' : 'bg-red-600 hover:bg-red-700'}`}>
          {save.isPending ? 'Saving…' : mode === 'approve' ? 'Approve requisition' : 'Reject requisition'}
        </button>
      </form>
    </Sheet>
  );
}

// ── Issue from store ──────────────────────────────────────────
function IssueModal({ req, onClose }: { req: Requisition; onClose: () => void }) {
  const qc = useQueryClient();
  const outstanding = req.items.map((i) => ({
    line: i,
    max: i.outstanding ?? n(i.quantityApproved) - n(i.quantityIssued),
  }));
  const [qty, setQty] = useState<Record<string, string>>(
    // Default to issuing everything outstanding that the store can actually cover.
    () => Object.fromEntries(outstanding.map(({ line, max }) => [line.id, String(Math.min(max, line.onHand ?? max))])),
  );
  const [issuedTo, setIssuedTo] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.post(`/requisitions/${req.id}/issue`, {
        issuedTo: issuedTo || undefined,
        lines: outstanding
          .filter(({ line }) => Number(qty[line.id] ?? 0) > 0)
          .map(({ line }) => ({ id: line.id, quantity: Number(qty[line.id]) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/requisitions/board'] });
      qc.invalidateQueries({ queryKey: ['/requisitions'] });
      qc.invalidateQueries({ queryKey: ['/inventory/stock'] });
      onClose();
    },
  });
  const err = save.error instanceof ApiError ? save.error.message : save.isError ? 'Failed to issue' : null;
  const anything = outstanding.some(({ line }) => Number(qty[line.id] ?? 0) > 0);

  return (
    <Sheet title={`Issue ${req.number} from store`} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <p className="text-brand-on-surface-variant text-[11px]">
          This posts an issue to the stock ledger and allocates the cost to the project.
          You cannot issue more than was approved, or more than the store holds.
        </p>
        <div className="space-y-2">
          {outstanding.map(({ line, max }) => {
            const want = Number(qty[line.id] ?? 0);
            const short = line.onHand !== undefined && want > line.onHand;
            return (
              <div key={line.id} className="flex items-center gap-3">
                <span className="flex-1 text-xs">
                  <span className="font-bold text-brand-primary">{line.material.code}</span>
                  <span className="text-brand-on-surface-variant"> — {fmt(max)} {line.unit} outstanding, {fmt(line.onHand)} on hand</span>
                </span>
                <input
                  type="number" min="0" max={max} step="any"
                  className={`${inputCls} w-28 ${short ? 'border-red-500' : ''}`}
                  value={qty[line.id] ?? ''}
                  onChange={(e) => setQty({ ...qty, [line.id]: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <div>
          <label className={labelCls}>ISSUED TO</label>
          <input className={inputCls} value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="Who collected it" />
        </div>
        {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
        <button type="submit" disabled={!anything || save.isPending} className="w-full h-11 bg-brand-primary text-white font-bold text-xs rounded-lg hover:bg-brand-primary-container disabled:opacity-60 flex items-center justify-center gap-2">
          <Check className="w-4 h-4" /> {save.isPending ? 'Issuing…' : 'Issue materials'}
        </button>
      </form>
    </Sheet>
  );
}
