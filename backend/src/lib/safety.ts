import { prisma } from './prisma';
import { notify } from '../modules/notifications/notify';
import { localClock } from '../modules/production/report-checks';

/**
 * ONE SAFETY & QUALITY SCORE (T2-05, T2-06). Before this, the Dashboard used 100 − 5 × incidents and
 * the HSE page used 100 − open risk scores − injuries: neither looked at failed tests, open NCRs or
 * missed inspections, so a failed concrete test and an open NCR left the score at 100.
 *
 * Score = 100 − Σ deductions (never below 0). Every deduction is listed with its reason.
 *   open incident (last 30 days)    LOW 5 · MEDIUM 10 · HIGH 20 · CRITICAL 30 (+10 lost-time / fatality)
 *   failed safety inspection (30 d) 10
 *   day without a safety inspection (last 7 working days, ACTIVE projects) 5 each, max 25
 *   open safety NCR                 10 each      open quality NCR   5 each
 *   failed material test with no passing re-test   5 each
 * Closing an incident (with evidence) or an NCR (with a passing re-test) removes its deduction.
 */
export interface Deduction { reason: string; points: number; kind: string }

const SEV: Record<string, number> = { LOW: 5, MEDIUM: 10, HIGH: 20, CRITICAL: 30 };
const SAFETY_NCR_SOURCES = ['INCIDENT', 'SAFETY_INSPECTION'];

export async function failedTestsWithoutRetest(orgId: string, scope: Record<string, unknown>) {
  const failed = await prisma.materialTest.findMany({ where: { organizationId: orgId, ...scope, result: 'FAIL', deletedAt: null } });
  if (!failed.length) return [];
  const passes = await prisma.materialTest.findMany({ where: { organizationId: orgId, retestOfId: { in: failed.map((f) => f.id) }, result: 'PASS', deletedAt: null }, select: { retestOfId: true } });
  const cleared = new Set(passes.map((p) => p.retestOfId));
  return failed.filter((f) => !cleared.has(f.id));
}

export async function safetyScore(orgId: string, opts: { projectId?: string; projectIds?: string[] | null } = {}, now = new Date()) {
  const scope: Record<string, unknown> = opts.projectId ? { projectId: opts.projectId } : opts.projectIds ? { projectId: { in: opts.projectIds } } : {};
  const since30 = new Date(now.getTime() - 30 * 86400000);
  const [incidents, failedInspections, ncrs, failedTests, projects, org] = await Promise.all([
    prisma.incident.findMany({ where: { organizationId: orgId, ...scope, closedAt: null, deletedAt: null, date: { gte: since30 } } }),
    prisma.safetyInspection.findMany({ where: { organizationId: orgId, ...scope, result: 'FAIL', deletedAt: null, date: { gte: since30 } }, select: { title: true, date: true } }),
    prisma.ncr.findMany({ where: { organizationId: orgId, ...scope, status: { not: 'CLOSED' }, deletedAt: null }, select: { number: true, sourceType: true, description: true } }),
    failedTestsWithoutRetest(orgId, scope),
    prisma.project.findMany({ where: { organizationId: orgId, status: 'ACTIVE', isDemo: false, ...(opts.projectId ? { id: opts.projectId } : opts.projectIds ? { id: { in: opts.projectIds } } : {}) }, select: { id: true, code: true, startDate: true } }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { workingDaysPerWeek: true, timezone: true } }),
  ]);
  const d: Deduction[] = [];
  for (const i of incidents) {
    const pts = (SEV[i.severity] ?? 10) + (i.type === 'LOST_TIME' || i.type === 'FATALITY' ? 10 : 0);
    d.push({ kind: 'INCIDENT', points: pts, reason: `Open ${i.severity.toLowerCase()} ${i.type.replace(/_/g, ' ').toLowerCase()} incident ${i.number ?? ''} (${i.date.toISOString().slice(0, 10)})`.replace(/\s+/g, ' ') });
  }
  for (const s of failedInspections) d.push({ kind: 'FAILED_INSPECTION', points: 10, reason: `Failed safety inspection "${s.title}" (${s.date.toISOString().slice(0, 10)})` });
  for (const n of ncrs) {
    const safety = SAFETY_NCR_SOURCES.includes(n.sourceType ?? '');
    d.push({ kind: safety ? 'SAFETY_NCR' : 'QUALITY_NCR', points: safety ? 10 : 5, reason: `Open ${safety ? 'safety' : 'quality'} NCR ${n.number}` });
  }
  for (const t of failedTests) d.push({ kind: 'FAILED_TEST', points: 5, reason: `${t.testType} test failed (batch ${t.batchNumber ?? '-'}) with no passing re-test` });

  // Missed daily safety inspections over the last 7 working days (today counts once it is over).
  const workDays = org?.workingDaysPerWeek ?? 6;
  const today = localClock(now, org?.timezone ?? undefined).date;
  if (projects.length) {
    const since7 = new Date(new Date(`${today}T00:00:00.000Z`).getTime() - 10 * 86400000);
    const inspections = await prisma.safetyInspection.findMany({ where: { organizationId: orgId, projectId: { in: projects.map((p) => p.id) }, date: { gte: since7 }, deletedAt: null }, select: { projectId: true, date: true } });
    const done = new Set(inspections.map((i) => `${i.projectId}|${i.date.toISOString().slice(0, 10)}`));
    for (const p of projects) {
      let missed = 0;
      const days: string[] = [];
      for (let back = 1; back <= 10 && days.length < 7; back++) {
        const dt = new Date(new Date(`${today}T00:00:00.000Z`).getTime() - back * 86400000);
        const dow = dt.getUTCDay(); // 0 = Sunday
        if (workDays <= 6 && dow === 0) continue;
        if (workDays <= 5 && dow === 6) continue;
        if (p.startDate && dt < new Date(p.startDate.toISOString().slice(0, 10))) continue;
        const key = dt.toISOString().slice(0, 10);
        days.push(key);
        if (!done.has(`${p.id}|${key}`)) missed++;
      }
      if (missed) d.push({ kind: 'MISSED_INSPECTION', points: Math.min(25, missed * 5), reason: `${p.code}: no safety inspection on ${missed} of the last ${days.length} working days` });
    }
  }
  const total = d.reduce((s, x) => s + x.points, 0);
  return { score: Math.max(0, 100 - total), deductions: d.sort((a, b) => b.points - a.points), counts: { openIncidents: incidents.length, openNcrs: ncrs.length, failedTestsWithoutRetest: failedTests.length } };
}

/**
 * Quality holds (T2-05 c): open NCRs and failed tests without a passing re-test. While one exists
 * on a WBS item (or project-wide when it has no WBS), payment for that work is held and new
 * progress on that item is flagged.
 */
export async function qualityHolds(orgId: string, projectId: string, wbsItemId?: string | null) {
  const wbs = wbsItemId ? { OR: [{ wbsItemId }, { wbsItemId: null }] } : {};
  const [ncrs, tests] = await Promise.all([
    prisma.ncr.findMany({ where: { organizationId: orgId, projectId, status: { not: 'CLOSED' }, deletedAt: null, ...wbs }, select: { number: true, description: true } }),
    failedTestsWithoutRetest(orgId, { projectId, ...wbs }),
  ]);
  return [
    ...ncrs.map((n) => `NCR ${n.number} is open (${n.description.slice(0, 80)})`),
    ...tests.map((t) => `${t.testType} test batch ${t.batchNumber ?? '-'} failed with no passing re-test`),
  ];
}

/** Watch: after the cut-off, an ACTIVE project with no safety inspection today alerts the CEO/admin once. */
export async function checkMissedSafetyInspections(now = new Date()): Promise<number> {
  const orgs = await prisma.organization.findMany({ where: { status: 'ACTIVE' }, select: { id: true, dailyReportCutoff: true, timezone: true } });
  let raised = 0;
  for (const o of orgs) {
    const clock = localClock(now, o.timezone ?? undefined);
    const [h, m] = o.dailyReportCutoff.split(':').map(Number);
    if (clock.minutes <= (h || 0) * 60 + (m || 0)) continue;
    const start = new Date(`${clock.date}T00:00:00.000Z`);
    const projects = await prisma.project.findMany({ where: { organizationId: o.id, status: 'ACTIVE', isDemo: false }, select: { id: true, code: true, name: true } });
    for (const p of projects) {
      const has = await prisma.safetyInspection.count({ where: { organizationId: o.id, projectId: p.id, date: { gte: start, lt: new Date(start.getTime() + 86400000) } } });
      if (has) continue;
      const refKey = `missed-safety:${p.id}:${clock.date}`;
      if (await prisma.notification.count({ where: { organizationId: o.id, refKey } })) continue;
      await notify({ organizationId: o.id, type: 'SAFETY_INCIDENT', severity: 'HIGH', title: `No safety inspection on ${p.code} today`, message: `${p.code} ${p.name} has no safety inspection for ${clock.date}. The safety score has been lowered.`, link: '/hse', refKey }).catch(() => undefined);
      raised++;
    }
  }
  return raised;
}
