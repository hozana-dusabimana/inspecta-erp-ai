import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, errorMessage } from '../lib/api';

const money = (n: unknown) => 'RWF ' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const num = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

interface Line {
  key: string; name: string; kind: 'named' | 'headcount'; phone: string | null; nationalId: string | null; trade: string | null;
  daysWorked: number; hours: number; workerDays: number; amount: number; unverifiedRecords: number; recordsWithoutRate: number;
}
interface Sheet {
  weekStart: string; weekEnd: string; lines: Line[];
  totals: { workerDays: number; amount: number; unverifiedRecords: number; recordsWithoutRate: number };
}

/** Monday of the week containing the given ISO date, moved by whole weeks. */
function shiftWeek(iso: string, weeks: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Weekly casual pay sheet built from attendance (separate from the monthly
 * payroll run). Site engineers can verify the week's headcount from here.
 */
export default function CasualPaySheet({ projectId, canWrite }: { projectId?: string; canWrite?: boolean }) {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const qs = `weekStart=${weekStart}${projectId ? `&projectId=${projectId}` : ''}`;
  const { data, isLoading } = useQuery({ queryKey: ['/fieldops/casual-paysheet', qs], queryFn: () => api.get<Sheet>(`/fieldops/casual-paysheet?${qs}`) });
  const sheet = data?.data;

  const verify = useMutation({
    mutationFn: () => api.post('/fieldops/attendance/verify', { projectId, date: sheet!.weekStart, to: sheet!.weekEnd }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/fieldops/casual-paysheet'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button onClick={() => setWeekStart(shiftWeek(weekStart, -1))} className="h-9 w-9 grid place-items-center rounded-lg border border-brand-outline-variant" aria-label="Previous week"><ChevronLeft className="w-4 h-4" /></button>
        <input type="date" value={weekStart} onChange={(e) => e.target.value && setWeekStart(e.target.value)} className="h-9 rounded-lg border border-brand-outline-variant px-2 text-xs font-semibold bg-brand-surface" />
        <button onClick={() => setWeekStart(shiftWeek(weekStart, 1))} className="h-9 w-9 grid place-items-center rounded-lg border border-brand-outline-variant" aria-label="Next week"><ChevronRight className="w-4 h-4" /></button>
        <span className="text-xs text-brand-on-surface-variant">{sheet ? `Week ${sheet.weekStart} to ${sheet.weekEnd}` : ''}{!projectId && ' · all projects'}</span>
        <div className="ml-auto flex gap-2">
          {canWrite && projectId && (
            <button disabled={verify.isPending || !sheet?.totals.unverifiedRecords} onClick={() => verify.mutate()}
              className="h-9 px-3 rounded-lg bg-brand-primary text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
              <ShieldCheck className="w-4 h-4" /> Verify week's headcount
            </button>
          )}
          <button onClick={() => window.print()} className="h-9 px-3 rounded-lg border border-brand-outline-variant text-xs font-bold flex items-center gap-1.5"><Printer className="w-4 h-4" /> Print</button>
        </div>
      </div>
      {verify.isError && <p className="text-xs text-red-600 font-semibold">{errorMessage(verify.error)}</p>}

      {sheet && sheet.totals.recordsWithoutRate > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {sheet.totals.recordsWithoutRate} record(s) have no daily rate, so their amount is 0. Add a wage rate for the trade (HR → Wage Rates) or a rate on the casual worker.
        </p>
      )}
      {sheet && sheet.totals.unverifiedRecords > 0 && (
        <p className="text-xs text-brand-on-surface-variant">{sheet.totals.unverifiedRecords} record(s) are not yet verified by a site engineer.</p>
      )}

      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-brand-on-surface-variant border-b border-brand-outline-variant/20">
              <th className="px-4 py-2">Worker / group</th><th>Trade</th><th>ID / phone</th><th className="text-right">Days</th><th className="text-right">Worker-days</th><th className="text-right px-4">Amount</th><th className="px-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-brand-on-surface-variant">Loading…</td></tr>}
            {sheet?.lines.map((l) => (
              <tr key={l.key} className="border-b border-brand-outline-variant/10">
                <td className="px-4 py-2 font-semibold">{l.name}</td><td>{l.trade ?? '—'}</td>
                <td>{[l.nationalId, l.phone].filter(Boolean).join(' · ') || '—'}</td>
                <td className="text-right font-mono">{l.daysWorked}</td><td className="text-right font-mono">{num(l.workerDays)}</td>
                <td className="text-right font-mono px-4">{money(l.amount)}</td>
                <td className="px-4">{l.unverifiedRecords ? <span className="text-amber-700">Unverified</span> : <span className="text-emerald-700">Verified</span>}</td>
              </tr>
            ))}
            {sheet && !sheet.lines.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-brand-on-surface-variant">No casual attendance recorded this week.</td></tr>}
          </tbody>
          {sheet && sheet.lines.length > 0 && (
            <tfoot>
              <tr className="font-bold"><td className="px-4 py-2" colSpan={4}>Total</td><td className="text-right font-mono">{num(sheet.totals.workerDays)}</td><td className="text-right font-mono px-4">{money(sheet.totals.amount)}</td><td /></tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
