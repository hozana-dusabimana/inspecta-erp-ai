import { buildProjectMetrics, rollupPortfolio, indexStatus } from '../src/lib/project-metrics';
import { rollupProgress } from '../src/lib/progress';

const base = {
  projectId: 'p1', code: 'PRJ-0008', name: 'Test', status: 'ACTIVE', isDemo: false,
  contractValue: 80_000_000, projectValue: 80_000_000, budgetLines: 0, boqBudget: 0,
  actualCost: 60_000, billed: 0, received: 0, prodPlanned: 0, prodActual: 0,
  scheduleAvg: null, scheduleCount: 0, manualPct: 0, startDate: null, endDate: null, openNcrs: 0, plannedProfitMarginPct: 0,
};

describe('project metrics — one calculation for every screen', () => {
  it('shows No data (null) for budget-driven figures when there is no BOQ', () => {
    const m = buildProjectMetrics({ ...base, prodPlanned: 100, prodActual: 50 });
    expect(m.budget).toBeNull();
    expect(m.budgetSource).toBe('NONE');
    expect(m.eac).toBeNull();
    expect(m.forecastProfit).toBeNull();
    expect(m.forecastMarginPct).toBeNull();
    expect(m.progressPct).toBe(50);
    expect(m.spi).toBe(0.5);
  });

  it('the BOQ is the one budget: budget lines never replace it (T1-03)', () => {
    const m = buildProjectMetrics({ ...base, boqBudget: 10_000_000, budgetLines: 40_000_000 });
    expect(m.budget).toBe(10_000_000);
    expect(m.budgetLinesTotal).toBe(40_000_000);
    const none = buildProjectMetrics({ ...base, budgetLines: 40_000_000 });
    expect(none.budget).toBeNull();
  });

  it('T1 figures: BOQ 10M, contract 100M, 30% progress, AC 959,600', () => {
    const m = buildProjectMetrics({ ...base, contractValue: 100_000_000, boqBudget: 10_000_000, prodPlanned: 100, prodActual: 30, actualCost: 959_600 });
    expect(m.earnedValue).toBe(3_000_000); // 30% of the 10M budget, not of the 100M contract
    expect(m.cpi).toBeCloseTo(3_000_000 / 959_600, 3);
    expect(m.etc).toBe(7_000_000); // BAC − EV (a good CPI never shrinks it)
    expect(m.eac).toBe(7_959_600); // AC + ETC
    expect(m.forecastProfit).toBe(92_040_400);
  });

  it('forecast margin = contract − (actual + cost to complete): +1,000,000 actual lowers it by at least 1,000,000 (T1-04)', () => {
    const at = (ac: number) => buildProjectMetrics({ ...base, contractValue: 100_000_000, boqBudget: 10_000_000, prodPlanned: 100, prodActual: 30, actualCost: ac }).forecastProfit!;
    for (const ac of [0, 959_600, 2_500_000, 3_000_000, 6_000_000, 20_000_000]) {
      expect(at(ac) - at(ac + 1_000_000)).toBeGreaterThanOrEqual(1_000_000 - 0.01);
    }
  });

  it('an overrun trend is carried into the estimate (CPI < 1 scales ETC)', () => {
    const m = buildProjectMetrics({ ...base, boqBudget: 50_000_000, prodPlanned: 100, prodActual: 50, actualCost: 30_000_000 });
    // EV 25M, AC 30M, CPI 0.833 → ETC = 25M ÷ 0.833 = 30M, EAC = 60M
    expect(m.cpi).toBeCloseTo(0.833, 3);
    expect(m.eac).toBeCloseTo(60_000_000, 0);
    expect(m.forecastProfit).toBeCloseTo(20_000_000, 0);
  });

  it('shows CPI whenever EV and AC exist, flagging implausibly low spend (T1-06)', () => {
    const m = buildProjectMetrics({ ...base, boqBudget: 50_000_000, prodPlanned: 100, prodActual: 50, actualCost: 21_250 });
    expect(m.cpi).toBeCloseTo(25_000_000 / 21_250, 2);
    expect(m.costDataIncomplete).toBe(true);
    expect(m.eac).toBe(25_021_250);
  });

  it('a project with no progress evidence is NO_DATA, not on track', () => {
    const m = buildProjectMetrics({ ...base, boqBudget: 50_000_000, actualCost: 0 });
    expect(m.progressPct).toBeNull();
    expect(m.health).toBe('NO_DATA');
  });

  it('but real warnings still show without progress (over budget)', () => {
    const m = buildProjectMetrics({ ...base, boqBudget: 1_000_000, actualCost: 2_000_000 });
    expect(m.health).toBe('CRITICAL');
  });

  it('uses the contract value (not 0 or a dash) for profit', () => {
    const m = buildProjectMetrics({ ...base, boqBudget: 50_000_000, actualCost: 0 });
    expect(m.contractValue).toBe(80_000_000);
    expect(m.eac).toBe(50_000_000); // nothing earned or spent yet: EAC = BAC
    expect(m.forecastProfit).toBe(30_000_000);
  });

  it('applies one badge rule: 0.87 is not on track', () => {
    expect(indexStatus(0.87)).toBe('AT_RISK');
    expect(indexStatus(1)).toBe('ON_TRACK');
    expect(indexStatus(0.5)).toBe('CRITICAL');
    expect(indexStatus(null)).toBe('NO_DATA');
  });

  it('portfolio SPI is value-weighted and excludes projects without data', () => {
    const a = buildProjectMetrics({ ...base, boqBudget: 100, prodPlanned: 10, prodActual: 5 });
    const b = buildProjectMetrics({ ...base, projectId: 'p2' });
    const t = rollupPortfolio([a, b]);
    expect(t.spi).toBe(0.5);
    expect(t.noData).toBe(1);
  });

  it('WBS-driven progress takes precedence and drives planned for SPI', () => {
    const m = buildProjectMetrics({ ...base, boqBudget: 10_000_000, wbs: { progress: 40, planned: 100 } });
    expect(m.progressSource).toBe('WBS');
    expect(m.progressPct).toBe(40);
    expect(m.spi).toBe(0.4);
  });
});

describe('progress roll-up (T1-07)', () => {
  const now = new Date('2026-11-16T00:00:00Z').getTime();

  it('30 of 100 on the only item gives 30%, and 40 gives 40%', () => {
    const items = [{ id: 'w11', parentId: null, quantity: 100, weightPct: 0, progressPct: 0 }];
    const r30 = rollupProgress(items, [{ wbsItemId: 'w11', planned: 100, actual: 30 }], [], now);
    expect(r30.byId.get('w11')!.progress).toBe(30);
    expect(r30.project!.progress).toBe(30);
    expect(r30.project!.planned).toBe(100);
    const r40 = rollupProgress(items, [{ wbsItemId: 'w11', planned: 100, actual: 40 }], [], now);
    expect(r40.project!.progress).toBe(40);
  });

  it('weights children; equal weights when all are 0; capped at 100', () => {
    const items = [
      { id: 'p', parentId: null, quantity: null, weightPct: 100, progressPct: 0 },
      { id: 'a', parentId: 'p', quantity: 100, weightPct: 75, progressPct: 0 },
      { id: 'b', parentId: 'p', quantity: 50, weightPct: 25, progressPct: 0 },
    ];
    const r = rollupProgress(items, [{ wbsItemId: 'a', planned: 100, actual: 50 }, { wbsItemId: 'b', planned: 50, actual: 80 }], [], now);
    expect(r.byId.get('b')!.progress).toBe(100);
    expect(r.byId.get('p')!.progress).toBeCloseTo(0.75 * 50 + 0.25 * 100, 5);
    const eq = rollupProgress(items.map((i) => ({ ...i, weightPct: 0 })), [{ wbsItemId: 'a', planned: 100, actual: 50 }], [], now);
    expect(eq.byId.get('p')!.progress).toBe(25);
  });

  it('an item without entries is planned by its linked activity dates', () => {
    const items = [{ id: 'x', parentId: null, quantity: 10, weightPct: 100, progressPct: 0 }];
    const r = rollupProgress(items, [], [{ wbsItemId: 'x', startDate: new Date('2026-11-06T00:00:00Z'), finishDate: new Date('2026-11-26T00:00:00Z') }], now);
    expect(r.byId.get('x')!.planned).toBe(50);
    expect(r.fromEntries).toBe(false);
  });
});
