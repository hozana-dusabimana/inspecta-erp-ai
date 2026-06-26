import { z } from 'zod';
import { RiskStatus } from '@prisma/client';
import { createCrudRouter } from '../../lib/crud';
import { riskScore } from '../../lib/formulas';

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

const router = createCrudRouter({
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
});

export default router;
