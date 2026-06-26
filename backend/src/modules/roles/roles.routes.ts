import { Router } from 'express';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { roleMatrix, allPermissions } from '../../auth/permissions';

const router = Router();
router.use(authenticate);

// LIST every role with its granted permissions, plus the full permission catalog.
// Read-only: the matrix is the single source of truth in code (auth/permissions.ts).
router.get(
  '/',
  requirePermission('user:read'),
  asyncHandler(async (_req, res) => {
    return ok(res, { roles: roleMatrix(), permissions: allPermissions });
  }),
);

export default router;
