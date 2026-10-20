import { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { CrudOptions, runCreate } from '../../lib/crud';
import type { Permission } from '../../auth/permissions';

/**
 * Copilot batch create: a whole pasted list (project, WBS with parents, BOQ,
 * schedule, productivity rates) becomes ONE plan, ONE confirmation, then every
 * record is created. Everything is addressed by the codes the user typed
 * (parent WBS code, activity code...) — never by internal ids — and "saved" is
 * only reported for rows read back from the database.
 */

export interface BatchActor { id: string; orgId: string; inspecting?: boolean }

export interface BatchDeps {
  crud: { project: CrudOptions; wbs: CrudOptions; boq: CrudOptions; activity: CrudOptions; productivity: CrudOptions };
  actorReq: (actor: BatchActor) => Request;
  canWrite: (actor: BatchActor, perm: Permission) => boolean;
}

const MAX = { wbs: 500, boq: 1000, activities: 500, productivity: 200 };

const num = z.preprocess((v) => (typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : v), z.number().finite());
const text = z.preprocess((v) => (v === null || v === undefined ? undefined : String(v).trim() || undefined), z.string().optional());
const code = z.preprocess((v) => (v === null || v === undefined ? undefined : String(v).trim()), z.string().min(1));

const inputSchema = z.object({
  projectRef: text, // an existing project: its code, name or id
  project: z.object({
    name: text, location: text, budget: num.optional(), startDate: text, endDate: text, clientName: text, managerName: text,
  }).partial().optional(),
  wbs: z.array(z.object({ code, name: z.string().min(1), parentCode: text, unit: text, quantity: num.optional(), budgetAmount: num.optional() })).max(MAX.wbs).default([]),
  boq: z.array(z.object({ code, wbsCode: text, description: z.string().min(1), unit: text, quantity: num, rate: num, category: text })).max(MAX.boq).default([]),
  activities: z.array(z.object({
    code, name: z.string().min(1), wbsCode: text, durationDays: num, startDate: text,
    predecessors: z.preprocess((v) => (typeof v === 'string' ? v.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : v ?? []), z.array(z.string())),
  })).max(MAX.activities).default([]),
  productivity: z.array(z.object({ activity: z.string().min(1), unit: z.string().min(1), productivityRate: num, standardCrewSize: num.optional() })).max(MAX.productivity).default([]),
});

export interface BatchPlan {
  /** Set once the project exists (existing project, or after a first commit attempt). */
  projectId?: string;
  projectLabel: string;
  newProject?: Record<string, unknown>;
  wbs: { code: string; name: string; parentCode?: string; unit?: string; quantity?: number; budgetAmount?: number }[];
  boq: { code: string; wbsCode?: string; description: string; unit?: string; quantity: number; rate: number; category?: string }[];
  activities: { code: string; name: string; wbsCode?: string; durationDays: number; startDate?: string; predecessors: string[] }[];
  productivity: { activity: string; unit: string; productivityRate: number; standardCrewSize?: number }[];
  /** Rows skipped because they already exist (create-only: nothing is overwritten). */
  skipped: { wbs: string[]; boq: string[]; activities: string[]; productivity: string[] };
}

export type BatchBuild =
  | { ok: true; plan: BatchPlan; preview: Record<string, string>; warnings: string[] }
  | { ok: false; problems: string[] };

const toIso = (d?: string) => {
  if (!d) return undefined;
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00.000Z` : d);
  return isNaN(t.getTime()) ? undefined : t.toISOString();
};
const money = (n: number) => `RWF ${Math.round(n).toLocaleString('en-US')}`;
const key = (s: string) => s.trim().toLowerCase();

/** Order items so that every item comes after the ones it points at; reports a cycle. */
function order<T>(items: T[], id: (t: T) => string, deps: (t: T) => string[]): { sorted: T[]; cycle: string | null } {
  const byId = new Map(items.map((i) => [key(id(i)), i]));
  const state = new Map<string, 1 | 2>();
  const sorted: T[] = [];
  let cycle: string | null = null;
  const visit = (k: string) => {
    if (state.get(k) === 2 || cycle) return;
    if (state.get(k) === 1) { cycle = k; return; }
    state.set(k, 1);
    const item = byId.get(k)!;
    for (const d of deps(item)) if (byId.has(key(d))) visit(key(d));
    state.set(k, 2);
    sorted.push(item);
  };
  for (const k of byId.keys()) visit(k);
  return { sorted, cycle };
}

export async function buildBatchPlan(raw: unknown, actor: BatchActor, deps: BatchDeps): Promise<BatchBuild> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(' › ') || 'List'}: ${i.message}`) };
  }
  const input = parsed.data;
  const problems: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  // ── Project (existing or new) ──
  let existing: { id: string; code: string; name: string } | null = null;
  let newProject: Record<string, unknown> | undefined;
  let clientLabel = '';
  let managerLabel = '';
  if (input.projectRef) {
    const rows = await prisma.project.findMany({
      where: { organizationId: actor.orgId, OR: [{ id: input.projectRef }, { code: { equals: input.projectRef, mode: 'insensitive' } }, { name: { equals: input.projectRef, mode: 'insensitive' } }] },
      select: { id: true, code: true, name: true }, take: 2,
    });
    if (rows.length === 1) existing = rows[0];
    else problems.push(rows.length ? `More than one project matches “${input.projectRef}” — use its project code.` : `I couldn't find a project called “${input.projectRef}”.`);
  } else if (input.project?.name) {
    const p = input.project;
    const data: Record<string, unknown> = { name: p.name, location: p.location, budget: p.budget, startDate: toIso(p.startDate), endDate: toIso(p.endDate) };
    if (p.startDate && !data.startDate) problems.push(`Project start date “${p.startDate}” isn't a valid date.`);
    if (p.endDate && !data.endDate) problems.push(`Project end date “${p.endDate}” isn't a valid date.`);
    if (p.clientName) {
      const c = await prisma.client.findFirst({ where: { organizationId: actor.orgId, name: { equals: p.clientName, mode: 'insensitive' } }, select: { id: true, name: true } });
      if (c) { data.clientId = c.id; clientLabel = c.name; }
      else warnings.push(`Client “${p.clientName}” isn't in your client list yet. The project would be created without a client — add the client first if you want it linked.`);
    } else warnings.push('Your message names no client, so the project would be created without one.');
    if (p.managerName) {
      const users = await prisma.user.findMany({
        where: { organizationId: actor.orgId, isActive: true, OR: [{ fullName: { equals: p.managerName, mode: 'insensitive' } }, { email: { equals: p.managerName, mode: 'insensitive' } }] },
        select: { id: true, fullName: true, email: true }, take: 2,
      });
      if (users.length === 1) { data.managerId = users[0].id; managerLabel = users[0].fullName || users[0].email; }
      else warnings.push(users.length ? `More than one user matches “${p.managerName}” — the project would have no project manager.` : `“${p.managerName}” isn't a user in your company, so the project would have no project manager.`);
    } else warnings.push('Your message names no project manager, so the project would be created without one.');
    const check = deps.crud.project.createSchema.safeParse(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
    if (!check.success) problems.push(...check.error.issues.map((i) => `Project ${i.path.join('.') || ''}: ${i.message}`.replace('  ', ' ')));
    newProject = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  } else {
    problems.push('Tell me which project this list belongs to — either an existing project, or the name of the new one.');
  }

  // What the project already holds (so references resolve and nothing is duplicated).
  const have = { wbs: new Set<string>(), boq: new Set<string>(), act: new Set<string>(), std: new Set<string>() };
  if (existing) {
    const [w, b, a] = await Promise.all([
      prisma.wbsItem.findMany({ where: { organizationId: actor.orgId, projectId: existing.id }, select: { code: true } }),
      prisma.boqItem.findMany({ where: { organizationId: actor.orgId, projectId: existing.id }, select: { code: true } }),
      prisma.scheduleActivity.findMany({ where: { organizationId: actor.orgId, projectId: existing.id }, select: { code: true } }),
    ]);
    w.forEach((r) => have.wbs.add(key(r.code))); b.forEach((r) => have.boq.add(key(r.code))); a.forEach((r) => have.act.add(key(r.code)));
  }
  const stds = await prisma.productivityStandard.findMany({ where: { organizationId: actor.orgId }, select: { activity: true, unit: true } });
  stds.forEach((s) => have.std.add(`${key(s.activity)}|${key(s.unit)}`));

  const skipped: BatchPlan['skipped'] = { wbs: [], boq: [], activities: [], productivity: [] };
  const dupes = (label: string, list: string[]) => {
    const seen = new Set<string>();
    for (const c of list) { if (seen.has(key(c))) problems.push(`${label} code “${c}” appears more than once in your list.`); seen.add(key(c)); }
  };

  // ── WBS ──
  dupes('WBS', input.wbs.map((w) => w.code));
  const listedWbs = new Set(input.wbs.map((w) => key(w.code)));
  let wbs = input.wbs.filter((w) => { if (have.wbs.has(key(w.code))) { skipped.wbs.push(w.code); return false; } return true; });
  for (const w of wbs) {
    if (w.parentCode && key(w.parentCode) === key(w.code)) problems.push(`WBS ${w.code} cannot be its own parent.`);
    else if (w.parentCode && !listedWbs.has(key(w.parentCode)) && !have.wbs.has(key(w.parentCode))) problems.push(`WBS ${w.code}: the parent “${w.parentCode}” is not in your list or in the project.`);
  }
  const wbsOrdered = order(wbs, (w) => w.code, (w) => (w.parentCode ? [w.parentCode] : []));
  if (wbsOrdered.cycle) problems.push(`The WBS parents form a loop around “${wbsOrdered.cycle}”.`);
  wbs = wbsOrdered.sorted;
  const knownWbs = new Set([...listedWbs, ...have.wbs]);

  // ── BOQ ──
  dupes('BOQ', input.boq.map((b) => b.code));
  const boq = input.boq.filter((b) => { if (have.boq.has(key(b.code))) { skipped.boq.push(b.code); return false; } return true; });
  for (const b of boq) {
    if (b.wbsCode && !knownWbs.has(key(b.wbsCode))) problems.push(`BOQ ${b.code}: the WBS code “${b.wbsCode}” is not in your list or in the project.`);
    if (b.quantity < 0 || b.rate < 0) problems.push(`BOQ ${b.code}: quantity and rate cannot be negative.`);
  }

  // ── Schedule ──
  dupes('Activity', input.activities.map((a) => a.code));
  const listedAct = new Set(input.activities.map((a) => key(a.code)));
  let activities = input.activities.filter((a) => { if (have.act.has(key(a.code))) { skipped.activities.push(a.code); return false; } return true; });
  for (const a of activities) {
    if (!Number.isInteger(a.durationDays) || a.durationDays < 1) problems.push(`Activity ${a.code}: the duration must be a whole number of days, 1 or more.`);
    if (a.startDate && !toIso(a.startDate)) problems.push(`Activity ${a.code}: “${a.startDate}” isn't a valid start date.`);
    if (a.wbsCode && !knownWbs.has(key(a.wbsCode))) problems.push(`Activity ${a.code}: the WBS code “${a.wbsCode}” is not in your list or in the project.`);
    for (const p of a.predecessors) {
      if (key(p) === key(a.code)) problems.push(`Activity ${a.code} cannot be its own predecessor.`);
      else if (!listedAct.has(key(p)) && !have.act.has(key(p))) problems.push(`Activity ${a.code}: the predecessor “${p}” is not in your list or in the project.`);
    }
  }
  const actOrdered = order(activities, (a) => a.code, (a) => a.predecessors);
  if (actOrdered.cycle) problems.push(`The activity predecessors form a loop around “${actOrdered.cycle}”.`);
  activities = actOrdered.sorted;

  // ── Productivity ──
  const seenStd = new Set<string>();
  const productivity = input.productivity.filter((p) => {
    const k = `${key(p.activity)}|${key(p.unit)}`;
    if (seenStd.has(k)) { problems.push(`Productivity rate for “${p.activity}” (${p.unit}) appears more than once.`); return false; }
    seenStd.add(k);
    if (have.std.has(k)) { skipped.productivity.push(p.activity); return false; }
    return true;
  });
  for (const p of productivity) {
    if (!(p.productivityRate > 0)) problems.push(`Productivity “${p.activity}”: the rate must be above 0.`);
    if (p.standardCrewSize !== undefined && (!Number.isInteger(p.standardCrewSize) || p.standardCrewSize < 1)) problems.push(`Productivity “${p.activity}”: the standard crew size must be a whole number, 1 or more.`);
  }

  if (!wbs.length && !boq.length && !activities.length && !productivity.length && !newProject) {
    problems.push('There is nothing new to create — everything in your list already exists.');
  }
  if (problems.length) return { ok: false, problems: problems.slice(0, 15).concat(problems.length > 15 ? [`…and ${problems.length - 15} more.`] : []) };

  const skippedCount = skipped.wbs.length + skipped.boq.length + skipped.activities.length + skipped.productivity.length;
  if (skippedCount) notes.push(`${skippedCount} row(s) already exist and will be left as they are (this only creates).`);

  const lines = (n: number, what: string, skip: string[]) => `${n} to create${skip.length ? `, ${skip.length} already exist` : ''}`.replace(/^0 to create, /, '') + (n === 0 && !skip.length ? ` (no ${what})` : '');
  const preview: Record<string, string> = {};
  preview['Project'] = existing ? `${existing.code} — ${existing.name} (existing)` : `${String(newProject?.name)} (new)`;
  if (newProject) {
    preview['Client'] = clientLabel || 'None';
    preview['Project manager'] = managerLabel || 'None';
    if (newProject.budget !== undefined) preview['Budget'] = money(Number(newProject.budget));
  }
  if (input.wbs.length) {
    const tree = wbs.slice(0, 25).map((w) => `${'  '.repeat(Math.max(0, w.code.split('.').length - 1))}${w.code} ${w.name}${w.parentCode ? ` (under ${w.parentCode})` : ''}`);
    preview['WBS items'] = `${lines(wbs.length, 'WBS items', skipped.wbs)}\n${tree.join('\n')}${wbs.length > 25 ? `\n…and ${wbs.length - 25} more` : ''}`;
  }
  if (input.boq.length) preview['BOQ lines'] = `${lines(boq.length, 'BOQ lines', skipped.boq)} · total ${money(boq.reduce((s, b) => s + b.quantity * b.rate, 0))}`;
  if (input.activities.length) preview['Schedule activities'] = lines(activities.length, 'activities', skipped.activities);
  if (input.productivity.length) preview['Productivity rates'] = lines(productivity.length, 'rates', skipped.productivity);
  if (notes.length) preview['Note'] = notes.join(' ');
  if (warnings.length) preview['Warnings'] = warnings.map((w) => `• ${w}`).join('\n');

  const plan: BatchPlan = {
    projectId: existing?.id, projectLabel: existing ? `${existing.code} — ${existing.name}` : String(newProject?.name),
    newProject, wbs, boq, activities, productivity, skipped,
  };
  return { ok: true, plan, preview, warnings };
}

export interface BatchCommitResult {
  ok: boolean;
  /** Plain-language lines describing what is really in the database. */
  saved: Record<string, string>;
  /** Set when something could not be created: what and why. */
  failure?: string;
  projectId?: string;
  /** Plan with the project filled in, so a retry continues instead of duplicating. */
  plan: BatchPlan;
}

/**
 * Create everything in dependency order, then read the rows back. Stops at the
 * first failure and says exactly what was and wasn't saved; re-running the same
 * plan skips what already exists, so a retry only creates the missing rest.
 */
export async function commitBatchPlan(plan: BatchPlan, actor: BatchActor, deps: BatchDeps): Promise<BatchCommitResult> {
  const org = actor.orgId;
  const req = deps.actorReq(actor);
  const saved: Record<string, string> = {};
  const fail = (failure: string): BatchCommitResult => ({ ok: false, failure, saved, projectId: plan.projectId, plan });

  const need: [boolean, CrudOptions, string][] = [
    [!plan.projectId, deps.crud.project, 'create projects'],
    [plan.wbs.length > 0, deps.crud.wbs, 'create WBS items'],
    [plan.boq.length > 0, deps.crud.boq, 'create BOQ lines'],
    [plan.activities.length > 0, deps.crud.activity, 'create schedule activities'],
    [plan.productivity.length > 0, deps.crud.productivity, 'create productivity rates'],
  ];
  for (const [needed, crud, what] of need) if (needed && !deps.canWrite(actor, crud.writePerm as Permission)) return fail(`You don't have permission to ${what}, so nothing was created.`);

  let step = 'the project';
  try {
    if (!plan.projectId) {
      const { record } = await runCreate(deps.crud.project, req, plan.newProject ?? {}, true);
      plan.projectId = String(record?.id);
    }
    const projectId = plan.projectId!;
    saved['Project'] = plan.projectLabel;

    const wbsId = new Map<string, string>();
    for (const w of await prisma.wbsItem.findMany({ where: { organizationId: org, projectId }, select: { id: true, code: true } })) wbsId.set(key(w.code), w.id);
    const activityCodes = new Set((await prisma.scheduleActivity.findMany({ where: { organizationId: org, projectId }, select: { code: true } })).map((a) => key(a.code)));

    for (const w of plan.wbs) {
      step = `WBS item ${w.code}`;
      if (wbsId.has(key(w.code))) continue; // a retry: already saved
      const { record } = await runCreate(deps.crud.wbs, req, {
        projectId, code: w.code, name: w.name, unit: w.unit, quantity: w.quantity, budgetAmount: w.budgetAmount,
        parentId: w.parentCode ? wbsId.get(key(w.parentCode)) : undefined,
      }, true);
      wbsId.set(key(w.code), String(record?.id));
    }
    const boqCodes = new Set((await prisma.boqItem.findMany({ where: { organizationId: org, projectId }, select: { code: true } })).map((b) => key(b.code)));
    for (const b of plan.boq) {
      step = `BOQ line ${b.code}`;
      if (boqCodes.has(key(b.code))) continue;
      const { record } = await runCreate(deps.crud.boq, req, {
        projectId, code: b.code, description: b.description, unit: b.unit, quantity: b.quantity, rate: b.rate, category: b.category,
        wbsItemId: b.wbsCode ? wbsId.get(key(b.wbsCode)) : undefined,
      }, true);
    }
    for (const a of plan.activities) {
      step = `activity ${a.code}`;
      if (activityCodes.has(key(a.code))) continue;
      const { record } = await runCreate(deps.crud.activity, req, {
        projectId, code: a.code, name: a.name, durationDays: a.durationDays, startDate: toIso(a.startDate),
        predecessors: a.predecessors, wbsItemId: a.wbsCode ? wbsId.get(key(a.wbsCode)) : undefined,
      }, true);
      activityCodes.add(key(a.code));
    }
    const haveStd = new Set((await prisma.productivityStandard.findMany({ where: { organizationId: org }, select: { activity: true, unit: true } })).map((s) => `${key(s.activity)}|${key(s.unit)}`));
    for (const p of plan.productivity) {
      step = `productivity rate for ${p.activity}`;
      if (haveStd.has(`${key(p.activity)}|${key(p.unit)}`)) continue;
      const { record } = await runCreate(deps.crud.productivity, req, { activity: p.activity, unit: p.unit, productivityRate: p.productivityRate, standardCrewSize: p.standardCrewSize }, true);
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : 'it was rejected';
    await readBack(plan, actor, saved);
    return fail(`I stopped at ${step}: ${why}. What is already saved is listed below; send “yes” again to create the rest.`);
  }

  const mismatch = await readBack(plan, actor, saved);
  if (mismatch.length) return fail(`These could not be confirmed in the database: ${mismatch.join(', ')}.`);
  return { ok: true, saved, projectId: plan.projectId, plan };
}

/** Read back what is really stored for this plan (by code); fills `saved` and returns anything missing. */
async function readBack(plan: BatchPlan, actor: BatchActor, saved: Record<string, string>): Promise<string[]> {
  const org = actor.orgId;
  const missing: string[] = [];
  if (!plan.projectId) return missing;
  const projectId = plan.projectId;
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: org }, select: { code: true, name: true } });
  if (!project) { missing.push('the project'); return missing; }
  saved['Project'] = `${project.code} — ${project.name}`;
  const check = async (label: string, wanted: number, skipped: number, count: () => Promise<number>) => {
    if (!wanted && !skipped) return;
    const found = wanted ? await count() : 0;
    saved[label] = `${found} of ${wanted} saved and checked${skipped ? `, ${skipped} already existed` : ''}`;
    if (found < wanted) missing.push(`${wanted - found} ${label.toLowerCase()}`);
  };
  const codes = <T extends { code: string }>(l: T[]) => ({ in: l.map((x) => x.code) });
  await check('WBS items', plan.wbs.length, plan.skipped.wbs.length, () => prisma.wbsItem.count({ where: { organizationId: org, projectId, code: codes(plan.wbs) } }));
  await check('BOQ lines', plan.boq.length, plan.skipped.boq.length, () => prisma.boqItem.count({ where: { organizationId: org, projectId, code: codes(plan.boq) } }));
  await check('Schedule activities', plan.activities.length, plan.skipped.activities.length, () => prisma.scheduleActivity.count({ where: { organizationId: org, projectId, code: codes(plan.activities) } }));
  await check('Productivity rates', plan.productivity.length, plan.skipped.productivity.length, async () => {
    const rows = await prisma.productivityStandard.findMany({ where: { organizationId: org, OR: plan.productivity.map((p) => ({ activity: { equals: p.activity, mode: 'insensitive' as const }, unit: { equals: p.unit, mode: 'insensitive' as const } })) }, select: { id: true } });
    return rows.length;
  });
  return missing;
}
