import crypto from 'crypto';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { hashPassword, verifyPassword } from '../../lib/password';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../../lib/jwt';
import { Unauthorized, Conflict, NotFound, Forbidden, BadRequest } from '../../lib/errors';
import { isPlatformRole, resolvePermissions } from '../../auth/permissions';
import { sendMail, isEmailConfigured } from '../../lib/email';
import { env } from '../../config/env';
import { getPlatformSettings } from '../platform/settings';
import { PLAN_DEFAULTS } from '../platform/plans';
import { trialEndFrom } from '../billing/billing.service';
import { ensureDefaultRoles, attachAdminRole } from '../roles/roles.service';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // links are valid for 24 hours
// Reset links are far more powerful than verification links, so they live for
// one hour rather than a day.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Issues a fresh verification token for a user, persists its hash, and emails
 * the verification link. Returns whether an email was actually dispatched.
 * When SMTP is not configured the link is logged so the flow is still
 * completable in development.
 */
async function sendVerification(user: { id: string; email: string; fullName: string }): Promise<boolean> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  await prisma.user.update({
    where: { id: user.id },
    data: {
      verificationTokenHash: hashToken(rawToken),
      verificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });

  const link = `${env.webUrl.replace(/\/$/, '')}/verify-email?token=${rawToken}`;

  if (!isEmailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn(`[auth] SMTP not configured — verification link for ${user.email}: ${link}`);
    return false;
  }

  const result = await sendMail({
    to: user.email,
    subject: 'Verify your email to activate your Inspecta account',
    text: `Hi ${user.fullName},\n\nWelcome to Inspecta. Confirm your email address to activate your company account:\n\n${link}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
    html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#141821">
      <h2 style="margin:0 0 12px">Welcome to Inspecta, ${user.fullName}</h2>
      <p style="color:#4b5563">Confirm your email address to activate your company account.</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#FC6061;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Verify my email</a>
      </p>
      <p style="color:#6b7280;font-size:12px">Or paste this link into your browser:<br>${link}</p>
      <p style="color:#9ca3af;font-size:11px;margin-top:24px">This link expires in 24 hours. If you did not create this account, you can safely ignore this email.</p>
    </div>`,
  });
  return result.ok;
}

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

/**
 * The session payload the client stores. `permissions` is what the whole UI
 * gates on, so it must be resolved the same way `authenticate` resolves it —
 * from the tenant-defined role when the account has one.
 */
async function publicUser(u: {
  id: string; email: string; fullName: string; role: Role; roleId?: string | null; organizationId: string;
}) {
  const roleDefinition = u.roleId
    ? await prisma.roleDefinition.findUnique({
        where: { id: u.roleId },
        select: { id: true, name: true, permissions: true },
      })
    : null;
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    roleId: roleDefinition?.id ?? null,
    roleName: roleDefinition?.name ?? null,
    organizationId: u.organizationId,
    isPlatformAdmin: isPlatformRole(u.role),
    permissions: resolvePermissions(u.role, roleDefinition),
  };
}

/**
 * Rejects sign-in for a member of a suspended tenant. Platform admins are exempt
 * so they can always get in to inspect or reinstate a company.
 */
async function assertOrgUsable(user: { organizationId: string; role: Role }) {
  if (isPlatformRole(user.role)) return;
  const org = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { status: true },
  });
  if (org?.status === 'SUSPENDED') {
    throw Forbidden('This company account is suspended. Contact support.');
  }
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

  // A platform admin can close self-service signup, after which tenants exist
  // only when provisioned from the console.
  const settings = await getPlatformSettings();
  if (!settings.allowSelfSignup) {
    throw Forbidden('Self-service signup is currently closed. Please contact us to request an account.');
  }

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) throw Conflict('A user with this email already exists');

  let slug = slugify(input.organizationName) || 'org';
  if (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const passwordHash = await hashPassword(input.password);

  const { user } = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug,
        currency: settings.defaultCurrency,
        timezone: settings.defaultTimezone,
        // Self-service tenants start on TRIAL with its default quotas and a
        // 14-day clock; after that they must pay to keep full access.
        maxUsers: PLAN_DEFAULTS.TRIAL.maxUsers,
        maxProjects: PLAN_DEFAULTS.TRIAL.maxProjects,
        trialEndsAt: trialEndFrom(),
      },
    });
    const user = await tx.user.create({
      data: {
        organizationId: org.id,
        email,
        passwordHash,
        fullName: input.fullName,
        role: Role.SYSTEM_ADMIN,
        emailVerified: false,
      },
    });
    return { org, user };
  });

  // Starter org chart for the new tenant; the first account holds the
  // administrator role so it can edit the rest.
  await ensureDefaultRoles(user.organizationId);
  await attachAdminRole(user.organizationId, user.id);

  // Account is created but dormant until the email is verified — no tokens yet.
  const emailed = await sendVerification(user);
  return { verificationRequired: true, email: user.email, emailed };
}

/**
 * Confirms an email-verification token, activates the account, and logs the
 * user in (returns tokens) so the new admin lands straight in their workspace.
 */
export async function verifyEmail(rawToken: string) {
  const user = await prisma.user.findUnique({
    where: { verificationTokenHash: hashToken(rawToken) },
  });
  if (!user || !user.verificationExpiresAt || user.verificationExpiresAt < new Date()) {
    throw BadRequest('This verification link is invalid or has expired. Request a new one.');
  }
  await assertOrgUsable(user);

  const verified = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      verificationTokenHash: null,
      verificationExpiresAt: null,
      lastLoginAt: new Date(),
    },
  });

  const tokens = await issueTokens(verified);
  return { user: await publicUser(verified), ...tokens };
}

/**
 * Re-sends a verification email. Always resolves the same way regardless of
 * whether the account exists or is already verified, to avoid leaking which
 * emails are registered.
 */
export async function resendVerification(rawEmail: string) {
  const email = rawEmail.toLowerCase().trim();
  const user = await prisma.user.findFirst({ where: { email } });
  if (user && !user.emailVerified) {
    await sendVerification(user);
  }
  return { sent: true };
}

export async function login(email: string, password: string) {
  const normalized = email.toLowerCase().trim();
  const user = await prisma.user.findFirst({ where: { email: normalized } });
  if (!user || !user.isActive) throw Unauthorized('Invalid credentials');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw Unauthorized('Invalid credentials');

  // Verify the password BEFORE this check so we don't reveal, to an
  // unauthenticated caller, whether an unverified email is even registered.
  if (!user.emailVerified) {
    throw Forbidden('Please verify your email before signing in. Check your inbox for the verification link.');
  }

  await assertOrgUsable(user);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokens = await issueTokens(user);
  return { user: await publicUser(user), ...tokens };
}

/**
 * Starts the forgot-password flow: issues a one-hour, single-use token, stores
 * only its hash, and emails the reset link.
 *
 * Always resolves the same way whether or not the address is registered — an
 * unauthenticated caller must not be able to use this endpoint to enumerate
 * which company emails have accounts.
 */
export async function requestPasswordReset(rawEmail: string) {
  const email = rawEmail.toLowerCase().trim();
  const user = await prisma.user.findFirst({ where: { email } });

  if (user && user.isActive) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashToken(rawToken),
        resetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    const link = `${env.webUrl.replace(/\/$/, '')}/reset-password?token=${rawToken}`;

    if (!isEmailConfigured()) {
      // Same escape hatch as verification: without SMTP the flow is still
      // completable in development from the server log.
      // eslint-disable-next-line no-console
      console.warn(`[auth] SMTP not configured — password reset link for ${user.email}: ${link}`);
    } else {
      await sendMail({
        to: user.email,
        subject: 'Reset your Inspecta password',
        text: `Hi ${user.fullName},\n\nWe received a request to reset your Inspecta password. Use the link below to choose a new one:\n\n${link}\n\nThis link expires in 1 hour and can only be used once. If you did not request a reset, you can ignore this email — your password will not change.`,
        html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#141821">
          <h2 style="margin:0 0 12px">Reset your password</h2>
          <p style="color:#4b5563">Hi ${user.fullName}, we received a request to reset your Inspecta password. Choose a new one below.</p>
          <p style="margin:24px 0">
            <a href="${link}" style="background:#FC6061;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Set a new password</a>
          </p>
          <p style="color:#6b7280;font-size:12px">Or paste this link into your browser:<br>${link}</p>
          <p style="color:#9ca3af;font-size:11px;margin-top:24px">This link expires in 1 hour and can only be used once. If you did not request a reset, you can safely ignore this email — your password will not change.</p>
        </div>`,
      });
    }
  }

  return { sent: true };
}

/**
 * Completes the forgot-password flow. Consumes the token, sets the new
 * password, and revokes every existing refresh token — if the reset was
 * triggered because the account was compromised, the attacker's session must
 * die with the old password. Returns fresh tokens so the user lands signed in.
 */
export async function resetPassword(rawToken: string, newPassword: string) {
  const user = await prisma.user.findUnique({
    where: { resetTokenHash: hashToken(rawToken) },
  });
  if (!user || !user.resetExpiresAt || user.resetExpiresAt < new Date()) {
    throw BadRequest('This reset link is invalid or has expired. Request a new one.');
  }
  if (!user.isActive) throw Forbidden('This account is deactivated. Contact your administrator.');
  await assertOrgUsable(user);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      resetTokenHash: null,
      resetExpiresAt: null,
      // Completing a reset proves control of the mailbox, which is exactly what
      // verification asks for — so an unverified account is activated here too
      // rather than being bounced at the next login.
      emailVerified: true,
      verificationTokenHash: null,
      verificationExpiresAt: null,
      lastLoginAt: new Date(),
    },
  });

  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueTokens(updated);
  return { user: await publicUser(updated), ...tokens };
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
  await assertOrgUsable(user);

  // Rotate: revoke old, issue new.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const tokens = await issueTokens(user);
  return { user: await publicUser(user), ...tokens };
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
