-- Evidence gate flags (Developer Memo §6): a goods receipt / material issue must
-- have its signed document attached before it can be confirmed.
ALTER TABLE "goods_receipts" ADD COLUMN "confirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "material_issues" ADD COLUMN "confirmed" BOOLEAN NOT NULL DEFAULT false;
