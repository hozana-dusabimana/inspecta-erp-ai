import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler, ok } from '../../lib/http';
import { sendMail, isEmailConfigured } from '../../lib/email';
import { env } from '../../config/env';

const router = Router();

// Heavily rate-limited: this is an unauthenticated, outward-facing endpoint.
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many demo requests, please try again later.' },
});

const demoSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  company: z.string().min(1).max(160),
});

// POST /api/public/demo-request — real "Book Demo" handler (emails the team).
router.post(
  '/demo-request',
  demoLimiter,
  asyncHandler(async (req, res) => {
    const body = demoSchema.parse(req.body);
    const to = env.smtp.fallbackTo || env.smtp.user;

    if (isEmailConfigured() && to) {
      await sendMail({
        to,
        subject: `New Inspecta demo request — ${body.company}`,
        text: `Name: ${body.name}\nEmail: ${body.email}\nCompany: ${body.company}\n\nReceived via inspecta.isiri.rw`,
        html: `<h3>New demo request</h3><ul><li><b>Name:</b> ${body.name}</li><li><b>Email:</b> ${body.email}</li><li><b>Company:</b> ${body.company}</li></ul><p style="color:#99a;font-size:11px">via inspecta.isiri.rw</p>`,
      });
    }
    // Always acknowledge (the request is recorded/emailed when possible).
    return ok(res, { received: true, emailed: isEmailConfigured() && Boolean(to) }, 201);
  }),
);

export default router;
