import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, GripVertical, CornerLeftUp, Activity, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';

interface WbsRow {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  level: number;
  progressPct: number;
}
interface Node extends WbsRow { children: Node[] }

interface Rollup {
  id: string;
  progress: number;
  budget: number;
  fromProduction: boolean;
  isLeaf: boolean;
  plannedStart: string | null;
  plannedFinish: string | null;
  childWeightSum: number | null;
}

const money = (n: number) => 'RWF ' + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const shortDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '');
const barColor = (p: number) => (p >= 80 ? 'bg-emerald-500' : p >= 40 ? 'bg-amber-500' : 'bg-red-500');

function buildTree(rows: WbsRow[]): Node[] {
  const byId = new Map<string, Node>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: Node[] = [];
  for (const n of byId.values()) {
    if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }
  const sortRec = (ns: Node[]) => { ns.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })); ns.forEach((c) => sortRec(c.children)); };
  sortRec(roots);
  return roots;
}

export default function WbsTree({ projectId, canWrite }: { projectId?: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [rootOver, setRootOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['/planning/wbs', projectId ?? 'none'],
    queryFn: () => api.get<WbsRow[]>(`/planning/wbs?projectId=${projectId}&pageSize=500`),
    enabled: Boolean(projectId),
  });
  const rows = data?.data ?? [];
  const tree = useMemo(() => buildTree(rows), [rows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // Computed roll-up (progress derived from production + children, budget summed).
  const { data: rollupData } = useQuery({
    queryKey: ['/planning/wbs/rollup', projectId ?? 'none'],
    queryFn: () => api.get<{ items: Rollup[] }>(`/planning/wbs/rollup?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
  const rollupById = useMemo(
    () => new Map((rollupData?.data.items ?? []).map((r) => [r.id, r])),
    [rollupData],
  );

  const move = useMutation({
    mutationFn: ({ id, parentId, level }: { id: string; parentId: string | null; level: number }) =>
      api.put(`/planning/wbs/${id}`, { parentId, level }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/planning/wbs'] });
      qc.invalidateQueries({ queryKey: ['/planning/wbs/rollup'] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Move failed'),
  });

  if (!projectId) {
    return <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-6 text-sm text-brand-on-surface-variant">Select a project to view its WBS tree.</div>;
  }

  // Collect descendant ids to prevent dropping a node into its own subtree.
  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    const childrenMap = new Map<string, string[]>();
    for (const r of rows) { if (r.parentId) { const a = childrenMap.get(r.parentId) ?? []; a.push(r.id); childrenMap.set(r.parentId, a); } }
    const stack = [...(childrenMap.get(id) ?? [])];
    while (stack.length) { const c = stack.pop()!; out.add(c); stack.push(...(childrenMap.get(c) ?? [])); }
    return out;
  };

  const drop = (targetId: string | null) => {
    setOverId(null); setRootOver(false);
    if (!dragId) return;
    const dragged = byId.get(dragId);
    if (!dragged) { setDragId(null); return; }
    if (targetId === dragId) { setDragId(null); return; }
    if (targetId && descendantsOf(dragId).has(targetId)) { setErr('Cannot move a node into its own subtree'); setDragId(null); return; }
    if ((dragged.parentId ?? null) === targetId) { setDragId(null); return; } // no-op
    const newLevel = targetId ? (byId.get(targetId)!.level + 1) : 1;
    setErr(null);
    move.mutate({ id: dragId, parentId: targetId, level: newLevel });
    setDragId(null);
  };

  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    const hasKids = n.children.length > 0;
    const isCollapsed = collapsed.has(n.id);
    const isOver = overId === n.id;
    const isDragging = dragId === n.id;
    return (
      <React.Fragment key={n.id}>
        <div
          draggable={canWrite}
          onDragStart={() => canWrite && setDragId(n.id)}
          onDragEnd={() => { setDragId(null); setOverId(null); setRootOver(false); }}
          onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(n.id); } }}
          onDragLeave={() => setOverId((o) => (o === n.id ? null : o))}
          onDrop={(e) => { e.preventDefault(); drop(n.id); }}
          className={`flex items-center gap-2 py-1.5 pr-3 rounded-md transition-colors ${isOver ? 'bg-brand-secondary-container/20 ring-1 ring-brand-secondary-container' : 'hover:bg-brand-surface'} ${isDragging ? 'opacity-40' : ''}`}
          style={{ paddingLeft: 8 + depth * 22 }}
        >
          {canWrite && <GripVertical className="w-3.5 h-3.5 text-brand-on-surface-variant/50 cursor-grab shrink-0" />}
          <button onClick={() => hasKids && toggle(n.id)} className="w-4 h-4 shrink-0 flex items-center justify-center text-brand-on-surface-variant">
            {hasKids ? (isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />) : <span className="w-1.5 h-1.5 rounded-full bg-brand-outline-variant" />}
          </button>
          <span className="text-xs font-bold text-brand-primary font-mono shrink-0">{n.code}</span>
          <span className="text-xs text-brand-on-surface truncate flex-1">{n.name}</span>
          {(() => {
            const r = rollupById.get(n.id);
            const progress = r ? r.progress : n.progressPct;
            const weightOff = r && r.childWeightSum != null && Math.abs(r.childWeightSum - 100) > 0.5;
            const dateRange = r && (r.plannedStart || r.plannedFinish)
              ? `${shortDate(r.plannedStart)} → ${shortDate(r.plannedFinish)}`
              : null;
            return (
              <div className="flex items-center gap-2 shrink-0">
                {dateRange && (
                  <span className="text-[10px] font-mono text-brand-on-surface-variant hidden md:inline w-36 text-right" title="Planned schedule window (from linked activities)">{dateRange}</span>
                )}
                {weightOff && (
                  <span title={`Child weights sum to ${r!.childWeightSum}% (should be 100%)`} className="text-amber-500">
                    <AlertTriangle className="w-3.5 h-3.5" />
                  </span>
                )}
                {r?.fromProduction && (
                  <span title="Progress derived from production data" className="text-brand-secondary-container">
                    <Activity className="w-3.5 h-3.5" />
                  </span>
                )}
                {r && r.budget > 0 && (
                  <span className="text-[10px] font-mono text-brand-on-surface-variant hidden sm:inline w-28 text-right">{money(r.budget)}</span>
                )}
                <div className="w-20 h-1.5 rounded-full bg-brand-surface-container overflow-hidden hidden sm:block">
                  <div className={`h-full rounded-full ${barColor(progress)}`} style={{ width: `${Math.min(100, progress)}%` }} />
                </div>
                <span className="text-[10px] font-bold text-brand-on-surface-variant w-9 text-right">{Math.round(progress)}%</span>
              </div>
            );
          })()}
        </div>
        {hasKids && !isCollapsed && n.children.map((c) => renderNode(c, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-brand-outline-variant/15 flex items-center justify-between gap-3">
        <h3 className="font-bold text-brand-primary text-sm">WBS Tree</h3>
        <span className="text-[11px] text-brand-on-surface-variant flex items-center gap-2">
          <span className="flex items-center gap-1"><Activity className="w-3 h-3 text-brand-secondary-container" /> from production</span>
          <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-500" /> weights ≠ 100%</span>
          {err && <em className="text-red-600 ml-1">{err}</em>}
        </span>
      </div>

      {canWrite && (
        <div
          onDragOver={(e) => { if (dragId) { e.preventDefault(); setRootOver(true); } }}
          onDragLeave={() => setRootOver(false)}
          onDrop={(e) => { e.preventDefault(); drop(null); }}
          className={`mx-3 mt-3 mb-1 px-3 py-2 rounded-md border border-dashed text-[11px] font-bold flex items-center gap-2 ${rootOver ? 'border-brand-secondary-container bg-brand-secondary-container/10 text-brand-primary' : 'border-brand-outline-variant/40 text-brand-on-surface-variant'}`}
        >
          <CornerLeftUp className="w-3.5 h-3.5" /> Drop here to make a top-level activity
        </div>
      )}

      <div className="p-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
        {isLoading ? <p className="text-xs text-brand-on-surface-variant px-2 py-4">Loading…</p>
          : tree.length === 0 ? <p className="text-xs text-brand-on-surface-variant px-2 py-4">No WBS items yet. Add them in the WBS tab.</p>
          : tree.map((n) => renderNode(n, 0))}
      </div>
    </div>
  );
}
