-- ════════════════════════════════════════════════════════════════════════════
-- Dataset link fields — denormalized convenience FKs / lookups to match the flat
-- BuildCore sample dataset (employee→crew/project, crew foreman, equipment home
-- project, supplier category, PO→PR link). All nullable; safe on existing rows.
-- Delta migration (repo uses `prisma db push`); apply with:
--   npx prisma db execute --schema prisma/schema.prisma \
--     --file prisma/migrations/20260628120000_dataset_link_fields/migration.sql
-- ════════════════════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "category" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "purchaseRequestId" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "crewId" TEXT,
ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "crews" ADD COLUMN     "foremanId" TEXT;

-- AlterTable
ALTER TABLE "equipment" ADD COLUMN     "primaryProjectId" TEXT;
