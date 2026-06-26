import { Router } from 'express';
import { z } from 'zod';
import { InspectionResult, Severity, NcrStatus } from '@prisma/client';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';

const router = Router();

// ── Inspections / testing ─────────────────────────────────────
const inspectionCreate = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  type: z.string().optional(),
  result: z.nativeEnum(InspectionResult).optional(),
  inspector: z.string().optional(),
  date: z.string().datetime().optional(),
  notes: z.string().optional(),
});
router.use(
  '/inspections',
  createCrudRouter({
    model: 'inspection',
    entity: 'inspection',
    readPerm: 'qaqc:read',
    writePerm: 'qaqc:write',
    createSchema: inspectionCreate,
    updateSchema: inspectionCreate.partial(),
    searchField: 'title',
    requireProject: true,
    orderBy: { date: 'desc' },
  }),
);

// ── NCR register + corrective actions ─────────────────────────
const ncrCreate = z.object({
  projectId: z.string(),
  number: z.string().min(1),
  description: z.string().min(1),
  severity: z.nativeEnum(Severity).optional(),
  status: z.nativeEnum(NcrStatus).optional(),
  correctiveAction: z.string().optional(),
  raisedBy: z.string().optional(),
  closedAt: z.string().datetime().optional(),
});
router.use(
  '/ncrs',
  createCrudRouter({
    model: 'ncr',
    entity: 'ncr',
    readPerm: 'qaqc:read',
    writePerm: 'qaqc:write',
    createSchema: ncrCreate,
    updateSchema: ncrCreate.partial(),
    searchField: 'description',
    requireProject: true,
    afterChange: async (action, record, req) => {
      if (action === 'CREATE') {
        await notify({
          organizationId: req.user!.orgId,
          type: 'NCR',
          severity: (record.severity as Severity) ?? 'MEDIUM',
          title: `NCR raised: ${record.number}`,
          message: String(record.description),
          link: `/projects/${record.projectId}`,
        });
      }
    },
  }),
);

export default router;
