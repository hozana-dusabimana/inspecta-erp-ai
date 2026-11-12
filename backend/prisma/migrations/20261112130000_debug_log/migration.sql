CREATE TABLE "debug_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "secret" TEXT,
    "organizationId" TEXT,
    "userId" TEXT,
    CONSTRAINT "debug_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "debug_events_createdAt_idx" ON "debug_events"("createdAt");
CREATE INDEX "debug_events_category_createdAt_idx" ON "debug_events"("category", "createdAt");
