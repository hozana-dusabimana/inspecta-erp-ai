import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { ensureDefaultRoles } from '../src/modules/roles/roles.service';

dotenv.config();

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@inspecta.africa';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123';

async function main() {
  console.log('🌱 Seeding INSPECTA BUILDOS...');

  // A single host organization for the super admin. It is billing-exempt, so a
  // lapsed clock can never lock the platform owner out.
  const org = await prisma.organization.upsert({
    where: { slug: 'inspecta-gc-corp' },
    update: {},
    create: {
      name: 'Inspecta GC Corp', slug: 'inspecta-gc-corp',
      currency: 'RWF', country: 'Rwanda', tinNumber: '100000000', workingDaysPerWeek: 6,
      billingExempt: true,
    },
  });

  // The tenant's own editable org chart. We seed the standard role set so the
  // super admin can be put on the System Administrator role for full in-org
  // permissions — the same set a real company sees on its first login.
  await ensureDefaultRoles(org.id);
  const systemAdminRole = await prisma.roleDefinition.findFirst({
    where: { organizationId: org.id, key: 'system-admin' },
  });

  // The only seeded account. It is a PLATFORM_ADMIN (cross-tenant Platform
  // Console) AND holds the System Administrator role in this host org, so it can
  // both manage every tenant and use every ERP module here.
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: ADMIN_EMAIL } },
    update: {
      fullName: 'Platform Superadmin',
      role: Role.PLATFORM_ADMIN,
      roleId: systemAdminRole?.id ?? null,
      emailVerified: true,
    },
    create: {
      organizationId: org.id,
      email: ADMIN_EMAIL,
      fullName: 'Platform Superadmin',
      role: Role.PLATFORM_ADMIN,
      roleId: systemAdminRole?.id ?? null,
      passwordHash,
      emailVerified: true,
    },
  });

  console.log('✅ Seed complete.');
  console.log(`   Super admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
