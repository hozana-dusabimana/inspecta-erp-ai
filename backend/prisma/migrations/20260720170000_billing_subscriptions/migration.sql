-- Billing & subscriptions: trial clock, RWF plan pricing, manual payment
-- accounts, and company payment requests approved by a platform admin.

-- 1. Enums.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingPeriod') THEN
    CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentAccountType') THEN
    CREATE TYPE "PaymentAccountType" AS ENUM ('MOBILE_MONEY', 'BANK');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionRequestStatus') THEN
    CREATE TYPE "SubscriptionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END
$$;

-- 2. Subscription clock on organizations.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "trialEndsAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "subscriptionEndsAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "billingExempt"      BOOLEAN NOT NULL DEFAULT false;

-- Every tenant that predates billing is exempt. Switching billing on must never
-- retroactively lock an existing customer out of their own data; a platform
-- admin can put them on a plan deliberately.
UPDATE "organizations" SET "billingExempt" = true WHERE "createdAt" < NOW();

-- 3. Plan pricing. Seeded at 0 — a platform admin sets the real RWF numbers,
--    and the billing page hides plans priced at 0.
CREATE TABLE IF NOT EXISTS "plan_prices" (
  "plan"         "OrgPlan" NOT NULL,
  "monthlyPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "annualPrice"  DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency"     TEXT NOT NULL DEFAULT 'RWF',
  "description"  TEXT,
  "isPublic"     BOOLEAN NOT NULL DEFAULT true,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("plan")
);

INSERT INTO "plan_prices" ("plan", "updatedAt", "isPublic") VALUES
  ('TRIAL', NOW(), false),
  ('STARTER', NOW(), true),
  ('PROFESSIONAL', NOW(), true),
  ('ENTERPRISE', NOW(), true)
ON CONFLICT ("plan") DO NOTHING;

-- 4. Payment destinations.
CREATE TABLE IF NOT EXISTS "payment_accounts" (
  "id"            TEXT NOT NULL,
  "type"          "PaymentAccountType" NOT NULL DEFAULT 'MOBILE_MONEY',
  "label"         TEXT NOT NULL,
  "accountName"   TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "bankName"      TEXT,
  "instructions"  TEXT,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- 5. Company payment requests.
CREATE TABLE IF NOT EXISTS "subscription_requests" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "requestedById"    TEXT,
  "plan"             "OrgPlan" NOT NULL,
  "period"           "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
  "amount"           DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency"         TEXT NOT NULL DEFAULT 'RWF',
  "paymentAccountId" TEXT,
  "payerName"        TEXT NOT NULL,
  "payerPhone"       TEXT NOT NULL,
  "reference"        TEXT NOT NULL,
  "paidAt"           TIMESTAMP(3),
  "note"             TEXT,
  "status"           "SubscriptionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById"     TEXT,
  "reviewedAt"       TIMESTAMP(3),
  "reviewNote"       TEXT,
  "activatedFrom"    TIMESTAMP(3),
  "activatedUntil"   TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "subscription_requests_organizationId_status_idx"
  ON "subscription_requests"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "subscription_requests_status_createdAt_idx"
  ON "subscription_requests"("status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_requests_organizationId_fkey') THEN
    ALTER TABLE "subscription_requests"
      ADD CONSTRAINT "subscription_requests_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_requests_paymentAccountId_fkey') THEN
    ALTER TABLE "subscription_requests"
      ADD CONSTRAINT "subscription_requests_paymentAccountId_fkey"
      FOREIGN KEY ("paymentAccountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
