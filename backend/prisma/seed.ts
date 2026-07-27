// src/config/env loads dotenv itself, so DATABASE_URL is read from backend/.env
// the same way the API reads it. The app's own Prisma client is reused rather
// than opening a second connection pool.
import { prisma } from '../src/lib/prisma';
import { ensureSuperAdmin } from '../src/modules/auth/superadmin';

async function main() {
  console.log('🌱 Seeding INSPECTA BUILDOS...');

  // The only seeded account: a PLATFORM_ADMIN (cross-tenant Platform Console)
  // that also holds System Administrator in the billing-exempt host org, so it
  // can both manage every tenant and use every ERP module here. The same
  // routine runs at API boot (src/index.ts), so the login always exists.
  const result = await ensureSuperAdmin();

  console.log('✅ Seed complete.');
  if (result.renamedFrom) {
    console.log(`   Superadmin email updated: ${result.renamedFrom} → ${result.email}`);
  }
  console.log(`   Super admin login: ${result.email}`);
  console.log(
    result.passwordReset
      ? '   Password set from SEED_ADMIN_PASSWORD.'
      : '   Password left as-is (account already in use — set SEED_ADMIN_RESET_PASSWORD=true to force).',
  );
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
