import { prisma } from '../../lib/prisma';
import { notify } from '../notifications/notify';
import { qualityHolds } from '../../lib/safety';

/**
 * Daily report cross-checks, lateness and the missing-report watch (T2-03).
 * A flag never blocks saving: it makes the approver write down why the report is still right.
 */

const num = (v: unknown) => Number(v ?? 0);
const CONCRETE = /concrete|slab|pour|column|beam|footing|blinding/i;
const CEMENT = /cement|concrete|ready.?mix/i;

/** Local "YYYY-MM-DD" and minutes-since-midnight for a time zone (defaults to Kigali). */
export function localClock(now: Date, timeZone = 'Africa/Kigali'): { date: string; minutes: number } {
  let tz = timeZone;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch { tz = 'Africa/Kigali'; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const cutoffMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** Submitted for a past day, or after today's cut-off. */
export async function isLate(orgId: string, reportDate: Date, now = new Date()): Promise<boolean> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { dailyReportCutoff: true, timezone: true } });
  const clock = localClock(now, org?.timezone ?? undefined);
  const day = reportDate.toISOString().slice(0, 10);
  if (day < clock.date) return true;
  return day === clock.date && clock.minutes > cutoffMinutes(org?.dailyReportCutoff ?? '18:00');
}

/** Compute the cross-check flags for a saved report ("CODE: human text"). */
export async function computeReportFlags(orgId: string, reportId: string): Promise<string[]> {
  const report = await prisma.dailyReport.findFirst({ where: { id: reportId, organizationId: orgId } });
  if (!report) return [];
  const start = new Date(`${report.reportDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86400000);
  const day = { gte: start, lt: end };
  const [entries, eqLogs, issues, tests] = await Promise.all([
    prisma.productionEntry.findMany({ where: { dailyReportId: reportId }, include: { materials: { select: { materialId: true, qtyUsed: true } } } }),
    prisma.equipmentUsageLog.findMany({ where: { organizationId: orgId, sourceRef: reportId }, include: { equipment: { select: { name: true, code: true } } } }),
    prisma.materialIssue.findMany({ where: { organizationId: orgId, projectId: report.projectId, dateIssued: day, cancelledAt: null }, select: { materialId: true } }),
    prisma.materialTest.count({ where: { organizationId: orgId, projectId: report.projectId, testType: 'CONCRETE', OR: [{ sampleDate: day }, { createdAt: day }] } }),
  ]);
  const flags: string[] = [];
  const entryIds = entries.map((e) => e.id);
  const attendanceByEntry = new Map(
    (await prisma.attendance.groupBy({ by: ['productionEntryId'], where: { productionEntryId: { in: entryIds } }, _count: { _all: true } }))
      .map((g) => [g.productionEntryId as string, g._count._all]),
  );
  const matIds = [...new Set([...issues.map((i) => i.materialId), ...entries.flatMap((e) => e.materials.map((m) => m.materialId))])];
  const mats = matIds.length ? await prisma.material.findMany({ where: { id: { in: matIds } }, select: { id: true, name: true } }) : [];
  const cementIssued = mats.some((m) => CEMENT.test(m.name));

  for (const e of entries) {
    if (num(e.laborHours) > 0 && !attendanceByEntry.get(e.id)) flags.push(`LABOUR_WITHOUT_ATTENDANCE: "${e.wbsActivity}" reports ${num(e.laborHours)} labour hours with no attendance.`);
    const pour = num(e.actualQty) > 0 && (CONCRETE.test(e.wbsActivity) || /m3|m³/i.test(e.unit));
    if (pour && !cementIssued) flags.push(`CONCRETE_WITHOUT_CEMENT: "${e.wbsActivity}" poured ${num(e.actualQty)} ${e.unit} but no cement was issued that day.`);
    if (pour && tests === 0) flags.push(`POUR_WITHOUT_TEST: "${e.wbsActivity}" was poured with no concrete test sampled that day.`);
    if (num(e.plannedQty) > 0 && num(e.actualQty) > num(e.plannedQty) * 1.5) flags.push(`PROGRESS_ABOVE_PLAN: "${e.wbsActivity}" reports ${num(e.actualQty)} against ${num(e.plannedQty)} planned (over 150%).`);
  }
  const wbsIds = [...new Set(entries.map((e) => e.wbsItemId).filter(Boolean) as string[])];
  for (const w of wbsIds) {
    const holds = await qualityHolds(orgId, report.projectId, w);
    if (holds.length) flags.push(`QUALITY_HOLD: work reported on a WBS item with an open quality failure: ${holds[0]}.`);
  }
  for (const l of eqLogs) {
    const fuel = await prisma.fuelLog.count({ where: { organizationId: orgId, equipmentId: l.equipmentId, date: day } });
    if (num(l.hoursUsed) > 0 && fuel === 0) flags.push(`EQUIPMENT_WITHOUT_FUEL: ${l.equipment.code ?? ''} ${l.equipment.name} ran ${num(l.hoursUsed)} h with no fuel logged that day.`.replace(/\s+/g, ' '));
  }
  return [...new Set(flags)];
}

/** Store flags + lateness on the report and alert the approvers when something needs a look. */
export async function stampReport(orgId: string, reportId: string): Promise<{ flags: string[]; late: boolean }> {
  const report = await prisma.dailyReport.findUnique({ where: { id: reportId }, select: { reportDate: true, reportNumber: true, projectId: true } });
  if (!report) return { flags: [], late: false };
  const [flags, late] = await Promise.all([computeReportFlags(orgId, reportId), isLate(orgId, report.reportDate)]);
  await prisma.dailyReport.update({ where: { id: reportId }, data: { flags, late, submittedAt: new Date() } });
  if (flags.length || late) {
    await notify({
      organizationId: orgId, type: 'APPROVAL', severity: flags.length ? 'HIGH' : 'MEDIUM',
      title: `Daily report ${report.reportNumber} needs a look`,
      message: [late ? 'Submitted after the cut-off.' : '', ...flags.map((f) => f.split(': ').slice(1).join(': '))].filter(Boolean).join(' '),
      link: '/production', refKey: `daily-report:${reportId}`,
    }).catch(() => undefined);
  }
  return { flags, late };
}

/**
 * Missing-report watch: after the cut-off, every ACTIVE project without a report for today
 * raises one alert (to the PM and company admin). Runs on a timer; safe to call repeatedly.
 */
export async function checkMissingReports(now = new Date()): Promise<number> {
  const orgs = await prisma.organization.findMany({ where: { status: 'ACTIVE' }, select: { id: true, dailyReportCutoff: true, timezone: true } });
  let raised = 0;
  for (const o of orgs) {
    const clock = localClock(now, o.timezone ?? undefined);
    if (clock.minutes <= cutoffMinutes(o.dailyReportCutoff)) continue;
    const start = new Date(`${clock.date}T00:00:00.000Z`);
    const projects = await prisma.project.findMany({ where: { organizationId: o.id, status: 'ACTIVE', isDemo: false }, select: { id: true, code: true, name: true, managerId: true } });
    for (const p of projects) {
      const has = await prisma.dailyReport.count({ where: { organizationId: o.id, projectId: p.id, reportDate: { gte: start, lt: new Date(start.getTime() + 86400000) } } });
      if (has) continue;
      const refKey = `missing-report:${p.id}:${clock.date}`;
      if (await prisma.notification.count({ where: { organizationId: o.id, refKey } })) continue;
      await notify({
        organizationId: o.id, type: 'DELAY', severity: 'HIGH', title: `No daily report for ${p.code}`,
        message: `${p.code} ${p.name} has no daily report for ${clock.date} and the ${o.dailyReportCutoff} cut-off has passed.`,
        link: '/production', refKey,
      }).catch(() => undefined);
      if (p.managerId) {
        await notify({ organizationId: o.id, userId: p.managerId, type: 'DELAY', severity: 'HIGH', title: `No daily report for ${p.code}`, message: `No daily report for ${clock.date} after the ${o.dailyReportCutoff} cut-off.`, link: '/production', refKey: `${refKey}:pm` }).catch(() => undefined);
      }
      raised++;
    }
  }
  return raised;
}

/** What already exists for a project on a day: the report is built from these, only quantities are typed. */
export async function daySummary(orgId: string, projectId: string, dayIso: string) {
  const start = new Date(`${dayIso.slice(0, 10)}T00:00:00.000Z`);
  const day = { gte: start, lt: new Date(start.getTime() + 86400000) };
  const [attendance, issues, usage, fuel, tests, ncrs, safety, incidents, reports] = await Promise.all([
    prisma.attendance.findMany({ where: { organizationId: orgId, projectId, date: day }, include: { employee: { select: { employeeNo: true, fullName: true } } }, orderBy: { workerName: 'asc' } }),
    prisma.materialIssue.findMany({ where: { organizationId: orgId, projectId, dateIssued: day, cancelledAt: null } }),
    prisma.equipmentUsageLog.findMany({ where: { organizationId: orgId, projectId, date: day }, include: { equipment: { select: { code: true, name: true } } } }),
    prisma.fuelLog.findMany({ where: { organizationId: orgId, projectId, date: day }, include: { equipment: { select: { code: true, name: true } } } }),
    prisma.materialTest.findMany({ where: { organizationId: orgId, projectId, OR: [{ sampleDate: day }, { createdAt: day }] } }),
    prisma.ncr.findMany({ where: { organizationId: orgId, projectId, createdAt: day }, select: { id: true, number: true, description: true, status: true, severity: true } }),
    prisma.safetyInspection.findMany({ where: { organizationId: orgId, projectId, date: day } }),
    prisma.incident.findMany({ where: { organizationId: orgId, projectId, date: day }, select: { id: true, number: true, type: true, severity: true, description: true } }),
    prisma.dailyReport.findMany({ where: { organizationId: orgId, projectId, reportDate: day }, select: { id: true, reportNumber: true, status: true, flags: true, late: true } }),
  ]);
  const matNames = new Map((await prisma.material.findMany({ where: { id: { in: issues.map((i) => i.materialId) } }, select: { id: true, name: true, unit: true } })).map((m) => [m.id, m]));
  return {
    date: dayIso.slice(0, 10),
    attendance: attendance.map((a) => ({ id: a.id, name: a.employee ? `${a.employee.employeeNo ?? ''} ${a.employee.fullName}`.trim() : a.workerName, employeeId: a.employeeId, headcount: a.headcount, hours: num(a.hoursWorked), cost: num(a.cost), verified: !!a.verifiedAt })),
    labourHours: attendance.reduce((s, a) => s + a.headcount * num(a.hoursWorked), 0),
    labourCost: attendance.reduce((s, a) => s + num(a.cost), 0),
    materialIssues: issues.map((i) => ({ id: i.id, number: i.issueNumber, material: matNames.get(i.materialId)?.name ?? i.materialId, quantity: num(i.quantityIssued), unit: matNames.get(i.materialId)?.unit ?? '' })),
    equipment: usage.map((u) => ({ id: u.id, equipment: `${u.equipment.code ?? ''} ${u.equipment.name}`.trim(), hours: num(u.hoursUsed), cost: num(u.cost) })),
    fuel: fuel.map((f) => ({ id: f.id, equipment: `${f.equipment.code ?? ''} ${f.equipment.name}`.trim(), liters: num(f.liters), cost: num(f.totalCost) })),
    tests: tests.map((t) => ({ id: t.id, type: t.testType, batch: t.batchNumber, result: t.result })),
    ncrs, safetyInspections: safety.map((s) => ({ id: s.id, title: s.title, result: s.result, score: s.score })), incidents, reports,
  };
}
