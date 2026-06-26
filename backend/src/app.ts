import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { notFoundHandler, errorHandler } from './middleware/error';

import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
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

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '4mb' }));
  if (!env.isProd) app.use(morgan('dev'));

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

  // Core
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
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
