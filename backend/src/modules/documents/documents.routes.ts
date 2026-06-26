import { z } from 'zod';
import { Request } from 'express';
import { createCrudRouter } from '../../lib/crud';
import { env } from '../../config/env';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';

// ── M7 — Document register (metadata + versioned links) ──────────
// Files are uploaded to storage (e.g. Supabase) by the client; this stores the
// resulting URL plus metadata, versioning, and project scoping.
const documentCreate = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1),
  category: z.string().optional(),
  url: z.string().url(),
  version: z.number().int().positive().optional(),
});

const router = createCrudRouter({
  model: 'document',
  entity: 'document',
  readPerm: 'document:read',
  writePerm: 'document:write',
  createSchema: documentCreate,
  updateSchema: documentCreate.partial(),
  searchField: 'name',
  include: { project: { select: { id: true, name: true } } },
  transform: (data, req: Request) => {
    if (!data.uploadedBy && req.user) data.uploadedBy = req.user.email;
    return data;
  },
});

const uploadSchema = z.object({ filename: z.string().min(1) });

/**
 * Returns a Supabase Storage signed upload URL so the client can PUT the file
 * directly, then register the resulting public URL via POST /documents.
 * Honest fallback: 400 with guidance when Supabase isn't configured.
 */
router.post(
  '/upload-url',
  requirePermission('document:write'),
  asyncHandler(async (req, res) => {
    const { filename } = uploadSchema.parse(req.body);
    if (!env.supabase.url || !env.supabase.serviceKey) {
      throw BadRequest(
        'Supabase storage is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_BUCKET in backend/.env, or paste a file URL directly when creating a document.',
      );
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectPath = `${req.user!.orgId}/${safeName}`;
    const signRes = await fetch(
      `${env.supabase.url}/storage/v1/object/upload/sign/${env.supabase.bucket}/${objectPath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.supabase.serviceKey}`,
          apikey: env.supabase.serviceKey,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!signRes.ok) throw BadRequest(`Supabase sign failed: ${await signRes.text()}`);
    const json = (await signRes.json()) as { url: string };

    return ok(res, {
      uploadUrl: `${env.supabase.url}/storage/v1${json.url}`,
      publicUrl: `${env.supabase.url}/storage/v1/object/public/${env.supabase.bucket}/${objectPath}`,
      path: objectPath,
    });
  }),
);

export default router;
