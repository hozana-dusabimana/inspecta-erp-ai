import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler, ok } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { sendMail, isEmailConfigured } from '../../lib/email';
import { env } from '../../config/env';
import { publicPlatformSettings } from '../platform/settings';

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

const contactSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().max(40).optional(),
  company: z.string().max(160).optional(),
  service: z.string().max(80).optional(),
  message: z.string().min(1).max(4000),
});

// POST /api/public/contact — website contact form (emails the team).
router.post(
  '/contact',
  demoLimiter,
  asyncHandler(async (req, res) => {
    const b = contactSchema.parse(req.body);
    const to = env.smtp.fallbackTo || env.smtp.user;
    if (isEmailConfigured() && to) {
      await sendMail({
        to,
        subject: `Website enquiry — ${b.service || 'General'} — ${b.name}`,
        text: `Name: ${b.name}\nEmail: ${b.email}\nPhone: ${b.phone ?? '—'}\nCompany: ${b.company ?? '—'}\nService: ${b.service ?? '—'}\n\n${b.message}\n\nReceived via inspecta.isiri.rw`,
        html: `<h3>New website enquiry</h3><ul><li><b>Name:</b> ${b.name}</li><li><b>Email:</b> ${b.email}</li><li><b>Phone:</b> ${b.phone ?? '—'}</li><li><b>Company:</b> ${b.company ?? '—'}</li><li><b>Service:</b> ${b.service ?? '—'}</li></ul><p>${b.message}</p><p style="color:#99a;font-size:11px">via inspecta.isiri.rw</p>`,
      });
    }
    return ok(res, { received: true, emailed: isEmailConfigured() && Boolean(to) }, 201);
  }),
);

// GET /api/public/team — published team profiles for the public website.
router.get(
  '/team',
  asyncHandler(async (_req, res) => {
    const members = await prisma.teamMember.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, title: true, bio: true, photoUrl: true },
    });
    return ok(res, members);
  }),
);

// GET /api/public/settings — the handful of platform settings an unauthenticated
// client legitimately needs: whether signup is open, and the maintenance banner
// (which has to reach people who cannot sign in).
router.get(
  '/settings',
  asyncHandler(async (_req, res) => ok(res, await publicPlatformSettings())),
);

export default router;
