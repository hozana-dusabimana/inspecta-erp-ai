import { prisma } from '../../lib/prisma';
import { syncSourceCost } from '../../lib/posting';
import { syncAttendanceCost } from '../fieldops/labour';

const num = (v: unknown) => Number(v ?? 0);

/**
 * When a daily report is approved its labour (attendance x rate) and equipment (hours x machine
 * rate) become project cost — not before (T2-03 f). Idempotent: re-approving posts nothing twice.
 */
export async function postApprovedReportCosts(orgId: string, userId: string, reportId: string): Promise<void> {
  const entryIds = (await prisma.productionEntry.findMany({ where: { dailyReportId: reportId }, select: { id: true } })).map((e) => e.id);
  const attendance = await prisma.attendance.findMany({ where: { productionEntryId: { in: entryIds } }, select: { id: true } });
  for (const a of attendance) await syncAttendanceCost(orgId, userId, a.id, 'Daily report approved');

  const logs = await prisma.equipmentUsageLog.findMany({ where: { organizationId: orgId, sourceRef: reportId }, include: { equipment: { select: { name: true, hourlyRate: true, dailyRate: true } } } });
  for (const l of logs) {
    const rate = num(l.equipment.hourlyRate) || num(l.equipment.dailyRate) / 8;
    const cost = Number((num(l.hoursUsed) * rate).toFixed(2));
    await prisma.equipmentUsageLog.update({ where: { id: l.id }, data: { ratePerHour: rate || null, cost } });
    if (!l.projectId) continue;
    await prisma.$transaction((tx) => syncSourceCost(tx, 'EQUIPMENT_USAGE', l.id, 'EQUIPMENT', {
      projectId: l.projectId!, wbsItemId: l.wbsItemId, category: 'EQUIPMENT', amount: cost, date: l.date,
      description: `Equipment - ${l.equipment.name} x ${num(l.hoursUsed)} h`,
    }, { orgId, userId, reason: 'Daily report approved' }));
  }
}
