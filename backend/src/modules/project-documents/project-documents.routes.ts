import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';
import { normalizeExternalUrl, signUpload } from '../../lib/storage';

// Central polymorphic evidence store (Developer Memo: project_documents).
// A row is either an uploaded FILE (the bytes live in Cloudinary; we keep its
// URL + public_id) or a LINK to evidence hosted elsewhere. Either way the DB
// holds a link, so both kinds open the same way.

const router = Router();
router.use(authenticate);

const ALLOWED_FILE_TYPES = ['photo', 'pdf', 'excel', 'doc', 'link', 'other'] as const;

// ── LIST — polymorphic + filterable (excludes soft-deleted) ──────
router.get(
  '/',
  requirePermission('document:read'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));
    const { module, recordId, projectId, fileType, sourceType, documentCategory, from, to } = req.query as Record<string, string | undefined>;
    const search = (req.query.search as string)?.trim();

    const where: Record<string, unknown> = { organizationId: req.user!.orgId, deletedAt: null };
    if (module) where.module = module;
    if (recordId) where.recordId = recordId;
    if (projectId) where.projectId = projectId;
    if (fileType) where.fileType = fileType;
    if (sourceType) where.sourceType = sourceType;
    if (documentCategory) where.documentCategory = documentCategory;
    if (from || to) where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    if (search) where.OR = [
      { fileName: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];

    const [data, total] = await Promise.all([
      prisma.projectDocument.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.projectDocument.count({ where }),
    ]);
    return paginated(res, data, { page, pageSize, total });
  }),
);

// ── Coverage — which records (for a module) already have evidence attached ──
router.get(
  '/coverage',
  requirePermission('document:read'),
  asyncHandler(async (req, res) => {
    const { module, projectId } = req.query as Record<string, string | undefined>;
    if (!module) throw BadRequest('module is required');
    const where: Record<string, unknown> = { organizationId: req.user!.orgId, module, deletedAt: null };
    if (projectId) where.projectId = projectId;
    const rows = await prisma.projectDocument.findMany({ where, select: { recordId: true }, distinct: ['recordId'] });
    return ok(res, { recordIds: rows.map((r) => r.recordId) });
  }),
);

// ── Distinct modules that actually hold evidence ─────────────────
// The register's module filter is built from this rather than a hardcoded list,
// which silently went stale every time a module gained attachments.
router.get(
  '/modules',
  requirePermission('document:read'),
  asyncHandler(async (req, res) => {
    const { projectId } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { organizationId: req.user!.orgId, deletedAt: null };
    if (projectId) where.projectId = projectId;
    const rows = await prisma.projectDocument.findMany({ where, select: { module: true }, distinct: ['module'], orderBy: { module: 'asc' } });
    return ok(res, { modules: rows.map((r) => r.module) });
  }),
);

// ── Signed direct upload (folder {org}/{project}/{module}/{record}) ──
// Returns a signature only; the browser POSTs the bytes to Cloudinary itself.
const uploadSchema = z.object({
  module: z.string().min(1),
  recordId: z.string().min(1),
  projectId: z.string().optional(),
  fileName: z.string().min(1),
});
router.post(
  '/upload-url',
  requirePermission('document:write'),
  asyncHandler(async (req, res) => {
    const { module, recordId, projectId, fileName } = uploadSchema.parse(req.body);
    const folder = `${req.user!.orgId}/${projectId ?? 'org'}/${module}/${recordId}`;
    return ok(res, signUpload(folder, fileName));
  }),
);

// ── Register an attachment (uploaded file OR external link) ──────
// Both kinds store the openable URL in `externalUrl`. FILE rows additionally
// keep Cloudinary's public_id in `storagePath` so the asset can be managed
// later; LINK rows have no public_id because we host nothing.
const createSchema = z
  .object({
    module: z.string().min(1),
    recordId: z.string().min(1),
    projectId: z.string().optional(),
    fileName: z.string().min(1),
    fileType: z.enum(ALLOWED_FILE_TYPES).optional(),
    mimeType: z.string().min(1).optional(),
    fileSizeBytes: z.number().int().nonnegative().optional(),
    sourceType: z.enum(['FILE', 'LINK']).default('FILE'),
    /** Cloudinary public_id — uploads only. */
    storagePath: z.string().min(1).optional(),
    /** The openable URL: Cloudinary's secure_url, or the pasted link. */
    externalUrl: z.string().min(1),
    documentCategory: z.string().optional(),
    description: z.string().optional(),
    isClientVisible: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.sourceType === 'FILE' && !v.storagePath) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['storagePath'], message: 'storagePath (Cloudinary public_id) is required for an uploaded file' });
    }
  });
router.post(
  '/',
  requirePermission('document:write'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (body.projectId) {
      const p = await prisma.project.findFirst({ where: { id: body.projectId, organizationId: req.user!.orgId }, select: { id: true } });
      if (!p) throw BadRequest('projectId does not belong to your organization');
    }
    const isLink = body.sourceType === 'LINK';
    const record = await prisma.projectDocument.create({
      data: {
        ...body,
        // A link has no bytes of ours to describe, so give it honest defaults
        // rather than pretending it's a file we hold.
        fileType: body.fileType ?? (isLink ? 'link' : 'other'),
        mimeType: body.mimeType ?? (isLink ? 'text/uri-list' : 'application/octet-stream'),
        externalUrl: normalizeExternalUrl(body.externalUrl),
        storagePath: isLink ? null : body.storagePath,
        fileSizeBytes: isLink ? null : body.fileSizeBytes,
        organizationId: req.user!.orgId,
        uploadedBy: req.user!.id,
      },
    });
    await auditFromRequest(req, 'CREATE', 'project-document', record.id, { newValues: record });
    return ok(res, record, 201);
  }),
);

// ── Resolve an attachment to an openable URL ─────────────────────
// Uploads and links both resolve to a URL, so this stays uniform. Kept as an
// endpoint (rather than the client using externalUrl directly) so access is
// permission-checked and tenant-scoped at open time.
router.get(
  '/:id/download',
  requirePermission('document:read'),
  asyncHandler(async (req, res) => {
    const doc = await prisma.projectDocument.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId, deletedAt: null } });
    if (!doc) throw NotFound('Document not found');
    if (!doc.externalUrl) throw BadRequest('This attachment has no file or link recorded.');
    return ok(res, { downloadUrl: doc.externalUrl, external: doc.sourceType === 'LINK' });
  }),
);

// ── Soft delete (never hard-delete) — authorized roles only ──────
router.delete(
  '/:id',
  requirePermission('document:write'),
  asyncHandler(async (req, res) => {
    const doc = await prisma.projectDocument.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId, deletedAt: null } });
    if (!doc) throw NotFound('Document not found');
    await prisma.projectDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
    await auditFromRequest(req, 'DELETE', 'project-document', doc.id, { oldValues: doc });
    return ok(res, { deleted: true });
  }),
);

// ── Export the register as Excel (metadata only, not the files) ──
router.get(
  '/export.xlsx',
  requirePermission('document:read'),
  asyncHandler(async (req, res) => {
    const { projectId, module, documentCategory, fileType, sourceType } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { organizationId: req.user!.orgId, deletedAt: null };
    if (projectId) where.projectId = projectId;
    if (module) where.module = module;
    if (documentCategory) where.documentCategory = documentCategory;
    if (fileType) where.fileType = fileType;
    if (sourceType) where.sourceType = sourceType;
    const docs = await prisma.projectDocument.findMany({ where, orderBy: { createdAt: 'desc' } });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'INSPECTA BUILDOS';
    const ws = wb.addWorksheet('Document Register');
    ws.columns = [
      { header: 'Module', key: 'module', width: 16 },
      { header: 'Record ID', key: 'recordId', width: 26 },
      { header: 'File Name', key: 'fileName', width: 30 },
      { header: 'Type', key: 'fileType', width: 10 },
      { header: 'Source', key: 'sourceType', width: 10 },
      { header: 'Link', key: 'externalUrl', width: 40 },
      { header: 'Category', key: 'documentCategory', width: 18 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Size (KB)', key: 'sizeKb', width: 12 },
      { header: 'Client Visible', key: 'isClientVisible', width: 14 },
      { header: 'Uploaded By', key: 'uploadedBy', width: 26 },
      { header: 'Uploaded At', key: 'createdAt', width: 22 },
    ];
    ws.getRow(1).font = { bold: true };
    docs.forEach((d) => ws.addRow({
      module: d.module, recordId: d.recordId, fileName: d.fileName, fileType: d.fileType,
      sourceType: d.sourceType, externalUrl: d.externalUrl ?? '',
      documentCategory: d.documentCategory ?? '', description: d.description ?? '',
      sizeKb: d.fileSizeBytes ? Math.round(d.fileSizeBytes / 1024) : '',
      isClientVisible: d.isClientVisible ? 'Yes' : 'No', uploadedBy: d.uploadedBy ?? '',
      createdAt: d.createdAt.toISOString(),
    }));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="document-register.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }),
);

export default router;
