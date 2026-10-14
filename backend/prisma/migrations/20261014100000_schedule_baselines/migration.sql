-- Schedule baselines: frozen copies of a project's schedule (activity dates and
-- durations) used to measure slippage. Additive only.

CREATE TABLE "schedule_baselines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SNAPSHOT',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_baselines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "schedule_baseline_activities" (
    "id" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "activityCode" TEXT NOT NULL,
    "activityName" TEXT NOT NULL,
    "wbsCode" TEXT,
    "durationDays" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3),
    "finishDate" TIMESTAMP(3),
    "milestone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "schedule_baseline_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_baselines_projectId_versionNo_key" ON "schedule_baselines"("projectId", "versionNo");
CREATE INDEX "schedule_baselines_organizationId_idx" ON "schedule_baselines"("organizationId");
CREATE INDEX "schedule_baselines_projectId_idx" ON "schedule_baselines"("projectId");
CREATE INDEX "schedule_baseline_activities_baselineId_idx" ON "schedule_baseline_activities"("baselineId");

ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_baseline_activities" ADD CONSTRAINT "schedule_baseline_activities_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "schedule_baselines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
