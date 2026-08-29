-- Revised public pricing (RWF). Annual keeps the "2 months free" ratio
-- (monthly x 10). Applied as an UPDATE so already-seeded rows move to the new
-- numbers; the billing.service#planPrices self-heal path still fills any row
-- that is somehow missing.
UPDATE "plan_prices" SET "monthlyPrice" = 350000,  "annualPrice" = 3500000  WHERE "plan" = 'STARTER';
UPDATE "plan_prices" SET "monthlyPrice" = 550000,  "annualPrice" = 5500000  WHERE "plan" = 'PROFESSIONAL';
UPDATE "plan_prices" SET "monthlyPrice" = 1250000, "annualPrice" = 12500000 WHERE "plan" = 'BUSINESS';
UPDATE "plan_prices" SET "monthlyPrice" = 1750000, "annualPrice" = 17500000 WHERE "plan" = 'ENTERPRISE';
