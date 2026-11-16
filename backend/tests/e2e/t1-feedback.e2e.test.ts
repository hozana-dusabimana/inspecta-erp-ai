import { call, provisionTenant, destroyTenant, addMember, disconnect, Tenant } from './harness';

/**
 * Acceptance tests for the T1 end-to-end feedback (document-feedback-1, 16 Nov 2026).
 * Each describe block is one Part of the developer message; each `it` one acceptance step.
 *   npm run test:e2e -- t1-feedback
 */
let t: Tenant;
let admin: string;
const ok = (res: { status: number; body: any }) => { if (![200, 201].includes(res.status)) throw new Error(`${res.status} ${JSON.stringify(res.body)}`); return res.body.data; };
const summary = async (projectId: string) => (await call('get', `/finance/summary?projectId=${projectId}`, undefined, admin)).body.data;
const stockOf = async (materialId: string) => (await call('get', '/inventory/stock', undefined, admin)).body.data.materials.find((m: any) => m.id === materialId).stock;

let P: any; let w11: any; let cement: any;
let qs: { id: string; token: string }; let pm: { id: string; token: string }; let qs2: { id: string; token: string };

beforeAll(async () => {
  t = await provisionTenant('t1');
  admin = t.admin;
  const client = ok(await call('post', '/clients', { name: 'T1 Client' }, admin));
  P = ok(await call('post', '/projects', { name: 'T1 Residential Block', budget: 100_000_000 }, admin));
  ok(await call('post', '/contracts', { clientId: client.id, projectId: P.id, reference: 'T1-CONTRACT', value: 100_000_000 }, admin));
  w11 = ok(await call('post', '/planning/wbs', { projectId: P.id, code: '1.1', name: 'Slab concrete', unit: 'm3', quantity: 100, weightPct: 100 }, admin));
  cement = ok(await call('post', '/inventory/materials', { code: 'CEM-01', name: 'Cement', unit: 'bag', unitCost: 14_000 }, admin));
  qs = await addMember(t, 'QUANTITY_SURVEYOR', 'qs');
  qs2 = await addMember(t, 'QUANTITY_SURVEYOR', 'qs2');
  pm = await addMember(t, 'PROJECT_MANAGER', 'pm');
}, 120_000);

afterAll(async () => { await destroyTenant(t); await disconnect(); }, 60_000);

describe('Part 1 — cost integrity (T1-01, T1-02)', () => {
  let grn: any; let issue: any;

  it('GRN raises stock; an issue of 50 bags at RWF 14,000 raises spend by 700,000 and lowers stock by 50', async () => {
    grn = ok(await call('post', '/inventory/grn', { materialId: cement.id, projectId: P.id, quantityReceived: 200, unitCost: 14_000 }, admin));
    expect(await stockOf(cement.id)).toBe(200);
    const before = await summary(P.id);
    issue = ok(await call('post', '/inventory/material-issues', { materialId: cement.id, projectId: P.id, wbsItemId: w11.id, quantityIssued: 50 }, admin));
    expect(issue.issueNumber).toBe('ISS-0001');
    const after = await summary(P.id);
    expect(after.actualCost - before.actualCost).toBe(700_000);
    expect(await stockOf(cement.id)).toBe(150);
  });

  it('a posted issue has no delete, and cancel without a reason is refused', async () => {
    const del = await call('delete', `/inventory/material-issues/${issue.id}`, undefined, admin);
    expect(del.status).toBe(409);
    expect(del.body.error).toMatch(/cannot be deleted/i);
    const noReason = await call('post', `/inventory/material-issues/${issue.id}/cancel`, {}, admin);
    expect(noReason.status).toBe(409);
    expect(noReason.body.error).toMatch(/reason/i);
    const edit = await call('put', `/inventory/material-issues/${issue.id}`, { quantityIssued: 60 }, admin);
    expect(edit.status).toBe(409);
  });

  it('cancelling the issue returns spend and stock in one step, and keeps the original visible', async () => {
    const before = await summary(P.id);
    ok(await call('post', `/inventory/material-issues/${issue.id}/cancel`, { reason: 'Issued to the wrong slab' }, admin));
    const after = await summary(P.id);
    expect(before.actualCost - after.actualCost).toBe(700_000);
    expect(await stockOf(cement.id)).toBe(200);
    const kept = ok(await call('get', `/inventory/material-issues/${issue.id}`, undefined, admin));
    expect(kept.cancelledAt).toBeTruthy();
    expect(kept.cancelReason).toBe('Issued to the wrong slab');
    const twice = await call('post', `/inventory/material-issues/${issue.id}/cancel`, { reason: 'again please' }, admin);
    expect(twice.status).toBe(409);
  });

  it('recreating the issue posts exactly one live cost entry', async () => {
    const again = ok(await call('post', '/inventory/material-issues', { materialId: cement.id, projectId: P.id, wbsItemId: w11.id, quantityIssued: 50 }, admin));
    const costs = ok(await call('get', `/finance/costs?projectId=${P.id}&source=MATERIAL_ISSUE&pageSize=100`, undefined, admin));
    const live = costs.filter((c: any) => !c.cancelledAt && !c.reversalOfId);
    expect(live).toHaveLength(1);
    expect(live[0].sourceRef).toBe(again.id);
    expect(Number(live[0].amount)).toBe(700_000);
    expect((await summary(P.id)).actualCost).toBe(700_000);
    const integrity = ok(await call('get', `/finance/cost-integrity?projectId=${P.id}`, undefined, admin));
    expect(integrity.duplicates).toHaveLength(0);
    expect(integrity.orphans).toHaveLength(0);
  });

  it('a second cost entry for the same source is refused by the database', async () => {
    const { prisma } = await import('../../src/lib/prisma');
    const { ensureCostIntegrityIndex } = await import('../../src/lib/posting');
    expect(await ensureCostIntegrityIndex()).toBe(true);
    const live = await prisma.costEntry.findFirstOrThrow({ where: { organizationId: t.orgId, source: 'MATERIAL_ISSUE', cancelledAt: null, reversalOfId: null } });
    await expect(prisma.costEntry.create({
      data: { organizationId: t.orgId, projectId: P.id, category: live.category, source: live.source, sourceRef: live.sourceRef, description: 'dup', amount: 1 },
    })).rejects.toThrow();
  });

  it('a GRN whose stock is already issued cannot be cancelled; once free it cancels and stock returns', async () => {
    const small = ok(await call('post', '/inventory/grn', { materialId: cement.id, projectId: P.id, quantityReceived: 10, unitCost: 14_000 }, admin));
    expect(await stockOf(cement.id)).toBe(160);
    // 150 + 10 on hand, of which 10 can go: cancelling the 200-bag GRN would leave −40.
    const blocked = await call('post', `/inventory/grn/${grn.id}/cancel`, { reason: 'Wrong supplier' }, admin);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/below zero/);
    ok(await call('post', `/inventory/grn/${small.id}/cancel`, { reason: 'Delivery note was a duplicate' }, admin));
    expect(await stockOf(cement.id)).toBe(150);
    expect((await call('delete', `/inventory/grn/${grn.id}`, undefined, admin)).status).toBe(409);
  });

  it('a manual cost entry is locked after posting and cancelled with a reversal; auto-posted costs must be cancelled at the source', async () => {
    const c = ok(await call('post', '/finance/costs', { projectId: P.id, description: 'Site office rent', amount: 250_000, category: 'OVERHEAD' }, qs.token));
    expect((await call('put', `/finance/costs/${c.id}`, { amount: 1 }, qs.token)).status).toBe(409);
    ok(await call('put', `/finance/costs/${c.id}`, { description: 'Site office rent (Nov)' }, qs.token)); // non-financial
    expect((await call('delete', `/finance/costs/${c.id}`, undefined, qs.token)).status).toBe(409);
    const before = (await summary(P.id)).actualCost;
    // Maker-checker: the surveyor who keyed it cannot cancel it, nor can another surveyor.
    const own = await call('post', `/finance/costs/${c.id}/cancel`, { reason: 'Charged to head office' }, qs.token);
    expect(own.status).toBe(403);
    expect(own.body.error).toMatch(/different person/);
    expect((await call('post', `/finance/costs/${c.id}/cancel`, { reason: 'Charged to head office' }, qs2.token)).status).toBe(403);
    ok(await call('post', `/finance/costs/${c.id}/cancel`, { reason: 'Charged to head office' }, pm.token));
    expect(before - (await summary(P.id)).actualCost).toBe(250_000);
    const auto = (ok(await call('get', `/finance/costs?projectId=${P.id}&source=MATERIAL_ISSUE`, undefined, admin)) as any[]).find((x) => !x.cancelledAt && !x.reversalOfId);
    const refused = await call('post', `/finance/costs/${auto.id}/cancel`, { reason: 'trying to bypass' }, admin);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Cancel that record instead/);
  });

  it('payments and invoices are cancelled, not deleted; a cancelled invoice leaves billed totals', async () => {
    const inv = ok(await call('post', '/finance/invoices', { projectId: P.id, amount: 5_000_000, status: 'SUBMITTED' }, admin));
    const pay = ok(await call('post', '/finance/payments', { projectId: P.id, invoiceId: inv.id, amount: 5_000_000 }, admin));
    ok(await call('post', `/finance/payments/${pay.id}/approve`, {}, pm.token));
    expect((await call('delete', `/finance/payments/${pay.id}`, undefined, admin)).status).toBe(409);
    expect((await call('delete', `/finance/invoices/${inv.id}`, undefined, admin)).status).toBe(409);
    expect((await call('post', `/finance/invoices/${inv.id}/cancel`, { reason: 'Raised in error' }, admin)).status).toBe(409); // has a payment
    const s0 = await summary(P.id);
    ok(await call('post', `/finance/payments/${pay.id}/cancel`, { reason: 'Bounced cheque' }, admin));
    const s1 = await summary(P.id);
    expect(s0.received - s1.received).toBe(5_000_000);
    ok(await call('post', `/finance/invoices/${inv.id}/cancel`, { reason: 'Raised in error' }, admin));
    expect(s1.billed - (await summary(P.id)).billed).toBe(5_000_000);
    // A draft is not posted yet: it can still be deleted.
    const draft = ok(await call('post', '/finance/invoices', { projectId: P.id, amount: 1_000 }, admin));
    expect((await call('delete', `/finance/invoices/${draft.id}`, undefined, admin)).status).toBe(200);
  });

  it('equipment usage edits reverse and repost instead of rewriting the amount', async () => {
    const eq = ok(await call('post', '/equipment/register', { name: 'T1 Mixer', hourlyRate: 10_000 }, admin));
    const log = ok(await call('post', '/equipment/usage-logs', { equipmentId: eq.id, projectId: P.id, wbsItemId: w11.id, hoursUsed: 2 }, admin));
    ok(await call('put', `/equipment/usage-logs/${log.id}`, { hoursUsed: 3 }, admin));
    const rows = ok(await call('get', `/finance/costs?projectId=${P.id}&source=EQUIPMENT_USAGE&pageSize=50`, undefined, admin)) as any[];
    expect(rows.filter((r) => !r.cancelledAt && !r.reversalOfId).map((r) => Number(r.amount))).toEqual([30_000]);
    expect(rows.some((r) => Number(r.amount) === -20_000)).toBe(true);
    ok(await call('delete', `/equipment/usage-logs/${log.id}`, undefined, admin));
    const net = (ok(await call('get', `/finance/costs?projectId=${P.id}&source=EQUIPMENT_USAGE&pageSize=50`, undefined, admin)) as any[]).reduce((s, r) => s + Number(r.amount), 0);
    expect(net).toBe(0);
  });
});


describe('Part 5 — audit log and maker-checker (T2-01, T2-02)', () => {
  it('editing a daily entry from 30 to 40 writes a log row with who, when, 30 and 40', async () => {
    const pe = ok(await call('post', '/production', { projectId: P.id, wbsItemId: w11.id, plannedQty: 100, actualQty: 30 }, admin));
    ok(await call('put', `/production/${pe.id}`, { actualQty: 40, reason: 'Recounted the pour' }, admin));
    const rows = ok(await call('get', `/audit?entity=production-entry&recordId=${pe.id}&action=UPDATE`, undefined, admin));
    expect(rows).toHaveLength(1);
    expect(rows[0].user.email).toBe(t.adminEmail);
    expect(rows[0].role).toBeTruthy();
    expect(rows[0].reason).toBe('Recounted the pour');
    expect(new Date(rows[0].createdAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    const change = rows[0].changes.find((c: any) => c.field === 'actualQty');
    expect(Number(change.from)).toBe(30);
    expect(Number(change.to)).toBe(40);
    expect(ok(await call('get', '/audit?q=Recounted', undefined, admin)).length).toBeGreaterThan(0);
  });

  it('a payment counts only after a different person with a different role approves it; the alert then disappears', async () => {
    const before = await summary(P.id);
    const pay = ok(await call('post', '/finance/payments', { projectId: P.id, amount: 1_200_000 }, qs.token));
    expect(pay.approvalStatus).toBe('PENDING');
    expect((await summary(P.id)).received).toBe(before.received);
    const mine = ok(await call('get', '/approvals/inbox', undefined, qs.token)).items.find((i: any) => i.id === pay.id);
    expect(mine.canDecide).toBe(false);
    expect(mine.blockedReason).toMatch(/You created this/);
    const self = await call('post', `/finance/payments/${pay.id}/approve`, {}, qs.token);
    expect(self.status).toBe(403);
    expect(self.body.error).toMatch(/A different person must approve it/);
    const sameRole = await call('post', `/finance/payments/${pay.id}/approve`, {}, qs2.token);
    expect(sameRole.status).toBe(403);
    expect(sameRole.body.error).toMatch(/different role/);
    const alertsBefore = ok(await call('get', '/notifications?pageSize=100', undefined, admin)).filter((n: any) => n.refKey === `payment:${pay.id}`);
    expect(alertsBefore.length).toBe(1);
    expect(ok(await call('get', '/approvals/inbox', undefined, pm.token)).items.find((i: any) => i.id === pay.id).canDecide).toBe(true);
    ok(await call('post', `/finance/payments/${pay.id}/approve`, {}, pm.token));
    expect((await summary(P.id)).received - before.received).toBe(1_200_000);
    const alertsAfter = ok(await call('get', '/notifications?pageSize=100', undefined, admin)).filter((n: any) => n.refKey === `payment:${pay.id}`);
    expect(alertsAfter).toHaveLength(0);
    expect(ok(await call('get', '/approvals/inbox', undefined, pm.token)).items.find((i: any) => i.id === pay.id)).toBeUndefined();
    const denied = ok(await call('get', '/audit?action=DENIED', undefined, admin));
    expect(denied.some((d: any) => d.entity === 'payment')).toBe(true);
  });

  it('approved requests leave the alert list at once', async () => {
    const r = ok(await call('post', '/approvals', { title: 'Hire a crane', entityType: 'OTHER', amount: 300_000 }, qs.token));
    expect(ok(await call('get', '/notifications?pageSize=100', undefined, admin)).some((n: any) => n.refKey === `approval:${r.id}`)).toBe(true);
    expect((await call('post', `/approvals/${r.id}/approve`, {}, qs2.token)).status).toBe(403);
    ok(await call('post', `/approvals/${r.id}/approve`, {}, pm.token));
    expect(ok(await call('get', '/notifications?pageSize=100', undefined, admin)).some((n: any) => n.refKey === `approval:${r.id}`)).toBe(false);
  });

  it('wage rates and wage changes need a second approver before they are used', async () => {
    const trade = ok(await call('post', '/hr/trades', { name: 'T1 Mason' }, admin));
    const rate = ok(await call('post', '/hr/wage-rates', { tradeId: trade.id, rateType: 'DAILY', amount: 8_000 }, admin));
    expect(rate.approvalStatus).toBe('PENDING');
    expect((await call('post', `/hr/wage-rates/${rate.id}/approve`, {}, admin)).status).toBe(403);
    ok(await call('post', `/hr/wage-rates/${rate.id}/approve`, {}, pm.token));
    expect((await call('put', `/hr/wage-rates/${rate.id}`, { amount: 9_000 }, admin)).status).toBe(409);
    const emp = ok(await call('post', '/hr/employees', { fullName: 'Wage Test Person', dailyWage: 10_000 }, admin));
    ok(await call('put', `/hr/employees/${emp.id}`, { dailyWage: 12_000 }, admin));
    expect(Number(ok(await call('get', `/hr/employees/${emp.id}`, undefined, admin)).dailyWage)).toBe(10_000);
    const req = ok(await call('get', '/approvals?pageSize=100', undefined, admin)).find((a: any) => a.entityType === 'WAGE_CHANGE' && a.entityId === emp.id);
    expect((await call('post', `/approvals/${req.id}/approve`, {}, admin)).status).toBe(403);
    ok(await call('post', `/approvals/${req.id}/approve`, {}, pm.token));
    expect(Number(ok(await call('get', `/hr/employees/${emp.id}`, undefined, admin)).dailyWage)).toBe(12_000);
    expect(ok(await call('get', `/audit?entity=employee-wage&recordId=${emp.id}`, undefined, admin))).toHaveLength(1);
  });

  it('nobody can change or delete a log row', async () => {
    const { prisma } = await import('../../src/lib/prisma');
    const row = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: t.orgId } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { entity: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    expect((await call('put', `/audit/${row.id}`, { entity: 'x' }, admin)).status).toBe(404);
    expect((await call('delete', `/audit/${row.id}`, undefined, admin)).status).toBe(404);
  });

  it('a forbidden direct call returns 403 and is written to the audit log', async () => {
    const se = await addMember(t, 'SITE_ENGINEER', 'se');
    const r = await call('get', '/audit', undefined, se.token);
    expect(r.status).toBe(403);
    const denied = ok(await call('get', '/audit?action=DENIED&entity=permission', undefined, admin));
    expect(denied.some((d: any) => d.userId === se.id && d.newValues.path === '/api/audit')).toBe(true);
  });
});

describe('Part 2 — one budget, honest margin, CPI (T1-03, T1-04, T1-06)', () => {
  let Q: any; let wq: any; let boq: any;
  const pages = async (id: string) => {
    const fin = (await call('get', `/finance/summary?projectId=${id}`, undefined, admin)).body.data;
    const prof = (await call('get', `/profitability/analysis?projectId=${id}`, undefined, admin)).body.data.projects[0];
    const evm = (await call('get', `/finance/evm?projectId=${id}`, undefined, admin)).body.data;
    const bud = (await call('get', `/dashboards/budget?projectId=${id}`, undefined, admin)).body.data;
    return { fin, prof, evm, bud };
  };

  beforeAll(async () => {
    const client = ok(await call('post', '/clients', { name: 'Budget Client' }, admin));
    Q = ok(await call('post', '/projects', { name: 'T1 Budget check' }, admin));
    ok(await call('post', '/contracts', { clientId: client.id, projectId: Q.id, reference: 'T1-B-CONTRACT', value: 100_000_000 }, admin));
    wq = ok(await call('post', '/planning/wbs', { projectId: Q.id, code: '1.1', name: 'Slab concrete', unit: 'm3', quantity: 100 }, admin));
    // The old "second budget": budget lines of 40M must not compete with the BOQ.
    ok(await call('post', '/finance/budget', { projectId: Q.id, description: 'Old estimate', amount: 40_000_000, category: 'OTHER' }, admin));
  });

  it('without a BOQ the project shows No cost budget and cannot go ACTIVE without confirming', async () => {
    const { fin, prof, evm } = await pages(Q.id);
    expect(fin.hasBudget).toBe(false);
    expect(prof.hasBudget).toBe(false);
    expect(evm.hasData).toBe(false);
    const refused = await call('put', `/projects/${Q.id}`, { status: 'ACTIVE' }, admin);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/no cost budget/i);
    ok(await call('put', `/projects/${Q.id}`, { status: 'ACTIVE', confirmNoBudget: true }, admin));
    const log = ok(await call('get', `/audit?entity=project&recordId=${Q.id}&action=UPDATE`, undefined, admin));
    expect(log[0].reason).toMatch(/without a cost budget/);
  });

  it('with a BOQ of RWF 10,000,000 every page shows 10,000,000 as the budget', async () => {
    boq = ok(await call('post', '/planning/boq', { projectId: Q.id, wbsItemId: wq.id, code: 'TEST-BOQ-01', description: 'Slab', unit: 'm3', quantity: 100, rate: 100_000 }, admin));
    const { fin, prof, evm, bud } = await pages(Q.id);
    expect(fin.budget).toBe(10_000_000);
    expect(prof.budget).toBe(10_000_000);
    expect(evm.bac).toBe(10_000_000);
    expect(bud.plannedCost).toBe(10_000_000);
    const byWbs = ok(await call('get', `/finance/cost-by-wbs?projectId=${Q.id}`, undefined, admin)).rows.find((r: any) => r.wbsItemId === wq.id);
    expect(byWbs.budget).toBe(10_000_000);
  });

  it('adding or removing a BOQ line changes every page', async () => {
    const extra = ok(await call('post', '/planning/boq', { projectId: Q.id, code: 'TEST-BOQ-02', description: 'Extra', quantity: 1, rate: 2_000_000 }, admin));
    expect((await pages(Q.id)).fin.budget).toBe(12_000_000);
    expect((await pages(Q.id)).prof.budget).toBe(12_000_000);
    ok(await call('delete', `/planning/boq/${extra.id}`, undefined, admin));
    const after = await pages(Q.id);
    expect(after.fin.budget).toBe(10_000_000);
    expect(after.evm.bac).toBe(10_000_000);
  });

  it('earned value is progress x budget; CPI = EV / AC; margin = contract - (AC + cost to complete)', async () => {
    ok(await call('post', '/production', { projectId: Q.id, wbsItemId: wq.id, plannedQty: 100, actualQty: 30 }, admin));
    ok(await call('post', '/finance/costs', { projectId: Q.id, description: 'Labour', amount: 959_600, category: 'LABOR' }, admin));
    const { evm, prof, fin } = await pages(Q.id);
    expect(evm.actualProgressPct).toBe(30);
    expect(evm.earnedValue).toBe(3_000_000);
    expect(evm.cpi).toBeCloseTo(3_000_000 / 959_600, 3);
    expect(evm.eac).toBe(7_959_600);
    expect(prof.forecastMargin).toBe(92_040_400);
    expect(fin.forecastProfit).toBe(92_040_400);
    ok(await call('post', '/finance/costs', { projectId: Q.id, description: 'Extra spend', amount: 1_000_000, category: 'OTHER' }, admin));
    const later = await pages(Q.id);
    expect(prof.forecastMargin - later.prof.forecastMargin).toBeGreaterThanOrEqual(1_000_000);
    expect(later.evm.cpi).toBeCloseTo(3_000_000 / 1_959_600, 3);
  });
});

describe('Part 4 — progress roll-up (T1-07)', () => {
  let R: any; let w: any; let act: any; let entry: any;
  beforeAll(async () => {
    R = ok(await call('post', '/projects', { name: 'T1 Progress check' }, admin));
    w = ok(await call('post', '/planning/wbs', { projectId: R.id, code: '1.1', name: 'Slab concrete', unit: 'm3', quantity: 100 }, admin));
    ok(await call('post', '/planning/boq', { projectId: R.id, wbsItemId: w.id, code: 'B1', description: 'Slab', quantity: 100, rate: 100_000 }, admin));
  });

  it('the only WBS item defaults to weight 100 and refuses 0', async () => {
    expect(w.weightPct).toBe(100);
    const zero = await call('put', `/planning/wbs/${w.id}`, { weightPct: 0 }, admin);
    expect(zero.status).toBe(400);
    expect(zero.body.error).toMatch(/only top-level WBS item/);
  });

  it('every schedule activity must link to a WBS item', async () => {
    const bad = await call('post', '/scheduling', { projectId: R.id, code: 'A10', name: 'Slab concrete', durationDays: 10 }, admin);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/WBS item/);
    act = ok(await call('post', '/scheduling', { projectId: R.id, code: 'A10', name: 'Slab concrete', durationDays: 10, wbsItemId: w.id }, admin));
  });

  it('a daily entry of 30 of 100 gives 30% on the WBS, the activity, the dashboard and the project row', async () => {
    entry = ok(await call('post', '/production', { projectId: R.id, wbsItemId: w.id, plannedQty: 100, actualQty: 30 }, admin));
    const wbs = ok(await call('get', `/planning/wbs/${w.id}`, undefined, admin));
    const a = ok(await call('get', `/scheduling/${act.id}`, undefined, admin));
    const row = ok(await call('get', '/projects?pageSize=100', undefined, admin)).find((p: any) => p.id === R.id);
    const evm = ok(await call('get', `/finance/evm?projectId=${R.id}`, undefined, admin));
    const rollup = ok(await call('get', `/planning/wbs/rollup?projectId=${R.id}`, undefined, admin)).items.find((x: any) => x.id === w.id);
    expect(wbs.progressPct).toBe(30);
    expect(a.progressPct).toBe(30);
    expect(row.progressPct).toBe(30);
    expect(evm.actualProgressPct).toBe(30);
    expect(evm.spi).toBe(0.3);
    expect(rollup.progress).toBe(30);
  });

  it('editing the actual quantity to 40 moves all of them to 40% and SPI to 0.40, and it is in the audit log', async () => {
    ok(await call('put', `/production/${entry.id}`, { actualQty: 40, reason: 'Corrected quantity' }, admin));
    expect(ok(await call('get', `/planning/wbs/${w.id}`, undefined, admin)).progressPct).toBe(40);
    expect(ok(await call('get', `/scheduling/${act.id}`, undefined, admin)).progressPct).toBe(40);
    expect(ok(await call('get', '/projects?pageSize=100', undefined, admin)).find((p: any) => p.id === R.id).progressPct).toBe(40);
    const evm = ok(await call('get', `/finance/evm?projectId=${R.id}`, undefined, admin));
    expect(evm.actualProgressPct).toBe(40);
    expect(evm.spi).toBe(0.4);
    const log = ok(await call('get', `/audit?entity=production-entry&recordId=${entry.id}&action=UPDATE`, undefined, admin));
    expect(log[0].changes.find((c: any) => c.field === 'actualQty')).toBeTruthy();
  });
});
