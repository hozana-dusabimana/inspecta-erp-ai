-- AI Copilot agentic writes: a create the assistant has PREVIEWED and is
-- waiting for the user to confirm. Nothing is written to the target table until
-- an explicit confirmation in a later turn. TTL-bounded (expiresAt).

CREATE TABLE "ai_pending_actions" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "argsJson" JSONB NOT NULL,
    "previewJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_pending_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_pending_actions_conversationId_userId_status_idx" ON "ai_pending_actions"("conversationId", "userId", "status");
