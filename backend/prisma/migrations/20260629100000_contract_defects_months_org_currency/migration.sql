-- Contract: replace days-based defects-liability with months (Module 01 spec
-- parity), converting any existing values; add signed date.
ALTER TABLE "contracts" ADD COLUMN "defectsLiabilityMonths" INTEGER;
UPDATE "contracts"
  SET "defectsLiabilityMonths" = ROUND("defectsLiabilityDays" / 30.0)
  WHERE "defectsLiabilityDays" IS NOT NULL;
ALTER TABLE "contracts" DROP COLUMN "defectsLiabilityDays";
ALTER TABLE "contracts" ADD COLUMN "signedDate" TIMESTAMP(3);

-- Organization: currency defaults to RWF and is required (spec parity).
UPDATE "organizations" SET "currency" = 'RWF' WHERE "currency" IS NULL;
ALTER TABLE "organizations" ALTER COLUMN "currency" SET DEFAULT 'RWF';
ALTER TABLE "organizations" ALTER COLUMN "currency" SET NOT NULL;
