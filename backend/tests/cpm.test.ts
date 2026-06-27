import { computeCpm } from '../src/modules/scheduling/cpm';

describe('CPM critical path', () => {
  it('computes duration and critical path for a simple network', () => {
    // A(3) -> B(4) -> D(2);  A(3) -> C(2) -> D(2). Critical = A,B,D (9 days).
    const r = computeCpm([
      { code: 'A', name: 'A', duration: 3, predecessors: [] },
      { code: 'B', name: 'B', duration: 4, predecessors: ['A'] },
      { code: 'C', name: 'C', duration: 2, predecessors: ['A'] },
      { code: 'D', name: 'D', duration: 2, predecessors: ['B', 'C'] },
    ]);
    expect(r.projectDuration).toBe(9);
    expect(r.criticalPath).toEqual(['A', 'B', 'D']);
    const c = r.activities.find((a) => a.code === 'C')!;
    expect(c.float).toBe(2); // C has 2 days of slack
    expect(c.critical).toBe(false);
  });

  it('handles a single activity', () => {
    const r = computeCpm([{ code: 'X', name: 'X', duration: 5, predecessors: [] }]);
    expect(r.projectDuration).toBe(5);
    expect(r.criticalPath).toEqual(['X']);
  });

  it('returns empty for no activities', () => {
    expect(computeCpm([])).toEqual({ activities: [], projectDuration: 0, criticalPath: [] });
  });

  it('honors a finish-to-start lag', () => {
    // A(3) -> B(2) with FS lag 2: B starts at A.ef + 2 = 5, ends 7.
    const r = computeCpm([
      { code: 'A', name: 'A', duration: 3, predecessors: [] },
      { code: 'B', name: 'B', duration: 2, predecessors: [], deps: [{ predecessor: 'A', type: 'FS', lag: 2 }] },
    ]);
    expect(r.projectDuration).toBe(7);
    expect(r.criticalPath).toEqual(['A', 'B']);
    expect(r.activities.find((a) => a.code === 'B')!.es).toBe(5);
  });

  it('honors a start-to-start dependency', () => {
    // A(5); B(3) SS lag 2: B starts at A.es + 2 = 2, ends 5. Project = 5.
    const r = computeCpm([
      { code: 'A', name: 'A', duration: 5, predecessors: [] },
      { code: 'B', name: 'B', duration: 3, predecessors: [], deps: [{ predecessor: 'A', type: 'SS', lag: 2 }] },
    ]);
    expect(r.projectDuration).toBe(5);
    expect(r.activities.find((a) => a.code === 'B')!.es).toBe(2);
  });

  it('throws on a circular dependency', () => {
    expect(() =>
      computeCpm([
        { code: 'A', name: 'A', duration: 1, predecessors: ['B'] },
        { code: 'B', name: 'B', duration: 1, predecessors: ['A'] },
      ]),
    ).toThrow(/circular/i);
  });
});
