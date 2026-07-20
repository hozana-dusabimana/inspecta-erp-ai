-- Platform superadmin: a role that operates across tenants, plus tenant lifecycle
-- (suspend / reinstate) on organizations.

-- 1. New role. Postgres requires ADD VALUE to run outside a transaction block in
--    older versions; Prisma runs each statement separately so IF NOT EXISTS is
--    enough to keep this idempotent on re-runs.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN' BEFORE 'SYSTEM_ADMIN';

-- 2. Tenant lifecycle enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrgStatus') THEN
    CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
  END IF;
END
$$;

-- 3. Suspension columns on organizations.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "status"          "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "suspendedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedById"   TEXT;

CREATE INDEX IF NOT EXISTS "organizations_status_idx" ON "organizations"("status");
