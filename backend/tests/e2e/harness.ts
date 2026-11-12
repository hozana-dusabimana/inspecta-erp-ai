import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { registerOrganization } from '../../src/modules/auth/auth.service';

/**
 * End-to-end harness: the real Express app, the real database, real HTTP-shaped calls (supertest).
 * Each run provisions a throwaway, verified company so it never touches existing data.
 * Needs DATABASE_URL (and JWT secrets) in the environment, e.g. from backend/.env or CI.
 */
export const app = createApp();

export interface Res<T = any> { status: number; body: T & { success?: boolean; data?: any; error?: string } }

export async function call(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown, token?: string): Promise<Res> {
  let r = request(app)[method](`/api${path}`);
  if (token) r = r.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) r = r.send(body as object);
  const res = await r;
  return { status: res.status, body: res.body };
}

export async function download(path: string, token: string): Promise<{ status: number; buffer: Buffer; type: string }> {
  const res = await request(app).get(`/api${path}`).set('Authorization', `Bearer ${token}`).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  return { status: res.status, buffer: res.body as Buffer, type: String(res.headers['content-type'] ?? '') };
}

const stamp = Date.now().toString(36);
export const PASSWORD = 'E2e!Passw0rd-x';

export interface Tenant { orgId: string; adminEmail: string; admin: string }

/** Creates a verified company with a company admin and returns the admin's access token. */
export async function provisionTenant(label = 'e2e'): Promise<Tenant> {
  const email = `${label}-${stamp}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
  await registerOrganization({ organizationName: `E2E ${label} ${stamp}`, fullName: 'E2E Admin', email, password: PASSWORD });
  const found = await prisma.user.findFirstOrThrow({ where: { email } });
  const user = await prisma.user.update({ where: { id: found.id }, data: { emailVerified: true, verificationTokenHash: null } });
  // Generous limits and no billing lock: the suite creates several projects and users.
  await prisma.organization.update({ where: { id: user.organizationId }, data: { billingExempt: true, maxUsers: 50, maxProjects: 50 } });
  const login = await call('post', '/auth/login', { email, password: PASSWORD });
  if (!login.body.data?.accessToken) throw new Error(`E2E login failed: ${JSON.stringify(login.body)}`);
  return { orgId: user.organizationId, adminEmail: email, admin: login.body.data.accessToken };
}

/** Best-effort removal of everything the run created. */
export async function destroyTenant(t: Tenant) {
  try {
    const projects = await prisma.project.findMany({ where: { organizationId: t.orgId }, select: { id: true } });
    await prisma.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });
    await prisma.organization.delete({ where: { id: t.orgId } });
  } catch {
    /* leftovers in a throwaway test database are harmless */
  }
}

/** Creates a member in the tenant and returns their token. */
export async function addMember(t: Tenant, role: 'SITE_ENGINEER' | 'QUANTITY_SURVEYOR' | 'STOREKEEPER' | 'PROJECT_MANAGER', label: string) {
  const email = `${label}-${stamp}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
  const created = await call('post', '/users', { email, fullName: `${label} person`, password: PASSWORD, role }, t.admin);
  if (!created.body.data?.id) throw new Error(`could not create ${role}: ${JSON.stringify(created.body)}`);
  const login = await call('post', '/auth/login', { email, password: PASSWORD });
  return { id: created.body.data.id as string, email, token: login.body.data.accessToken as string };
}

export async function disconnect() {
  await prisma.$disconnect();
}
