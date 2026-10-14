/**
 * Dependency-graph helpers shared by the dependency CRUD, the Excel importer
 * and the Copilot create flow. Edges are `[predecessor, activity]` pairs of any
 * comparable key (ids or codes).
 */
export type Edge = readonly [predecessor: string, activity: string];

/**
 * Would adding `predecessor → activity` close a loop? It does exactly when the
 * activity can already reach the predecessor through existing links (or both
 * are the same activity).
 */
export function wouldCreateCycle(edges: readonly Edge[], predecessor: string, activity: string): boolean {
  if (predecessor === activity) return true;
  const next = new Map<string, string[]>();
  for (const [p, a] of edges) {
    const list = next.get(p) ?? [];
    list.push(a);
    next.set(p, list);
  }
  const seen = new Set<string>([activity]);
  const stack = [activity];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of next.get(cur) ?? []) {
      if (n === predecessor) return true;
      if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return false;
}
