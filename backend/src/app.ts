import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { notFoundHandler, errorHandler } from './middleware/error';

import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import rolesRoutes from './modules/roles/roles.routes';
import organizationRoutes from './modules/organization/organization.routes';
import clientsRoutes from './modules/clients/clients.routes';
import projectsRoutes from './modules/projects/projects.routes';
import auditRoutes from './modules/audit/audit.routes';
import aiRoutes from './modules/ai/ai.routes';
import planningRoutes from './modules/planning/planning.routes';
import productionRoutes from './modules/production/production.routes';
import financeRoutes from './modules/finance/finance.routes';
import inventoryRoutes from './modules/inventory/inventory.routes';
import procurementRoutes from './modules/procurement/procurement.routes';
import qaqcRoutes from './modules/qaqc/qaqc.routes';
import hseRoutes from './modules/hse/hse.routes';
import riskRoutes from './modules/risk/risk.routes';
import documentsRoutes from './modules/documents/documents.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import reportsRoutes from './modules/reports/reports.routes';
import dashboardsRoutes from './modules/dashboards/dashboards.routes';
import schedulingRoutes from './modules/scheduling/scheduling.routes';
import profitabilityRoutes from './modules/profitability/profitability.routes';
import fieldopsRoutes from './modules/fieldops/fieldops.routes';
import approvalsRoutes from './modules/approvals/approvals.routes';
import portfolioRoutes from './modules/portfolio/portfolio.routes';
import publicRoutes from './modules/public/public.routes';

export function createApp() {
  const app = express();

  // Behind nginx (+ Cloudflare). Trust one proxy hop for correct client IPs.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '4mb' }));
  if (!env.isProd) app.use(morgan('dev'));

  // ── Rate limiting (Module 21) — key by the real client IP (Cloudflare header) ──
  const clientKey = (req: express.Request) =>
    (req.headers['cf-connecting-ip'] as string) || req.ip || 'unknown';
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
    message: { success: false, error: 'Too many requests, please slow down.' },
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30, // brute-force protection: counts only FAILED auth attempts
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
    skipSuccessfulRequests: true, // successful logins don't count toward the limit
    message: { success: false, error: 'Too many authentication attempts, try again later.' },
  });

  // Health stays unlimited (used by CI/monitoring).
  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        service: 'inspecta-buildos-backend',
        build: process.env.BUILD_VERSION || 'dev',
      },
    });
  });

  app.use('/api', apiLimiter);
  app.use('/api/public', publicRoutes); // public, unauthenticated (own stricter limiter)

  // Core
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/roles', rolesRoutes);
  app.use('/api/organization', organizationRoutes);
  app.use('/api/clients', clientsRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/ai', aiRoutes);

  // ERP modules
  app.use('/api/planning', planningRoutes); // M1 — WBS + BOQ
  app.use('/api/production', productionRoutes); // M2
  app.use('/api/finance', financeRoutes); // M3
  app.use('/api/inventory', inventoryRoutes); // M4
  app.use('/api/procurement', procurementRoutes); // M17
  app.use('/api/qaqc', qaqcRoutes); // M5
  app.use('/api/hse', hseRoutes); // M6
  app.use('/api/risk', riskRoutes); // M24
  app.use('/api/documents', documentsRoutes); // M7
  app.use('/api/notifications', notificationsRoutes); // M9
  app.use('/api/reports', reportsRoutes); // M8
  app.use('/api/dashboards', dashboardsRoutes); // M12 + M15
  app.use('/api/scheduling', schedulingRoutes); // M13 — CPM
  app.use('/api/profitability', profitabilityRoutes); // M14
  app.use('/api/fieldops', fieldopsRoutes); // M16
  app.use('/api/approvals', approvalsRoutes); // M18 — workflow
  app.use('/api/portfolio', portfolioRoutes); // M23

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
