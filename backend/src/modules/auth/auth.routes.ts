import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { auditFromRequest, recordAudit } from '../../auth/audit';
import * as service from './auth.service';

const router = Router();

const registerSchema = z.object({
  organizationName: z.string().min(2),
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

const resendSchema = z.object({
  email: z.string().email(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * Forgot-password answers 200 to everyone (it must not leak which addresses are
 * registered), so the app-wide auth limiter — which only counts *failed*
 * attempts — would never throttle it. This one counts every call, to stop the
 * endpoint being used to flood a real user's inbox.
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.headers['cf-connecting-ip'] as string) || req.ip || 'unknown',
  message: { success: false, error: 'Too many password reset requests. Please try again later.' },
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const result = await service.registerOrganization(body);
    return ok(res, result, 201);
  }),
);

router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const body = verifyEmailSchema.parse(req.body);
    const result = await service.verifyEmail(body.token);
    await recordAudit({
      organizationId: result.user.organizationId,
      userId: result.user.id,
      action: 'LOGIN',
      entity: 'auth',
      entityId: result.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return ok(res, result);
  }),
);

router.post(
  '/resend-verification',
  asyncHandler(async (req, res) => {
    const body = resendSchema.parse(req.body);
    const result = await service.resendVerification(body.email);
    return ok(res, result);
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const result = await service.login(body.email, body.password);
    await recordAudit({
      organizationId: result.user.organizationId,
      userId: result.user.id,
      action: 'LOGIN',
      entity: 'auth',
      entityId: result.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return ok(res, result);
  }),
);

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  asyncHandler(async (req, res) => {
    const body = forgotPasswordSchema.parse(req.body);
    const result = await service.requestPasswordReset(body.email);
    return ok(res, result);
  }),
);

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const body = resetPasswordSchema.parse(req.body);
    const result = await service.resetPassword(body.token, body.password);
    await recordAudit({
      organizationId: result.user.organizationId,
      userId: result.user.id,
      action: 'UPDATE',
      entity: 'auth',
      entityId: result.user.id,
      newValues: { passwordReset: true },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return ok(res, result);
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    const result = await service.refresh(body.refreshToken);
    return ok(res, result);
  }),
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    const body = refreshSchema.partial().parse(req.body ?? {});
    await service.logout(body.refreshToken);
    await auditFromRequest(req, 'LOGOUT', 'auth', req.user?.id);
    return ok(res, { loggedOut: true });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await service.me(req.user!.id);
    return ok(res, result);
  }),
);

export default router;
