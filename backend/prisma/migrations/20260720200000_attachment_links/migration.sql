-- ═══ Attachments: upload OR link ════════════════════════════════════════════
-- Evidence is frequently hosted outside the ERP (a lab's online certificate, a
-- SharePoint method statement, a Drive folder). Previously project_documents
-- could only describe a file uploaded into our own storage bucket, so users
-- either skipped attaching evidence or pasted the URL into a free-text notes
-- field where nothing could find it. A row is now either:
--   sourceType = 'FILE' → storagePath set (object in remote storage)
--   sourceType = 'LINK' → externalUrl set (absolute http/https URL)
ALTER TABLE "project_documents" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'FILE';
ALTER TABLE "project_documents" ADD COLUMN "externalUrl" TEXT;

-- Existing rows are all uploaded files, so the 'FILE' default is already right.
-- storagePath becomes nullable because LINK rows have no stored object.
ALTER TABLE "project_documents" ALTER COLUMN "storagePath" DROP NOT NULL;
