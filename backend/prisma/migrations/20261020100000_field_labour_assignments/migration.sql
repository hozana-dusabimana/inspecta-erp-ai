-- AlterTable
ALTER TABLE "daily_reports" ADD COLUMN     "clientRef" TEXT;

-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "casualWorkerId" TEXT,
ADD COLUMN     "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "evidenceUrl" TEXT,
ADD COLUMN     "headcount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "productionEntryId" TEXT,
ADD COLUMN     "ratePerDay" DECIMAL(18,2),
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "wbsItemId" TEXT;

-- AlterTable
ALTER TABLE "productivity_standards" ADD COLUMN     "ratePerWorkerDay" DECIMAL(18,4),
ADD COLUMN     "standardCrewSize" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "fuel_logs" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "wbsItemId" TEXT;

-- AlterTable
ALTER TABLE "equipment_usage_logs" ADD COLUMN     "sourceRef" TEXT;

-- CreateTable
CREATE TABLE "project_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casual_workers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "nationalId" TEXT,
    "trade" TEXT,
    "dailyRate" DECIMAL(18,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "casual_workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_assignments_organizationId_idx" ON "project_assignments"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "project_assignments_userId_projectId_key" ON "project_assignments"("userId", "projectId");

-- CreateIndex
CREATE INDEX "casual_workers_organizationId_idx" ON "casual_workers"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_organizationId_clientRef_key" ON "daily_reports"("organizationId", "clientRef");

-- CreateIndex
CREATE INDEX "fuel_logs_projectId_idx" ON "fuel_logs"("projectId");

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_casualWorkerId_fkey" FOREIGN KEY ("casualWorkerId") REFERENCES "casual_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

