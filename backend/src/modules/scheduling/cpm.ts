export interface CpmInput {
  code: string;
  name: string;
  duration: number;
  predecessors: string[];
}

export interface CpmNode extends CpmInput {
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

/**
 * Critical Path Method. Forward pass = earliest start/finish; backward pass =
 * latest start/finish; float = LS − ES; zero-float activities are critical.
 * Throws on circular dependencies. Pure & unit-tested.
 */
export function computeCpm(input: CpmInput[]): CpmResult {
  if (input.length === 0) return { activities: [], projectDuration: 0, criticalPath: [] };

  const byCode = new Map<string, CpmNode>();
  for (const a of input) {
    byCode.set(a.code, {
      ...a,
      predecessors: (a.predecessors ?? []).filter(Boolean),
      es: 0,
      ef: 0,
      ls: 0,
      lf: 0,
      float: 0,
      critical: false,
    });
  }

  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  byCode.forEach((n) => {
    indeg.set(n.code, 0);
    adj.set(n.code, []);
  });
  byCode.forEach((n) => {
    for (const p of n.predecessors) {
      if (!byCode.has(p)) continue;
      adj.get(p)!.push(n.code);
      indeg.set(n.code, (indeg.get(n.code) ?? 0) + 1);
    }
  });

  const queue: string[] = [];
  indeg.forEach((d, code) => d === 0 && queue.push(code));
  const order: string[] = [];
  while (queue.length) {
    const code = queue.shift()!;
    order.push(code);
    for (const next of adj.get(code)!) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== byCode.size) {
    throw new Error('Schedule contains a circular dependency — cannot compute critical path');
  }

  // Forward pass.
  for (const code of order) {
    const n = byCode.get(code)!;
    const preds = n.predecessors.filter((p) => byCode.has(p));
    n.es = preds.length ? Math.max(...preds.map((p) => byCode.get(p)!.ef)) : 0;
    n.ef = n.es + n.duration;
  }
  const projectDuration = Math.max(...[...byCode.values()].map((n) => n.ef));

  // Backward pass.
  for (const code of [...order].reverse()) {
    const n = byCode.get(code)!;
    const successors = adj.get(code)!;
    n.lf = successors.length ? Math.min(...successors.map((s) => byCode.get(s)!.ls)) : projectDuration;
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
