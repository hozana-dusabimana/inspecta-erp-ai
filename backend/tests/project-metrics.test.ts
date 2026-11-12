import { buildProjectMetrics, rollupPortfolio, indexStatus } from '../src/lib/project-metrics';

const base = {
  projectId: 'p1', code: 'PRJ-0008', name: 'Test', status: 'ACTIVE', isDemo: false,
  contractValue: 80_000_000, projectValue: 80_000_000, budgetLines: 0, boqBudget: 0,
  actualCost: 60_000, billed: 0, received: 0, prodPlanned: 0, prodActual: 0,
  scheduleAvg: null, scheduleCount: 0, manualPct: 0, startDate: null, endDate: null, openNcrs: 0, plannedProfitMarginPct: 0,
};

describe('project metrics — one calculation for every screen', () => {
  it('shows No data (null) for budget-driven figures when there is no budget', () => {
    const m = buildProjectMetrics({ ...base, prodPlanned: 100, prodActual: 50 });
    expect(m.budget).toBeNull();
    expect(m.eac).toBeNull();
    expect(m.forecastProfit).toBeNull();
    expect(m.forecastMarginPct).toBeNull();
    expect(m.progressPct).toBe(50);
    expect(m.spi).toBe(0.5);
  });

  it('computes EAC from budget and progress, not from actual cost', () => {
    const m = buildProjectMetrics({ ...base, budgetLines: 50_000_000, prodPlanned: 100, prodActual: 50, actualCost: 30_000_000 });
    // EV = 25M, AC = 30M, CPI = 0.833, EAC = BAC / CPI = 60M
    expect(m.cpi).toBeCloseTo(0.833, 3);
    expect(m.eac).toBeCloseTo(60_000_000, 0);
    expect(m.forecastProfit).toBeCloseTo(20_000_000, 0);
  });

  it('treats implausibly low spend as incomplete cost data (no fantasy CPI or profit)', () => {
    const m = buildProjectMetrics({ ...base, budgetLines: 50_000_000, prodPlanned: 100, prodActual: 50, actualCost: 21_250 });
    expect(m.cpi).toBeNull();
    expect(m.costDataIncomplete).toBe(true);
    expect(m.eac).toBe(50_000_000);
    expect(m.forecastProfit).toBe(30_000_000);
  });

  it('uses the contract value (not 0 or a dash) for profit', () => {
    const m = buildProjectMetrics({ ...base, budgetLines: 50_000_000 });
    expect(m.contractValue).toBe(80_000_000);
    expect(m.eac).toBe(50_000_000); // no progress evidence yet: EAC = BAC
    expect(m.forecastProfit).toBe(30_000_000);
  });

  it('applies one badge rule: 0.87 is not on track', () => {
    expect(indexStatus(0.87)).toBe('AT_RISK');
    expect(indexStatus(1)).toBe('ON_TRACK');
    expect(indexStatus(0.5)).toBe('CRITICAL');
    expect(indexStatus(null)).toBe('NO_DATA');
  });

  it('portfolio SPI is value-weighted and excludes projects without data', () => {
    const a = buildProjectMetrics({ ...base, budgetLines: 100, prodPlanned: 10, prodActual: 5 });
    const b = buildProjectMetrics({ ...base, projectId: 'p2' });
    const t = rollupPortfolio([a, b]);
    expect(t.spi).toBe(0.5);
    expect(t.noData).toBe(1);
  });
});
