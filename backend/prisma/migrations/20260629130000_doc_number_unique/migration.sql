-- Module 09/10/11 spec parity: enforce unique document numbers per tenant.
-- NULLs remain allowed (Postgres treats NULLs as distinct), so rows without a
-- number (e.g. non-IPC invoices) are unaffected.
CREATE UNIQUE INDEX "pos_transactions_organizationId_receiptNumber_key" ON "pos_transactions"("organizationId", "receiptNumber");
CREATE UNIQUE INDEX "service_invoices_organizationId_invoiceNumber_key" ON "service_invoices"("organizationId", "invoiceNumber");
CREATE UNIQUE INDEX "invoices_organizationId_certificateNumber_key" ON "invoices"("organizationId", "certificateNumber");
CREATE UNIQUE INDEX "ncrs_organizationId_number_key" ON "ncrs"("organizationId", "number");
