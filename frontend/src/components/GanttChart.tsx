import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface CpmActivity {
  code: string;
  name: string;
  duration: number;
  deps: { predecessor: string; type: string; lag: number }[];
  es: number;
  ef: number;
  float: number;
  critical: boolean;
}
interface CpmResult {
  activities: CpmActivity[];
  projectDuration: number;
  criticalPath: string[];
}

const ROW_H = 34;
const LABEL_W = 184;
const HEADER_H = 26;

export default function GanttChart({ projectId }: { projectId?: string }) {
  const { data: cpmResp } = useQuery({
    queryKey: ['gantt-cpm', projectId],
    queryFn: () => api.get<CpmResult>(`/scheduling/cpm?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
  const { data: actResp } = useQuery({
    queryKey: ['gantt-activities', projectId],
    queryFn: () => api.get<any[]>(`/scheduling?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });

  if (!projectId) {
    return (
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-5 mb-6">
        <h3 className="font-bold text-brand-primary text-sm">Baseline Gantt</h3>
        <p className="text-xs text-brand-on-surface-variant mt-1">Select a project to view its Gantt chart.</p>
      </div>
    );
  }

  const cpm = cpmResp?.data;
  if (!cpm || cpm.activities.length === 0) {
    return (
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm p-5 mb-6">
        <h3 className="font-bold text-brand-primary text-sm">Baseline Gantt</h3>
        <p className="text-xs text-brand-on-surface-variant mt-1">No schedule activities yet for this project.</p>
      </div>
    );
  }

  const milestoneByCode = new Map<string, boolean>((actResp?.data ?? []).map((a) => [a.code, Boolean(a.milestone)]));
  const total = Math.max(1, cpm.projectDuration);
  const dayW = total > 90 ? 6 : total > 45 ? 11 : total > 20 ? 20 : 30;
  const chartW = total * dayW;
  const rows = cpm.activities;
  const rowIndex = new Map(rows.map((a, i) => [a.code, i]));
  const bodyH = rows.length * ROW_H;

  // Tick spacing for the day scale.
  const step = total > 90 ? 14 : total > 30 ? 7 : total > 14 ? 5 : 2;
  const ticks: number[] = [];
  for (let d = 0; d <= total; d += step) ticks.push(d);

  // Dependency connector segments (predecessor end → activity start).
  const arrows: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const a of rows) {
    const r = rowIndex.get(a.code)!;
    for (const dep of a.deps ?? []) {
      const pr = rowIndex.get(dep.predecessor);
      if (pr === undefined) continue;
      const pred = rows[pr];
      arrows.push({
        x1: pred.ef * dayW,
        y1: pr * ROW_H + ROW_H / 2,
        x2: a.es * dayW,
        y2: r * ROW_H + ROW_H / 2,
      });
    }
  }

  return (
    <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm mb-6 overflow-hidden">
      <div className="px-5 py-3 border-b border-brand-outline-variant/15 flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-brand-primary text-sm">Baseline Gantt</h3>
        <div className="flex items-center gap-4 text-[10px] font-bold text-brand-on-surface-variant">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#00286a' }} /> Task</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#dc2626' }} /> Critical</span>
          <span className="flex items-center gap-1.5"><span style={{ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '10px solid #ff8a00' }} /> Milestone</span>
          <span>Duration: {cpm.projectDuration}d</span>
        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <div style={{ width: LABEL_W + chartW, minWidth: '100%' }}>
          {/* Scale header */}
          <div className="flex border-b border-brand-outline-variant/15" style={{ height: HEADER_H }}>
            <div style={{ width: LABEL_W }} className="shrink-0 px-3 flex items-center text-[10px] font-bold text-brand-on-surface-variant uppercase tracking-wider">Activity</div>
            <div className="relative" style={{ width: chartW }}>
              {ticks.map((d) => (
                <div key={d} className="absolute top-0 h-full flex items-start" style={{ left: d * dayW }}>
                  <span className="text-[9px] text-brand-on-surface-variant font-mono pl-0.5">{d}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Rows + bars + arrow overlay */}
          <div className="relative">
            {/* gridlines */}
            <div className="absolute pointer-events-none" style={{ left: LABEL_W, top: 0, width: chartW, height: bodyH }}>
              {ticks.map((d) => (
                <div key={d} className="absolute top-0 bottom-0 border-l border-brand-outline-variant/15" style={{ left: d * dayW }} />
              ))}
            </div>

            {/* dependency arrows */}
            <svg className="absolute pointer-events-none" style={{ left: LABEL_W, top: 0, width: chartW, height: bodyH, overflow: 'visible' }}>
              {arrows.map((a, i) => (
                <polyline
                  key={i}
                  points={`${a.x1},${a.y1} ${a.x1 + 6},${a.y1} ${a.x1 + 6},${a.y2} ${a.x2},${a.y2}`}
                  fill="none" stroke="#9aa0b4" strokeWidth={1.2} markerEnd="url(#arrow)"
                />
              ))}
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#9aa0b4" />
                </marker>
              </defs>
            </svg>

            {rows.map((a, i) => {
              const isMilestone = milestoneByCode.get(a.code) || a.duration === 0;
              const left = a.es * dayW;
              const width = Math.max(dayW * 0.6, a.duration * dayW);
              return (
                <div key={a.code} className="flex items-center border-b border-brand-outline-variant/10 last:border-0" style={{ height: ROW_H }}>
                  <div style={{ width: LABEL_W }} className="shrink-0 px-3 truncate text-xs">
                    <span className="font-bold text-brand-primary">{a.code}</span>
                    <span className="text-brand-on-surface-variant"> {a.name}</span>
                  </div>
                  <div className="relative" style={{ width: chartW, height: ROW_H }}>
                    {isMilestone ? (
                      <div className="absolute" style={{ left: left - 7, top: ROW_H / 2 - 7, width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: '12px solid #ff8a00' }} title={`${a.name} (milestone, day ${a.es})`} />
                    ) : (
                      <div
                        className="absolute rounded shadow-sm flex items-center"
                        style={{ left, top: 7, width, height: ROW_H - 14, background: a.critical ? '#dc2626' : '#00286a' }}
                        title={`${a.name}: day ${a.es}–${a.ef} (${a.duration}d), float ${a.float}${a.critical ? ', critical' : ''}`}
                      >
                        {width > 34 && <span className="text-[9px] text-white font-bold px-1.5 truncate">{a.duration}d</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
