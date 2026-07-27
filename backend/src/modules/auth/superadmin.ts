import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { hashPassword, verifyPassword } from '../../lib/password';
import { env } from '../../config/env';
import { ensureDefaultRoles } from '../roles/roles.service';

/**
 * The single host organization that owns the platform superadmin. It is
 * billing-exempt, so a lapsed subscription clock can never lock the platform
 * owner out of their own product.
 */
export const HOST_ORG_SLUG = 'inspecta-gc-corp';

function envFlag(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[name] ?? '');
}

/**
 * Decides whether the seeded password should be (re)written onto an account
 * that already exists.
 *
 * The rule keeps two things true at once:
 *  - `SEED_ADMIN_PASSWORD` is authoritative while the account is untouched, so
 *    a re-deploy with a corrected password actually takes effect instead of
 *    silently keeping whatever hash the first-ever seed happened to write.
 *  - Once a human has actually signed in, the password is *theirs*. A later
 *    boot must never quietly roll it back to the value in the compose file.
 *
 * `isRename` is the third case: `SEED_ADMIN_EMAIL` now names a different
 * address, so the operator is re-provisioning the superadmin identity from
 * configuration. Email and password are documented as a pair, so applying one
 * without the other produces credentials that look correct and still fail.
 *
 * `SEED_ADMIN_RESET_PASSWORD=true` is the deliberate break-glass override for a
 * genuine lockout.
 */
export function shouldSyncSeedPassword(input: {
  lastLoginAt: Date | null;
  passwordMatches: boolean;
  forceReset: boolean;
  isRename?: boolean;
}): boolean {
  if (input.forceReset) return true;
  if (input.passwordMatches) return false; // already in sync — nothing to write
  if (input.isRename) return true; // identity re-provisioned from config
  return input.lastLoginAt === null; // never used ⇒ config still owns it
}

export interface EnsureSuperAdminResult {
  email: string;
  created: boolean;
  passwordReset: boolean;
  renamedFrom?: string;
}

/**
 * Guarantees the platform superadmin exists and can sign in. Idempotent, and
 * run from BOTH `prisma/seed.ts` and the API bootstrap (src/index.ts) so the
 * account is present however the backend was started — `npm start`, `npm run
 * dev`, `docker compose up`, or a bare `node dist/index.js`.
 *
 * Beyond creating the row it also repairs the states that produce a baffling
 * "Invalid credentials" on a database that was seeded once and drifted since:
 * a deactivated or unverified account, a lost System Administrator role, or a
 * `SEED_ADMIN_EMAIL` that was changed after the first seed (which would
 * otherwise create a *second* admin rather than rename the first).
 */
export async function ensureSuperAdmin(): Promise<EnsureSuperAdminResult> {
  const email = env.seed.adminEmail.toLowerCase().trim();
  const password = env.seed.adminPassword;
  const forceReset = envFlag('SEED_ADMIN_RESET_PASSWORD');

  const org = await prisma.organization.upsert({
    where: { slug: HOST_ORG_SLUG },
    update: {},
    create: {
      name: 'Inspecta GC Corp',
      slug: HOST_ORG_SLUG,
      currency: 'RWF',
      country: 'Rwanda',
      tinNumber: '100000000',
      workingDaysPerWeek: 6,
      billingExempt: true,
    },
  });

  // The tenant's own editable org chart. Seeding the standard role set lets the
  // superadmin hold System Administrator here for full in-org permissions — the
  // same set a real company sees on its first login.
  await ensureDefaultRoles(org.id);
  const systemAdminRole = await prisma.roleDefinition.findFirst({
    where: { organizationId: org.id, key: 'system-admin' },
  });

  const byEmail = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId: org.id, email } },
  });

  // No account under the configured email — before creating one, check whether
  // this is really a rename of the existing superadmin (SEED_ADMIN_EMAIL was
  // changed between deploys). Creating a duplicate would leave the old row
  // holding the console and the new one looking broken.
  const existing =
    byEmail ??
    (await prisma.user.findFirst({
      where: { organizationId: org.id, role: Role.PLATFORM_ADMIN },
      orderBy: { createdAt: 'asc' },
    }));

  if (!existing) {
    await prisma.user.create({
      data: {
        organizationId: org.id,
        email,
        fullName: 'Platform Superadmin',
        role: Role.PLATFORM_ADMIN,
        roleId: systemAdminRole?.id ?? null,
        passwordHash: await hashPassword(password),
        emailVerified: true,
        isActive: true,
      },
    });
    return { email, created: true, passwordReset: true };
  }

  const isRename = existing.email !== email;
  const passwordMatches = await verifyPassword(password, existing.passwordHash);
  const resetPassword = shouldSyncSeedPassword({
    lastLoginAt: existing.lastLoginAt,
    passwordMatches,
    forceReset,
    isRename,
  });

  if (!resetPassword && !passwordMatches) {
    // Silence here is how "the documented credentials don't work" becomes a
    // mystery. Say so, and say how to override it.
    // eslint-disable-next-line no-console
    console.warn(
      `[superadmin] ${email} does not use SEED_ADMIN_PASSWORD — the account has been signed into, so its password was left unchanged. ` +
        'Use "Forgot password" on the login page, or redeploy once with SEED_ADMIN_RESET_PASSWORD=true.',
    );
  }

  await prisma.user.update({
    where: { id: existing.id },
    data: {
      email,
      fullName: existing.fullName?.trim() ? existing.fullName : 'Platform Superadmin',
      role: Role.PLATFORM_ADMIN,
      // Keep a deliberately assigned role; only fill the gap when there is none.
      roleId: existing.roleId ?? systemAdminRole?.id ?? null,
      // `login` rejects inactive and unverified accounts with a bare "Invalid
      // credentials" / verification error, so both are repaired here.
      isActive: true,
      emailVerified: true,
      ...(resetPassword ? { passwordHash: await hashPassword(password) } : {}),
    },
  });

  return {
    email,
    created: false,
    passwordReset: resetPassword,
    renamedFrom: isRename ? existing.email : undefined,
  };
}
