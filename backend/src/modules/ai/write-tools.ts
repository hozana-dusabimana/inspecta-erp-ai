import { Request } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { CrudOptions, runCreate } from '../../lib/crud';
import { wbsCreate, boqCreate } from '../planning/planning.routes';
import { activitySchema as activityCreate } from '../scheduling/scheduling.routes';
import { createSchema as productionCreate } from '../production/production.routes';
import { usageSchema as usageCreate } from '../equipment/equipment.routes';
import { Permission, resolvePermissions } from '../../auth/permissions';
import { actorCan } from '../../middleware/auth';
import { ToolSpec } from './providers';
import { readFileFromUrl } from './file-reader';
import { createSchema as projectCreateSchema } from '../projects/projects.routes';
import { upsertSchema as clientUpsertSchema } from '../clients/clients.routes';
import { riskCrud } from '../risk/risk.routes';
import { ncrCrud } from '../qaqc/qaqc.routes';
import { costEntryCrud } from '../finance/finance.routes';
import { materialCreate, movementCrud, requirementCrud } from '../inventory/inventory.routes';
import { supplierCrud } from '../procurement/procurement.routes';

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
  /** Resolved permissions (tenant-defined role or the static matrix). Optional
   *  so older call sites still type-check; `actorCan` falls back to the matrix. */
  permissions?: Permission[];
}

/** A minimal Express-request shim so the shared crud pipeline (which expects a
 * `req` for its validate/transform/afterChange/audit hooks) works off-request. */
function actorReq(actor: Actor): Request {
  return {
    user: {
      id: actor.id, orgId: actor.orgId, role: actor.role, email: actor.email,
      permissions: actor.permissions ?? resolvePermissions(actor.role),
    },
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
  const props = (parameters.properties ?? {}) as Record<string, { type?: string; enum?: string[] }>;
  const norm = (s: string) => s.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const out: Record<string, unknown> = { ...args };
  for (const [k, v] of Object.entries(out)) {
    const t = props[k]?.type;
    const allowed = props[k]?.enum;
    if ((t === 'number' || t === 'integer') && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      out[k] = Number(v);
    } else if (t === 'boolean' && typeof v === 'string') {
      out[k] = v === 'true';
    } else if (allowed && typeof v === 'string') {
      const match = allowed.find((e) => norm(e) === norm(v));
      if (match) out[k] = match;
    }
  }
  return out;
}

interface WriteToolDef {
  entity: string; // registry key / tool suffix, e.g. 'cost_entry'
  title: string; // human label for messages
  description: string; // shown to the model
  /** Fields to ask the user about (one at a time) BEFORE previewing. */
  intake: string;
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

// Material register: the UI requires a code, but for the chat flow we make it
// optional and auto-generate MAT-#### so the user doesn't have to invent one.
const materialCrud: CrudOptions = {
  model: 'material',
  entity: 'material',
  readPerm: 'inventory:read',
  writePerm: 'inventory:write',
  createSchema: materialCreate.extend({ code: z.string().min(1).optional() }),
  updateSchema: materialCreate.partial(),
  autoCode: { field: 'code', prefix: 'MAT' },
  refs: [{ field: 'supplierId', model: 'supplier' }],
};

const DAY_MS = 24 * 60 * 60 * 1000;

const wbsCrud: CrudOptions = {
  model: 'wbsItem',
  entity: 'wbs-item',
  readPerm: 'planning:read',
  writePerm: 'planning:write',
  createSchema: wbsCreate,
  updateSchema: wbsCreate.partial(),
  requireProject: true,
  refs: [{ field: 'parentId', model: 'wbsItem' }],
};

const boqCrud: CrudOptions = {
  model: 'boqItem',
  entity: 'boq-item',
  readPerm: 'planning:read',
  writePerm: 'planning:write',
  createSchema: boqCreate,
  updateSchema: boqCreate.partial(),
  requireProject: true,
  refs: [{ field: 'wbsItemId', model: 'wbsItem' }],
  transform: (d) => {
    const cost = Number(d.quantity ?? 0) * Number(d.rate ?? 0);
    d.amount = cost;
    d.budget = cost + (cost * Number(d.markupPct ?? 0)) / 100 + (cost * Number(d.contingencyPct ?? 0)) / 100;
    return d;
  },
};

const scheduleCrud: CrudOptions = {
  model: 'scheduleActivity',
  entity: 'schedule-activity',
  readPerm: 'scheduling:read',
  writePerm: 'scheduling:write',
  createSchema: activityCreate,
  updateSchema: activityCreate.partial(),
  requireProject: true,
  refs: [{ field: 'wbsItemId', model: 'wbsItem' }],
  transform: (d) => {
    const start = d.startDate as Date | undefined;
    const duration = Number(d.durationDays ?? 0);
    if (start instanceof Date && duration > 0) d.finishDate = new Date(start.getTime() + duration * DAY_MS);
    return d;
  },
};

const productionCrud: CrudOptions = {
  model: 'productionEntry',
  entity: 'production-entry',
  readPerm: 'production:read',
  writePerm: 'production:write',
  createSchema: productionCreate,
  updateSchema: productionCreate.partial(),
  requireProject: true,
  refs: [
    { field: 'wbsItemId', model: 'wbsItem' },
    { field: 'equipmentId', model: 'equipment' },
  ],
};

const equipmentUsageCrud: CrudOptions = {
  model: 'equipmentUsageLog',
  entity: 'equipment-usage-log',
  readPerm: 'equipment:read',
  writePerm: 'equipment:write',
  createSchema: usageCreate,
  updateSchema: usageCreate.partial(),
  refs: [
    { field: 'equipmentId', model: 'equipment' },
    { field: 'wbsItemId', model: 'wbsItem' },
  ],
};

const DEFS: Record<string, WriteToolDef> = {
  project: {
    entity: 'project',
    title: 'project',
    description: 'Create a new construction project for the organization.',
    intake: 'the client, location, total budget, start date, end date, and project manager',
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
    intake: 'the client type (private/government/individual), contact person, email, phone, and address',
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
    intake: 'which project, the risk title, probability (1-5), impact (1-5), category, owner, and mitigation',
    crud: riskCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'title', 'probability', 'impact'],
      properties: {
        projectId: { type: 'string', description: 'Existing project id — call list_projects to resolve a name' },
        title: { type: 'string' },
        // Mirrors RISK_CATEGORY_OPTIONS in frontend/src/formConfigs.tsx (creatable — see CREATABLE_ENUM_FIELDS).
        category: { type: 'string', enum: ['Safety', 'Financial', 'Schedule', 'Technical', 'Environmental', 'Contractual', 'Quality', 'Resource', 'Regulatory', 'Weather'] },
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
    intake: 'which project, the description of the non-conformance, severity, root cause, responsible person, and due date',
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
    intake: 'which project, the cost description, amount, category (labor/material/equipment/...), and date',
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
  wbs_item: {
    entity: 'wbs_item',
    title: 'WBS item',
    description: 'Add a work breakdown structure item to a project.',
    intake: 'which project, the WBS code and name, the parent item if nested, unit, quantity and budget amount',
    crud: wbsCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'code', 'name'],
      properties: {
        projectId: { type: 'string', description: 'Existing project id — call list_projects to resolve a name' },
        parentId: { type: 'string', description: 'Parent WBS item id, if nested' },
        code: { type: 'string', description: 'WBS code, e.g. 1.2.3' },
        name: { type: 'string' },
        description: { type: 'string' },
        unit: { type: 'string' },
        quantity: { type: 'number', minimum: 0 },
        budgetAmount: { type: 'number', minimum: 0 },
      },
    },
  },
  boq_item: {
    entity: 'boq_item',
    title: 'BOQ line',
    description: 'Add a bill of quantities line to a project. Amount and budget are computed from quantity, rate, markup and contingency.',
    intake: 'which project, the BOQ code and description, quantity, unit rate, unit, category, the WBS item it belongs to, and markup and contingency percentages',
    crud: boqCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'wbsCode', 'code', 'description', 'quantity', 'rate'],
      properties: {
        projectId: { type: 'string', description: 'Existing project id — call list_projects to resolve a name' },
        wbsCode: { type: 'string', description: 'WBS code this line belongs to, e.g. 1.2.3' },
        code: { type: 'string' },
        category: { type: 'string' },
        description: { type: 'string' },
        unit: { type: 'string' },
        quantity: { type: 'number', minimum: 0 },
        rate: { type: 'number', minimum: 0 },
        markupPct: { type: 'number', minimum: 0, maximum: 100 },
        contingencyPct: { type: 'number', minimum: 0, maximum: 100 },
      },
    },
  },
  schedule_activity: {
    entity: 'schedule_activity',
    title: 'schedule activity',
    description: 'Add an activity to a project schedule. The finish date is computed from start date and duration.',
    intake: 'which project, the activity code and name, duration in days, start date, the WBS item it belongs to, and any predecessors',
    crud: scheduleCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'wbsCode', 'code', 'name', 'durationDays'],
      properties: {
        projectId: { type: 'string', description: 'Existing project id — call list_projects to resolve a name' },
        wbsCode: { type: 'string', description: 'WBS code this activity belongs to, e.g. 1.2.3' },
        code: { type: 'string' },
        name: { type: 'string' },
        durationDays: { type: 'integer', minimum: 1 },
        startDate: { type: 'string', description: 'ISO 8601 date/datetime' },
        predecessors: { type: 'array', items: { type: 'string' }, description: 'Predecessor activity ids' },
        progressPct: { type: 'number', minimum: 0, maximum: 100 },
        milestone: { type: 'boolean' },
      },
    },
  },
  production_entry: {
    entity: 'production_entry',
    title: 'production entry',
    description: 'Record a daily production entry against a project activity.',
    intake: 'which project, the activity description, planned and actual quantities, the date, and labour and equipment hours',
    crud: productionCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'wbsCode', 'wbsActivity', 'plannedQty', 'actualQty'],
      properties: {
        projectId: { type: 'string', description: 'Existing project id — call list_projects to resolve a name' },
        wbsActivity: { type: 'string', description: 'Activity description, e.g. "Excavation, zone A"' },
        wbsCode: { type: 'string', description: 'WBS code this production is recorded against, e.g. 1.2.3' },
        date: { type: 'string', description: 'ISO 8601 date/datetime' },
        plannedQty: { type: 'number', minimum: 0 },
        actualQty: { type: 'number', minimum: 0 },
        laborHours: { type: 'number', minimum: 0 },
        equipmentHours: { type: 'number', minimum: 0 },
        weatherCondition: { type: 'string' },
        remarks: { type: 'string' },
      },
    },
  },
  equipment_usage: {
    entity: 'equipment_usage',
    title: 'equipment usage log',
    description: 'Log hours of equipment use, optionally against a project and WBS item.',
    intake: 'which equipment (id), hours used, the date, the project and WBS item if any',
    crud: equipmentUsageCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['equipmentId', 'projectId', 'wbsCode', 'hoursUsed'],
      properties: {
        equipmentId: { type: 'string', description: 'Existing equipment id' },
        projectId: { type: 'string', description: 'Existing project id' },
        wbsCode: { type: 'string', description: 'WBS code this usage is charged to, e.g. 1.2.3' },
        date: { type: 'string', description: 'ISO 8601 date/datetime' },
        hoursUsed: { type: 'number', minimum: 0 },
        note: { type: 'string' },
      },
    },
  },
  // ── Inventory ──
  material: {
    entity: 'material',
    title: 'material',
    description: 'Add a material to the inventory register (code auto-generated).',
    intake: 'the unit of measure, category, reorder level, unit cost, and preferred supplier',
    crud: materialCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string' },
        // Mirrors MATERIAL_CATEGORY_OPTIONS in frontend/src/formConfigs.tsx (creatable — see CREATABLE_ENUM_FIELDS).
        category: { type: 'string', enum: ['Cement & Concrete', 'Aggregates', 'Steel & Rebar', 'Timber', 'Blocks & Bricks', 'Roofing', 'Electrical', 'Plumbing', 'Paints & Finishes', 'Hardware', 'Sanitary', 'Tiles', 'Glass & Aluminium', 'Fuel & Lubricants', 'Safety / PPE'] },
        unit: { type: 'string', description: 'e.g. bag, kg, m3, litre' },
        reorderLevel: { type: 'number' },
        unitCost: { type: 'number' },
        supplierId: { type: 'string', description: 'Existing supplier id' },
      },
    },
  },
  stock_movement: {
    entity: 'stock_movement',
    title: 'stock movement',
    description: 'Record a stock movement (receipt, issue, adjustment, waste…) for a material.',
    intake: 'which material, the movement type, quantity, unit cost, project, and a reference or note',
    crud: movementCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['materialId', 'type', 'quantity'],
      properties: {
        materialId: { type: 'string' },
        type: { type: 'string', enum: ['RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER', 'RETURN', 'WASTE', 'OPENING'] },
        quantity: { type: 'number', minimum: 0 },
        unitCost: { type: 'number' },
        projectId: { type: 'string' },
        reference: { type: 'string' },
        note: { type: 'string' },
        date: { type: 'string', description: 'ISO 8601 date/datetime' },
      },
    },
  },
  material_requirement: {
    entity: 'material_requirement',
    title: 'material requirement',
    description: 'Plan a material requirement (planned quantity) for a project.',
    intake: 'the material, planned quantity, required-by date, supplier and lead time',
    crud: requirementCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'materialId', 'plannedQuantity'],
      properties: {
        projectId: { type: 'string' },
        materialId: { type: 'string' },
        plannedQuantity: { type: 'number', minimum: 0 },
        requiredByDate: { type: 'string', description: 'ISO 8601 date/datetime' },
        supplierId: { type: 'string' },
        leadTimeDays: { type: 'integer', minimum: 0 },
        note: { type: 'string' },
      },
    },
  },
  // ── Procurement ──
  supplier: {
    entity: 'supplier',
    title: 'supplier',
    description: 'Add a supplier / vendor.',
    intake: 'the category, contact person, email, phone, TIN, payment terms and lead time',
    crud: supplierCrud,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string' },
        // Mirrors SUPPLIER_CATEGORY_OPTIONS in frontend/src/formConfigs.tsx (creatable — see CREATABLE_ENUM_FIELDS).
        category: { type: 'string', enum: ['Cement & Concrete', 'Aggregates', 'Steel & Rebar', 'Timber', 'Electrical', 'Plumbing', 'Finishes', 'Hardware', 'Equipment Rental', 'Transport', 'Fuel', 'Professional Services', 'Subcontractor'] },
        contactName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        tinNumber: { type: 'string' },
        paymentTerms: { type: 'string' },
        leadTimeDays: { type: 'integer', minimum: 0 },
      },
    },
  },
};

/** In-app pages the Copilot can open on the user's behalf (mirrors frontend/src/lib/routes.ts). */
export const NAV_PAGES: Record<string, string> = {
  '/dashboard': 'Dashboard', '/executive': 'Executive dashboard', '/portfolio': 'Portfolio',
  '/planning': 'Planning & Resources', '/planning-dashboards': 'Planning dashboards', '/scheduling': 'Scheduling (CPM)',
  '/human-resources': 'Human Resources', '/payroll': 'Labor & Payroll', '/point-of-sale': 'Point of Sale',
  '/equipment': 'Equipment', '/production': 'Production', '/field-ops': 'Field Operations',
  '/finance': 'Finance & Cost Control', '/profitability': 'Profitability', '/inventory': 'Inventory',
  '/requisitions': 'Material Requisitions', '/procurement': 'Procurement', '/qaqc': 'Quality & Compliance',
  '/hse': 'Safety (HSE)', '/risk': 'Risk Register', '/approvals': 'Approvals', '/documents': 'Documents',
  '/reports': 'Reports', '/notifications': 'Notifications', '/daily-entry': 'Daily Entry',
  '/admin': 'Admin', '/billing': 'Billing & AI credits',
};

const LOOKUP_SPECS: ToolSpec[] = [
  {
    name: 'open_page',
    description: 'Take the user to a page of the ERP (e.g. \"open inventory\", \"go to the risk register\", \"show me approvals\"). Use it whenever the user asks to open/go to/see a module or page.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['page'],
      properties: { page: { type: 'string', enum: Object.keys(NAV_PAGES), description: 'Path of the page to open' } },
    },
  },
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
  {
    name: 'read_file',
    description:
      'Read a file attached to a record (a link from an attachments field: PDF, Word, Excel, PowerPoint, text, image/photo or audio) ' +
      'and return its text — documents are extracted, photos are described/transcribed, audio is transcribed. Optionally pass `question` to focus on an image.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'The attachment link (https://res.cloudinary.com/...)' },
        question: { type: 'string', description: 'What to look for (images only)' },
      },
    },
  },
];

// Single tool the model calls to KICK OFF a create. After this, the server drives
// a deterministic field-by-field intake (input widgets), so data collection never
// depends on the model behaving across turns.
const START_CREATE_SPEC: ToolSpec = {
  name: 'start_create',
  description:
    'Begin creating a record when the user wants to create/add a project, client, risk, NCR, cost entry, ' +
    'material, stock movement (receipt/issue/adjustment), material requirement, or supplier. ' +
    'Pass any values the user already stated in `values` (e.g. name, budget, quantity). ' +
    'After you call this, the SYSTEM collects the remaining fields from the user via input widgets — do NOT ask for fields yourself and do NOT preview; just briefly acknowledge (one short sentence).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['entity'],
    properties: {
      entity: { type: 'string', enum: ['project', 'client', 'risk', 'ncr', 'cost_entry', 'material', 'stock_movement', 'material_requirement', 'supplier'] },
      values: { type: 'object', description: 'Fields the user already provided, e.g. {"name":"...","quantity":100}', additionalProperties: true },
    },
  },
};

/** Tool specs exposed to the model: start_create + read lookups. */
export function writeToolSpecs(): ToolSpec[] {
  return [START_CREATE_SPEC, ...LOOKUP_SPECS];
}

export function isWriteToolName(name: string): boolean {
  if (name === 'list_projects' || name === 'list_clients' || name === 'read_file' || name === 'open_page') return true;
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
  if (!actorCan(actor, def.crud.writePerm)) {
    return { error: `You do not have permission to create a ${def.title}.` };
  }
  const body = normalizeDates(coerceArgTypes(args, def.parameters));
  let data: Record<string, unknown>;
  try {
    ({ data } = await runCreate(def.crud, actorReq(actor), await withWbsItem(body, actor, entity), false));
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
  if (!actorCan(actor, def.crud.writePerm)) {
    return { error: `You do not have permission to create a ${def.title}.` };
  }
  let record: Record<string, unknown> | undefined;
  try {
    ({ record } = await runCreate(def.crud, actorReq(actor), await withWbsItem(pending.argsJson as Record<string, unknown>, actor, pending.entity), true));
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Create failed.' };
  }
  await prisma.aiPendingAction.update({ where: { id: pending.id }, data: { status: 'committed' } });
  return { created: true, entity, id: record?.id, saved: previewFields(record ?? {}) };
}

async function listProjects(actor: Actor) {
  if (!actorCan(actor, 'project:read')) return { error: 'You do not have permission to view projects.' };
  const rows = await prisma.project.findMany({
    where: { organizationId: actor.orgId },
    select: { id: true, code: true, name: true, status: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { projects: rows };
}

async function listClients(actor: Actor) {
  if (!actorCan(actor, 'client:read')) return { error: 'You do not have permission to view clients.' };
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
  if (!actorCan(actor, def.crud.writePerm)) {
    await prisma.aiPendingAction.update({ where: { id: pending.id }, data: { status: 'cancelled' } });
    return `You don't have permission to create a ${def.title}, so I didn't save it.`;
  }
  let record: Record<string, unknown> | undefined;
  try {
    ({ record } = await runCreate(def.crud, actorReq(actor), await withWbsItem(pending.argsJson as Record<string, unknown>, actor, pending.entity), true));
  } catch (e) {
    return `I couldn't save the ${def.title}: ${e instanceof Error ? e.message : 'validation failed'}.`;
  }
  await prisma.aiPendingAction.update({ where: { id: pending.id }, data: { status: 'committed' } });
  const label = (record?.code as string) || (record?.name as string) || (record?.id as string) || '';
  const fields = previewFields(record ?? {});
  const lines = Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return `Done — I've created the ${def.title}${label ? ` (${label})` : ''}.\n${lines}`;
}

// ──────────────── Guided (deterministic) create sessions ────────────────
// The model only calls start_create; from there the server asks for one field
// at a time via typed input widgets. Sessions live in AiPendingAction:
//   status 'collecting' → gathering fields (argsJson = values, previewJson = {skipped})
//   status 'pending'    → all fields in, preview built (previewJson = resolved record)
//   status 'committed' | 'cancelled' → terminal.

export interface FieldOption { value: string; label: string }
export interface FieldSpec {
  entity: string;
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  required: boolean;
  options?: FieldOption[];
  allowAdd?: boolean; // reference field → offer "add new"
  addLabel?: string;
}
export interface GuidedResult {
  text?: string;
  field?: FieldSpec;
  preview?: { entity: string; title: string; fields: Record<string, unknown> };
  created?: { entity: string; id?: string; fields: Record<string, unknown> };
  done?: boolean;
  error?: string;
  sessionActive?: boolean;
}

// Field collection order per entity (required first). Optional ones are skippable.
const FIELD_ORDER: Record<string, string[]> = {
  project: ['name', 'clientId', 'location', 'budget', 'startDate', 'endDate', 'managerId'],
  client: ['name', 'clientType', 'contactName', 'email', 'phone', 'address'],
  risk: ['projectId', 'title', 'probability', 'impact', 'category', 'owner', 'mitigation'],
  ncr: ['projectId', 'description', 'severity', 'rootCause', 'responsiblePerson', 'dueDate'],
  cost_entry: ['projectId', 'description', 'amount', 'category', 'date'],
  material: ['name', 'category', 'unit', 'reorderLevel', 'unitCost', 'supplierId'],
  stock_movement: ['materialId', 'type', 'quantity', 'unitCost', 'projectId', 'reference', 'note', 'date'],
  material_requirement: ['projectId', 'materialId', 'plannedQuantity', 'requiredByDate', 'supplierId', 'leadTimeDays', 'note'],
  supplier: ['name', 'category', 'contactName', 'email', 'phone', 'tinNumber', 'paymentTerms', 'leadTimeDays'],
  wbs_item: ['projectId', 'code', 'name', 'parentId', 'unit', 'quantity', 'budgetAmount', 'description'],
  boq_item: ['projectId', 'code', 'description', 'quantity', 'rate', 'unit', 'category', 'wbsCode', 'markupPct', 'contingencyPct'],
  schedule_activity: ['projectId', 'code', 'name', 'durationDays', 'wbsCode', 'startDate', 'predecessors', 'milestone'],
  production_entry: ['projectId', 'wbsActivity', 'plannedQty', 'actualQty', 'date', 'wbsCode', 'laborHours', 'equipmentHours', 'remarks'],
  equipment_usage: ['projectId', 'equipmentId', 'wbsCode', 'hoursUsed', 'date', 'note'],
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', clientId: 'Client', location: 'Location', budget: 'Budget',
  startDate: 'Start date', endDate: 'End date', managerId: 'Project manager',
  clientType: 'Client type', contactName: 'Contact person', email: 'Email', phone: 'Phone', address: 'Address',
  projectId: 'Project', title: 'Title', probability: 'Probability (1-5)', impact: 'Impact (1-5)',
  category: 'Category', owner: 'Owner', mitigation: 'Mitigation',
  description: 'Description', severity: 'Severity', rootCause: 'Root cause',
  responsiblePerson: 'Responsible person', dueDate: 'Due date', amount: 'Amount', date: 'Date',
  unit: 'Unit', reorderLevel: 'Reorder level', unitCost: 'Unit cost', supplierId: 'Supplier',
  materialId: 'Material', type: 'Movement type', quantity: 'Quantity', reference: 'Reference', note: 'Note',
  plannedQuantity: 'Planned quantity', requiredByDate: 'Required by', leadTimeDays: 'Lead time (days)',
  tinNumber: 'TIN (tax number)', paymentTerms: 'Payment terms',
  wbsCode: 'WBS code', code: 'Code', durationDays: 'Duration (days)', wbsActivity: 'Activity',
  plannedQty: 'Planned quantity', actualQty: 'Actual quantity', equipmentId: 'Equipment', hoursUsed: 'Hours used', rate: 'Unit rate',
};

type RefModel = 'client' | 'project' | 'user' | 'material' | 'supplier';
const REFERENCES: Record<string, { model: RefModel; allowAdd: boolean; addLabel?: string }> = {
  clientId: { model: 'client', allowAdd: true, addLabel: 'Add a new client' },
  projectId: { model: 'project', allowAdd: true, addLabel: 'Add a new project' },
  managerId: { model: 'user', allowAdd: false },
  materialId: { model: 'material', allowAdd: true, addLabel: 'Add a new material' },
  supplierId: { model: 'supplier', allowAdd: true, addLabel: 'Add a new supplier' },
};

const DATE_FIELDS_G = new Set(['startDate', 'endDate', 'dueDate', 'date', 'requiredByDate']);

// `entity.field` enum selects that also accept a typed-in custom value, mirroring the
// forms' creatable category selects (frontend/src/formConfigs.tsx → pick()/creatable).
const CREATABLE_ENUM_FIELDS = new Set(['material.category', 'supplier.category', 'risk.category']);

const SESSION_TTL_MS = 30 * 60 * 1000;

async function referenceOptions(model: RefModel, orgId: string): Promise<FieldOption[]> {
  if (model === 'client') {
    const rows = await prisma.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 });
    return rows.map((r) => ({ value: r.id, label: r.name }));
  }
  if (model === 'project') {
    const rows = await prisma.project.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }));
  }
  if (model === 'material') {
    const rows = await prisma.material.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' }, take: 200 });
    return rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }));
  }
  if (model === 'supplier') {
    const rows = await prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 });
    return rows.map((r) => ({ value: r.id, label: r.name }));
  }
  const rows = await prisma.user.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, fullName: true, email: true }, orderBy: { fullName: 'asc' }, take: 200 });
  return rows.map((r) => ({ value: r.id, label: r.fullName || r.email }));
}

async function buildFieldSpec(entity: string, field: string, actor: Actor): Promise<FieldSpec> {
  const def = DEFS[entity];
  const props = (def.parameters.properties ?? {}) as Record<string, { type?: string; enum?: string[] }>;
  const prop = props[field] ?? {};
  const required = (((def.parameters.required as string[]) ?? [])).includes(field);
  const label = FIELD_LABELS[field] ?? field;
  const ref = REFERENCES[field];
  if (ref) {
    return { entity, name: field, label, type: 'select', required, options: await referenceOptions(ref.model, actor.orgId), allowAdd: ref.allowAdd, addLabel: ref.addLabel };
  }
  if (prop.enum) {
    const creatable = CREATABLE_ENUM_FIELDS.has(`${entity}.${field}`);
    return {
      entity, name: field, label, type: 'select', required,
      options: prop.enum.map((v) => ({ value: v, label: v })),
      ...(creatable ? { allowAdd: true, addLabel: 'Other / custom…' } : {}),
    };
  }
  if (prop.type === 'number' || prop.type === 'integer') return { entity, name: field, label, type: 'number', required };
  if (DATE_FIELDS_G.has(field)) return { entity, name: field, label, type: 'date', required };
  return { entity, name: field, label, type: 'text', required };
}

type SessionRow = { id: string; entity: string; argsJson: unknown; previewJson: unknown };

function collectedOf(session: SessionRow): { values: Record<string, unknown>; skipped: string[] } {
  const values = (session.argsJson as Record<string, unknown>) ?? {};
  const skipped = (((session.previewJson as { skipped?: string[] })?.skipped) ?? []) as string[];
  return { values, skipped };
}

function nextFieldName(entity: string, values: Record<string, unknown>, skipped: string[]): string | null {
  for (const f of FIELD_ORDER[entity] ?? []) {
    const v = values[f];
    if (v !== undefined && v !== null && v !== '') continue;
    if (skipped.includes(f)) continue;
    return f;
  }
  return null;
}

function activeSession(conversationId: string, userId: string, statuses: string[]) {
  return prisma.aiPendingAction.findFirst({
    where: { conversationId, userId, status: { in: statuses }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
}

async function withWbsItem(values: Record<string, unknown>, actor: Actor, entity: string): Promise<Record<string, unknown>> {
  if (!('wbsCode' in values)) return values;
  const { wbsCode, ...rest } = values;
  const item = await prisma.wbsItem.findFirst({
    where: { organizationId: actor.orgId, projectId: String(rest.projectId ?? ''), code: String(wbsCode) },
    select: { id: true },
  });
  if (!item) throw new Error(`No WBS item with code "${wbsCode}" in that project.`);
  return entity === 'production_entry' ? rest : { ...rest, wbsItemId: item.id };
}

async function advanceSession(sessionId: string, entity: string, values: Record<string, unknown>, skipped: string[], actor: Actor, leadText?: string): Promise<GuidedResult> {
  const nf = nextFieldName(entity, values, skipped);
  if (nf) return { text: leadText, field: await buildFieldSpec(entity, nf, actor), sessionActive: true };
  // All fields gathered → build a preview (dry-run through the real pipeline).
  let data: Record<string, unknown>;
  try {
    ({ data } = await runCreate(DEFS[entity].crud, actorReq(actor), await withWbsItem(values, actor, entity), false));
  } catch (e) {
    return { text: leadText, error: e instanceof Error ? e.message : 'Some details are invalid.', sessionActive: true };
  }
  await prisma.aiPendingAction.update({ where: { id: sessionId }, data: { status: 'pending', previewJson: toJson(data) } });
  return { text: leadText, preview: { entity, title: DEFS[entity].title, fields: previewFields(data) }, sessionActive: true };
}

export async function startCreateSession(entity: string, rawValues: Record<string, unknown>, actor: Actor, conversationId: string): Promise<GuidedResult> {
  const def = DEFS[entity];
  if (!def) return { error: `I can't create a "${entity}".` };
  if (!actorCan(actor, def.crud.writePerm)) return { error: `You don't have permission to create a ${def.title}.` };
  await prisma.aiPendingAction.updateMany({ where: { conversationId, userId: actor.id, status: { in: ['collecting', 'pending'] } }, data: { status: 'cancelled' } });
  const allowed = new Set([...(FIELD_ORDER[entity] ?? []), ...Object.keys((def.parameters.properties ?? {}) as Record<string, unknown>)]);
  const coerced = coerceArgTypes(normalizeDates(rawValues || {}), def.parameters);
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(coerced)) {
    if (allowed.has(k) && v !== undefined && v !== null && v !== '') values[k] = v;
  }
  const session = await prisma.aiPendingAction.create({
    data: {
      conversationId, organizationId: actor.orgId, userId: actor.id,
      tool: `create_${entity}`, entity, argsJson: toJson(values), previewJson: toJson({ skipped: [] }),
      status: 'collecting', expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return advanceSession(session.id, entity, values, [], actor, `Let's create a ${def.title}. Fill in each field below — you can skip the optional ones.`);
}

async function createReference(model: RefModel, name: string, actor: Actor): Promise<{ id?: string; error?: string }> {
  const clean = (name || '').trim();
  if (clean.length < 2) return { error: 'Please enter a name (at least 2 characters).' };
  if (model === 'client') {
    if (!actorCan(actor, 'client:write')) return { error: `You don't have permission to add a client.` };
    const { record } = await runCreate(clientCrud, actorReq(actor), { name: clean }, true);
    return { id: String(record?.id) };
  }
  if (model === 'project') {
    if (!actorCan(actor, 'project:write')) return { error: `You don't have permission to add a project.` };
    const { record } = await runCreate(projectCrud, actorReq(actor), { name: clean }, true);
    return { id: String(record?.id) };
  }
  if (model === 'material') {
    if (!actorCan(actor, 'inventory:write')) return { error: `You don't have permission to add a material.` };
    const { record } = await runCreate(materialCrud, actorReq(actor), { name: clean }, true);
    return { id: String(record?.id) };
  }
  if (model === 'supplier') {
    if (!actorCan(actor, 'procurement:write')) return { error: `You don't have permission to add a supplier.` };
    const { record } = await runCreate(supplierCrud, actorReq(actor), { name: clean }, true);
    return { id: String(record?.id) };
  }
  return { error: 'You can only pick an existing project manager, not add one here.' };
}

export async function answerCreateField(
  conversationId: string,
  actor: Actor,
  fieldName: string,
  value: unknown,
  action: 'value' | 'skip' | 'addNew',
): Promise<GuidedResult> {
  const session = await activeSession(conversationId, actor.id, ['collecting']);
  if (!session) return { error: `That form is no longer active — tell me what you'd like to create.`, sessionActive: false };
  const entity = session.entity;
  const def = DEFS[entity];
  const { values, skipped } = collectedOf(session);
  const required = (((def.parameters.required as string[]) ?? [])).includes(fieldName);

  if (action === 'skip') {
    if (required) return { field: await buildFieldSpec(entity, fieldName, actor), error: `${FIELD_LABELS[fieldName] ?? fieldName} is required — please provide it.`, sessionActive: true };
    if (!skipped.includes(fieldName)) skipped.push(fieldName);
  } else if (action === 'addNew') {
    const ref = REFERENCES[fieldName];
    if (ref) {
      const created = await createReference(ref.model, String(value ?? ''), actor);
      if (created.error) return { field: await buildFieldSpec(entity, fieldName, actor), error: created.error, sessionActive: true };
      values[fieldName] = created.id;
    } else if (CREATABLE_ENUM_FIELDS.has(`${entity}.${fieldName}`)) {
      // Creatable select: keep the free-typed value as-is (mirrors the form's creatable category).
      const custom = String(value ?? '').trim();
      if (!custom) return { field: await buildFieldSpec(entity, fieldName, actor), error: `Please enter a ${(FIELD_LABELS[fieldName] ?? fieldName).toLowerCase()}.`, sessionActive: true };
      values[fieldName] = coerceArgTypes(normalizeDates({ [fieldName]: custom }), def.parameters)[fieldName];
    } else {
      return { field: await buildFieldSpec(entity, fieldName, actor), error: `You can't add a new value for this field.`, sessionActive: true };
    }
  } else {
    values[fieldName] = coerceArgTypes(normalizeDates({ [fieldName]: value }), def.parameters)[fieldName];
  }
  await prisma.aiPendingAction.update({ where: { id: session.id }, data: { argsJson: toJson(values), previewJson: toJson({ skipped }) } });
  return advanceSession(session.id, entity, values, skipped, actor);
}

export async function commitCreateSession(conversationId: string, actor: Actor): Promise<GuidedResult> {
  const session = await activeSession(conversationId, actor.id, ['pending']);
  if (!session) return { error: `There's nothing ready to create yet.`, sessionActive: false };
  const def = DEFS[session.entity];
  if (!actorCan(actor, def.crud.writePerm)) return { error: `You don't have permission to create a ${def.title}.` };
  let record: Record<string, unknown> | undefined;
  try {
    ({ record } = await runCreate(def.crud, actorReq(actor), await withWbsItem(session.argsJson as Record<string, unknown>, actor, session.entity), true));
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Create failed.', sessionActive: true };
  }
  await prisma.aiPendingAction.update({ where: { id: session.id }, data: { status: 'committed' } });
  return { created: { entity: session.entity, id: String(record?.id), fields: previewFields(record ?? {}) }, done: true };
}

export async function cancelCreateSession(conversationId: string, actor: Actor): Promise<GuidedResult> {
  await prisma.aiPendingAction.updateMany({ where: { conversationId, userId: actor.id, status: { in: ['collecting', 'pending'] } }, data: { status: 'cancelled' } });
  return { done: true, text: 'Okay, cancelled — nothing was created.' };
}

/** Execute one tool call from the agent loop. Never throws — returns a result
 * object (including `{ error }`) that is fed back to the model as a tool message. */
export async function executeWriteTool(
  name: string,
  args: Record<string, unknown>,
  actor: Actor,
  ctx: ToolRunContext,
): Promise<unknown> {
  if (name === 'start_create') {
    const entity = String(args.entity ?? '');
    const values = args.values && typeof args.values === 'object' ? (args.values as Record<string, unknown>) : {};
    return startCreateSession(entity, values, actor, ctx.conversationId);
  }
  if (name === 'list_projects') return listProjects(actor);
  if (name === 'list_clients') return listClients(actor);
  if (name === 'open_page') {
    const page = String(args.page ?? '');
    return NAV_PAGES[page] ? { navigate: page, opened: NAV_PAGES[page] } : { error: `Unknown page "${page}".` };
  }
  if (name === 'read_file') return readFileFromUrl(String(args.url ?? ''), args.question ? String(args.question) : undefined);
  const preview = /^preview_(.+)$/.exec(name);
  if (preview) return previewWrite(preview[1], args, actor, ctx);
  const commit = /^commit_(.+)$/.exec(name);
  if (commit) return commitWrite(commit[1], actor, ctx);
  return { error: `Unknown tool "${name}".` };
}
