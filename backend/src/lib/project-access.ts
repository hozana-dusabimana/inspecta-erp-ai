import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { Forbidden } from './errors';

/**
 * Project assignment enforcement.
 *
 * A member who has been assigned to one or more projects can only see and change
 * those projects' records. Company admins and members with no assignments are not
 * restricted (an assignment is how you narrow someone down). Platform admins are
 * never restricted.
 */

const CACHE_MS = 15_000;
const cache = new Map<string, { at: number; ids: string[] | null }>();

/** Drop a user's cached assignment list (call after assignments change). */
export function clearProjectAccessCache(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/** The project ids the user is limited to, or null when unrestricted. */
export async function loadProjectIds(user: { id: string; role: string; orgId: string; isPlatformAdmin: boolean; inspecting: boolean }): Promise<string[] | null> {
  if (user.isPlatformAdmin || user.inspecting || user.role === 'SYSTEM_ADMIN') return null;
  const hit = cache.get(user.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;
  const rows = await prisma.projectAssignment.findMany({ where: { userId: user.id, organizationId: user.orgId }, select: { projectId: true } });
  const ids = rows.length ? rows.map((r) => r.projectId) : null;
  cache.set(user.id, { at: Date.now(), ids });
  return ids;
}

export function allowedProjects(req: Request): string[] | null {
  return req.user?.projectIds ?? null;
}

/** Throws 403 when the user is restricted and the project is not one of theirs. */
export function assertProjectAccess(req: Request, projectId: unknown): void {
  const ids = allowedProjects(req);
  if (!ids || projectId === undefined || projectId === null || projectId === '') return;
  if (!ids.includes(String(projectId))) throw Forbidden('You are not assigned to this project.');
}

/** Models that have a projectId column (from the Prisma schema), for generic scoping. */
const projectScoped = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'projectId')).map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1)),
);
export const modelHasProject = (model: string) => projectScoped.has(model);
