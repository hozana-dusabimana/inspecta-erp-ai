import { prisma } from '../../lib/prisma';
import { generateAutoCode } from '../../lib/crud';

/**
 * A failed inspection or material test must not stop at an alert: it raises an
 * NCR and a first corrective action so the failure is owned, tracked and
 * counted in compliance. Idempotent per source record.
 */
export async function raiseNcrFromFailure(
  orgId: string,
  userId: string,
  f: { projectId: string; sourceType: 'MATERIAL_TEST' | 'INSPECTION'; sourceId: string; description: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; wbsItemId?: string; inspectionId?: string },
) {
  const existing = await prisma.ncr.findFirst({ where: { organizationId: orgId, sourceType: f.sourceType, sourceId: f.sourceId } });
  if (existing) return existing;
  const number = await generateAutoCode('ncr', orgId, 'number', 'NCR');
  const due = new Date(Date.now() + 7 * 86400000);
  const ncr = await prisma.ncr.create({
    data: {
      organizationId: orgId, projectId: f.projectId, number, description: f.description, severity: f.severity,
      status: 'OPEN', wbsItemId: f.wbsItemId ?? null, inspectionId: f.inspectionId ?? null,
      sourceType: f.sourceType, sourceId: f.sourceId, dueDate: due, createdBy: userId, updatedBy: userId, raisedBy: userId,
    },
  });
  await prisma.correctiveAction.create({
    data: {
      organizationId: orgId, ncrId: ncr.id, projectId: f.projectId,
      description: `Investigate the failure, agree the fix and re-test (${f.description})`, dueDate: due, status: 'OPEN',
    } as never,
  });
  return ncr;
}
