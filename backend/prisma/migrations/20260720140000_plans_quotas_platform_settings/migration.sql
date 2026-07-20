-- Commercial tiers + per-tenant quotas, and platform-wide settings.

-- 1. Plan tier.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrgPlan') THEN
    CREATE TYPE "OrgPlan" AS ENUM ('TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');
  END IF;
END
$$;

-- 2. Plan + quotas on organizations. NULL limit = unlimited.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "plan"        "OrgPlan" NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN IF NOT EXISTS "maxUsers"    INTEGER,
  ADD COLUMN IF NOT EXISTS "maxProjects" INTEGER;

-- Existing tenants predate plans; put them on ENTERPRISE with no limits so a
-- migration can never retroactively lock a paying customer out of their own data.
UPDATE "organizations" SET "plan" = 'ENTERPRISE' WHERE "createdAt" < NOW();

-- 3. Platform settings singleton.
CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id"                 TEXT NOT NULL DEFAULT 'global',
  "allowSelfSignup"    BOOLEAN NOT NULL DEFAULT true,
  "defaultCurrency"    TEXT NOT NULL DEFAULT 'RWF',
  "defaultTimezone"    TEXT,
  "supportEmail"       TEXT,
  "maintenanceMessage" TEXT,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  "updatedById"        TEXT,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_settings" ("id", "updatedAt")
VALUES ('global', NOW())
ON CONFLICT ("id") DO NOTHING;
