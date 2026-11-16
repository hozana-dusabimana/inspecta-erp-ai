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
