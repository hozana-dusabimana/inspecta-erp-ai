export type DependencyKind = 'FS' | 'SS' | 'FF' | 'SF';

export interface CpmDep {
  predecessor: string;
  type: DependencyKind;
  lag: number;
}

export interface CpmInput {
  code: string;
  name: string;
  duration: number;
  /** Legacy finish-to-start predecessor codes (lag 0). */
  predecessors: string[];
  /** Typed dependencies; when present they replace `predecessors`. */
  deps?: CpmDep[];
}

export interface CpmNode {
  code: string;
  name: string;
  duration: number;
  deps: CpmDep[];
  es: number;
  ef: number;
  ls: number;
  lf: number;
  float: number;
  critical: boolean;
}

export interface CpmResult {
  activities: CpmNode[];
  projectDuration: number;
  criticalPath: string[];
}

interface Edge {
  succ: string;
  type: DependencyKind;
  lag: number;
}

/** Normalize an activity's dependencies: prefer typed `deps`, else legacy FS codes. */
function normalizeDeps(a: CpmInput): CpmDep[] {
  if (a.deps && a.deps.length) return a.deps.filter((d) => d.predecessor);
  return (a.predecessors ?? []).filter(Boolean).map((p) => ({ predecessor: p, type: 'FS' as const, lag: 0 }));
}

/**
 * Critical Path Method with typed dependencies (FS/SS/FF/SF) + lag.
 * Forward pass = earliest start/finish; backward pass = latest start/finish;
 * float = LS − ES; zero-float activities are critical.
 * Throws on circular dependencies. Pure & unit-tested.
 */
export function computeCpm(input: CpmInput[]): CpmResult {
  if (input.length === 0) return { activities: [], projectDuration: 0, criticalPath: [] };

  const byCode = new Map<string, CpmNode>();
  for (const a of input) {
    byCode.set(a.code, {
      code: a.code,
      name: a.name,
      duration: a.duration,
      deps: normalizeDeps(a).filter((d) => true),
      es: 0,
      ef: 0,
      ls: 0,
      lf: 0,
      float: 0,
      critical: false,
    });
  }
  // Drop deps whose predecessor doesn't exist in this set.
  byCode.forEach((n) => {
    n.deps = n.deps.filter((d) => byCode.has(d.predecessor));
  });

  const indeg = new Map<string, number>();
  const adj = new Map<string, Edge[]>(); // predecessor -> outgoing edges
  byCode.forEach((n) => {
    indeg.set(n.code, 0);
    adj.set(n.code, []);
  });
  byCode.forEach((n) => {
    for (const d of n.deps) {
      adj.get(d.predecessor)!.push({ succ: n.code, type: d.type, lag: d.lag });
      indeg.set(n.code, (indeg.get(n.code) ?? 0) + 1);
    }
  });

  // Topological order (Kahn).
  const queue: string[] = [];
  indeg.forEach((deg, code) => deg === 0 && queue.push(code));
  const order: string[] = [];
  while (queue.length) {
    const code = queue.shift()!;
    order.push(code);
    for (const e of adj.get(code)!) {
      indeg.set(e.succ, (indeg.get(e.succ) ?? 0) - 1);
      if (indeg.get(e.succ) === 0) queue.push(e.succ);
    }
  }
  if (order.length !== byCode.size) {
    throw new Error('Schedule contains a circular dependency — cannot compute critical path');
  }

  // Forward pass — earliest start derived from each predecessor by dependency type.
  for (const code of order) {
    const n = byCode.get(code)!;
    let es = 0;
    for (const d of n.deps) {
      const p = byCode.get(d.predecessor)!;
      let cand: number;
      switch (d.type) {
        case 'SS': cand = p.es + d.lag; break;
        case 'FF': cand = p.ef + d.lag - n.duration; break;
        case 'SF': cand = p.es + d.lag - n.duration; break;
        case 'FS':
        default: cand = p.ef + d.lag; break;
      }
      if (cand > es) es = cand;
    }
    n.es = Math.max(0, es);
    n.ef = n.es + n.duration;
  }
  const projectDuration = Math.max(...[...byCode.values()].map((n) => n.ef));

  // Backward pass — latest finish derived from each successor by dependency type.
  for (const code of [...order].reverse()) {
    const n = byCode.get(code)!;
    const edges = adj.get(code)!;
    if (!edges.length) {
      n.lf = projectDuration;
    } else {
      let lf = Infinity;
      for (const e of edges) {
        const s = byCode.get(e.succ)!;
        let cand: number;
        switch (e.type) {
          case 'SS': cand = (s.ls - e.lag) + n.duration; break;
          case 'FF': cand = s.lf - e.lag; break;
          case 'SF': cand = (s.lf - e.lag) + n.duration; break;
          case 'FS':
          default: cand = s.ls - e.lag; break;
        }
        if (cand < lf) lf = cand;
      }
      n.lf = lf;
    }
    n.ls = n.lf - n.duration;
    n.float = n.ls - n.es;
    n.critical = n.float === 0;
  }

  const activities = order.map((c) => byCode.get(c)!);
  return {
    activities,
    projectDuration,
    criticalPath: activities.filter((n) => n.critical).map((n) => n.code),
  };
}
