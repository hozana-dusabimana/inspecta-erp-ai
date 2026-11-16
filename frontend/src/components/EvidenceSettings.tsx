import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { useEvidenceRules } from '../lib/evidence';

/**
 * System Admin: which records cannot be saved without photo evidence, and the daily report
 * cut-off after which a report is late and a missing one alerts the PM and company admin.
 */
export default function EvidenceSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useEvidenceRules();
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [cutoff, setCutoff] = useState('18:00');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (data) { setRules(data.rules); setCutoff(data.dailyReportCutoff); } }, [data]);
  const save = useMutation({
    mutationFn: () => api.put('/organization/evidence-rules', { rules, dailyReportCutoff: cutoff }),
    onSuccess: () => { setMsg('Saved.'); qc.invalidateQueries({ queryKey: ['/organization/evidence-rules'] }); },
    onError: (e) => setMsg(errorMessage(e)),
  });
  if (isLoading || !data) return <div className="h-32 animate-pulse rounded-xl bg-brand-surface-container-low" aria-busy="true" />;
  return (
    <section className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-brand-primary">Evidence and daily reports</h3>
        <p className="text-xs text-brand-on-surface-variant">Ticked records cannot be saved without at least one photo (or a link to one). Each photo is stamped with who uploaded it, when, and the site location when the device allows it.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {Object.entries(data.labels).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" checked={rules[k] ?? false} onChange={(e) => setRules((r) => ({ ...r, [k]: e.target.checked }))} /> {label}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold">
        Daily report cut-off
        <input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} className="h-9 rounded-lg border border-brand-outline-variant bg-brand-surface px-2 text-xs" />
        <span className="font-normal text-brand-on-surface-variant">After this time a report is late, and a project with none alerts the PM and admin.</span>
      </label>
      <div className="flex items-center gap-3">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-lg bg-brand-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save'}</button>
        {msg && <span className="text-xs font-semibold">{msg}</span>}
      </div>
    </section>
  );
}
