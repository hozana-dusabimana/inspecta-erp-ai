import { z } from 'zod';
import { RiskStatus } from '@prisma/client';
import { createCrudRouter, CrudOptions } from '../../lib/crud';
import { riskScore } from '../../lib/formulas';
import { notify } from '../notifications/notify';

// ── M24 — Risk register with auto-scored severity (probability × impact) ──
const riskCreate = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  category: z.string().optional(),
  probability: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  status: z.nativeEnum(RiskStatus).optional(),
  mitigation: z.string().optional(),
  owner: z.string().optional(),
});

// Exported so the AI Copilot write tools reuse the exact create pipeline.
export const riskCrud: CrudOptions = {
  model: 'risk',
  entity: 'risk',
  readPerm: 'risk:read',
  writePerm: 'risk:write',
  createSchema: riskCreate,
  updateSchema: riskCreate.partial(),
  searchField: 'title',
  requireProject: true,
  orderBy: { score: 'desc' },
  transform: (data) => {
    const p = Number(data.probability ?? 0);
    const i = Number(data.impact ?? 0);
    if (p && i) data.score = riskScore(p, i); // 1–25 risk score
    return data;
  },
  // Risk alert: notify when a high/critical risk (score ≥ 15) is raised or updated.
  afterChange: async (action, record, req) => {
    if (action !== 'DELETE' && Number(record.score) >= 15 && record.status !== 'CLOSED') {
      await notify({
        organizationId: req.user!.orgId,
        type: 'GENERAL',
        severity: Number(record.score) >= 20 ? 'CRITICAL' : 'HIGH',
        title: `High risk: ${record.title}`,
        message: `Risk score ${record.score} (P${record.probability}×I${record.impact}) requires attention.`,
        link: `/projects/${record.projectId}`,
      });
    }
  },
};

const router = createCrudRouter(riskCrud);

export default router;
