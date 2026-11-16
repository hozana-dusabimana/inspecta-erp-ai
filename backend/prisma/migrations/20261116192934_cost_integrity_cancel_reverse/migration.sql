-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CANCEL';
ALTER TYPE "AuditAction" ADD VALUE 'REVERSE';
ALTER TYPE "AuditAction" ADD VALUE 'DENIED';

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "cost_entries" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "reversalOfId" TEXT;

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AlterTable
ALTER TABLE "material_issues" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "reversalOfId" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "reversalOfId" TEXT;

-- One live cost entry per source record (T1-01/T1-02). A second posting for the
-- same source + category is refused by the database itself. Cancelled originals
-- and their reversal rows are excluded, so cancel-and-repost stays possible.
-- If existing data already holds duplicates the index is NOT created (it would
-- fail the deploy); run `npx tsx scripts/find-duplicate-costs.ts` to list them,
-- reverse them in Finance > Cost integrity, then the next deploy creates it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "cost_entries"
    WHERE "sourceRef" IS NOT NULL AND "reversalOfId" IS NULL AND "cancelledAt" IS NULL AND "deletedAt" IS NULL
    GROUP BY "organizationId", "source", "sourceRef", "category" HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "cost_entries_one_live_per_source"
      ON "cost_entries" ("organizationId", "source", "sourceRef", "category")
      WHERE "sourceRef" IS NOT NULL AND "reversalOfId" IS NULL AND "cancelledAt" IS NULL AND "deletedAt" IS NULL;
  ELSE
    RAISE NOTICE 'cost_entries has duplicate source postings; unique index skipped until they are reversed';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "stock_movements_referenceId_idx" ON "stock_movements" ("referenceId");
CREATE INDEX IF NOT EXISTS "cost_entries_source_ref_idx" ON "cost_entries" ("organizationId", "source", "sourceRef");
