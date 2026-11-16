import { useCurrentProject } from '../lib/currentProject';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Trash2, Camera, WifiOff, CloudUpload, CheckCircle2, Loader2, ClipboardCheck, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AppView, DailyProductionEntry } from '../types';
import { api, errorMessage } from '../lib/api';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import {
  flushQueue, isNetworkError, listQueued, newClientRef, queueReport, removeQueued, sendReport, type QueuedReport, type SubmitResult,
} from '../lib/offlineReports';

interface DailyEntryProps {
  onNavigate: (view: AppView) => void;
  onSubmitSuccess: (entry: DailyProductionEntry) => void;
}

interface LabourRow { trade: string; headcount: string; hours: string }
interface WorkerRow { employeeId: string; hours: string }
interface ActivityRow {
  key: string; wbsItemId?: string; name: string; code?: string; unit: string; plannedQty: number; ratePerWorkerDay: number | null;
  actualQty: string; labour: LabourRow[]; workers: WorkerRow[]; crewId: string;
}

/** Best-effort site location for the photo stamp (never blocks the report). */
function siteLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    const t = setTimeout(() => resolve(null), 5000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 300000 },
    );
  });
}
interface MaterialRow { materialId: string; qty: string }
interface EquipmentRow { equipmentId: string; hours: string }

const WEATHER = ['Sunny', 'Partly cloudy', 'Cloudy', 'Light rain', 'Heavy rain', 'Windy'];
const today = () => new Date().toISOString().slice(0, 10);
const n = (v: string) => (v.trim() === '' || isNaN(Number(v)) ? 0 : Number(v));
const field = 'w-full h-12 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-base outline-none focus:border-brand-primary';
const card = 'bg-brand-surface-container-lowest p-4 rounded-2xl border border-brand-outline-variant/20 shadow-sm space-y-3';

/** Server data is cached on the phone, so the form still opens with no signal. */
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const v = await load();
    try { localStorage.setItem(`inspecta.cache.${key}`, JSON.stringify(v)); } catch { /* storage full */ }
    return v;
  } catch (e) {
    const raw = localStorage.getItem(`inspecta.cache.${key}`);
    if (raw) return JSON.parse(raw) as T;
    throw e;
  }
}

export default function DailyEntry({ onNavigate, onSubmitSuccess }: DailyEntryProps) {
  const online = useOnlineStatus();
  const { projectId, setProjectId } = useCurrentProject();
  const [date, setDate] = useState(today);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [weather, setWeather] = useState('Sunny');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [sheet, setSheet] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ queued: boolean; data?: SubmitResult } | null>(null);
  const [queued, setQueued] = useState<QueuedReport[]>([]);
  const [clientRef, setClientRef] = useState(newClientRef);

  const refreshQueue = () => listQueued().then(setQueued);
  useEffect(() => { refreshQueue(); }, []);
  // Send anything waiting as soon as the signal returns.
  useEffect(() => { if (online) flushQueue().then(refreshQueue); }, [online]);

  const { data: mine } = useQuery({ queryKey: ['users', 'me', 'projects'], queryFn: () => cached('my-projects', () => api.get<{ id: string; code: string; name: string }[]>('/users/me/projects').then((r) => r.data)) });
  const { data: all } = useQuery({ queryKey: ['projects', 'picker'], queryFn: () => cached('projects', () => api.get<{ id: string; code: string; name: string }[]>('/projects?pageSize=200').then((r) => r.data)) });
  const choices = mine && mine.length ? mine : all ?? [];
  useEffect(() => { if (!projectId && choices.length) setProjectId(choices[0].id); }, [choices, projectId]);

  const { data: plan, isFetching: planLoading } = useQuery({
    queryKey: ['field-report', 'today', projectId, date], enabled: Boolean(projectId),
    queryFn: () => cached(`plan.${projectId}.${date}`, () => api.get<any[]>(`/production/field-report/today?projectId=${projectId}&date=${date}`).then((r) => r.data)),
  });
  const { data: wbs } = useQuery({
    queryKey: ['field-report', 'wbs', projectId], enabled: Boolean(projectId),
    queryFn: () => cached(`wbs.${projectId}`, () => api.get<any[]>(`/planning/wbs?projectId=${projectId}&pageSize=500`).then((r) => r.data)),
  });
  const { data: trades } = useQuery({ queryKey: ['field-report', 'trades'], queryFn: () => cached('trades', () => api.get<any[]>('/hr/trades?pageSize=200').then((r) => r.data)) });
  const { data: materialList } = useQuery({ queryKey: ['field-report', 'materials'], queryFn: () => cached('materials', () => api.get<any[]>('/inventory/materials?pageSize=500').then((r) => r.data)) });
  const { data: employeeList } = useQuery({ queryKey: ['field-report', 'employees'], queryFn: () => cached('employees', () => api.get<any[]>('/hr/employees?pageSize=500').then((r) => r.data)).catch(() => []) });
  const { data: crewList } = useQuery({ queryKey: ['field-report', 'crews'], queryFn: () => cached('crews', () => api.get<any[]>('/hr/crews?pageSize=200').then((r) => r.data)).catch(() => []) });
  const { data: rulesResp } = useQuery({ queryKey: ['/organization/evidence-rules'], queryFn: () => cached('evidence-rules', () => api.get<any>('/organization/evidence-rules').then((r) => r.data)).catch(() => null) });
  const photoRequired = rulesResp?.rules?.daily_report !== false;
  // What the day already holds (attendance, store issues, machines, fuel, tests, NCRs, safety): read-only here.
  const { data: dayData } = useQuery({
    queryKey: ['field-report', 'day', projectId, date], enabled: Boolean(projectId) && online,
    queryFn: () => api.get<any>(`/production/field-report/day?projectId=${projectId}&date=${date}`).then((r) => r.data),
  });
  const { data: equipmentList } = useQuery({ queryKey: ['field-report', 'equipment'], queryFn: () => cached('equipment', () => api.get<any[]>('/equipment/register?pageSize=500').then((r) => r.data)) });

  // Today's planned activities become the form's rows; the site manager only types the numbers.
  useEffect(() => {
    if (!plan) return;
    setActivities(plan.map((p) => ({
      key: p.activityId, wbsItemId: p.wbsItemId ?? undefined, name: p.name, code: p.wbsCode ?? p.code, unit: p.unit ?? '',
      plannedQty: p.plannedQty ?? 0, ratePerWorkerDay: p.ratePerWorkerDay ?? null, actualQty: '', labour: [{ trade: '', headcount: '', hours: '8' }], workers: [], crewId: '',
    })));
  }, [plan]);

  const patch = (i: number, p: Partial<ActivityRow>) => setActivities((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const patchLabour = (i: number, k: number, p: Partial<LabourRow>) => setActivities((a) => a.map((x, j) => (j === i ? { ...x, labour: x.labour.map((l, m) => (m === k ? { ...l, ...p } : l)) } : x)));

  const addExtra = (id: string) => {
    const w = (wbs ?? []).find((x) => x.id === id);
    if (!w || activities.some((a) => a.wbsItemId === id)) return;
    setActivities((a) => [...a, { key: `x${id}`, wbsItemId: id, name: w.name, code: w.code, unit: w.unit ?? '', plannedQty: 0, ratePerWorkerDay: null, actualQty: '', labour: [{ trade: '', headcount: '', hours: '8' }], workers: [], crewId: '' }]);
  };

  const totals = useMemo(() => {
    const workers = activities.reduce((s, a) => s + a.labour.reduce((t, l) => t + n(l.headcount), 0) + a.workers.filter((w) => w.employeeId).length, 0);
    return { workers };
  }, [activities]);

  const build = (): QueuedReport | string => {
    const used = activities.filter((a) => n(a.actualQty) > 0 || a.labour.some((l) => n(l.headcount) > 0) || a.workers.some((w) => w.employeeId));
    if (!projectId) return 'Choose your project.';
    if (photoRequired && photos.length === 0 && !sheet) return 'Missing evidence: add at least one site photo. The report cannot be saved without one.';
    const named = used.flatMap((a) => a.workers.filter((w) => w.employeeId).map((w) => w.employeeId));
    if (named.some((id, i) => named.indexOf(id) !== i)) return 'A person is listed twice. Record one attendance per person per day.';
    if (!used.length) return 'Enter the quantity done or the headcount for at least one activity.';
    for (const a of used) for (const l of a.labour) if (n(l.headcount) > 0 && !l.trade) return `Choose a trade for the workers on "${a.name}".`;
    const mats = materials.filter((m) => m.materialId && n(m.qty) > 0);
    const eq = equipment.filter((e) => e.equipmentId && n(e.hours) > 0);
    return {
      id: clientRef, createdAt: Date.now(), photos, sheet,
      payload: {
        projectId, clientRef, date, weather, note: note || undefined,
        activities: used.map((a) => ({
          wbsItemId: a.wbsItemId, name: a.name, unit: a.unit || undefined, plannedQty: a.plannedQty, actualQty: n(a.actualQty),
          labour: a.labour.filter((l) => n(l.headcount) > 0).map((l) => ({ trade: l.trade, headcount: Math.round(n(l.headcount)), hours: n(l.hours) })),
          workers: a.workers.filter((w) => w.employeeId && n(w.hours) > 0).map((w) => ({ employeeId: w.employeeId, hours: n(w.hours) })),
          crewId: a.crewId || undefined,
        })),
        materials: mats.map((m) => ({ materialId: m.materialId, qtyUsed: n(m.qty) })),
        equipment: eq.map((e) => ({ equipmentId: e.equipmentId, hours: n(e.hours) })),
      },
    };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = build();
    if (typeof r === 'string') { setError(r); return; }
    setBusy(true);
    // Stamp: the photos carry where and when they were taken (the server adds who).
    const geo = await siteLocation();
    r.payload.geo = geo ? { ...geo, at: new Date().toISOString() } : { at: new Date().toISOString() };
    try {
      if (!online) throw new TypeError('offline');
      const data = await sendReport(r);
      setResult({ queued: false, data });
      first(r);
    } catch (err) {
      if (isNetworkError(err)) {
        // No signal: keep the whole day on the phone and send it when the signal returns.
        await queueReport(r);
        setResult({ queued: true });
        refreshQueue();
      } else setError(errorMessage(err));
    } finally { setBusy(false); }
  };

  const first = (r: QueuedReport) => {
    const a = (r.payload.activities as any[])[0];
    onSubmitSuccess({
      id: String(r.id), date, wbsActivity: a.name, plannedQty: a.plannedQty ?? 0, actualQty: a.actualQty,
      laborHours: a.labour.reduce((s: number, l: any) => s + l.headcount * l.hours, 0) + (a.workers ?? []).reduce((s: number, w: any) => s + w.hours, 0), weatherCondition: weather, remarks: note, photos: [], status: 'synced',
      timestamp: new Date().toLocaleTimeString(),
    } as DailyProductionEntry);
  };

  const reset = () => {
    setResult(null); setClientRef(newClientRef()); setPhotos([]); setSheet(null); setNote(''); setMaterials([]); setEquipment([]);
    setActivities((a) => a.map((x) => ({ ...x, actualQty: '', labour: [{ trade: '', headcount: '', hours: '8' }], workers: [], crewId: '' })));
  };

  const tradeOptions = (trades ?? []).map((t) => t.name as string);

  return (
    <div className="min-h-screen bg-brand-surface text-brand-on-surface font-sans pb-32" id="daily-entry-root">
      <header className="h-14 sticky top-0 z-40 bg-brand-surface-container-lowest/95 backdrop-blur-md flex items-center gap-3 px-4 border-b border-brand-outline-variant/10">
        <button onClick={() => onNavigate(AppView.DASHBOARD)} aria-label="Back" className="p-2 -ml-2 text-brand-primary"><ArrowLeft className="w-5 h-5" /></button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-extrabold text-brand-primary leading-tight">Daily report</h2>
          <p className="text-[10px] text-brand-on-surface-variant font-bold uppercase tracking-wider truncate">{choices.find((p) => p.id === projectId)?.name ?? 'Select a project'}</p>
        </div>
        {!online && <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700"><WifiOff className="w-4 h-4" /> Offline</span>}
        {queued.length > 0 && <span className="flex items-center gap-1 text-[11px] font-bold text-brand-primary"><CloudUpload className="w-4 h-4" /> {queued.length} waiting</span>}
      </header>

      {result ? (
        <main className="max-w-xl mx-auto p-4 space-y-4">
          <div className={card}>
            <div className="flex items-center gap-2 font-extrabold text-brand-primary">
              {result.queued ? <CloudUpload className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6 text-emerald-600" />}
              {result.queued ? 'Saved on this phone' : `Report ${result.data?.reportNumber} saved`}
            </div>
            {result.queued ? (
              <p className="text-sm text-brand-on-surface-variant">There is no signal. The whole day, photos included, will be sent automatically when the connection returns. Keep this page's browser installed; you can close it.</p>
            ) : (
              <p className="text-sm text-brand-on-surface-variant">
                Read back from the database: {result.data?.entries} activity entries, {result.data?.attendance} headcount records, {result.data?.materials} material lines, {result.data?.equipmentLogs} machine logs.
                {result.data?.duplicate && ' (This report had already been received.)'}
              </p>
            )}
            {!result.queued && (result.data as any)?.late && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Sent after the daily cut-off: it is marked late.</p>}
            {!result.queued && ((result.data as any)?.flags ?? []).length > 0 && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                <p className="font-bold">Checks to answer before approval:</p>
                <ul className="list-disc pl-4">{((result.data as any).flags as string[]).map((f) => <li key={f}>{f.split(': ').slice(1).join(': ')}</li>)}</ul>
              </div>
            )}
            {!result.queued && <p className="text-xs text-brand-on-surface-variant">Nothing counts toward progress or cost until the project manager approves the report.</p>}
            <button onClick={reset} className="w-full h-12 rounded-xl bg-brand-primary text-white font-bold">Start another report</button>
          </div>
        </main>
      ) : (
        <form onSubmit={submit} className="max-w-xl mx-auto p-4 space-y-4">
          <div className={card}>
            <div className="grid grid-cols-2 gap-3">
              {choices.length !== 1 ? (
                <div className="col-span-2">
                  <label className="text-[11px] font-bold text-brand-on-surface-variant">PROJECT</label>
                  <select className={field} value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
                    <option value="">Select project…</option>
                    {choices.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </div>
              ) : null}
              <div>
                <label className="text-[11px] font-bold text-brand-on-surface-variant">DATE</label>
                <input type="date" className={field} value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-brand-on-surface-variant">WEATHER</label>
                <select className={field} value={weather} onChange={(e) => setWeather(e.target.value)}>{WEATHER.map((w) => <option key={w}>{w}</option>)}</select>
              </div>
            </div>
          </div>

          {dayData && (
            <div className={card} aria-label="Already recorded for this day">
              <h3 className="text-xs font-extrabold text-brand-primary uppercase tracking-wider">Already recorded for {date}</h3>
              <p className="text-[11px] text-brand-on-surface-variant">From the people who own each record. You only type the quantities and notes below.</p>
              <ul className="text-xs space-y-1">
                <li><b>Attendance:</b> {dayData.attendance.length ? `${dayData.attendance.length} record(s), ${dayData.labourHours} h, RWF ${Number(dayData.labourCost).toLocaleString()}` : 'none yet'}</li>
                <li><b>Store issues:</b> {dayData.materialIssues.length ? dayData.materialIssues.map((m: any) => `${m.number ?? ''} ${m.material} × ${m.quantity}`).join(', ') : 'none'}</li>
                <li><b>Machines:</b> {dayData.equipment.length ? dayData.equipment.map((e: any) => `${e.equipment} ${e.hours} h`).join(', ') : 'none'}{dayData.fuel.length ? ` · fuel: ${dayData.fuel.map((f: any) => `${f.equipment} ${f.liters} L`).join(', ')}` : ''}</li>
                <li><b>Tests / NCRs:</b> {dayData.tests.length ? dayData.tests.map((t: any) => `${t.type} ${t.batch ?? ''} ${t.result}`).join(', ') : 'no tests'}{dayData.ncrs.length ? ` · ${dayData.ncrs.length} NCR(s)` : ''}</li>
                <li><b>Safety:</b> {dayData.safetyInspections.length ? `${dayData.safetyInspections.length} inspection(s)` : 'no inspection yet'}{dayData.incidents.length ? ` · ${dayData.incidents.length} incident(s)` : ''}</li>
              </ul>
            </div>
          )}
          <h3 className="text-xs font-extrabold text-brand-primary uppercase tracking-wider px-1">Work done today {planLoading && <Loader2 className="inline w-3 h-3 animate-spin" />}</h3>
          {!planLoading && activities.length === 0 && <p className="text-sm text-brand-on-surface-variant px-1">No activity is scheduled for this date. Add the work that was done below.</p>}
          {activities.map((a, i) => {
            const wd = a.labour.reduce((s, l) => s + (n(l.headcount) * n(l.hours)) / 8, 0);
            const perWd = wd > 0 && n(a.actualQty) > 0 ? n(a.actualQty) / wd : 0;
            return (
              <div key={a.key} className={card}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-brand-primary leading-tight">{a.name}</p>
                    <p className="text-[11px] text-brand-on-surface-variant">{a.code ? `${a.code} · ` : ''}{a.plannedQty > 0 ? `planned ${a.plannedQty} ${a.unit}` : a.unit}</p>
                  </div>
                  {a.key.startsWith('x') && <button type="button" aria-label="Remove" onClick={() => setActivities((x) => x.filter((_, j) => j !== i))} className="p-1 text-brand-on-surface-variant"><X className="w-4 h-4" /></button>}
                </div>
                <div>
                  <label className="text-[11px] font-bold text-brand-on-surface-variant">QUANTITY DONE {a.unit && `(${a.unit})`}</label>
                  <input inputMode="decimal" className={field} value={a.actualQty} onChange={(e) => patch(i, { actualQty: e.target.value })} placeholder="0" />
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-brand-on-surface-variant">WORKERS (BY TRADE)</p>
                  {a.labour.map((l, k) => (
                    <div key={k} className="grid grid-cols-[1fr_72px_72px_36px] gap-2 items-center">
                      <select className={field} value={l.trade} onChange={(e) => patchLabour(i, k, { trade: e.target.value })} aria-label="Trade">
                        <option value="">Trade…</option>{tradeOptions.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <input inputMode="numeric" className={field} value={l.headcount} onChange={(e) => patchLabour(i, k, { headcount: e.target.value })} placeholder="No." aria-label="Headcount" />
                      <input inputMode="decimal" className={field} value={l.hours} onChange={(e) => patchLabour(i, k, { hours: e.target.value })} placeholder="Hrs" aria-label="Hours" />
                      <button type="button" aria-label="Remove trade" disabled={a.labour.length === 1} onClick={() => patch(i, { labour: a.labour.filter((_, m) => m !== k) })} className="text-brand-on-surface-variant disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => patch(i, { labour: [...a.labour, { trade: '', headcount: '', hours: '8' }] })} className="text-xs font-bold text-brand-primary flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add trade</button>
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-brand-on-surface-variant">NAMED WORKERS (EMPLOYEES, COSTED AT THEIR WAGE)</p>
                  {a.workers.map((w, k) => (
                    <div key={k} className="grid grid-cols-[1fr_72px_36px] gap-2 items-center">
                      <select className={field} value={w.employeeId} aria-label="Employee" onChange={(e) => patch(i, { workers: a.workers.map((x, m) => (m === k ? { ...x, employeeId: e.target.value } : x)) })}>
                        <option value="">Employee…</option>{(employeeList ?? []).map((emp) => <option key={emp.id} value={emp.id}>{emp.employeeNo ? `${emp.employeeNo} ` : ''}{emp.fullName}</option>)}
                      </select>
                      <input inputMode="decimal" className={field} value={w.hours} aria-label="Hours" placeholder="Hrs" onChange={(e) => patch(i, { workers: a.workers.map((x, m) => (m === k ? { ...x, hours: e.target.value } : x)) })} />
                      <button type="button" aria-label="Remove worker" onClick={() => patch(i, { workers: a.workers.filter((_, m) => m !== k) })} className="text-brand-on-surface-variant"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => patch(i, { workers: [...a.workers, { employeeId: '', hours: '8' }] })} className="text-xs font-bold text-brand-primary flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add employee</button>
                    {(crewList ?? []).length > 0 && (
                      <select className="h-9 rounded-lg border border-brand-outline-variant bg-brand-surface px-2 text-xs" value={a.crewId} aria-label="Crew" onChange={(e) => patch(i, { crewId: e.target.value })}>
                        <option value="">Crew (optional)…</option>{(crewList ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                {perWd > 0 && (
                  <p className="text-xs rounded-lg bg-brand-surface px-3 py-2">
                    <b>{perWd.toFixed(2)}</b> {a.unit} per worker-day
                    {a.ratePerWorkerDay ? <> vs planned <b>{a.ratePerWorkerDay.toFixed(2)}</b> ({Math.round((perWd / a.ratePerWorkerDay) * 100)}%)</> : ' (no planned rate set)'}
                  </p>
                )}
              </div>
            );
          })}
          <select className={field} value="" onChange={(e) => addExtra(e.target.value)} aria-label="Add other activity">
            <option value="">+ Add other work done…</option>
            {(wbs ?? []).filter((w) => !activities.some((a) => a.wbsItemId === w.id)).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>

          <div className={card}>
            <h3 className="text-xs font-extrabold text-brand-primary uppercase tracking-wider">Materials used</h3>
            {materials.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_88px_36px] gap-2 items-center">
                <select className={field} value={m.materialId} onChange={(e) => setMaterials((x) => x.map((r, j) => (j === i ? { ...r, materialId: e.target.value } : r)))}>
                  <option value="">Material…</option>{(materialList ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
                </select>
                <input inputMode="decimal" className={field} value={m.qty} placeholder="Qty" onChange={(e) => setMaterials((x) => x.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))} />
                <button type="button" aria-label="Remove" onClick={() => setMaterials((x) => x.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4 text-brand-on-surface-variant" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setMaterials((x) => [...x, { materialId: '', qty: '' }])} className="text-xs font-bold text-brand-primary flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add material</button>
          </div>

          <div className={card}>
            <h3 className="text-xs font-extrabold text-brand-primary uppercase tracking-wider">Machine hours (optional)</h3>
            {equipment.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_88px_36px] gap-2 items-center">
                <select className={field} value={m.equipmentId} onChange={(e) => setEquipment((x) => x.map((r, j) => (j === i ? { ...r, equipmentId: e.target.value } : r)))}>
                  <option value="">Machine…</option>{(equipmentList ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <input inputMode="decimal" className={field} value={m.hours} placeholder="Hrs" onChange={(e) => setEquipment((x) => x.map((r, j) => (j === i ? { ...r, hours: e.target.value } : r)))} />
                <button type="button" aria-label="Remove" onClick={() => setEquipment((x) => x.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4 text-brand-on-surface-variant" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setEquipment((x) => [...x, { equipmentId: '', hours: '' }])} className="text-xs font-bold text-brand-primary flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add machine</button>
          </div>

          <div className={card}>
            <label className="text-[11px] font-bold text-brand-on-surface-variant" htmlFor="dr-note">NOTE</label>
            <textarea id="dr-note" className="w-full bg-brand-surface border border-brand-outline-variant rounded-lg px-3 py-2 text-base min-h-[80px] outline-none focus:border-brand-primary" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Delays, issues, visitors…" />
            <div className="grid grid-cols-2 gap-3">
              <label className="h-12 rounded-xl border border-dashed border-brand-primary/40 flex items-center justify-center gap-2 text-sm font-bold text-brand-primary cursor-pointer">
                <Camera className="w-5 h-5" /> Site photos{photos.length > 0 ? ` (${photos.length})` : photoRequired ? ' (required)' : ''}
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => setPhotos((p) => [...p, ...Array.from(e.target.files ?? [])])} />
              </label>
              <label className="h-12 rounded-xl border border-dashed border-brand-primary/40 flex items-center justify-center gap-2 text-sm font-bold text-brand-primary cursor-pointer">
                <ClipboardCheck className="w-5 h-5" /> {sheet ? 'Sheet added' : 'Signed sheet'}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setSheet(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </div>

          {error && <p role="alert" className="text-sm font-semibold text-red-600 px-1">{error}</p>}
          {queued.some((q) => q.lastError) && <p className="text-xs text-red-600 px-1">A saved report was rejected by the server: {queued.find((q) => q.lastError)?.lastError}. <button type="button" className="underline" onClick={() => queued.forEach((q) => q.lastError && removeQueued(q.id).then(refreshQueue))}>Discard it</button></p>}

          <div className="fixed bottom-0 inset-x-0 z-30 bg-brand-surface-container-lowest/95 backdrop-blur-md border-t border-brand-outline-variant/20 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="submit" disabled={busy} className="max-w-xl mx-auto w-[calc(100%-4.5rem)] sm:w-full block mr-auto h-14 rounded-xl bg-brand-primary text-white font-extrabold text-base flex items-center justify-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {busy ? 'Sending…' : online ? `Submit day · ${totals.workers} workers` : 'Save on phone (offline)'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
