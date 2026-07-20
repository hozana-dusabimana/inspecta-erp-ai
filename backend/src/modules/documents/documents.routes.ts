import { z } from 'zod';
import { Request } from 'express';
import { createCrudRouter } from '../../lib/crud';
import { asyncHandler, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { normalizeExternalUrl, signUpload } from '../../lib/storage';

// ── M7 — Document register (metadata + versioned links) ──────────
// `url` is either the public URL of a file uploaded via /documents/upload-url
// or a link the user pasted to a document hosted elsewhere. Both http and
// https are accepted — see normalizeExternalUrl for why.
const documentCreate = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1),
  category: z.string().optional(),
  url: z.string().min(1).transform(normalizeExternalUrl),
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
 * Signs a direct upload to Cloudinary so the browser can POST the file itself;
 * the caller then saves the returned secure_url on the record. Used by the
 * document register and by the generic upload-or-link form field.
 */
router.post(
  '/upload-url',
  requirePermission('document:write'),
  asyncHandler(async (req, res) => {
    const { filename } = uploadSchema.parse(req.body);
    return ok(res, signUpload(`${req.user!.orgId}/documents`, filename));
  }),
);

export default router;
