-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "payload" JSONB;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "role" TEXT;

-- AlterTable
ALTER TABLE "boq_versions" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "decisionNote" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "refKey" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "decisionNote" TEXT;

-- AlterTable
ALTER TABLE "schedule_baselines" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "decisionNote" TEXT;

-- AlterTable
ALTER TABLE "wage_rates" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "decisionNote" TEXT;

-- CreateIndex
CREATE INDEX "notifications_organizationId_refKey_idx" ON "notifications"("organizationId", "refKey");

-- Append-only audit log (T2-01): no role, including admin, can edit or delete a row.
-- The only changes allowed are the ones the database itself makes when a parent goes away:
--   * a user is removed  -> userId set to NULL (ON DELETE SET NULL), nothing else may change;
--   * a company is removed -> its rows go with it (ON DELETE CASCADE, parent already gone).
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."userId" IS NULL AND OLD."userId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "users" WHERE id = OLD."userId")
       AND (to_jsonb(NEW) - 'userId') = (to_jsonb(OLD) - 'userId') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_logs is append-only: rows cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "organizations" WHERE id = OLD."organizationId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_logs is append-only: rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON "audit_logs";
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
