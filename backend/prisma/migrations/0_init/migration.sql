-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SYSTEM_ADMIN', 'PROJECT_MANAGER', 'SITE_ENGINEER', 'QUANTITY_SURVEYOR', 'STOREKEEPER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'AT_RISK', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectHealth" AS ENUM ('OPTIMAL', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('LUMP_SUM', 'UNIT_PRICE', 'COST_PLUS', 'TIME_AND_MATERIAL');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCONTRACTOR', 'OVERHEAD', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CERTIFIED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING', 'RECEIPT', 'ISSUE', 'POS_SALE', 'ADJUSTMENT', 'TRANSFER', 'RETURN', 'WASTE');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NcrStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'INVESTIGATING', 'CORRECTIVE_ACTION', 'CLOSED');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'FAIL', 'PENDING');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('NEAR_MISS', 'FIRST_AID', 'MEDICAL', 'LOST_TIME', 'FATALITY', 'PROPERTY_DAMAGE');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MITIGATING', 'CLOSED');

-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DELAY', 'COST_OVERRUN', 'LOW_STOCK', 'SAFETY_INCIDENT', 'NCR', 'GENERAL', 'APPROVAL');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FS', 'SS', 'FF', 'SF');

-- CreateEnum
CREATE TYPE "PrStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'DELIVERED', 'CLOSED');

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

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "timezone" TEXT,
    "currency" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "logoUrl" TEXT,
    "tinNumber" TEXT,
    "workingDaysPerWeek" INTEGER NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SITE_ENGINEER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientType" TEXT NOT NULL DEFAULT 'private',
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "reference" TEXT NOT NULL,
    "contractNumber" TEXT,
    "type" "ContractType" NOT NULL DEFAULT 'LUMP_SUM',
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "contractDate" TIMESTAMP(3),
    "commencementDate" TIMESTAMP(3),
    "defectsLiabilityDays" INTEGER,
    "retentionPct" DECIMAL(5,2),
    "advancePayment" DECIMAL(18,2),
    "documentsUrl" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "managerId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "projectType" TEXT,
    "category" TEXT,
    "applicationNumber" TEXT,
    "permitNumber" TEXT,
    "groundSurface" DOUBLE PRECISION,
    "groundSurfaceUnit" TEXT DEFAULT 'm²',
    "buildingSurface" DOUBLE PRECISION,
    "timezone" TEXT,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "plannedProfitMargin" DECIMAL(5,2),
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "health" "ProjectHealth" NOT NULL DEFAULT 'OPTIMAL',
    "budget" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "progressPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "forecastFinishDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wbs_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "quantity" DECIMAL(18,3),
    "budgetAmount" DECIMAL(18,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "weightPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wbs_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "code" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "markupPct" DECIMAL(5,2),
    "contingencyPct" DECIMAL(5,2),
    "budget" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dailyReportId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wbsActivity" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "equipmentId" TEXT,
    "crewId" TEXT,
    "tradeId" TEXT,
    "productivityStandardId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "plannedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "actualQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "remainingQty" DECIMAL(18,3),
    "laborHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "equipmentHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "weatherCondition" TEXT,
    "issues" TEXT,
    "delays" TEXT,
    "remarks" TEXT,
    "photos" TEXT[],
    "attachments" TEXT[],
    "createdById" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shift" TEXT,
    "weather" TEXT,
    "temperature" DOUBLE PRECISION,
    "preparedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_materials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productionEntryId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "plannedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "qtyUsed" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "wasteQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "category" "CostCategory" NOT NULL DEFAULT 'OTHER',
    "budgetType" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "costCode" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "category" "CostCategory" NOT NULL DEFAULT 'OTHER',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "isIpc" BOOLEAN NOT NULL DEFAULT false,
    "certificateNumber" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "grossValuation" DECIMAL(18,2),
    "previousCertified" DECIMAL(18,2),
    "retentionPct" DECIMAL(5,2),
    "retentionAmount" DECIMAL(18,2),
    "advanceDeduction" DECIMAL(18,2),
    "taxPct" DECIMAL(5,2),
    "netAmount" DECIMAL(18,2),
    "certifiedAmount" DECIMAL(18,2),
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedDate" TIMESTAMP(3),
    "paidDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "supplierId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "reorderLevel" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "standardCost" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "projectId" TEXT,
    "wbsItemId" TEXT,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "runningBalance" DECIMAL(18,3),
    "referenceId" TEXT,
    "reference" TEXT,
    "warehouse" TEXT,
    "requestedBy" TEXT,
    "approvedBy" TEXT,
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "tinNumber" TEXT,
    "paymentTerms" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT,
    "purchaseRequestId" TEXT,
    "number" TEXT NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'DRAFT',
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "materialId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantityReceived" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'General',
    "wbsItemId" TEXT,
    "result" "InspectionResult" NOT NULL DEFAULT 'PENDING',
    "defects" INTEGER NOT NULL DEFAULT 0,
    "inspector" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "photos" TEXT[],
    "attachments" TEXT[],
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncrs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inspectionId" TEXT,
    "number" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "reworkCost" DECIMAL(18,2),
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "status" "NcrStatus" NOT NULL DEFAULT 'OPEN',
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "responsiblePerson" TEXT,
    "dueDate" TIMESTAMP(3),
    "photos" TEXT[],
    "attachments" TEXT[],
    "raisedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncrs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT,
    "type" "IncidentType" NOT NULL DEFAULT 'NEAR_MISS',
    "severity" "Severity" NOT NULL DEFAULT 'LOW',
    "description" TEXT NOT NULL,
    "location" TEXT,
    "hazard" TEXT,
    "investigation" TEXT,
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "involvedEmployeeId" TEXT,
    "reportedBy" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "photos" TEXT[],
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toolbox_talks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "presenter" TEXT,
    "attendees" INTEGER NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toolbox_talks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "probability" INTEGER NOT NULL DEFAULT 3,
    "impact" INTEGER NOT NULL DEFAULT 3,
    "score" INTEGER NOT NULL DEFAULT 9,
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "mitigation" TEXT,
    "owner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "url" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "NotificationType" NOT NULL DEFAULT 'GENERAL',
    "severity" "Severity" NOT NULL DEFAULT 'LOW',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 1,
    "predecessors" TEXT[],
    "progressPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "finishDate" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualFinish" TIMESTAMP(3),
    "isCriticalPath" BOOLEAN NOT NULL DEFAULT false,
    "milestone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_dependencies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FS',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_diaries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weather" TEXT,
    "workforce" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_diaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "employeeId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workerName" TEXT NOT NULL,
    "trade" TEXT,
    "status" TEXT NOT NULL DEFAULT 'present',
    "hoursWorked" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'general',
    "entityId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productivity_standards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "productivityRate" DECIMAL(18,4) NOT NULL,
    "benchmarkSource" TEXT,
    "companyStandard" DECIMAL(18,4),
    "historicalStandard" DECIMAL(18,4),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productivity_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeNo" TEXT,
    "fullName" TEXT NOT NULL,
    "nationalId" TEXT,
    "tradeId" TEXT,
    "crewId" TEXT,
    "projectId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dailyWage" DECIMAL(18,2),
    "grossMonthlySalary" DECIMAL(18,2),
    "medicalScheme" TEXT NOT NULL DEFAULT 'rama',
    "hireDate" TIMESTAMP(3),
    "bankAccountNumber" TEXT,
    "skills" TEXT[],
    "certifications" TEXT[],
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wage_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "rateType" TEXT NOT NULL DEFAULT 'DAILY',
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "effectiveDate" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wage_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crews" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "foremanId" TEXT,
    "description" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "roleInCrew" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_availability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "hoursAvailable" DOUBLE PRECISION,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "primaryProjectId" TEXT,
    "ownershipStatus" TEXT NOT NULL DEFAULT 'OWNED',
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "fuelType" TEXT NOT NULL DEFAULT 'diesel',
    "hourlyRate" DECIMAL(18,2),
    "dailyRate" DECIMAL(18,2),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_utilization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "projectId" TEXT,
    "periodStart" TIMESTAMP(3),
    "plannedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availableHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "utilizationPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_utilization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_maintenance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "type" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "cost" DECIMAL(18,2),
    "downtimeHours" DECIMAL(10,2),
    "nextDueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_requirements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "plannedQuantity" DECIMAL(18,3) NOT NULL,
    "requiredByDate" TIMESTAMP(3),
    "supplierId" TEXT,
    "leadTimeDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT,
    "status" "PrStatus" NOT NULL DEFAULT 'DRAFT',
    "neededByDate" TIMESTAMP(3),
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "materialId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "estimatedRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfqs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "purchaseRequestId" TEXT,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER,
    "awarded" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "purchaseOrderId" TEXT,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "deliveryDate" TIMESTAMP(3),
    "receivedBy" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "label" TEXT,
    "note" TEXT,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalBudget" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boq_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_version_items" (
    "id" TEXT NOT NULL,
    "boqVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "markupPct" DECIMAL(5,2),
    "contingencyPct" DECIMAL(5,2),
    "budget" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "boq_version_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_flow_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "CashDirection" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isForecast" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_flow_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_tests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT,
    "supplierId" TEXT,
    "testType" TEXT NOT NULL DEFAULT 'CONCRETE',
    "batchNumber" TEXT,
    "sampleDate" TIMESTAMP(3),
    "resultDate" TIMESTAMP(3),
    "result" "InspectionResult" NOT NULL DEFAULT 'PENDING',
    "labName" TEXT,
    "certificateNumber" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ncrId" TEXT,
    "projectId" TEXT,
    "description" TEXT NOT NULL,
    "responsiblePerson" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "verification" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reworks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsItemId" TEXT,
    "ncrId" TEXT,
    "activity" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "equipmentCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reworkCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppe_issues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "employeeId" TEXT,
    "ppeType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppe_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_inspections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "template" TEXT,
    "inspector" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "InspectionResult" NOT NULL DEFAULT 'PENDING',
    "score" DOUBLE PRECISION,
    "findings" TEXT,
    "correctiveAction" TEXT,
    "photos" TEXT[],
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "docType" TEXT NOT NULL DEFAULT 'METHOD_STATEMENT',
    "title" TEXT NOT NULL,
    "reference" TEXT,
    "version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "fileUrl" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_email_key" ON "users"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "clients_organizationId_idx" ON "clients"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_projectId_key" ON "contracts"("projectId");

-- CreateIndex
CREATE INDEX "contracts_organizationId_idx" ON "contracts"("organizationId");

-- CreateIndex
CREATE INDEX "projects_organizationId_idx" ON "projects"("organizationId");

-- CreateIndex
CREATE INDEX "projects_clientId_idx" ON "projects"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organizationId_code_key" ON "projects"("organizationId", "code");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_entity_idx" ON "audit_logs"("organizationId", "entity");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "wbs_items_organizationId_idx" ON "wbs_items"("organizationId");

-- CreateIndex
CREATE INDEX "wbs_items_projectId_idx" ON "wbs_items"("projectId");

-- CreateIndex
CREATE INDEX "boq_items_organizationId_idx" ON "boq_items"("organizationId");

-- CreateIndex
CREATE INDEX "boq_items_projectId_idx" ON "boq_items"("projectId");

-- CreateIndex
CREATE INDEX "production_entries_organizationId_idx" ON "production_entries"("organizationId");

-- CreateIndex
CREATE INDEX "production_entries_projectId_date_idx" ON "production_entries"("projectId", "date");

-- CreateIndex
CREATE INDEX "daily_reports_organizationId_idx" ON "daily_reports"("organizationId");

-- CreateIndex
CREATE INDEX "daily_reports_projectId_idx" ON "daily_reports"("projectId");

-- CreateIndex
CREATE INDEX "production_materials_organizationId_idx" ON "production_materials"("organizationId");

-- CreateIndex
CREATE INDEX "production_materials_productionEntryId_idx" ON "production_materials"("productionEntryId");

-- CreateIndex
CREATE INDEX "budget_lines_organizationId_idx" ON "budget_lines"("organizationId");

-- CreateIndex
CREATE INDEX "budget_lines_organizationId_projectId_idx" ON "budget_lines"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "cost_entries_organizationId_idx" ON "cost_entries"("organizationId");

-- CreateIndex
CREATE INDEX "cost_entries_projectId_date_idx" ON "cost_entries"("projectId", "date");

-- CreateIndex
CREATE INDEX "invoices_organizationId_idx" ON "invoices"("organizationId");

-- CreateIndex
CREATE INDEX "invoices_projectId_idx" ON "invoices"("projectId");

-- CreateIndex
CREATE INDEX "invoices_organizationId_projectId_idx" ON "invoices"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "payments_organizationId_idx" ON "payments"("organizationId");

-- CreateIndex
CREATE INDEX "payments_projectId_idx" ON "payments"("projectId");

-- CreateIndex
CREATE INDEX "payments_organizationId_projectId_idx" ON "payments"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "materials_organizationId_idx" ON "materials"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "materials_organizationId_code_key" ON "materials"("organizationId", "code");

-- CreateIndex
CREATE INDEX "stock_movements_organizationId_idx" ON "stock_movements"("organizationId");

-- CreateIndex
CREATE INDEX "stock_movements_materialId_date_idx" ON "stock_movements"("materialId", "date");

-- CreateIndex
CREATE INDEX "stock_movements_organizationId_materialId_type_idx" ON "stock_movements"("organizationId", "materialId", "type");

-- CreateIndex
CREATE INDEX "suppliers_organizationId_idx" ON "suppliers"("organizationId");

-- CreateIndex
CREATE INDEX "purchase_orders_organizationId_idx" ON "purchase_orders"("organizationId");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchaseOrderId_idx" ON "purchase_order_items"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "inspections_organizationId_idx" ON "inspections"("organizationId");

-- CreateIndex
CREATE INDEX "inspections_projectId_idx" ON "inspections"("projectId");

-- CreateIndex
CREATE INDEX "ncrs_organizationId_idx" ON "ncrs"("organizationId");

-- CreateIndex
CREATE INDEX "ncrs_projectId_status_idx" ON "ncrs"("projectId", "status");

-- CreateIndex
CREATE INDEX "incidents_organizationId_idx" ON "incidents"("organizationId");

-- CreateIndex
CREATE INDEX "incidents_projectId_idx" ON "incidents"("projectId");

-- CreateIndex
CREATE INDEX "incidents_organizationId_projectId_idx" ON "incidents"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "toolbox_talks_organizationId_idx" ON "toolbox_talks"("organizationId");

-- CreateIndex
CREATE INDEX "toolbox_talks_projectId_idx" ON "toolbox_talks"("projectId");

-- CreateIndex
CREATE INDEX "risks_organizationId_idx" ON "risks"("organizationId");

-- CreateIndex
CREATE INDEX "risks_projectId_status_idx" ON "risks"("projectId", "status");

-- CreateIndex
CREATE INDEX "documents_organizationId_idx" ON "documents"("organizationId");

-- CreateIndex
CREATE INDEX "documents_projectId_idx" ON "documents"("projectId");

-- CreateIndex
CREATE INDEX "notifications_organizationId_isRead_idx" ON "notifications"("organizationId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "schedule_activities_organizationId_idx" ON "schedule_activities"("organizationId");

-- CreateIndex
CREATE INDEX "schedule_activities_projectId_idx" ON "schedule_activities"("projectId");

-- CreateIndex
CREATE INDEX "schedule_dependencies_organizationId_idx" ON "schedule_dependencies"("organizationId");

-- CreateIndex
CREATE INDEX "schedule_dependencies_projectId_idx" ON "schedule_dependencies"("projectId");

-- CreateIndex
CREATE INDEX "site_diaries_organizationId_idx" ON "site_diaries"("organizationId");

-- CreateIndex
CREATE INDEX "site_diaries_projectId_date_idx" ON "site_diaries"("projectId", "date");

-- CreateIndex
CREATE INDEX "field_tasks_organizationId_idx" ON "field_tasks"("organizationId");

-- CreateIndex
CREATE INDEX "field_tasks_projectId_status_idx" ON "field_tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "attendances_organizationId_idx" ON "attendances"("organizationId");

-- CreateIndex
CREATE INDEX "attendances_projectId_date_idx" ON "attendances"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_employeeId_date_key" ON "attendances"("employeeId", "date");

-- CreateIndex
CREATE INDEX "approval_requests_organizationId_status_idx" ON "approval_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "productivity_standards_organizationId_idx" ON "productivity_standards"("organizationId");

-- CreateIndex
CREATE INDEX "trades_organizationId_idx" ON "trades"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeNo_key" ON "employees"("employeeNo");

-- CreateIndex
CREATE INDEX "employees_organizationId_idx" ON "employees"("organizationId");

-- CreateIndex
CREATE INDEX "wage_rates_organizationId_idx" ON "wage_rates"("organizationId");

-- CreateIndex
CREATE INDEX "crews_organizationId_idx" ON "crews"("organizationId");

-- CreateIndex
CREATE INDEX "crew_members_organizationId_idx" ON "crew_members"("organizationId");

-- CreateIndex
CREATE INDEX "labor_availability_organizationId_idx" ON "labor_availability"("organizationId");

-- CreateIndex
CREATE INDEX "equipment_categories_organizationId_idx" ON "equipment_categories"("organizationId");

-- CreateIndex
CREATE INDEX "equipment_organizationId_idx" ON "equipment"("organizationId");

-- CreateIndex
CREATE INDEX "equipment_utilization_organizationId_idx" ON "equipment_utilization"("organizationId");

-- CreateIndex
CREATE INDEX "equipment_maintenance_organizationId_idx" ON "equipment_maintenance"("organizationId");

-- CreateIndex
CREATE INDEX "material_requirements_organizationId_idx" ON "material_requirements"("organizationId");

-- CreateIndex
CREATE INDEX "material_requirements_projectId_idx" ON "material_requirements"("projectId");

-- CreateIndex
CREATE INDEX "purchase_requests_organizationId_idx" ON "purchase_requests"("organizationId");

-- CreateIndex
CREATE INDEX "purchase_requests_projectId_idx" ON "purchase_requests"("projectId");

-- CreateIndex
CREATE INDEX "purchase_request_items_purchaseRequestId_idx" ON "purchase_request_items"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "rfqs_organizationId_idx" ON "rfqs"("organizationId");

-- CreateIndex
CREATE INDEX "rfq_quotes_organizationId_idx" ON "rfq_quotes"("organizationId");

-- CreateIndex
CREATE INDEX "deliveries_organizationId_idx" ON "deliveries"("organizationId");

-- CreateIndex
CREATE INDEX "boq_versions_organizationId_idx" ON "boq_versions"("organizationId");

-- CreateIndex
CREATE INDEX "boq_versions_projectId_idx" ON "boq_versions"("projectId");

-- CreateIndex
CREATE INDEX "boq_version_items_boqVersionId_idx" ON "boq_version_items"("boqVersionId");

-- CreateIndex
CREATE INDEX "cash_flow_entries_organizationId_idx" ON "cash_flow_entries"("organizationId");

-- CreateIndex
CREATE INDEX "cash_flow_entries_projectId_idx" ON "cash_flow_entries"("projectId");

-- CreateIndex
CREATE INDEX "material_tests_organizationId_idx" ON "material_tests"("organizationId");

-- CreateIndex
CREATE INDEX "material_tests_projectId_idx" ON "material_tests"("projectId");

-- CreateIndex
CREATE INDEX "material_tests_organizationId_projectId_idx" ON "material_tests"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "corrective_actions_organizationId_idx" ON "corrective_actions"("organizationId");

-- CreateIndex
CREATE INDEX "reworks_organizationId_idx" ON "reworks"("organizationId");

-- CreateIndex
CREATE INDEX "reworks_projectId_idx" ON "reworks"("projectId");

-- CreateIndex
CREATE INDEX "reworks_organizationId_projectId_idx" ON "reworks"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "ppe_issues_organizationId_idx" ON "ppe_issues"("organizationId");

-- CreateIndex
CREATE INDEX "safety_inspections_organizationId_idx" ON "safety_inspections"("organizationId");

-- CreateIndex
CREATE INDEX "safety_inspections_projectId_idx" ON "safety_inspections"("projectId");

-- CreateIndex
CREATE INDEX "safety_inspections_organizationId_projectId_idx" ON "safety_inspections"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "compliance_documents_organizationId_idx" ON "compliance_documents"("organizationId");

-- CreateIndex
CREATE INDEX "compliance_documents_projectId_idx" ON "compliance_documents"("projectId");

-- CreateIndex
CREATE INDEX "compliance_documents_organizationId_projectId_idx" ON "compliance_documents"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "ai_conversations_organizationId_userId_idx" ON "ai_conversations"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "ai_messages_conversationId_idx" ON "ai_messages"("conversationId");

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

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_items" ADD CONSTRAINT "wbs_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_items" ADD CONSTRAINT "wbs_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "wbs_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "wbs_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_productionEntryId_fkey" FOREIGN KEY ("productionEntryId") REFERENCES "production_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncrs" ADD CONSTRAINT "ncrs_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toolbox_talks" ADD CONSTRAINT "toolbox_talks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risks" ADD CONSTRAINT "risks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_activities" ADD CONSTRAINT "schedule_activities_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "wbs_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "schedule_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "schedule_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_diaries" ADD CONSTRAINT "site_diaries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_tasks" ADD CONSTRAINT "field_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wage_rates" ADD CONSTRAINT "wage_rates_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_availability" ADD CONSTRAINT "labor_availability_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "equipment_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_utilization" ADD CONSTRAINT "equipment_utilization_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_version_items" ADD CONSTRAINT "boq_version_items_boqVersionId_fkey" FOREIGN KEY ("boqVersionId") REFERENCES "boq_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_ncrId_fkey" FOREIGN KEY ("ncrId") REFERENCES "ncrs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

