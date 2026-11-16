-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "closeNote" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT;

-- AlterTable
ALTER TABLE "material_tests" ADD COLUMN     "retestOfId" TEXT;

-- AlterTable
ALTER TABLE "ncrs" ADD COLUMN     "closedById" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "poApprovalLimit" DECIMAL(18,2) NOT NULL DEFAULT 10000000;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "flags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "number" TEXT NOT NULL,
    "supplierRef" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "supplierInvoiceId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_invoices_organizationId_idx" ON "supplier_invoices"("organizationId");

-- CreateIndex
CREATE INDEX "supplier_invoices_purchaseOrderId_idx" ON "supplier_invoices"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_organizationId_number_key" ON "supplier_invoices"("organizationId", "number");

-- CreateIndex
CREATE INDEX "supplier_payments_organizationId_idx" ON "supplier_payments"("organizationId");

-- CreateIndex
CREATE INDEX "supplier_payments_supplierInvoiceId_idx" ON "supplier_payments"("supplierInvoiceId");

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
