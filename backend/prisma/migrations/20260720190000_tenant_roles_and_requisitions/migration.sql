-- ═══ Tenant-defined roles ═══════════════════════════════════════════════════
-- A company builds its own org chart instead of being forced into the fixed
-- `Role` enum. Existing users keep `role_id = NULL` and therefore keep resolving
-- their permissions from the static matrix — switching this on must never change
-- what an existing account can do.
CREATE TABLE "role_definitions" (
    "id"              TEXT NOT NULL,
    "organizationId"  TEXT NOT NULL,
    "key"             TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "description"     TEXT,
    "permissions"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "baseRole"        "Role" NOT NULL DEFAULT 'SITE_ENGINEER',
    "isSystem"        BOOLEAN NOT NULL DEFAULT false,
    "isDefault"       BOOLEAN NOT NULL DEFAULT false,
    "createdBy"       TEXT,
    "updatedBy"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "role_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "role_definitions_organizationId_key_key" ON "role_definitions"("organizationId", "key");
CREATE INDEX "role_definitions_organizationId_idx" ON "role_definitions"("organizationId");
ALTER TABLE "role_definitions" ADD CONSTRAINT "role_definitions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "roleId" TEXT;
CREATE INDEX "users_roleId_idx" ON "users"("roleId");
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "role_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══ Material requisitions (internal store request) ═════════════════════════
CREATE TYPE "RequisitionStatus" AS ENUM (
    'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED',
    'PARTIALLY_ISSUED', 'ISSUED', 'CANCELLED', 'CLOSED'
);

CREATE TABLE "material_requisitions" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId"      TEXT NOT NULL,
    "number"         TEXT NOT NULL,
    "title"          TEXT,
    "status"         "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "location"       TEXT,
    "requiredByDate" TIMESTAMP(3),
    "dateRequested"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById"  TEXT,
    "submittedAt"    TIMESTAMP(3),
    "approvedById"   TEXT,
    "approvedAt"     TIMESTAMP(3),
    "decisionNote"   TEXT,
    "issuedById"     TEXT,
    "issuedAt"       TIMESTAMP(3),
    "notes"          TEXT,
    "createdBy"      TEXT,
    "updatedBy"      TEXT,
    "deletedAt"      TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "material_requisitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "material_requisitions_organizationId_number_key" ON "material_requisitions"("organizationId", "number");
CREATE INDEX "material_requisitions_organizationId_status_idx" ON "material_requisitions"("organizationId", "status");
CREATE INDEX "material_requisitions_projectId_idx" ON "material_requisitions"("projectId");

CREATE TABLE "material_requisition_items" (
    "id"                TEXT NOT NULL,
    "requisitionId"     TEXT NOT NULL,
    "materialId"        TEXT NOT NULL,
    "wbsItemId"         TEXT,
    "unit"              TEXT NOT NULL DEFAULT 'unit',
    "quantityRequested" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantityApproved"  DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantityIssued"    DECIMAL(18,3) NOT NULL DEFAULT 0,
    "note"              TEXT,
    CONSTRAINT "material_requisition_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "material_requisition_items_requisitionId_idx" ON "material_requisition_items"("requisitionId");
CREATE INDEX "material_requisition_items_materialId_idx" ON "material_requisition_items"("materialId");
ALTER TABLE "material_requisition_items" ADD CONSTRAINT "material_requisition_items_requisitionId_fkey"
    FOREIGN KEY ("requisitionId") REFERENCES "material_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_requisition_items" ADD CONSTRAINT "material_requisition_items_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trace every store drawdown back to the requisition that authorised it.
ALTER TABLE "material_issues" ADD COLUMN "requisitionId" TEXT;
CREATE INDEX "material_issues_requisitionId_idx" ON "material_issues"("requisitionId");
