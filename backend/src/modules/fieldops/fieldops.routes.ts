import { Router } from 'express';
import { z } from 'zod';
import { labourRouter, attendanceOpts } from './labour';
import { Request } from 'express';
import { TaskStatus } from '@prisma/client';
import { createCrudRouter } from '../../lib/crud';

const router = Router();

// ── Site diary ────────────────────────────────────────────────
const diaryCreate = z.object({
  projectId: z.string(),
  date: z.string().datetime().optional(),
  weather: z.string().optional(),
  workforce: z.number().int().nonnegative().optional(),
  notes: z.string().min(1),
});
router.use(
  '/diary',
  createCrudRouter({
    model: 'siteDiary',
    entity: 'site-diary',
    readPerm: 'fieldops:read',
    writePerm: 'fieldops:write',
    createSchema: diaryCreate,
    updateSchema: diaryCreate.partial(),
    searchField: 'notes',
    dateField: 'date',
    requireProject: true,
    orderBy: { date: 'desc' },
    transform: (data, req: Request) => {
      if (!data.createdById && req.user) data.createdById = req.user.id;
      return data;
    },
  }),
);

// ── Field tasks (assignment) ──────────────────────────────────
const taskCreate = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  assignee: z.string().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  dueDate: z.string().datetime().optional(),
});
router.use(
  '/tasks',
  createCrudRouter({
    model: 'fieldTask',
    entity: 'field-task',
    readPerm: 'fieldops:read',
    writePerm: 'fieldops:write',
    createSchema: taskCreate,
    updateSchema: taskCreate.partial(),
    searchField: 'title',
    filterFields: ['status'],
    requireProject: true,
  }),
);

// ── Attendance (headcount rows, casual roster, pay sheet) ─────
router.use('/', labourRouter);
router.use('/attendance', createCrudRouter(attendanceOpts));

export default router;
