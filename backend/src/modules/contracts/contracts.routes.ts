import { z } from 'zod';
import { ContractType, ContractStatus } from '@prisma/client';
import { createCrudRouter } from '../../lib/crud';

// Contract Information (Module 1 — Project Setup).
const createSchema = z.object({
  clientId: z.string(),
  projectId: z.string().optional(),
  reference: z.string().min(1),
  contractNumber: z.string().optional(),
  type: z.nativeEnum(ContractType).optional(),
  status: z.nativeEnum(ContractStatus).optional(),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  contractDate: z.string().datetime().optional(),
  commencementDate: z.string().datetime().optional(),
  signedDate: z.string().datetime().optional(),
  defectsLiabilityMonths: z.number().int().nonnegative().optional(),
  retentionPct: z.number().min(0).max(100).optional(),
  advancePayment: z.number().nonnegative().optional(),
  documentsUrl: z.string().optional(),
});

const router = createCrudRouter({
  model: 'contract',
  entity: 'contract',
  readPerm: 'contract:read',
  writePerm: 'contract:write',
  createSchema,
  updateSchema: createSchema.partial(),
  searchField: 'reference',
  include: { client: { select: { id: true, name: true } }, project: { select: { id: true, name: true, code: true } } },
  refs: [
    { field: 'clientId', model: 'client' },
    { field: 'projectId', model: 'project' },
  ],
  // Stamp the lifecycle audit columns required by the multi-tenant spec.
  transform: (data, req) => {
    const out = { ...data };
    if (!('id' in out) && !out.createdAt) out.createdBy = req.user!.id;
    out.updatedBy = req.user!.id;
    return out;
  },
});

export default router;
