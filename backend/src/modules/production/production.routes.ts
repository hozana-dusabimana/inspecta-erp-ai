import { z } from 'zod';
import { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';
import { productivity, variancePct } from '../../lib/formulas';

const createSchema = z.object({
  projectId: z.string(),
  date: z.string().datetime().optional(),
  wbsActivity: z.string().min(1),
  unit: z.string().optional(),
  plannedQty: z.number().nonnegative(),
  actualQty: z.number().nonnegative(),
  laborHours: z.number().nonnegative().optional(),
  equipmentHours: z.number().nonnegative().optional(),
  weatherCondition: z.string().optional(),
  remarks: z.string().optional(),
  photos: z.array(z.string()).optional(),
});

const router = createCrudRouter({
  model: 'productionEntry',
  entity: 'production-entry',
  readPerm: 'production:read',
  writePerm: 'production:write',
  createSchema,
  updateSchema: createSchema.partial(),
  searchField: 'wbsActivity',
  requireProject: true,
  orderBy: { date: 'desc' },
  transform: (data, req: Request) => {
    if (!data.createdById && req.user) data.createdById = req.user.id;
    return data;
  },
  afterChange: async (action, record, req) => {
    if (action === 'DELETE') return;
    const planned = Number(record.plannedQty) || 0;
    const actual = Number(record.actualQty) || 0;
    // Variance = (Actual - Planned) / Planned * 100. Flag a meaningful shortfall.
    if (planned > 0 && (actual - planned) / planned <= -0.1) {
      await notify({
        organizationId: req.user!.orgId,
        type: 'DELAY',
        severity: 'HIGH',
        title: 'Production shortfall detected',
        message: `Activity "${record.wbsActivity}" achieved ${actual} of ${planned} planned units (${(((actual - planned) / planned) * 100).toFixed(1)}% variance).`,
        link: `/projects/${record.projectId}`,
      });
    }
  },
});

// ── Productivity & variance summary (Module 2 KPIs) ────────────
router.get(
  '/summary/metrics',
  authenticate,
  requirePermission('production:read'),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    const entries = await prisma.productionEntry.findMany({
      where: { organizationId: req.user!.orgId, ...(projectId ? { projectId } : {}) },
      orderBy: { date: 'asc' },
    });

    const totalPlanned = entries.reduce((s, e) => s + Number(e.plannedQty), 0);
    const totalActual = entries.reduce((s, e) => s + Number(e.actualQty), 0);
    const totalLabor = entries.reduce((s, e) => s + Number(e.laborHours), 0);

    const series = entries.map((e) => ({
      date: e.date,
      planned: Number(e.plannedQty),
      actual: Number(e.actualQty),
      productivity: productivity(Number(e.actualQty), Number(e.laborHours)),
    }));

    return ok(res, {
      entries: entries.length,
      totalPlanned,
      totalActual,
      totalLaborHours: totalLabor,
      productivityIndex: Number(productivity(totalActual, totalLabor).toFixed(3)),
      variancePct: Number(variancePct(totalActual, totalPlanned).toFixed(2)),
      series,
    });
  }),
);

export default router;
