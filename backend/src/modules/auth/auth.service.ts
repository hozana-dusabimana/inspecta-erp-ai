import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { hashPassword, verifyPassword } from '../../lib/password';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../../lib/jwt';
import { Unauthorized, Conflict, NotFound } from '../../lib/errors';
import { permissionsFor } from '../../auth/permissions';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

async function issueTokens(user: { id: string; organizationId: string; role: Role; email: string }) {
  const accessToken = signAccessToken({
    sub: user.id,
    orgId: user.organizationId,
    role: user.role,
    email: user.email,
  });
  const refreshToken = signRefreshToken(user.id);
  const decoded = verifyRefreshToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(((decoded as unknown as { exp: number }).exp ?? 0) * 1000),
    },
  });

  return { accessToken, refreshToken };
}

function publicUser(u: { id: string; email: string; fullName: string; role: Role; organizationId: string }) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    organizationId: u.organizationId,
    permissions: permissionsFor(u.role),
  };
}

/**
 * Registers a brand-new organization plus its first SYSTEM_ADMIN user.
 * (Inviting additional users into an existing org is handled by the users module.)
 */
export async function registerOrganization(input: {
  organizationName: string;
  fullName: string;
  email: string;
  password: string;
}) {
  const email = input.email.toLowerCase().trim();

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) throw Conflict('A user with this email already exists');

  let slug = slugify(input.organizationName) || 'org';
  if (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const passwordHash = await hashPassword(input.password);

  const { user } = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: input.organizationName, slug },
    });
    const user = await tx.user.create({
      data: {
        organizationId: org.id,
        email,
        passwordHash,
        fullName: input.fullName,
        role: Role.SYSTEM_ADMIN,
      },
    });
    return { org, user };
  });

  const tokens = await issueTokens(user);
  return { user: publicUser(user), ...tokens };
}

export async function login(email: string, password: string) {
  const normalized = email.toLowerCase().trim();
  const user = await prisma.user.findFirst({ where: { email: normalized } });
  if (!user || !user.isActive) throw Unauthorized('Invalid credentials');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw Unauthorized('Invalid credentials');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokens = await issueTokens(user);
  return { user: publicUser(user), ...tokens };
}

export async function refresh(refreshToken: string) {
  let decoded: { sub: string };
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw Unauthorized('Invalid refresh token');
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw Unauthorized('Refresh token is no longer valid');
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!user || !user.isActive) throw Unauthorized('User no longer active');

  // Rotate: revoke old, issue new.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const tokens = await issueTokens(user);
  return { user: publicUser(user), ...tokens };
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken
    .updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw NotFound('User not found');
  return publicUser(user);
}
