import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter, CrudOptions } from '../../lib/crud';

/**
 * Resource assignment per schedule activity (T2-04): which named employees, crews and machines
 * are PLANNED on an activity, and what was ACTUALLY used (attendance and equipment logs on the
 * activity's WBS item).
 */
const num = (v: unknown) => Number(v ?? 0);

const resourceSchema = z.object({
  projectId: z.string(),
  activityId: z.string(),
  resourceType: z.enum(['EMPLOYEE', 'CREW', 'EQUIPMENT']),
  employeeId: z.string().optional(),
  crewId: z.string().optional(),
  equipmentId: z.string().optional(),
  plannedDays: z.number().nonnegative().optional(),
  plannedHours: z.number().nonnegative().optional(),
  note: z.string().max(1000).optional(),
});

export const activityResourceOpts: CrudOptions = {
  model: 'activityResource',
  entity: 'activity-resource',
  readPerm: 'scheduling:read',
  writePerm: 'scheduling:write',
  createSchema: resourceSchema,
  updateSchema: resourceSchema.partial(),
  requireProject: true,
  filterFields: ['activityId', 'resourceType'],
  refs: [
    { field: 'activityId', model: 'scheduleActivity' },
    { field: 'employeeId', model: 'employee' },
    { field: 'crewId', model: 'crew' },
    { field: 'equipmentId', model: 'equipment' },
  ],
  include: { activity: { select: { id: true, code: true, name: true } } },
  validate: async (data, req) => {
    const need = data.resourceType === 'EMPLOYEE' ? 'employeeId' : data.resourceType === 'CREW' ? 'crewId' : 'equipmentId';
    if (!data[need]) throw BadRequest(`Pick the ${need.replace('Id', '')} for this ${String(data.resourceType).toLowerCase()} assignment`);
    const act = await prisma.scheduleActivity.findFirst({ where: { id: String(data.activityId), organizationId: req.user!.orgId }, select: { projectId: true } });
    if (!act || act.projectId !== data.projectId) throw BadRequest('The activity must belong to this project');
  },
  transform: (data, req) => {
    if (!('id' in data)) data.createdBy = req.user!.id;
    data.updatedBy = req.user!.id;
    return data;
  },
};

export const resourcesRouter = Router();

// Planned against actual resources for one activity.
resourcesRouter.get('/plan-vs-actual', authenticate, requirePermission('scheduling:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const activityId = String(req.query.activityId ?? '');
  if (!activityId) throw BadRequest('activityId is required');
  const act = await prisma.scheduleActivity.findFirst({ where: { id: activityId, organizationId: orgId }, include: { wbsItem: { select: { id: true, code: true, name: true } } } });
  if (!act) throw NotFound('Activity not found');
  const planned = await prisma.activityResource.findMany({ where: { organizationId: orgId, activityId } });
  const [emps, crews, eqs] = await Promise.all([
    prisma.employee.findMany({ where: { organizationId: orgId }, select: { id: true, employeeNo: true, fullName: true } }),
    prisma.crew.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, members: { select: { employeeId: true } } } }),
    prisma.equipment.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true } }),
  ]);
  const empName = new Map(emps.map((e) => [e.id, `${e.employeeNo ?? ''} ${e.fullName}`.trim()]));
  const crewName = new Map(crews.map((c) => [c.id, c.name]));
  const eqName = new Map(eqs.map((e) => [e.id, `${e.code ?? ''} ${e.name}`.trim()]));

  const wbsId = act.wbsItemId;
  const entryIds = wbsId ? (await prisma.productionEntry.findMany({ where: { organizationId: orgId, wbsItemId: wbsId }, select: { id: true, crewId: true, laborHours: true } })) : [];
  const attendance = wbsId ? await prisma.attendance.findMany({
    where: { organizationId: orgId, present: true, OR: [{ wbsItemId: wbsId }, { productionEntryId: { in: entryIds.map((e) => e.id) } }] },
    select: { employeeId: true, workerName: true, headcount: true, hoursWorked: true, cost: true, date: true },
  }) : [];
  const usage = wbsId ? await prisma.equipmentUsageLog.findMany({ where: { organizationId: orgId, wbsItemId: wbsId }, select: { equipmentId: true, hoursUsed: true, cost: true } }) : [];

  const actualEmp = new Map<string, { hours: number; cost: number; days: Set<string> }>();
  let casualHours = 0; let casualCost = 0;
  for (const a of attendance) {
    const h = a.headcount * num(a.hoursWorked);
    if (a.employeeId) {
      const g = actualEmp.get(a.employeeId) ?? { hours: 0, cost: 0, days: new Set<string>() };
      g.hours += h; g.cost += num(a.cost); g.days.add(a.date.toISOString().slice(0, 10)); actualEmp.set(a.employeeId, g);
    } else { casualHours += h; casualCost += num(a.cost); }
  }
  const actualEq = new Map<string, { hours: number; cost: number }>();
  for (const u of usage) {
    const g = actualEq.get(u.equipmentId) ?? { hours: 0, cost: 0 };
    g.hours += num(u.hoursUsed); g.cost += num(u.cost); actualEq.set(u.equipmentId, g);
  }
  const crewHours = new Map<string, number>();
  for (const e of entryIds) if (e.crewId) crewHours.set(e.crewId, (crewHours.get(e.crewId) ?? 0) + num(e.laborHours));

  const rows = planned.map((p) => {
    if (p.resourceType === 'EMPLOYEE') {
      const a = actualEmp.get(p.employeeId!);
      return { id: p.id, type: 'EMPLOYEE', name: empName.get(p.employeeId!) ?? p.employeeId, plannedDays: p.plannedDays, plannedHours: p.plannedHours ?? (p.plannedDays != null ? p.plannedDays * 8 : null), actualDays: a?.days.size ?? 0, actualHours: a?.hours ?? 0, actualCost: Number((a?.cost ?? 0).toFixed(2)) };
    }
    if (p.resourceType === 'CREW') {
      return { id: p.id, type: 'CREW', name: crewName.get(p.crewId!) ?? p.crewId, plannedDays: p.plannedDays, plannedHours: p.plannedHours ?? null, actualDays: null, actualHours: crewHours.get(p.crewId!) ?? 0, actualCost: null };
    }
    const a = actualEq.get(p.equipmentId!);
    return { id: p.id, type: 'EQUIPMENT', name: eqName.get(p.equipmentId!) ?? p.equipmentId, plannedDays: p.plannedDays, plannedHours: p.plannedHours ?? (p.plannedDays != null ? p.plannedDays * 8 : null), actualDays: null, actualHours: a?.hours ?? 0, actualCost: Number((a?.cost ?? 0).toFixed(2)) };
  });
  // Used but never planned: shown so nothing is hidden.
  const plannedEmp = new Set(planned.map((p) => p.employeeId).filter(Boolean));
  const plannedEq = new Set(planned.map((p) => p.equipmentId).filter(Boolean));
  const unplanned = [
    ...[...actualEmp.entries()].filter(([id]) => !plannedEmp.has(id)).map(([id, a]) => ({ type: 'EMPLOYEE', name: empName.get(id) ?? id, actualHours: a.hours, actualCost: Number(a.cost.toFixed(2)) })),
    ...[...actualEq.entries()].filter(([id]) => !plannedEq.has(id)).map(([id, a]) => ({ type: 'EQUIPMENT', name: eqName.get(id) ?? id, actualHours: a.hours, actualCost: Number(a.cost.toFixed(2)) })),
    ...(casualHours > 0 ? [{ type: 'CASUAL', name: 'Casual labour (headcount)', actualHours: casualHours, actualCost: Number(casualCost.toFixed(2)) }] : []),
  ];
  return ok(res, { activity: { id: act.id, code: act.code, name: act.name, wbs: act.wbsItem }, planned: rows, unplanned, linked: !!wbsId });
}));

resourcesRouter.use('/', createCrudRouter(activityResourceOpts));
