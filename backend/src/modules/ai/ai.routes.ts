import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import * as service from './ai.service';

const router = Router();
router.use(authenticate);

const chatSchema = z.object({
  prompt: z.string().min(1).max(4000),
  provider: z.enum(['openrouter', 'claude', 'gemini']).optional(),
});

router.post(
  '/chat',
  requirePermission('ai:use'),
  asyncHandler(async (req, res) => {
    const body = chatSchema.parse(req.body);
    const answer = await service.ask(req.user!.orgId, body.prompt, body.provider);
    return ok(res, answer);
  }),
);

export default router;
