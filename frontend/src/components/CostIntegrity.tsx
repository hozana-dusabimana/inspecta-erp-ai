import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { api, errorMessage } from '../lib/api';

/**
 * Cost integrity check (T1-01 e). Lists postings that look wrong — the same source posted
 * twice, costs or stock movements whose source document no longer exists, identical twins —
 * and lets someone with finance rights reverse one WITH A REASON. Nothing is ever deleted.
 */
interface CostRow { id: string; projectCode: string; category: string; source: string; sourceRef: string | null; description: string; amount: number; date: string; createdAt: string }
interface MoveRow { id: string; type: string; quantity: number; reference: string | null; material: string; date: string }
interface Report { duplicates: CostRow[][]; orphans: CostRow[]; lookalikes: CostRow[][]; orphanMovements: MoveRow[]; clean: boolean }

const money = (n: number) => 'RWF ' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const when = (s: string) => new Date(s).toLocaleString();

export default function CostIntegrity({ projectId, canWrite }: { projectId?: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ url: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['/finance/cost-integrity', projectId],
    queryFn: () => api.get<Report>(`/finance/cost-integrity${projectId ? `?projectId=${projectId}` : ''}`),
  });
  const reverse = useMutation({
    mutationFn: () => api.post(target!.url, { reason: reason.trim() }),
    onSuccess: () => { setTarget(null); setReason(''); qc.invalidateQueries(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const r = data?.data;

  const costTable = (rows: CostRow[], title: string) => (
    <table className="w-full text-xs">
      <thead><tr className="text-left text-brand-on-surface-variant"><th className="py-1">Project</th><th>Source</th><th>Description</th><th>Posted</th><th className="text-right">Amount</th><th /></tr></thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-t border-brand-outline-variant/10">
            <td className="py-1.5">{c.projectCode}</td>
            <td>{c.source}</td>
            <td>{c.description}</td>
            <td>{when(c.createdAt)}</td>
            <td className="text-right font-mono">{money(c.amount)}</td>
            <td className="text-right">
              {canWrite && <button onClick={() => { setError(null); setTarget({ url: `/finance/costs/${c.id}/cancel`, label: `${title}: ${c.description} (${money(c.amount)})` }); }} className="rounded border border-red-300 px-2 py-0.5 text-[11px] font-bold text-red-700 hover:bg-red-50">Reverse…</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (isLoading) return <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-brand-surface-container-low" />)}</div>;
  if (isError || !r) return <p className="text-xs text-red-700">Could not load the integrity check.</p>;

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-xl border p-4 ${r.clean ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        {r.clean ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
        <div className="text-xs">
          <p className="font-bold">{r.clean ? 'No duplicate or orphan postings found.' : 'Some postings need a review.'}</p>
          <p className="text-brand-on-surface-variant">This check only lists. Reversing writes an equal and opposite entry with your reason; the original stays visible and nothing is deleted.</p>
        </div>
      </div>

      {r.duplicates.length > 0 && (
        <section className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-4">
          <h4 className="mb-2 text-sm font-bold">Same source posted more than once</h4>
          {r.duplicates.map((g, i) => <div key={i} className="mb-3">{costTable(g, 'Duplicate')}</div>)}
        </section>
      )}
      {r.orphans.length > 0 && (
        <section className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-4">
          <h4 className="mb-1 text-sm font-bold">Costs whose source record no longer exists</h4>
          <p className="mb-2 text-[11px] text-brand-on-surface-variant">Usually left behind when a material issue or log was deleted before cancel/reverse existed.</p>
          {costTable(r.orphans, 'Orphan cost')}
        </section>
      )}
      {r.lookalikes.length > 0 && (
        <section className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-4">
          <h4 className="mb-1 text-sm font-bold">Identical twins (same project, category, amount and description)</h4>
          <p className="mb-2 text-[11px] text-brand-on-surface-variant">May be genuine repeats. Compare the posted times before reversing.</p>
          {r.lookalikes.map((g, i) => <div key={i} className="mb-3">{costTable(g, 'Twin')}</div>)}
        </section>
      )}
      {r.orphanMovements.length > 0 && (
        <section className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-4">
          <h4 className="mb-2 text-sm font-bold">Stock movements whose document no longer exists</h4>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-brand-on-surface-variant"><th className="py-1">Material</th><th>Type</th><th>Reference</th><th>Date</th><th className="text-right">Qty</th><th /></tr></thead>
            <tbody>
              {r.orphanMovements.map((m) => (
                <tr key={m.id} className="border-t border-brand-outline-variant/10">
                  <td className="py-1.5">{m.material}</td><td>{m.type}</td><td>{m.reference ?? '—'}</td><td>{when(m.date)}</td>
                  <td className="text-right font-mono">{m.quantity}</td>
                  <td className="text-right">{canWrite && <button onClick={() => { setError(null); setTarget({ url: `/inventory/movements/${m.id}/cancel`, label: `${m.type} ${m.quantity} ${m.material}` }); }} className="rounded border border-red-300 px-2 py-0.5 text-[11px] font-bold text-red-700 hover:bg-red-50">Reverse…</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Reverse posting">
          <form onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 5) reverse.mutate(); }} className="w-full max-w-md space-y-3 rounded-xl bg-brand-surface-container-lowest p-5 shadow-xl">
            <h3 className="text-sm font-bold text-brand-primary">Reverse posting</h3>
            <p className="text-xs">{target.label}</p>
            <label htmlFor="rev-reason" className="block text-[11px] font-bold uppercase tracking-wide text-brand-on-surface-variant">Reason (required)</label>
            <textarea id="rev-reason" autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-brand-outline-variant bg-brand-surface p-2 text-xs" placeholder="e.g. Duplicate of ISS-0001 left after the issue was deleted and recreated" />
            {error && <p className="text-[11px] font-semibold text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setTarget(null)} className="rounded-lg border border-brand-outline-variant px-3 py-1.5 text-xs font-bold">Close</button>
              <button type="submit" disabled={reason.trim().length < 5 || reverse.isPending} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Reverse</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
