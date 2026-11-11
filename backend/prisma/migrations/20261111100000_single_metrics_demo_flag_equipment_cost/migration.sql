-- AlterTable
ALTER TABLE "projects" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "equipment_usage_logs" ADD COLUMN "ratePerHour" DECIMAL(18,2),
ADD COLUMN "cost" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ncrs" ADD COLUMN "sourceType" TEXT,
ADD COLUMN "sourceId" TEXT;
