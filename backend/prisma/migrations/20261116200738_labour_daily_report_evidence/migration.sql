-- AlterTable
ALTER TABLE "daily_reports" ADD COLUMN     "correctionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "late" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "dailyReportCutoff" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "evidenceRules" JSONB;

-- AlterTable
ALTER TABLE "production_entries" ADD COLUMN     "flags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "project_documents" ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "capturedLat" DOUBLE PRECISION,
ADD COLUMN     "capturedLng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "activity_resources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "employeeId" TEXT,
    "crewId" TEXT,
    "equipmentId" TEXT,
    "plannedDays" DOUBLE PRECISION,
    "plannedHours" DOUBLE PRECISION,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_resources_organizationId_idx" ON "activity_resources"("organizationId");

-- CreateIndex
CREATE INDEX "activity_resources_activityId_idx" ON "activity_resources"("activityId");

-- AddForeignKey
ALTER TABLE "activity_resources" ADD CONSTRAINT "activity_resources_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "schedule_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
