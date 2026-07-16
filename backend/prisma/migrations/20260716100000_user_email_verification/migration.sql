-- Email verification for self-service company signup.
-- emailVerified defaults to true: every user that already exists (seeded,
-- previously registered, admin-invited) stays able to log in, and only the
-- public self-registration path explicitly writes false to gate the account.
ALTER TABLE "users" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "verificationTokenHash" TEXT;
ALTER TABLE "users" ADD COLUMN "verificationExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_verificationTokenHash_key" ON "users"("verificationTokenHash");
