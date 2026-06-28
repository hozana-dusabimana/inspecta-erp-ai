-- ════════════════════════════════════════════════════════════════════════════
-- BuildCore Excel parity — delta migration (M05 Payroll, M09 POS, Equipment
-- fuel/usage, GRN/Material-Issues, HSE risk-assessments/PPE-checks + field gaps).
-- This is a DELTA against the previously db-push'ed schema (the repo uses
-- `prisma db push`, so there was no baseline migration). Apply ONCE to the
-- existing database, e.g.:
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file prisma/migrations/20260628000000_buildcore_excel_parity/migration.sql
-- Fresh databases can still be provisioned with `prisma db push` from schema.prisma.
-- NOTE: the ALTER TYPE ... ADD VALUE statements (enums) must run outside an
-- explicit transaction on PostgreSQL < 12; `db execute` handles this fine on 12+.
-- ════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PosTransactionStatus" AS ENUM ('COMPLETED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TillSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "ServiceInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'AT_RISK';

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'CERTIFIED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE 'OPENING';
ALTER TYPE "MovementType" ADD VALUE 'POS_SALE';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "tinNumber" TEXT,
ADD COLUMN     "workingDaysPerWeek" INTEGER NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "clientType" TEXT NOT NULL DEFAULT 'private';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "forecastFinishDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "wbs_items" ADD COLUMN     "budgetAmount" DECIMAL(18,2),
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "certifiedAmount" DECIMAL(18,2),
ADD COLUMN     "paidDate" TIMESTAMP(3),
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "submittedDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "referenceId" TEXT,
ADD COLUMN     "runningBalance" DECIMAL(18,3),
ADD COLUMN     "wbsItemId" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "tinNumber" TEXT;

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "materialId" TEXT,
ADD COLUMN     "quantityReceived" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ncrs" ADD COLUMN     "inspectionId" TEXT,
ADD COLUMN     "reworkCost" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "involvedEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "schedule_activities" ADD COLUMN     "actualFinish" TIMESTAMP(3),
ADD COLUMN     "actualStart" TIMESTAMP(3),
ADD COLUMN     "isCriticalPath" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'present';

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "grossMonthlySalary" DECIMAL(18,2),
ADD COLUMN     "hireDate" TIMESTAMP(3),
ADD COLUMN     "medicalScheme" TEXT NOT NULL DEFAULT 'rama',
ADD COLUMN     "nationalId" TEXT;

-- AlterTable
ALTER TABLE "equipment" ADD COLUMN     "fuelType" TEXT NOT NULL DEFAULT 'diesel';

-- AlterTable
ALTER TABLE "equipment_maintenance" ADD COLUMN     "downtimeHours" DECIMAL(10,2),
ADD COLUMN     "nextDueDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "cash_flow_entries" ADD COLUMN     "isForecast" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "statutory_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rateType" TEXT NOT NULL,
    "bandFrom" DECIMAL(18,2),
    "bandTo" DECIMAL(18,2),
    "employeePct" DECIMAL(6,3),
    "employerPct" DECIMAL(6,3),
    "fixedAmount" DECIMAL(18,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statutory_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "totalGross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalPaye" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalRssbEmployee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalRssbEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "approvedById" TEXT,
    "postedToFinanceAt" TIMESTAMP(3),
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "daysWorked" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "grossSalary" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rssbPensionEmployee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rssbPensionEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rssbMaternityEmployee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rssbMaternityEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rssbMedicalEmployee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rssbMedicalEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cbhiAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "materialId" TEXT,
    "name" TEXT NOT NULL,
    "productType" TEXT NOT NULL DEFAULT 'material',
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "unitPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatApplicable" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "till_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openingFloat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "countedCash" DECIMAL(18,2),
    "expectedCash" DECIMAL(18,2),
    "variance" DECIMAL(18,2),
    "status" "TillSessionStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "till_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_transactions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tillSessionId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "clientName" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentMethod" "PosPaymentMethod" NOT NULL DEFAULT 'CASH',
    "status" "PosTransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_transaction_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "posTransactionId" TEXT NOT NULL,
    "posProductId" TEXT NOT NULL,
    "quantity" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "pos_transaction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "clientId" TEXT,
    "clientNameFreetext" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "status" "ServiceInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liters" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costPerLiter" DECIMAL(12,2),
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "odometerReading" DECIMAL(14,2),
    "supplier" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_usage_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "projectId" TEXT,
    "wbsItemId" TEXT,
    "operatorId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hoursUsed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "projectId" TEXT,
    "purchaseOrderId" TEXT,
    "quantityReceived" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,2),
    "dateReceived" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedBy" TEXT,
    "supplierName" TEXT,
    "grnNumber" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_issues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "quantityIssued" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "dateIssued" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedTo" TEXT,
    "issueNumber" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityName" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "controls" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppe_checks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "employeeId" TEXT,
    "checkDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "InspectionResult" NOT NULL DEFAULT 'PASS',
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppe_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "statutory_rates_organizationId_rateType_effectiveFrom_idx" ON "statutory_rates"("organizationId", "rateType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "payroll_runs_organizationId_idx" ON "payroll_runs"("organizationId");

-- CreateIndex
CREATE INDEX "payslips_organizationId_idx" ON "payslips"("organizationId");

-- CreateIndex
CREATE INDEX "payslips_payrollRunId_idx" ON "payslips"("payrollRunId");

-- CreateIndex
CREATE INDEX "pos_products_organizationId_idx" ON "pos_products"("organizationId");

-- CreateIndex
CREATE INDEX "till_sessions_organizationId_idx" ON "till_sessions"("organizationId");

-- CreateIndex
CREATE INDEX "pos_transactions_organizationId_idx" ON "pos_transactions"("organizationId");

-- CreateIndex
CREATE INDEX "pos_transactions_tillSessionId_idx" ON "pos_transactions"("tillSessionId");

-- CreateIndex
CREATE INDEX "pos_transaction_lines_posTransactionId_idx" ON "pos_transaction_lines"("posTransactionId");

-- CreateIndex
CREATE INDEX "service_invoices_organizationId_idx" ON "service_invoices"("organizationId");

-- CreateIndex
CREATE INDEX "fuel_logs_organizationId_idx" ON "fuel_logs"("organizationId");

-- CreateIndex
CREATE INDEX "fuel_logs_equipmentId_date_idx" ON "fuel_logs"("equipmentId", "date");

-- CreateIndex
CREATE INDEX "equipment_usage_logs_organizationId_idx" ON "equipment_usage_logs"("organizationId");

-- CreateIndex
CREATE INDEX "equipment_usage_logs_equipmentId_date_idx" ON "equipment_usage_logs"("equipmentId", "date");

-- CreateIndex
CREATE INDEX "goods_receipts_organizationId_idx" ON "goods_receipts"("organizationId");

-- CreateIndex
CREATE INDEX "goods_receipts_materialId_idx" ON "goods_receipts"("materialId");

-- CreateIndex
CREATE INDEX "material_issues_organizationId_idx" ON "material_issues"("organizationId");

-- CreateIndex
CREATE INDEX "material_issues_materialId_idx" ON "material_issues"("materialId");

-- CreateIndex
CREATE INDEX "material_issues_projectId_idx" ON "material_issues"("projectId");

-- CreateIndex
CREATE INDEX "risk_assessments_organizationId_idx" ON "risk_assessments"("organizationId");

-- CreateIndex
CREATE INDEX "risk_assessments_projectId_idx" ON "risk_assessments"("projectId");

-- CreateIndex
CREATE INDEX "ppe_checks_organizationId_idx" ON "ppe_checks"("organizationId");

-- CreateIndex
CREATE INDEX "ppe_checks_projectId_idx" ON "ppe_checks"("projectId");

-- CreateIndex
CREATE INDEX "attendances_employeeId_date_idx" ON "attendances"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_tillSessionId_fkey" FOREIGN KEY ("tillSessionId") REFERENCES "till_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_transaction_lines" ADD CONSTRAINT "pos_transaction_lines_posTransactionId_fkey" FOREIGN KEY ("posTransactionId") REFERENCES "pos_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_transaction_lines" ADD CONSTRAINT "pos_transaction_lines_posProductId_fkey" FOREIGN KEY ("posProductId") REFERENCES "pos_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_invoices" ADD CONSTRAINT "service_invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_usage_logs" ADD CONSTRAINT "equipment_usage_logs_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

