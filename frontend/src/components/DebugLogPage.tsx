import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bug, Copy, Trash2, RefreshCw, KeyRound, ShieldAlert } from 'lucide-react';
import { AppView } from '../types';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { toast } from '../lib/toast';
import ErpLayout from './ErpLayout';

interface DebugEvent {
  id: string; at: string; level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'; category: string; message: string;
  meta: Record<string, unknown> | null; secret: string | null; organizationId: string | null; userId: string | null;
}

const CATEGORIES = ['AUTH', 'EMAIL', 'HTTP', 'SYSTEM', 'NOTIFY'] as const;
const LEVEL_STYLE: Record<string, string> = {
  ERROR: 'bg-red-50 text-red-700 border-red-200',
  WARN: 'bg-amber-50 text-amber-700 border-amber-200',
  INFO: 'bg-sky-50 text-sky-700 border-sky-200',
  DEBUG: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** Platform-admin only: everything that happened, including verification / reset links and why emails failed. */
export default function DebugLogPage({ onNavigate, onLogout }: { onNavigate: (v: AppView) => void; onLogout: () => void }) {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [onlyCodes, setOnlyCodes] = useState(false);
  const [live, setLive] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: '150' });
    if (category) p.set('category', category);
    if (level) p.set('level', level);
    if (search.trim()) p.set('q', search.trim());
    if (onlyCodes) p.set('only', 'secrets');
    return p.toString();
  }, [category, level, search, onlyCodes]);

  const status = useQuery({ queryKey: ['debug-status'], queryFn: () => api.get<any>('/platform/debug-log/status'), refetchInterval: live ? 5000 : false });
  const log = useQuery({ queryKey: ['debug-log', params], queryFn: () => api.get<{ events: DebugEvent[]; secretsRecorded: boolean }>(`/platform/debug-log?${params}`), refetchInterval: live ? 4000 : false });
  const clear = useMutation({
    mutationFn: () => api.del('/platform/debug-log'),
    onSuccess: () => { toast('Debug log cleared.', 'success'); void qc.invalidateQueries({ queryKey: ['debug-log'] }); void qc.invalidateQueries({ queryKey: ['debug-status'] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const s = status.data?.data;
  const events = log.data?.data?.events ?? [];

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied.', 'success'); } catch { toast('Could not copy; select the text instead.', 'error'); }
  };

  return (
    <ErpLayout active={AppView.PLATFORM_DEBUG_LOG} title="Debug log" subtitle="Everything the system did and why, including verification and reset links" onNavigate={onNavigate} onLogout={onLogout}>
      {!hasPermission('platform:manage') ? (
        <div className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-8 text-center text-sm text-brand-on-surface-variant">Only platform administrators can read the debug log.</div>
      ) : (
        <div className="space-y-4">
          {/* what is being recorded */}
          <div className={`rounded-xl border p-4 text-xs flex items-start gap-3 ${s?.secretsRecorded ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-brand-surface-container-lowest border-brand-outline-variant/20 text-brand-on-surface-variant'}`} data-testid="secrets-banner">
            {s?.secretsRecorded ? <ShieldAlert className="w-5 h-5 shrink-0" /> : <KeyRound className="w-5 h-5 shrink-0" />}
            <div>
              {s?.secretsRecorded ? (
                <p><b>Codes and links are being recorded.</b> Verification and password-reset links show below. Anyone who can read them can take over that account, so switch <code>DEBUG_LOG_SECRETS</code> off on the server when you are done.</p>
              ) : (
                <p><b>Codes and links are hidden.</b> To see the verification and reset links, set <code>DEBUG_LOG_SECRETS=true</code> in the server's <code>.env</code> and restart the API. Everything else is recorded already.</p>
              )}
              <p className="mt-1">Email: {s ? (s.smtpConfigured ? 'SMTP is configured.' : <b className="text-red-700">SMTP is NOT configured, so no emails can be sent.</b>) : '…'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[['Events (all)', s?.total], ['Last 24 hours', s?.last24h], ['Errors (24 h)', s?.errors24h], ['Email problems (24 h)', s?.emailFailures24h]].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-on-surface-variant">{label}</p>
                <p className="font-mono text-xl font-extrabold text-brand-primary">{value ?? '…'}</p>
              </div>
            ))}
          </div>

          {/* filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-brand-surface-container p-1 rounded-lg border border-brand-outline-variant/10">
              <button onClick={() => setCategory('')} className={`px-3 py-1 rounded-md text-xs font-bold ${category === '' ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant'}`}>All</button>
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)} className={`px-3 py-1 rounded-md text-xs font-bold ${category === c ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant'}`}>{c}</button>
              ))}
            </div>
            <select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)} className="h-9 rounded-lg border border-brand-outline-variant bg-brand-surface px-2 text-xs font-semibold">
              <option value="">All levels</option>
              {['ERROR', 'WARN', 'INFO', 'DEBUG'].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <input aria-label="Search the log" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search message or code…" className="h-9 min-w-[220px] rounded-lg border border-brand-outline-variant bg-brand-surface px-3 text-xs outline-none focus:border-brand-primary" />
            <label className="flex items-center gap-1.5 text-xs font-semibold text-brand-on-surface-variant"><input type="checkbox" checked={onlyCodes} onChange={(e) => setOnlyCodes(e.target.checked)} /> Only codes / links</label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-brand-on-surface-variant"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live (every few seconds)</label>
            <button onClick={() => { void log.refetch(); void status.refetch(); }} className="h-9 px-3 rounded-lg border border-brand-outline-variant text-xs font-bold text-brand-primary flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
            <button onClick={() => { if (confirm('Delete every event in the debug log?')) clear.mutate(); }} className="h-9 px-3 rounded-lg border border-red-200 text-xs font-bold text-red-700 flex items-center gap-1.5 ml-auto"><Trash2 className="w-3.5 h-3.5" /> Clear</button>
          </div>

          {/* events */}
          <div className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest overflow-hidden" data-testid="debug-events">
            {log.isLoading ? (
              <div className="p-10 text-center text-sm text-brand-on-surface-variant" data-testid="debug-events-loading"><RefreshCw className="w-6 h-6 mx-auto mb-2 opacity-50 animate-spin" />Loading…</div>
            ) : events.length === 0 ? (
              <div className="p-10 text-center text-sm text-brand-on-surface-variant" data-testid="debug-events-empty"><Bug className="w-6 h-6 mx-auto mb-2 opacity-50" />No events match. Sign in, sign up or send an email and they appear here.</div>
            ) : events.map((e) => (
              <div key={e.id} className="border-b last:border-0 border-brand-outline-variant/10 px-4 py-2.5" data-event={e.category}>
                <button className="w-full text-left flex items-start gap-3" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <span className="font-mono text-[11px] text-brand-on-surface-variant shrink-0 w-[132px]">{new Date(e.at).toLocaleString()}</span>
                  <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border shrink-0 ${LEVEL_STYLE[e.level]}`}>{e.level}</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-surface-container text-brand-on-surface-variant shrink-0">{e.category}</span>
                  <span className="text-xs text-brand-primary font-semibold break-words min-w-0">{e.message}</span>
                  {e.secret && <KeyRound className="w-3.5 h-3.5 text-amber-600 shrink-0 ml-auto" aria-label="has a code or link" />}
                </button>
                {(open === e.id || e.secret) && (
                  <div className="mt-2 ml-[144px] space-y-2">
                    {e.secret && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                        <p className="text-[10px] font-bold uppercase text-amber-800 mb-1">Code / link</p>
                        {e.secret.split('\n').map((line) => (
                          <div key={line} className="flex items-start gap-2">
                            <code className="text-[11px] break-all flex-1 select-all" data-secret>{line}</code>
                            <button onClick={() => void copy(line)} aria-label="Copy code or link" className="p-1 rounded hover:bg-amber-100 text-amber-800"><Copy className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    {open === e.id && e.meta && <pre className="text-[11px] bg-brand-surface rounded-lg p-2.5 overflow-x-auto">{JSON.stringify(e.meta, null, 2)}</pre>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </ErpLayout>
  );
}
