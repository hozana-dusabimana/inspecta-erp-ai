-- AI Copilot credit metering + a new Business plan tier between Professional
-- and Enterprise. Publishes the agreed RWF pricing for Trial, Starter,
-- Professional, and Enterprise. Business is seeded lazily by
-- billing.service#planPrices (the same self-heal path already used for rows
-- missing from plan_prices), because a freshly added enum value cannot be
-- referenced by an INSERT/UPDATE in the same transaction that creates it.

-- 1. New plan tier.
ALTER TYPE "OrgPlan" ADD VALUE IF NOT EXISTS 'BUSINESS';

-- 2. AI credit meter on the organization. Balance carries unused credits
--    forward; the plan's monthly allowance is added once per period by
--    aiCredits.service, not by this migration.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "aiCreditBalance"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "aiCreditPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "aiSpendLimitCredits"  INTEGER NOT NULL DEFAULT 0;

-- 3. Monthly AI credit allowance per plan, and the agreed public prices.
ALTER TABLE "plan_prices"
  ADD COLUMN IF NOT EXISTS "aiCreditsIncluded" INTEGER NOT NULL DEFAULT 0;

UPDATE "plan_prices" SET "aiCreditsIncluded" = 20 WHERE "plan" = 'TRIAL';
UPDATE "plan_prices" SET "monthlyPrice" = 150000, "annualPrice" = 1500000, "aiCreditsIncluded" = 100, "isPublic" = true
  WHERE "plan" = 'STARTER';
UPDATE "plan_prices" SET "monthlyPrice" = 250000, "annualPrice" = 2500000, "aiCreditsIncluded" = 500, "isPublic" = true
  WHERE "plan" = 'PROFESSIONAL';
UPDATE "plan_prices" SET "monthlyPrice" = 1000000, "annualPrice" = 10000000, "aiCreditsIncluded" = 5000, "isPublic" = true,
  "description" = 'Large or multi-company construction organizations — custom users, projects, integrations, and SLA. Price shown is a starting point; final pricing is scoped to your requirements.'
  WHERE "plan" = 'ENTERPRISE';

-- 4. Append-only AI-credit ledger — every balance change (usage, monthly
--    top-up, purchase, manual grant) — powers the usage view and audit trail.
CREATE TABLE IF NOT EXISTS "ai_credit_ledger" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "delta"          INTEGER NOT NULL,
  "balanceAfter"   INTEGER NOT NULL,
  "reason"         TEXT NOT NULL,
  "userId"         TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_credit_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_credit_ledger_organizationId_createdAt_idx"
  ON "ai_credit_ledger"("organizationId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_credit_ledger_organizationId_fkey') THEN
    ALTER TABLE "ai_credit_ledger"
      ADD CONSTRAINT "ai_credit_ledger_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- 5. AI-credit top-up requests (manual payment, platform-admin approved —
--    mirrors subscription_requests since there is no payment gateway).
CREATE TABLE IF NOT EXISTS "ai_credit_purchase_requests" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "requestedById"    TEXT,
  "credits"          INTEGER NOT NULL,
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
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_credit_purchase_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_credit_purchase_requests_organizationId_status_idx"
  ON "ai_credit_purchase_requests"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "ai_credit_purchase_requests_status_createdAt_idx"
  ON "ai_credit_purchase_requests"("status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_credit_purchase_requests_organizationId_fkey') THEN
    ALTER TABLE "ai_credit_purchase_requests"
      ADD CONSTRAINT "ai_credit_purchase_requests_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_credit_purchase_requests_paymentAccountId_fkey') THEN
    ALTER TABLE "ai_credit_purchase_requests"
      ADD CONSTRAINT "ai_credit_purchase_requests_paymentAccountId_fkey"
      FOREIGN KEY ("paymentAccountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
