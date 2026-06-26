import { Router } from 'express';
import { z } from 'zod';
import { IncidentType, Severity } from '@prisma/client';
import { createCrudRouter } from '../../lib/crud';
import { notify } from '../notifications/notify';

const router = Router();

// ── Incident reports ──────────────────────────────────────────
const incidentCreate = z.object({
  projectId: z.string(),
  type: z.nativeEnum(IncidentType).optional(),
  severity: z.nativeEnum(Severity).optional(),
  description: z.string().min(1),
  location: z.string().optional(),
  reportedBy: z.string().optional(),
  date: z.string().datetime().optional(),
});
router.use(
  '/incidents',
  createCrudRouter({
    model: 'incident',
    entity: 'incident',
    readPerm: 'hse:read',
    writePerm: 'hse:write',
    createSchema: incidentCreate,
    updateSchema: incidentCreate.partial(),
    searchField: 'description',
    requireProject: true,
    orderBy: { date: 'desc' },
    afterChange: async (action, record, req) => {
      if (action === 'CREATE') {
        await notify({
          organizationId: req.user!.orgId,
          type: 'SAFETY_INCIDENT',
          severity: (record.severity as Severity) ?? 'MEDIUM',
          title: `Safety incident: ${record.type}`,
          message: String(record.description),
          link: `/projects/${record.projectId}`,
        });
      }
    },
  }),
);

// ── Toolbox talks ─────────────────────────────────────────────
const talkCreate = z.object({
  projectId: z.string(),
  topic: z.string().min(1),
  presenter: z.string().optional(),
  attendees: z.number().int().nonnegative().optional(),
  date: z.string().datetime().optional(),
  notes: z.string().optional(),
});
router.use(
  '/toolbox-talks',
  createCrudRouter({
    model: 'toolboxTalk',
    entity: 'toolbox-talk',
    readPerm: 'hse:read',
    writePerm: 'hse:write',
    createSchema: talkCreate,
    updateSchema: talkCreate.partial(),
    searchField: 'topic',
    requireProject: true,
    orderBy: { date: 'desc' },
  }),
);

export default router;
