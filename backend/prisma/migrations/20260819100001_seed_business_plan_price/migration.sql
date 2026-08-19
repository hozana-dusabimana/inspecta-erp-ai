-- Seed the Business plan's price row with real numbers, in its own
-- migration/transaction: 'BUSINESS' was added to the OrgPlan enum in the
-- previous migration, and Postgres will not let a value referenced by an
-- INSERT be used in the same transaction that created it.
INSERT INTO "plan_prices" ("plan", "monthlyPrice", "annualPrice", "currency", "description", "isPublic", "aiCreditsIncluded", "updatedAt")
VALUES (
  'BUSINESS', 500000, 5000000, 'RWF',
  'Advanced finance, procurement, inventory, and quality & safety for contractors running several sites at once.',
  true, 2000, NOW()
)
ON CONFLICT ("plan") DO NOTHING;
