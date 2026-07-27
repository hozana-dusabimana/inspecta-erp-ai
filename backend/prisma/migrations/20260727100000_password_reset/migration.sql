-- Forgot-password flow. Only the SHA-256 hash of the emailed token is stored,
-- so a database leak cannot be replayed into an account takeover. Both columns
-- are nullable and cleared on use, making the token single-use.
ALTER TABLE "users" ADD COLUMN "resetTokenHash" TEXT;
ALTER TABLE "users" ADD COLUMN "resetExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_resetTokenHash_key" ON "users"("resetTokenHash");
