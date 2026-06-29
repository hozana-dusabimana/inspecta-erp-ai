-- Purchase orders: enforce unique po_number per tenant (Module 08 spec: po_number UNIQUE).
CREATE UNIQUE INDEX "purchase_orders_organizationId_number_key" ON "purchase_orders"("organizationId", "number");

-- Purchase requests: add date_requested (spec: date_requested NOT NULL); backfill
-- existing rows from createdAt, default future rows to now().
ALTER TABLE "purchase_requests" ADD COLUMN "dateRequested" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE "purchase_requests" SET "dateRequested" = "createdAt";
