import { Request } from 'express';
import { prisma } from './prisma';
import { BadRequest } from './errors';

/**
 * A record linked to a WBS item must also name a project, and the WBS item must
 * belong to that project — otherwise cost would be allocated to another job.
 */
export async function assertWbsInProject(data: Record<string, unknown>, req: Request): Promise<void> {
  if (!data.wbsItemId) return;
  if (!data.projectId) throw BadRequest('Choose a project when linking a WBS item');
  const wbs = await prisma.wbsItem.findFirst({
    where: { id: String(data.wbsItemId), projectId: String(data.projectId), organizationId: req.user!.orgId },
    select: { id: true },
  });
  if (!wbs) throw BadRequest('That WBS item does not belong to the selected project');
}
