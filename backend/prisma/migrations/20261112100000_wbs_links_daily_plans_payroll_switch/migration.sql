-- Payroll is off until a company admin enables it (also switches it off for existing companies).
ALTER TABLE "organizations" ADD COLUMN "payrollEnabled" BOOLEAN NOT NULL DEFAULT false;

-- WBS links for material tests, incidents and procurement lines.
ALTER TABLE "material_tests" ADD COLUMN "wbsItemId" TEXT;
ALTER TABLE "incidents" ADD COLUMN "wbsItemId" TEXT;
ALTER TABLE "purchase_request_items" ADD COLUMN "wbsItemId" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "wbsItemId" TEXT;

-- Daily plans assigned to a person.
CREATE TABLE "daily_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "planDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "plannedQty" DECIMAL(18,3),
    "unit" TEXT,
    "assigneeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "daily_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "daily_plans_organizationId_idx" ON "daily_plans"("organizationId");
CREATE INDEX "daily_plans_projectId_planDate_idx" ON "daily_plans"("projectId", "planDate");
CREATE INDEX "daily_plans_assigneeId_idx" ON "daily_plans"("assigneeId");
ALTER TABLE "daily_plans" ADD CONSTRAINT "daily_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
