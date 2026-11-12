-- Tie cash movements, invoices and planned material requirements to a specific WBS task,
-- matching every other cost record in the system (budget lines, cost entries, issues, PO/PR lines...).
ALTER TABLE "cash_flow_entries" ADD COLUMN "wbsItemId" TEXT;
ALTER TABLE "invoices" ADD COLUMN "wbsItemId" TEXT;
ALTER TABLE "material_requirements" ADD COLUMN "wbsItemId" TEXT;
