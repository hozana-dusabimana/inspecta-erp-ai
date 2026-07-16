import { Request } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { CrudOptions, runCreate } from '../../lib/crud';
import { can } from '../../auth/permissions';
import { ToolSpec } from './providers';
import { createSchema as projectCreateSchema } from '../projects/projects.routes';
import { upsertSchema as clientUpsertSchema } from '../clients/clients.routes';
import { riskCrud } from '../risk/risk.routes';
import { ncrCrud } from '../qaqc/qaqc.routes';
import { costEntryCrud } from '../finance/finance.routes';

/**
 * Agentic WRITE tools for the AI Copilot. The model can create records by
 * chatting, but never writes on its own: every create is a two-step
 * preview → commit. `preview_<entity>` validates and freezes the exact would-be
 * record (persisted as an AiPendingAction) and asks the user to confirm;
 * `commit_<entity>` re-runs the frozen args through the SAME create pipeline the
 * UI uses — only after an explicit confirmation in a LATER turn, and only if the
 * acting user actually holds the write permission.
 */

/** The signed-in user the tools act as (mirrors AuthUser). */
export interface Actor {
  id: string;
  orgId: string;
  role: Role;
  email: string;
}

/** A minimal Express-request shim so the shared crud pipeline (which expects a
 * `req` for its validate/transform/afterChange/audit hooks) works off-request. */
function actorReq(actor: Actor): Request {
  return {
    user: { id: actor.id, orgId: actor.orgId, role: actor.role, email: actor.email },
    ip: 'ai-copilot',
    headers: { 'user-agent': 'inspecta-copilot' },
    query: {},
    params: {},
    body: {},
  } as unknown as Request;
}

const toJson = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

/** Normalize `YYYY-MM-DD` args to full ISO so `z.string().datetime()` accepts them. */
function normalizeDates(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = `${v}T00:00:00.000Z`;
  }
  return out;
}

/**
 * Coerce arg types to match the tool's JSON Schema — models frequently emit
 * numbers/booleans as strings in tool calls (e.g. budget: "200000000"), which
 * the underlying `z.number()`/`z.boolean()` schemas would otherwise reject.
 */
function coerceArgTypes(args: Record<string, unknown>, parameters: Record<string, unknown>): Record<string, unknown> {
  const props = (parameters.properties ?? {}) as Record<string, { type?: string }>;
  const out: Record<string, unknown> = { ...args };
  for (const [k, v] of Object.entries(out)) {
    const t = props[k]?.type;
    if ((t === 'number' || t === 'integer') && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      out[k] = Number(v);
    } else if (t === 'boolean' && typeof v === 'string') {
      out[k] = v === 'true';
    }
  }
  return out;
}

interface WriteToolDef {
  entity: string; // registry key / tool suffix, e.g. 'cost_entry'
  title: string; // human label for messages
  description: string; // shown to the model
  crud: CrudOptions; // the exact create pipeline config
  parameters: Record<string, unknown>; // JSON Schema for the model
}

// Projects and clients have bespoke inline routes (not crud), so we build a
// crud-shaped config from their EXPORTED schemas — validation stays identical.
const projectCrud: CrudOptions = {
  model: 'project',
  entity: 'project',
  readPerm: 'project:read',
  writePerm: 'project:write',
  createSchema: projectCreateSchema,
  updateSchema: projectCreateSchema.partial(),
  autoCode: { field: 'code', prefix: 'PRJ' },
  refs: [
    { field: 'clientId', model: 'client' },
    { field: 'managerId', model: 'user' },
  ],
  transform: (d) => {
    d.budget = d.budget ?? 0;
    d.progressPct = d.progressPct ?? 0;
    return d;
  },
};

const clientCrud: CrudOptions = {
  model: 'client',
  entity: 'client',
  readPerm: 'client:read',
  writePerm: 'client:write',
  createSchema: clientUpsertSchema,
  updateSchema: clientUpsertSchema.partial(),
  transform: (d) => {
    if (d.email === '') d.email = null;
    return d;
  },
};

const DEFS: Record<string, WriteToolDef> = {
  project: {
    entity: 'project',
    title: 'project',
    description: 'Create a new construction project for the organization.',
    crud: projectCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Project name' },
        description: { type: 'string' },
        location: { type: 'string', description: 'Free text, e.g. "Rwanda, Kigali, Gasabo"' },
        projectType: { type: 'string' },
        category: { type: 'string' },
        budget: { type: 'number', description: 'Total budget amount (defaults to 0)' },
        currency: { type: 'string', description: '3-letter ISO code, default RWF' },
        status: { type: 'string', enum: ['PLANNING', 'ACTIVE', 'ON_HOLD', 'AT_RISK', 'COMPLETED', 'CANCELLED'] },
        plannedProfitMargin: { type: 'number', description: 'Percent 0-100' },
        clientId: { type: 'string', description: 'Existing client id — call list_clients to resolve a client name' },
        managerId: { type: 'string', description: 'Existing user id of the project manager' },
        startDate: { type: 'string', description: 'ISO 8601 date/datetime' },
        endDate: { type: 'string', description: 'ISO 8601 date/datetime' },
      },
    },
  },
  client: {
    entity: 'client',
    title: 'client',
    description: 'Create a new client / customer (needed before linking one to a project).',
    crud: clientCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string' },
        clientType: { type: 'string', enum: ['private', 'government', 'individual'] },
        contactName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string' },
        taxNumber: { type: 'string' },
      },
    },
  },
  risk: {
    entity: 'risk',
    title: 'risk',
    description: 'Log a project risk. Score = probability × impact (auto-computed).',
    crud: riskCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'title', 'probability', 'impact'],
      properties: {
        projectId: { type: 'string', description: 'Existing project id — call list_projects to resolve a name' },
        title: { type: 'string' },
        category: { type: 'string' },
        probability: { type: 'integer', minimum: 1, maximum: 5 },
        impact: { type: 'integer', minimum: 1, maximum: 5 },
        status: { type: 'string', enum: ['OPEN', 'MITIGATING', 'CLOSED'] },
        mitigation: { type: 'string' },
        owner: { type: 'string' },
      },
    },
  },
  ncr: {
    entity: 'ncr',
    title: 'NCR (non-conformance report)',
    description: 'Raise a non-conformance report against a project. The NCR number is auto-generated.',
    crud: ncrCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'description'],
      properties: {
        projectId: { type: 'string', description: 'Existing project id — call list_projects to resolve a name' },
        description: { type: 'string' },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        status: { type: 'string', enum: ['DRAFT', 'OPEN', 'IN_PROGRESS', 'INVESTIGATING', 'CORRECTIVE_ACTION', 'CLOSED'] },
        rootCause: { type: 'string' },
        correctiveAction: { type: 'string' },
        responsiblePerson: { type: 'string' },
        dueDate: { type: 'string', description: 'ISO 8601 date/datetime' },
      },
    },
  },
  cost_entry: {
    entity: 'cost_entry',
    title: 'cost entry',
    description: 'Record an actual cost against a project.',
    crud: costEntryCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'description', 'amount'],
      properties: {
        projectId: { type: 'string', description: 'Existing project id — call list_projects to resolve a name' },
        category: { type: 'string', enum: ['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCONTRACTOR', 'OVERHEAD', 'OTHER'] },
        description: { type: 'string' },
        amount: { type: 'number', minimum: 0 },
        date: { type: 'string', description: 'ISO 8601 date/datetime' },
      },
    },
  },
};

const LOOKUP_SPECS: ToolSpec[] = [
  {
    name: 'list_projects',
    description: 'List existing projects (id, code, name, status) to resolve a project name to its id.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'list_clients',
    description: 'List existing clients (id, name, type) to resolve a client name to its id.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
];

/** All tool specs exposed to the model (lookups + preview/commit per entity). */
export function writeToolSpecs(): ToolSpec[] {
  const specs: ToolSpec[] = [...LOOKUP_SPECS];
  for (const [key, def] of Object.entries(DEFS)) {
    specs.push({
      name: `preview_${key}`,
      description: `Validate and PREVIEW creating a ${def.title} (does NOT save). ${def.description} Show the preview and ask the user to confirm.`,
      parameters: def.parameters,
    });
    specs.push({
      name: `commit_${key}`,
      description: `Save the ${def.title} the user just previewed and confirmed. Only call this after the user explicitly confirms, in a later message.`,
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    });
  }
  return specs;
}

export function isWriteToolName(name: string): boolean {
  if (name === 'list_projects' || name === 'list_clients') return true;
  const m = /^(preview|commit)_(.+)$/.exec(name);
  return !!m && !!DEFS[m[2]];
}

/** Per-request context so a preview and its commit can't happen in one turn. */
export interface ToolRunContext {
  conversationId: string;
  /** Pending-action ids created during THIS request (block same-turn commit). */
  sameTurnPendingIds: Set<string>;
}

async function previewWrite(entity: string, args: Record<string, unknown>, actor: Actor, ctx: ToolRunContext) {
  const def = DEFS[entity];
  if (!def) return { error: `Unknown entity "${entity}".` };
  if (!can(actor.role, def.crud.writePerm)) {
    return { error: `You do not have permission to create a ${def.title}.` };
  }
  const body = normalizeDates(coerceArgTypes(args, def.parameters));
  let data: Record<string, unknown>;
  try {
    ({ data } = await runCreate(def.crud, actorReq(actor), body, false));
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Validation failed.' };
  }
  const pending = await prisma.aiPendingAction.create({
    data: {
      conversationId: ctx.conversationId,
      organizationId: actor.orgId,
      userId: actor.id,
      tool: `create_${entity}`,
      entity,
      argsJson: toJson(body),
      previewJson: toJson(data),
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  ctx.sameTurnPendingIds.add(pending.id);
  return {
    needsConfirmation: true,
    entity,
    preview: previewFields(data),
    message: `Preview ready. Show these fields to the user and ask them to confirm before it is saved.`,
  };
}

async function commitWrite(entity: string, actor: Actor, ctx: ToolRunContext) {
  const def = DEFS[entity];
  if (!def) return { error: `Unknown entity "${entity}".` };
  const pending = await prisma.aiPendingAction.findFirst({
    where: { conversationId: ctx.conversationId, userId: actor.id, entity, status: 'pending', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!pending) {
    return { error: `Nothing to confirm — preview creating a ${def.title} first, then ask the user to confirm.` };
  }
  if (ctx.sameTurnPendingIds.has(pending.id)) {
    return { error: `Do not confirm on the user's behalf. Show the preview and wait for the user to confirm in their next message.` };
  }
  if (!can(actor.role, def.crud.writePerm)) {
    return { error: `You do not have permission to create a ${def.title}.` };
  }
  let record: Record<string, unknown> | undefined;
  try {
    ({ record } = await runCreate(def.crud, actorReq(actor), pending.argsJson as Record<string, unknown>, true));
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Create failed.' };
  }
  await prisma.aiPendingAction.update({ where: { id: pending.id }, data: { status: 'committed' } });
  return { created: true, entity, id: record?.id, saved: previewFields(record ?? {}) };
}

async function listProjects(actor: Actor) {
  if (!can(actor.role, 'project:read')) return { error: 'You do not have permission to view projects.' };
  const rows = await prisma.project.findMany({
    where: { organizationId: actor.orgId },
    select: { id: true, code: true, name: true, status: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { projects: rows };
}

async function listClients(actor: Actor) {
  if (!can(actor.role, 'client:read')) return { error: 'You do not have permission to view clients.' };
  const rows = await prisma.client.findMany({
    where: { organizationId: actor.orgId },
    select: { id: true, name: true, clientType: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { clients: rows };
}

/** Strip internal/empty fields from a would-be record for a clean preview. */
function previewFields(data: Record<string, unknown>): Record<string, unknown> {
  const HIDE = new Set(['organizationId', 'createdBy', 'updatedBy', 'id', 'createdAt', 'updatedAt']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (HIDE.has(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

// The whole (normalized) user message must BE one of these to count as a bare
// confirmation. Kept strict so "create a project X" can't trigger a commit.
const AFFIRMATIONS = new Set([
  'y', 'yes', 'yep', 'yeah', 'yup', 'ya', 'ok', 'okay', 'k', 'sure', 'fine',
  'confirm', 'confirmed', 'confirm it', 'go', 'go ahead', 'do it', 'create it',
  'save it', 'save', 'proceed', 'please do', 'yes please', 'looks good', 'correct',
  'yes create it', 'yes save it', 'yes confirm', 'yes do it', 'go for it', 'approved',
]);

function isAffirmation(prompt: string): boolean {
  const norm = prompt.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return AFFIRMATIONS.has(norm);
}

/**
 * Deterministic confirmation: if the user's message is a bare affirmation and an
 * unexpired pending action (from a PREVIOUS turn's preview) exists, commit it
 * server-side — bypassing the model, which is unreliable at the second step.
 * Every safety property is preserved: the pending action can only exist because
 * the user was already shown a preview; permission is re-checked here; org is
 * forced; the frozen args are used. Returns an assistant message, or null to let
 * the normal agent loop handle the turn.
 */
export async function tryConfirmPending(prompt: string, actor: Actor, conversationId: string): Promise<string | null> {
  if (!isAffirmation(prompt)) return null;
  const pending = await prisma.aiPendingAction.findFirst({
    where: { conversationId, userId: actor.id, status: 'pending', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!pending) return null;
  const def = DEFS[pending.entity];
  if (!def) return null;
  if (!can(actor.role, def.crud.writePerm)) {
    await prisma.aiPendingAction.update({ where: { id: pending.id }, data: { status: 'cancelled' } });
    return `You don't have permission to create a ${def.title}, so I didn't save it.`;
  }
  let record: Record<string, unknown> | undefined;
  try {
    ({ record } = await runCreate(def.crud, actorReq(actor), pending.argsJson as Record<string, unknown>, true));
  } catch (e) {
    return `I couldn't save the ${def.title}: ${e instanceof Error ? e.message : 'validation failed'}.`;
  }
  await prisma.aiPendingAction.update({ where: { id: pending.id }, data: { status: 'committed' } });
  const label = (record?.code as string) || (record?.name as string) || (record?.id as string) || '';
  const fields = previewFields(record ?? {});
  const lines = Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return `Done — I've created the ${def.title}${label ? ` (${label})` : ''}.\n${lines}`;
}

/** Execute one tool call from the agent loop. Never throws — returns a result
 * object (including `{ error }`) that is fed back to the model as a tool message. */
export async function executeWriteTool(
  name: string,
  args: Record<string, unknown>,
  actor: Actor,
  ctx: ToolRunContext,
): Promise<unknown> {
  if (name === 'list_projects') return listProjects(actor);
  if (name === 'list_clients') return listClients(actor);
  const preview = /^preview_(.+)$/.exec(name);
  if (preview) return previewWrite(preview[1], args, actor, ctx);
  const commit = /^commit_(.+)$/.exec(name);
  if (commit) return commitWrite(commit[1], actor, ctx);
  return { error: `Unknown tool "${name}".` };
}
