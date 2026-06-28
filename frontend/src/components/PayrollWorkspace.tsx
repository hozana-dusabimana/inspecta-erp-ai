import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Calculator, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';

const money = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const monthLabel = (d: unknown) => (d ? String(d).slice(0, 7) : '—');

interface Run {
  id: string;
  periodMonth: string;
  status: string;
  totalGross: number;
  totalPaye: number;
  totalRssbEmployee: number;
  totalRssbEmployer: number;
  totalNet: number;
  _count?: { payslips: number };
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  POSTED: 'bg-emerald-100 text-emerald-700',
};

function Payslips({ runId }: { runId: string }) {
  const { data } = useQuery({
    queryKey: ['/payroll/payslips', runId],
    queryFn: () => api.get<any[]>(`/payroll/payslips?runId=${runId}&pageSize=200`),
  });
  const rows = data?.data ?? [];
  if (!rows.length) return <div className="px-5 py-3 text-xs text-brand-on-surface-variant">No payslips yet — run “Compute”.</div>;
  return (
    <div className="overflow-x-auto bg-brand-surface/40">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-brand-on-surface-variant font-bold text-left border-b border-brand-outline-variant/20">
            <th className="px-5 py-2">Employee</th>
            <th className="px-3 py-2 text-right">Gross</th>
            <th className="px-3 py-2 text-right">PAYE</th>
            <th className="px-3 py-2 text-right">RSSB (Emp)</th>
            <th className="px-3 py-2 text-right">CBHI</th>
            <th className="px-3 py-2 text-right">Net Pay</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-brand-outline-variant/10">
              <td className="px-5 py-2 font-semibold">{p.employee?.fullName ?? '—'}</td>
              <td className="px-3 py-2 text-right font-mono">{money(p.grossSalary)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(p.payeAmount)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(Number(p.rssbPensionEmployee) + Number(p.rssbMaternityEmployee) + Number(p.rssbMedicalEmployee))}</td>
              <td className="px-3 py-2 text-right font-mono">{money(p.cbhiAmount)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold text-brand-primary">{money(p.netPay)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PayrollWorkspace({ canWrite }: { projectId?: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [month, setMonth] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: summary } = useQuery({ queryKey: ['/payroll/summary'], queryFn: () => api.get<any>('/payroll/summary') });
  const { data: runsData, isLoading } = useQuery({ queryKey: ['/payroll/runs'], queryFn: () => api.get<Run[]>('/payroll/runs?pageSize=100') });
  const runs = runsData?.data ?? [];
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/payroll/runs'] });
    qc.invalidateQueries({ queryKey: ['/payroll/summary'] });
  };

  const create = useMutation({
    mutationFn: () => api.post('/payroll/runs', { periodMonth: new Date(`${month}-01T00:00:00.000Z`).toISOString() }),
    onSuccess: () => { setMonth(''); setError(null); invalidate(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed'),
  });
  const compute = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/runs/${id}/compute`),
    onSuccess: (_d, id) => { invalidate(); qc.invalidateQueries({ queryKey: ['/payroll/payslips', id] }); setError(null); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Compute failed'),
  });
  const post = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/runs/${id}/post`),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Post failed'),
  });

  const s = summary?.data;

  return (
    <div className="space-y-5">
      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Active Employees" value={String(s.activeEmployees)} />
          <Stat label="Payroll Runs" value={String(s.totalRuns)} />
          <Stat label="Latest Net Pay" value={money(s.latestRun?.totalNet)} />
          <Stat label="Latest PAYE" value={money(s.latestRun?.totalPaye)} />
        </div>
      )}

      {canWrite && (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-brand-on-surface-variant uppercase tracking-wide block">New run — period month</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary" />
          </div>
          <button disabled={!month || create.isPending} onClick={() => create.mutate()} className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary-container disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Create payroll run
          </button>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</div>}

      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 overflow-hidden">
        <div className="px-5 py-3 border-b border-brand-outline-variant/15 font-bold text-sm text-brand-primary">Payroll Runs <span className="font-mono text-xs text-brand-on-surface-variant">({runs.length})</span></div>
        {isLoading ? (
          <div className="p-8 text-center text-xs text-brand-on-surface-variant">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="p-8 text-center text-xs text-brand-on-surface-variant">No payroll runs yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-brand-on-surface-variant font-bold text-left border-b border-brand-outline-variant/20">
                <th className="px-5 py-2.5">Period</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Gross</th>
                <th className="px-3 py-2.5 text-right">PAYE</th>
                <th className="px-3 py-2.5 text-right">Net</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="border-b border-brand-outline-variant/10 hover:bg-brand-surface/40">
                    <td className="px-5 py-2.5">
                      <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="flex items-center gap-1.5 font-semibold text-brand-primary">
                        {expanded === r.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {monthLabel(r.periodMonth)}
                      </button>
                    </td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_TONE[r.status] ?? ''}`}>{r.status.replace(/_/g, ' ')}</span></td>
                    <td className="px-3 py-2.5 text-right font-mono">{money(r.totalGross)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{money(r.totalPaye)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-brand-primary">{money(r.totalNet)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {canWrite && r.status !== 'POSTED' && (
                        <>
                          <button onClick={() => compute.mutate(r.id)} disabled={compute.isPending} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-brand-primary/5 text-brand-primary border border-brand-primary/10 text-[11px] font-bold hover:bg-brand-primary/10 mr-1.5">
                            <Calculator className="w-3 h-3" /> Compute
                          </button>
                          <button onClick={() => { if (confirm('Post this payroll run? This records the net as a cash outflow and locks the run.')) post.mutate(r.id); }} disabled={post.isPending} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700">
                            <CheckCircle2 className="w-3 h-3" /> Post
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr><td colSpan={6} className="p-0"><Payslips runId={r.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-brand-surface-container-lowest p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
      <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{label}</p>
      <p className="font-mono text-xl font-extrabold mt-1 text-brand-primary">{value}</p>
    </div>
  );
}
