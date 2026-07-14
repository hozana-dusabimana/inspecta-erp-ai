import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../auth/audit';

// Central polymorphic evidence store (Developer Memo: project_documents).
// Files are stored in a private Supabase bucket; this module manages the
// metadata rows, signed upload/download URLs, and soft-delete.

const router = Router();
router.use(authenticate);

const ALLOWED_FILE_TYPES = ['photo', 'pdf', 'excel'] as const;

function supabaseConfigured(): boolean {
  return Boolean(env.supabase.url && env.supabase.serviceKey);
}

// Auto-provision the private evidence bucket on first use (idempotent) so the
// only manual setup is pasting SUPABASE_URL/SERVICE_KEY into the env.
let bucketReady = false;
async function ensureDocBucket(): Promise<void> {
  if (bucketReady || !supabaseConfigured()) return;
  const res = await fetch(`${env.supabase.url}/storage/v1/bucket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.supabase.serviceKey}`, apikey: env.supabase.serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: env.supabase.docBucket, name: env.supabase.docBucket, public: false, file_size_limit: 52428800 }),
  });
  // 200 = created; 400/409 = already exists — all fine. Anything else: let the
  // subsequent sign call surface the real error.
  if (res.ok || res.status === 400 || res.status === 409) bucketReady = true;
}

// ── LIST — polymorphic + filterable (excludes soft-deleted) ──────
router.get(
  '/',
  requirePermission('document:read'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));
    const { module, recordId, projectId, fileType, documentCategory, from, to } = req.query as Record<string, string | undefined>;
    const search = (req.query.search as string)?.trim();

    const where: Record<string, unknown> = { organizationId: req.user!.orgId, deletedAt: null };
    if (module) where.module = module;
    if (recordId) where.recordId = recordId;
    if (projectId) where.projectId = projectId;
    if (fileType) where.fileType = fileType;
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

// ── Signed upload URL (path convention {org}/{project}/{module}/{record}/{name}_{ts}) ──
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
    if (!supabaseConfigured()) {
      throw BadRequest('Supabase storage is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_DOC_BUCKET in backend/.env.');
    }
    await ensureDocBucket();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = Date.now();
    const objectPath = `${req.user!.orgId}/${projectId ?? 'org'}/${module}/${recordId}/${safeName}_${stamp}`;
    const signRes = await fetch(
      `${env.supabase.url}/storage/v1/object/upload/sign/${env.supabase.docBucket}/${objectPath}`,
      { method: 'POST', headers: { Authorization: `Bearer ${env.supabase.serviceKey}`, apikey: env.supabase.serviceKey, 'Content-Type': 'application/json' } },
    );
    if (!signRes.ok) throw BadRequest(`Supabase sign failed: ${await signRes.text()}`);
    const json = (await signRes.json()) as { url: string };
    return ok(res, { uploadUrl: `${env.supabase.url}/storage/v1${json.url}`, storagePath: objectPath });
  }),
);

// ── Register an uploaded document (metadata row) ─────────────────
const createSchema = z.object({
  module: z.string().min(1),
  recordId: z.string().min(1),
  projectId: z.string().optional(),
  fileName: z.string().min(1),
  fileType: z.enum(ALLOWED_FILE_TYPES),
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  storagePath: z.string().min(1),
  documentCategory: z.string().optional(),
  description: z.string().optional(),
  isClientVisible: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
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
    const record = await prisma.projectDocument.create({
      data: { ...body, organizationId: req.user!.orgId, uploadedBy: req.user!.id },
    });
    await auditFromRequest(req, 'CREATE', 'project-document', record.id, { newValues: record });
    return ok(res, record, 201);
  }),
);

// ── Signed download URL for a stored file ────────────────────────
router.get(
  '/:id/download',
  requirePermission('document:read'),
  asyncHandler(async (req, res) => {
    const doc = await prisma.projectDocument.findFirst({ where: { id: req.params.id, organizationId: req.user!.orgId, deletedAt: null } });
    if (!doc) throw NotFound('Document not found');
    if (!supabaseConfigured()) throw BadRequest('Supabase storage is not configured.');
    const signRes = await fetch(
      `${env.supabase.url}/storage/v1/object/sign/${env.supabase.docBucket}/${doc.storagePath}`,
      { method: 'POST', headers: { Authorization: `Bearer ${env.supabase.serviceKey}`, apikey: env.supabase.serviceKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) },
    );
    if (!signRes.ok) throw BadRequest(`Supabase sign failed: ${await signRes.text()}`);
    const json = (await signRes.json()) as { signedURL: string };
    return ok(res, { downloadUrl: `${env.supabase.url}/storage/v1${json.signedURL}` });
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
    const { projectId, module, documentCategory, fileType } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { organizationId: req.user!.orgId, deletedAt: null };
    if (projectId) where.projectId = projectId;
    if (module) where.module = module;
    if (documentCategory) where.documentCategory = documentCategory;
    if (fileType) where.fileType = fileType;
    const docs = await prisma.projectDocument.findMany({ where, orderBy: { createdAt: 'desc' } });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'INSPECTA BUILDOS';
    const ws = wb.addWorksheet('Document Register');
    ws.columns = [
      { header: 'Module', key: 'module', width: 16 },
      { header: 'Record ID', key: 'recordId', width: 26 },
      { header: 'File Name', key: 'fileName', width: 30 },
      { header: 'Type', key: 'fileType', width: 10 },
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
