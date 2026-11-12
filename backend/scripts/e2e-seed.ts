/**
 * Creates a verified, billing-exempt company with an admin, plus a platform admin, for the browser tests and
 * prints E2E_* lines (CI appends them to the job environment).
 *   npx tsx scripts/e2e-seed.ts >> "$GITHUB_ENV"
 */
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { registerOrganization } from '../src/modules/auth/auth.service';

async function main() {
  const stamp = Date.now().toString(36);
  const email = `e2e-admin-${stamp}@e2e.test`;
  const password = `E2e!${Math.random().toString(36).slice(2, 10)}Zz9`;
  await registerOrganization({ organizationName: `E2E Company ${stamp}`, fullName: 'E2E Admin', email, password });
  const found = await prisma.user.findFirstOrThrow({ where: { email } });
  await prisma.user.update({ where: { id: found.id }, data: { emailVerified: true, verificationTokenHash: null } });
  await prisma.organization.update({ where: { id: found.organizationId }, data: { billingExempt: true, maxUsers: 50, maxProjects: 50 } });

  // A platform administrator (cross-company role) for the Platform console tests, e.g. the Debug log.
  const platformEmail = `e2e-platform-${stamp}@e2e.test`;
  const platformPassword = `E2e!${Math.random().toString(36).slice(2, 10)}Pp9`;
  await prisma.user.create({
    data: {
      organizationId: found.organizationId, email: platformEmail, fullName: 'E2E Platform Admin', role: 'PLATFORM_ADMIN',
      passwordHash: await hashPassword(platformPassword), emailVerified: true,
    },
  });

  console.log(`E2E_EMAIL=${email}`);
  console.log(`E2E_PASSWORD=${password}`);
  console.log(`E2E_PLATFORM_EMAIL=${platformEmail}`);
  console.log(`E2E_PLATFORM_PASSWORD=${platformPassword}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
