import { call, download, provisionTenant, destroyTenant, addMember, disconnect, Tenant } from './harness';

/**
 * API end-to-end suite. Runs the real app against a real database.
 *   npm run test:e2e
 * One throwaway company is provisioned for the whole run and removed at the end.
 */
let t: Tenant;
let admin: string;
let eng: { id: string; token: string };
let qs: { id: string; token: string };

const iso = () => new Date().toISOString();
const ok = (res: { status: number; body: any }) => { expect([200, 201]).toContain(res.status); return res.body.data; };

// shared fixtures
let A: any; let B: any; let wA: any; let wA2: any; let wB: any; let mat: any;

beforeAll(async () => {
  t = await provisionTenant('feat');
  admin = t.admin;
  const client = ok(await call('post', '/clients', { name: 'E2E Client' }, admin));
  A = ok(await call('post', '/projects', { name: 'E2E Alpha', budget: 80_000_000 }, admin));
  B = ok(await call('post', '/projects', { name: 'E2E Beta', budget: 10_000_000 }, admin));
  ok(await call('post', '/contracts', { clientId: client.id, projectId: A.id, reference: 'E2E-C1', value: 80_000_000 }, admin));
  wA = ok(await call('post', '/planning/wbs', { projectId: A.id, code: '1', name: 'Walls', unit: 'm2', quantity: 100 }, admin));
  wA2 = ok(await call('post', '/planning/wbs', { projectId: A.id, code: '2', name: 'Slab' }, admin));
  wB = ok(await call('post', '/planning/wbs', { projectId: B.id, code: '1', name: 'Other job' }, admin));
  mat = ok(await call('post', '/inventory/materials', { code: 'E2E-M1', name: 'Cement', unit: 'bag', unitCost: 400 }, admin));
  eng = await addMember(t, 'SITE_ENGINEER', 'eng');
  qs = await addMember(t, 'QUANTITY_SURVEYOR', 'qs');
  ok(await call('put', `/users/${eng.id}/projects`, { projectIds: [A.id] }, admin));
}, 120_000);

afterAll(async () => { await destroyTenant(t); await disconnect(); }, 60_000);

describe('one calculation for progress, earned value and profit', () => {
  it('shows No data (null) without a budget and uses the contract value', async () => {
    const evm = (await call('get', `/finance/evm?projectId=${A.id}`, undefined, admin)).body.data;
    expect(evm.hasData).toBe(false);
    expect(evm.forecastProfit).toBeNull();
    const sum = (await call('get', `/finance/summary?projectId=${A.id}`, undefined, admin)).body.data;
    expect(sum.contractValue).toBe(80_000_000);
    const prof = (await call('get', `/profitability/analysis?projectId=${A.id}`, undefined, admin)).body.data;
    expect(prof.projects[0].hasBudget).toBe(false);
  });

  it('a budget line makes forecast profit = contract - budget, the same on every page', async () => {
    ok(await call('post', '/finance/budget', { projectId: A.id, wbsItemId: wA.id, description: 'Walls', amount: 3_000_000, category: 'MATERIAL' }, admin));
    ok(await call('post', '/finance/budget', { projectId: A.id, description: 'Rest', amount: 2_000_000, category: 'OTHER' }, admin));
    const f1 = (await call('get', `/finance/summary?projectId=${A.id}`, undefined, admin)).body.data.forecastProfit;
    const f3 = (await call('get', `/profitability/analysis?projectId=${A.id}`, undefined, admin)).body.data.projects[0].forecastMargin;
    expect(f1).toBe(75_000_000);
    expect(f3).toBe(75_000_000);
  });

  it('production progress and SPI agree on Production, Projects, Finance', async () => {
    const pe = await call('post', '/production', { projectId: A.id, wbsItemId: wA.id, plannedQty: 100, actualQty: 50, laborHours: 8, date: iso() }, admin);
    expect(pe.status).toBe(201);
    expect(pe.body.data.wbsActivity).toMatch(/Walls/);
    const an = (await call('get', `/production/analytics?projectId=${A.id}`, undefined, admin)).body.data;
    const list = (await call('get', '/projects?pageSize=100', undefined, admin)).body.data.find((p: any) => p.id === A.id);
    const evm = (await call('get', `/finance/evm?projectId=${A.id}`, undefined, admin)).body.data;
    expect(an.progress.actualProgressPct).toBe(50);
    expect(list.progressPct).toBe(50);
    expect(evm.actualProgressPct).toBe(50);
    expect(an.progress.spi).toBe(0.5);
    expect(evm.spiStatus).toBe('CRITICAL');
    expect(an.profitabilityImpact.forecastProfit).toBe(evm.forecastProfit);
  });

  it('implausibly low spend is treated as incomplete cost data, not a fantasy CPI', async () => {
    ok(await call('post', '/finance/costs', { projectId: A.id, description: 'tiny', amount: 21_250, category: 'OTHER' }, admin));
    const evm = (await call('get', `/finance/evm?projectId=${A.id}`, undefined, admin)).body.data;
    expect(evm.cpi).toBeNull();
    expect(evm.forecastProfit).toBe(75_000_000);
  });

  it('demo projects are excluded from client totals', async () => {
    const before = (await call('get', '/dashboards/executive', undefined, admin)).body.data.portfolio.totalProjects;
    const demo = ok(await call('post', '/projects', { name: 'E2E Demo', budget: 1, isDemo: true }, admin));
    const after = (await call('get', '/dashboards/executive', undefined, admin)).body.data.portfolio;
    expect(after.totalProjects).toBe(before);
    expect(after.demoProjects).toBeGreaterThanOrEqual(1);
    await call('delete', `/projects/${demo.id}`, undefined, admin);
  });
});

describe('every WBS link must belong to the record\'s project', () => {
  it.each([
    ['budget line', '/finance/budget', { description: 'x', amount: 1 }],
    ['cost entry', '/finance/costs', { description: 'x', amount: 1, category: 'OTHER' }],
    ['incident', '/hse/incidents', { description: 'x' }],
    ['material test', '/qaqc/material-tests', { testType: 'CONCRETE' }],
    ['daily plan', '/production/daily-plans', { title: 'x' }],
  ])('%s refuses another project\'s WBS', async (_n, path, extra) => {
    const r = await call('post', path, { projectId: A.id, wbsItemId: wB.id, ...extra }, admin);
    expect(r.status).toBe(400);
  });
});

describe('materials become project cost', () => {
  it('goods in, then issues: WBS required, stock guarded, cost posted at average cost', async () => {
    ok(await call('post', '/inventory/grn', { materialId: mat.id, projectId: A.id, quantityReceived: 100, unitCost: 500 }, admin));
    expect((await call('post', '/inventory/material-issues', { materialId: mat.id, projectId: A.id, quantityIssued: 5 }, admin)).status).toBe(400); // no WBS
    const over = await call('post', '/inventory/material-issues', { materialId: mat.id, projectId: A.id, wbsItemId: wA.id, quantityIssued: 500 }, admin);
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/on hand/);
    const rowBefore = (await call('get', `/finance/cost-by-wbs?projectId=${A.id}`, undefined, admin)).body.data.rows.find((r: any) => r.wbsItemId === wA.id);
    const issue = await call('post', '/inventory/material-issues', { materialId: mat.id, projectId: A.id, wbsItemId: wA.id, quantityIssued: 10 }, admin);
    expect(issue.status).toBe(201);
    expect(issue.body.data.issueNumber).toMatch(/^ISS-/);
    const rowAfter = (await call('get', `/finance/cost-by-wbs?projectId=${A.id}`, undefined, admin)).body.data.rows.find((r: any) => r.wbsItemId === wA.id);
    expect(Math.round(rowAfter.actual - rowBefore.actual)).toBe(5_000); // 10 x 500
  });

  it('equipment hours and fuel post cost; usage needs a project', async () => {
    const eq = ok(await call('post', '/equipment/register', { name: 'Excavator', hourlyRate: 30_000 }, admin));
    expect((await call('post', '/equipment/usage-logs', { equipmentId: eq.id, hoursUsed: 4 }, admin)).status).toBe(400);
    const b0 = (await call('get', `/finance/summary?projectId=${A.id}`, undefined, admin)).body.data.actualCost;
    ok(await call('post', '/equipment/usage-logs', { equipmentId: eq.id, projectId: A.id, wbsItemId: wA.id, hoursUsed: 4 }, admin));
    const b1 = (await call('get', `/finance/summary?projectId=${A.id}`, undefined, admin)).body.data.actualCost;
    expect(Math.round(b1 - b0)).toBe(120_000);
    ok(await call('post', '/equipment/fuel-logs', { equipmentId: eq.id, projectId: A.id, liters: 100, costPerLiter: 1_800 }, admin));
    const b2 = (await call('get', `/finance/summary?projectId=${A.id}`, undefined, admin)).body.data.actualCost;
    expect(Math.round(b2 - b1)).toBe(180_000);
    expect((await call('post', '/equipment/maintenance', { equipmentId: eq.id, type: 'scheduled', cost: 50_000, status: 'DONE' }, admin)).status).toBe(201);
  });

  it('requisition: WBS per line, second person approves, issuing posts cost on that task', async () => {
    expect((await call('post', '/requisitions', { projectId: A.id, title: 'no wbs', items: [{ materialId: mat.id, quantityRequested: 5 }] }, admin)).status).toBe(400);
    expect((await call('post', '/requisitions', { projectId: A.id, title: 'wrong', items: [{ materialId: mat.id, quantityRequested: 5, wbsItemId: wB.id }] }, admin)).status).toBe(400);
    const rq = ok(await call('post', '/requisitions', { projectId: A.id, title: 'Walls cement', items: [{ materialId: mat.id, quantityRequested: 20, wbsItemId: wA.id }] }, admin));
    const full = (await call('get', `/requisitions/${rq.id}`, undefined, admin)).body.data;
    expect(full.items[0].wbsItemId).toBe(wA.id);
    ok(await call('post', `/requisitions/${rq.id}/submit`, {}, admin));
    const self = await call('post', `/requisitions/${rq.id}/approve`, {}, admin);
    expect(self.status).toBe(403);
    expect(self.body.error).toMatch(/raised yourself/);
    ok(await call('post', `/requisitions/${rq.id}/approve`, {}, eng.token));
    const before = (await call('get', `/finance/cost-by-wbs?projectId=${A.id}`, undefined, admin)).body.data.rows.find((r: any) => r.wbsItemId === wA.id).actual;
    ok(await call('post', `/requisitions/${rq.id}/issue`, {}, admin));
    const after = (await call('get', `/finance/cost-by-wbs?projectId=${A.id}`, undefined, admin)).body.data.rows.find((r: any) => r.wbsItemId === wA.id).actual;
    expect(Math.round(after - before)).toBe(10_000); // 20 x 500
  });
});

describe('procurement carries WBS and shows commitments', () => {
  it('purchase request/order lines link to a WBS task; open POs are commitments', async () => {
    const bad = await call('post', '/procurement/purchase-requests', { number: 'PR-E2E-0', title: 'x', projectId: A.id, items: [{ description: 'Rebar', quantity: 1, estimatedRate: 1, wbsItemId: wB.id }] }, admin);
    expect(bad.status).toBe(400);
    expect((await call('post', '/procurement/purchase-requests', { number: 'PR-E2E-1', projectId: A.id, items: [] }, admin)).status).toBe(400); // title + items required
    const pr = ok(await call('post', '/procurement/purchase-requests', { number: 'PR-E2E-2', title: 'Slab steel', projectId: A.id, items: [{ description: 'Rebar', quantity: 10, estimatedRate: 1_000, wbsItemId: wA2.id }] }, admin));
    const prFull = (await call('get', `/procurement/purchase-requests/${pr.id}`, undefined, admin)).body.data;
    expect(Number(prFull.total)).toBe(10_000);
    expect(prFull.items[0].wbsItemId).toBe(wA2.id);
    const sup = ok(await call('post', '/procurement/suppliers', { name: 'E2E Supplier' }, admin));
    ok(await call('post', '/procurement/purchase-orders', { supplierId: sup.id, projectId: A.id, status: 'ISSUED', items: [{ description: 'Rebar', quantity: 50, rate: 2_000, wbsItemId: wA2.id }] }, admin));
    const slab = (await call('get', `/finance/cost-by-wbs?projectId=${A.id}`, undefined, admin)).body.data.rows.find((r: any) => r.wbsItemId === wA2.id);
    expect(Math.round(slab.committed)).toBe(100_000);
    expect(Math.round(slab.forecast)).toBe(100_000);
  });
});

describe('quality and safety chain', () => {
  it('compliance says No data first, then a failed test raises an NCR + corrective action on the same WBS task', async () => {
    const empty = (await call('get', `/compliance/ai-risk?projectId=${B.id}`, undefined, admin)).body.data;
    expect(empty.complianceScore).toBeNull();
    const inc = ok(await call('post', '/hse/incidents', { projectId: A.id, wbsItemId: wA.id, description: 'Slip', type: 'NEAR_MISS' }, admin));
    expect(inc.wbsItemId).toBe(wA.id);
    const mt = ok(await call('post', '/qaqc/material-tests', { projectId: A.id, wbsItemId: wA.id, testType: 'CONCRETE', batchNumber: 'E2E', result: 'FAIL' }, admin));
    expect(mt.wbsItemId).toBe(wA.id);
    const ncrs = (await call('get', `/qaqc/ncrs?projectId=${A.id}`, undefined, admin)).body.data;
    expect(ncrs).toHaveLength(1);
    expect(ncrs[0].wbsItemId).toBe(wA.id);
    expect(ncrs[0].actions).toHaveLength(1);
    const comp = (await call('get', `/compliance/ai-risk?projectId=${A.id}`, undefined, admin)).body.data;
    expect(comp.complianceScore).toBeLessThan(100);
  });
});

describe('approvals', () => {
  it('one inbox with levels, typed requests, no self-approval', async () => {
    expect((await call('post', '/approvals', { title: 'x', entityType: 'free text' }, admin)).status).toBe(400);
    const ap = ok(await call('post', '/approvals', { title: 'E2E PO', entityType: 'PURCHASE_ORDER', projectId: A.id, amount: 6_000_000 }, admin));
    const inbox = (await call('get', '/approvals/inbox', undefined, admin)).body.data;
    expect(inbox.items.some((i: any) => i.title === 'E2E PO' && i.level === 2)).toBe(true);
    const self = await call('post', `/approvals/${ap.id}/approve`, {}, admin);
    expect(self.status).toBe(403);
  });
});

describe('daily plans go to people who can raise requisitions', () => {
  it('assigns, notifies and refuses ineligible assignees', async () => {
    const raisers = (await call('get', `/production/daily-plans/assignees?projectId=${A.id}`, undefined, admin)).body.data;
    expect(raisers.some((u: any) => u.id === eng.id)).toBe(true);
    expect(raisers.some((u: any) => u.id === qs.id)).toBe(false);
    expect((await call('post', '/production/daily-plans', { projectId: A.id, wbsItemId: wA.id, title: 'x', assigneeId: qs.id }, admin)).status).toBe(400);
    const plan = ok(await call('post', '/production/daily-plans', { projectId: A.id, wbsItemId: wA.id, title: 'Lay blocks', plannedQty: 40, unit: 'm2', assigneeId: eng.id }, admin));
    const row = (await call('get', `/production/daily-plans?projectId=${A.id}`, undefined, admin)).body.data.find((p: any) => p.id === plan.id);
    expect(row.assignee.fullName).toMatch(/eng/);
    expect(row.wbsItem.code).toBe('1');
    const mine = (await call('get', `/production/daily-plans?projectId=${A.id}&assigneeId=${eng.id}`, undefined, eng.token)).body.data;
    expect(mine.some((p: any) => p.id === plan.id)).toBe(true);
    const notes = (await call('get', '/notifications?pageSize=20', undefined, eng.token)).body.data;
    expect(notes.some((n: any) => /Daily plan assigned/.test(n.title))).toBe(true);
  });

  it('planned quantity defaults from the plan when left empty', async () => {
    ok(await call('post', '/planning/setup-wizard', { projectId: A.id, startDate: iso(), items: [{ code: '3.1', name: 'Foundations', unit: 'm3', quantity: 200, budgetAmount: 1_000_000, durationDays: 10 }] }, admin));
    const f = (await call('get', `/planning/wbs?projectId=${A.id}&pageSize=50`, undefined, admin)).body.data.find((w: any) => w.code === '3.1');
    const pe = ok(await call('post', '/production', { projectId: A.id, wbsItemId: f.id, actualQty: 10, date: iso() }, admin));
    expect(Number(pe.plannedQty)).toBe(20);
  });
});

describe('roles and project assignment are enforced by the server', () => {
  it('an assigned engineer only sees and touches their own project', async () => {
    const projects = (await call('get', '/projects?pageSize=100', undefined, eng.token)).body.data;
    expect(projects.map((p: any) => p.id)).toEqual([A.id]);
    expect((await call('get', `/projects/${B.id}`, undefined, eng.token)).status).toBe(403);
    expect((await call('get', `/production?projectId=${B.id}`, undefined, eng.token)).status).toBe(403);
    expect((await call('post', '/hse/incidents', { projectId: B.id, description: 'sneaky' }, eng.token)).status).toBe(403);
    const incidents = (await call('get', '/hse/incidents?pageSize=100', undefined, eng.token)).body.data;
    expect(incidents.every((i: any) => i.projectId === A.id)).toBe(true);
    const dash = (await call('get', '/dashboards/executive', undefined, eng.token)).body.data;
    expect(dash.portfolio.totalProjects).toBe(1);
    expect((await call('get', `/reports/project/${B.id}.pdf`, undefined, eng.token)).status).toBe(403);
  });

  it('permissions are enforced: a surveyor cannot raise requisitions or read payroll', async () => {
    const r = await call('post', '/requisitions', { projectId: A.id, title: 'qs', items: [{ materialId: mat.id, quantityRequested: 1, wbsItemId: wA.id }] }, qs.token);
    expect(r.status).toBe(403);
    expect((await call('get', '/payroll/runs', undefined, qs.token)).status).toBe(403);
  });
});

describe('payroll switch', () => {
  it('is off by default, only the company admin can switch it, duplicate months are blocked', async () => {
    const off = await call('get', '/payroll/runs', undefined, admin);
    expect(off.status).toBe(403);
    expect(off.body.error).toMatch(/switched off/i);
    expect((await call('get', '/auth/me', undefined, admin)).body.data.payrollEnabled).toBe(false);
    expect((await call('put', '/organization', { payrollEnabled: true }, eng.token)).status).toBe(403);
    expect((await call('put', '/organization', { payrollEnabled: true }, admin)).body.data.payrollEnabled).toBe(true);
    expect((await call('get', '/payroll/runs', undefined, admin)).status).toBe(200);
    ok(await call('post', '/payroll/runs', { periodMonth: '2031-03-01T00:00:00.000Z' }, admin));
    expect((await call('post', '/payroll/runs', { periodMonth: '2031-03-15T00:00:00.000Z' }, admin)).status).toBe(400);
    await call('put', '/organization', { payrollEnabled: false }, admin);
    expect((await call('get', '/payroll/runs', undefined, admin)).status).toBe(403);
  });
});

describe('reports', () => {
  it.each([
    ['portfolio', () => '/reports/portfolio.pdf'],
    ['project status', () => `/reports/project/${A.id}.pdf`],
    ['cost by WBS', () => `/reports/project/${A.id}/cost-wbs.pdf`],
    ['quality and safety', () => `/reports/project/${A.id}/quality-safety.pdf`],
    ['procurement', () => `/reports/project/${A.id}/procurement.pdf`],
  ])('%s PDF downloads and is a real PDF', async (_n, path) => {
    const r = await download(path(), admin);
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/pdf/);
    expect(r.buffer.slice(0, 5).toString()).toBe('%PDF-');
    expect(r.buffer.length).toBeGreaterThan(1_500);
  });

  it.each(['/reports/projects.xlsx', '/reports/projects.csv', '/reports/executive.xlsx'])('%s downloads', async (path) => {
    const r = await download(path, admin);
    expect(r.status).toBe(200);
    expect(r.buffer.length).toBeGreaterThan(100);
  });
});

describe('other consistency checks', () => {
  it('HR headcount, alerts ranking and executive snapshot respond', async () => {
    const hc = (await call('get', '/hr/headcount', undefined, admin)).body.data;
    expect(typeof hc.active).toBe('number');
    const al = (await call('get', '/ai/alerts', undefined, admin)).body.data.alerts as Array<{ severity: string }>;
    const rank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    const ranks = al.map((a) => rank[a.severity]);
    expect(ranks.every((v, i) => i === 0 || ranks[i - 1] >= v)).toBe(true);
  });

  it('purchase-order supplier balances and portfolio comparison work', async () => {
    expect((await call('get', '/procurement/supplier-balances', undefined, admin)).status).toBe(200);
    const pc = (await call('get', '/portfolio/comparison', undefined, admin)).body.data;
    expect(pc.projects.length).toBeGreaterThanOrEqual(2);
  });
});
