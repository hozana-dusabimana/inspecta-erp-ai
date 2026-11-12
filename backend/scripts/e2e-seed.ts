/**
 * Creates a verified, billing-exempt company with an admin for the browser tests and prints
 * E2E_EMAIL / E2E_PASSWORD lines (CI appends them to the job environment).
 *   npx tsx scripts/e2e-seed.ts >> "$GITHUB_ENV"
 */
import { prisma } from '../src/lib/prisma';
import { registerOrganization } from '../src/modules/auth/auth.service';

async function main() {
  const stamp = Date.now().toString(36);
  const email = `e2e-admin-${stamp}@e2e.test`;
  const password = `E2e!${Math.random().toString(36).slice(2, 10)}Zz9`;
  await registerOrganization({ organizationName: `E2E Company ${stamp}`, fullName: 'E2E Admin', email, password });
  const found = await prisma.user.findFirstOrThrow({ where: { email } });
  await prisma.user.update({ where: { id: found.id }, data: { emailVerified: true, verificationTokenHash: null } });
  await prisma.organization.update({ where: { id: found.organizationId }, data: { billingExempt: true, maxUsers: 50, maxProjects: 50 } });
  console.log(`E2E_EMAIL=${email}`);
  console.log(`E2E_PASSWORD=${password}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
