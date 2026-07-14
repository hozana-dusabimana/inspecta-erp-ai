-- Central polymorphic evidence store (Developer Memo: project_documents).
CREATE TABLE "project_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "module" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "storagePath" TEXT NOT NULL,
    "documentCategory" TEXT,
    "description" TEXT,
    "isClientVisible" BOOLEAN NOT NULL DEFAULT false,
    "uploadedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_documents_organizationId_idx" ON "project_documents"("organizationId");
CREATE INDEX "project_documents_projectId_idx" ON "project_documents"("projectId");
CREATE INDEX "project_documents_module_recordId_idx" ON "project_documents"("module", "recordId");

ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
