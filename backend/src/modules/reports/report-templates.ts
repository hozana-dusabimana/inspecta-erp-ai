import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { loadProjectMetrics, ProjectMetrics } from '../../lib/project-metrics';
import { costByWbs } from '../../lib/cost-by-wbs';
import { assertProjectAccess } from '../../lib/project-access';
import { ReportPdf, rwf, pct, idx, day, Tone } from '../../lib/pdf-kit';

/**
 * Designed PDF report templates (one visual system, see lib/pdf-kit).
 *  /reports/portfolio.pdf                    company-wide summary
 *  /reports/project/:id.pdf                  project status report
 *  /reports/project/:id/cost-wbs.pdf         budget vs actual vs commitments by WBS
 *  /reports/project/:id/quality-safety.pdf   NCRs, tests, incidents
 *  /reports/project/:id/procurement.pdf      purchase orders and requests
 */
export const templatesRouter = Router();
templatesRouter.use(authenticate);

const num = (v: unknown) => Number(v ?? 0);
const toneOf = (s: string): Tone => (s === 'ON_TRACK' ? 'good' : s === 'AT_RISK' ? 'warn' : s === 'CRITICAL' ? 'bad' : undefined);
const statusLabel = (s: string) => s.replace('_', ' ');

async function loadProject(req: import('express').Request): Promise<{ m: ProjectMetrics; org: string; client: string; manager: string; location: string }> {
  const orgId = req.user!.orgId;
  assertProjectAccess(req, req.params.id);
  const [pm, project, org] = await Promise.all([
    loadProjectMetrics(orgId, { projectId: req.params.id }),
    prisma.project.findFirst({ where: { id: req.params.id, organizationId: orgId }, include: { client: { select: { name: true } }, manager: { select: { fullName: true } } } }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
  ]);
  const m = pm.projects[0];
  if (!m || !project) throw NotFound('Project not found');
  return { m, org: org?.name ?? '', client: project.client?.name ?? '—', manager: project.manager?.fullName ?? '—', location: project.location ?? '—' };
}

// ── Portfolio ─────────────────────────────────────────────────
templatesRouter.get('/portfolio.pdf', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const [pm, org] = await Promise.all([
    loadProjectMetrics(orgId, { includeDemo: false, projectIds: req.user!.projectIds }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
  ]);
  const t = pm.totals;
  const r = new ReportPdf(res, { filename: 'portfolio-report.pdf', title: 'Portfolio Report', subtitle: `${t.projectCount} project(s), demo/test projects excluded`, org: org?.name });
  r.kpis([
    ['Average progress', pct(t.avgProgressPct)],
    ['Schedule (SPI)', idx(t.spi), toneOf(t.spiStatus)],
    ['Cost (CPI)', idx(t.cpi), toneOf(t.cpiStatus)],
    ['Forecast profit', rwf(t.forecastProfit), t.forecastProfit == null ? undefined : t.forecastProfit < 0 ? 'bad' : 'good'],
    ['Contract value', rwf(t.contractValue || null)],
    ['Actual cost', rwf(t.actualCost)],
    ['Billed', rwf(t.billed)],
    ['Open NCRs', String(t.openNcrs), t.openNcrs > 0 ? 'warn' : 'good'],
  ]);
  r.section('Projects');
  r.table(
    [{ header: 'Project', key: 'p', width: 190 }, { header: 'Progress', key: 'pr', width: 60, align: 'right' }, { header: 'SPI', key: 'spi', width: 45, align: 'right' }, { header: 'Forecast profit', key: 'fp', width: 105, align: 'right' }, { header: 'NCRs', key: 'n', width: 40, align: 'right' }, { header: 'Status', key: 's', width: 70 }],
    pm.projects.map((p) => ({ p: `${p.code} ${p.name}`, pr: pct(p.progressPct), spi: idx(p.spi), fp: rwf(p.forecastProfit), n: p.openNcrs, s: statusLabel(p.health) })),
    { empty: 'No projects yet.' },
  );
  r.note('Progress, SPI, CPI and forecast profit use the same calculation as every screen in the app. "No data" means the figure cannot be calculated yet (for example no cost budget).');
  r.end();
}));

// ── Project status ────────────────────────────────────────────
templatesRouter.get('/project/:id.pdf', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const { m, org, client, manager, location } = await loadProject(req);
  const [wbs, prod, ncrs, tests, incidents, inspections] = await Promise.all([
    costByWbs(orgId, m.projectId),
    prisma.productionEntry.aggregate({ where: { organizationId: orgId, projectId: m.projectId }, _sum: { plannedQty: true, actualQty: true, laborHours: true } }),
    prisma.ncr.count({ where: { organizationId: orgId, projectId: m.projectId, status: { not: 'CLOSED' } } }),
    prisma.materialTest.findMany({ where: { organizationId: orgId, projectId: m.projectId }, select: { result: true } }),
    prisma.incident.count({ where: { organizationId: orgId, projectId: m.projectId } }),
    prisma.inspection.count({ where: { organizationId: orgId, projectId: m.projectId } }),
  ]);
  const committed = wbs.reduce((s, w) => s + w.committed, 0);
  const r = new ReportPdf(res, { filename: `project-${m.code}.pdf`, title: 'Project Status Report', subtitle: `${m.code} - ${m.name}`, org });
  r.kpis([
    ['Progress', pct(m.progressPct), toneOf(m.spiStatus)],
    ['Schedule (SPI)', idx(m.spi), toneOf(m.spiStatus)],
    ['Cost (CPI)', idx(m.cpi), toneOf(m.cpiStatus)],
    ['Forecast profit', rwf(m.forecastProfit), m.forecastProfit == null ? undefined : m.forecastProfit < 0 ? 'bad' : 'good'],
  ]);
  r.section('Project');
  r.table([{ header: 'Item', key: 'k', width: 140 }, { header: 'Value', key: 'v', width: 360 }], [
    { k: 'Client', v: client }, { k: 'Manager', v: manager }, { k: 'Location', v: location }, { k: 'Status', v: m.status }, { k: 'Overall health', v: statusLabel(m.health) },
  ]);
  r.section('Financials');
  r.table([{ header: 'Measure', key: 'k', width: 240 }, { header: 'Amount', key: 'v', width: 260, align: 'right' }], [
    { k: 'Contract value', v: rwf(m.contractValue) }, { k: 'Cost budget', v: rwf(m.budget) }, { k: 'Actual cost to date', v: rwf(m.actualCost) },
    { k: 'Committed (open purchase orders)', v: rwf(committed) }, { k: 'Estimated cost at completion', v: rwf(m.eac) },
    { k: 'Forecast profit', v: rwf(m.forecastProfit) }, { k: 'Forecast margin', v: pct(m.forecastMarginPct) },
    { k: 'Billed / received', v: `${rwf(m.billed)} / ${rwf(m.received)}` },
  ]);
  if (m.costDataIncomplete) r.note('Cost entries look incomplete compared with the progress earned, so CPI is not shown and the estimate stays at budget.');
  r.section('Cost by WBS (top items)');
  r.table(
    [{ header: 'WBS', key: 'c', width: 40 }, { header: 'Task', key: 'n', width: 150 }, { header: 'Budget', key: 'b', width: 80, align: 'right' }, { header: 'Actual', key: 'a', width: 80, align: 'right' }, { header: 'Committed', key: 'cm', width: 80, align: 'right' }, { header: 'Variance', key: 'v', width: 80, align: 'right' }],
    wbs.slice().sort((a, b) => b.actual - a.actual).slice(0, 12).map((w) => ({ c: w.code, n: w.name, b: rwf(w.budget), a: rwf(w.actual), cm: rwf(w.committed), v: rwf(w.forecastVariance) })),
    { empty: 'No budget or cost is linked to WBS items yet.' },
  );
  r.section('Production');
  r.table([{ header: 'Measure', key: 'k', width: 240 }, { header: 'Value', key: 'v', width: 260, align: 'right' }], [
    { k: 'Planned quantity', v: num(prod._sum.plannedQty).toLocaleString() }, { k: 'Actual quantity', v: num(prod._sum.actualQty).toLocaleString() }, { k: 'Labour hours', v: num(prod._sum.laborHours).toLocaleString() },
  ]);
  r.section('Quality and safety');
  const failed = tests.filter((t) => t.result === 'FAIL').length;
  r.table([{ header: 'Measure', key: 'k', width: 240 }, { header: 'Count', key: 'v', width: 260, align: 'right' }], [
    { k: 'Open NCRs', v: ncrs }, { k: 'Inspections', v: inspections }, { k: 'Material tests (failed)', v: `${tests.length} (${failed})` }, { k: 'Incidents', v: incidents },
  ]);
  r.end();
}));

// ── Cost by WBS ───────────────────────────────────────────────
templatesRouter.get('/project/:id/cost-wbs.pdf', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const { m, org } = await loadProject(req);
  const rows = await costByWbs(req.user!.orgId, m.projectId);
  const tot = rows.reduce((a, w) => ({ b: a.b + w.budget, a: a.a + w.actual, c: a.c + w.committed + w.requested, f: a.f + w.forecast }), { b: 0, a: 0, c: 0, f: 0 });
  const r = new ReportPdf(res, { filename: `cost-by-wbs-${m.code}.pdf`, title: 'Cost by WBS', subtitle: `${m.code} - ${m.name}`, org });
  r.kpis([['Budget', rwf(tot.b)], ['Actual cost', rwf(tot.a)], ['Committed', rwf(tot.c)], ['Forecast spend', rwf(tot.f), tot.b > 0 && tot.f > tot.b ? 'bad' : 'good']]);
  r.section('Budget, actual and commitments per task');
  r.table(
    [{ header: 'WBS', key: 'c', width: 36 }, { header: 'Task', key: 'n', width: 110 }, { header: 'Budget', key: 'b', width: 70, align: 'right' }, { header: 'Actual', key: 'a', width: 70, align: 'right' }, { header: 'Committed', key: 'cm', width: 70, align: 'right' }, { header: 'Forecast', key: 'f', width: 70, align: 'right' }, { header: 'Left', key: 'v', width: 70, align: 'right' }],
    rows.map((w) => ({ c: w.code, n: w.name, b: rwf(w.budget), a: rwf(w.actual), cm: rwf(w.committed + w.requested), f: rwf(w.forecast), v: rwf(w.forecastVariance) })),
    { empty: 'No budget, cost or commitments are linked to WBS items yet.' },
  );
  r.note('Committed = open purchase orders not yet received plus approved purchase requests not yet ordered. Forecast = actual + committed. Left = budget - forecast (negative means over budget).');
  r.end();
}));

// ── Quality and safety ────────────────────────────────────────
templatesRouter.get('/project/:id/quality-safety.pdf', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const { m, org } = await loadProject(req);
  const scope = { organizationId: orgId, projectId: m.projectId };
  const [ncrs, tests, incidents, wbs] = await Promise.all([
    prisma.ncr.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.materialTest.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.incident.findMany({ where: scope, orderBy: { date: 'desc' }, take: 30 }),
    prisma.wbsItem.findMany({ where: scope, select: { id: true, code: true } }),
  ]);
  const code = new Map(wbs.map((w) => [w.id, w.code]));
  const r = new ReportPdf(res, { filename: `quality-safety-${m.code}.pdf`, title: 'Quality and Safety Report', subtitle: `${m.code} - ${m.name}`, org });
  const open = ncrs.filter((n) => n.status !== 'CLOSED').length;
  r.kpis([['Open NCRs', String(open), open ? 'warn' : 'good'], ['Material tests', String(tests.length)], ['Failed tests', String(tests.filter((t) => t.result === 'FAIL').length), tests.some((t) => t.result === 'FAIL') ? 'bad' : 'good'], ['Incidents', String(incidents.length), incidents.length ? 'warn' : 'good']]);
  r.section('Non-conformance reports');
  r.table([{ header: 'NCR', key: 'n', width: 55 }, { header: 'WBS', key: 'w', width: 40 }, { header: 'Severity', key: 's', width: 55 }, { header: 'Status', key: 'st', width: 70 }, { header: 'Due', key: 'd', width: 60 }, { header: 'Description', key: 'ds', width: 220 }],
    ncrs.map((n) => ({ n: n.number, w: n.wbsItemId ? code.get(n.wbsItemId) ?? '—' : '—', s: n.severity, st: n.status.replace('_', ' '), d: day(n.dueDate), ds: n.description })), { empty: 'No NCRs.' });
  r.section('Material tests');
  r.table([{ header: 'Type', key: 't', width: 70 }, { header: 'Batch', key: 'b', width: 80 }, { header: 'WBS', key: 'w', width: 40 }, { header: 'Sampled', key: 'd', width: 70 }, { header: 'Result', key: 'r', width: 70 }, { header: 'Lab', key: 'l', width: 120 }],
    tests.map((t) => ({ t: t.testType, b: t.batchNumber, w: t.wbsItemId ? code.get(t.wbsItemId) ?? '—' : '—', d: day(t.sampleDate), r: t.result, l: t.labName })), { empty: 'No material tests.' });
  r.section('Incidents');
  r.table([{ header: 'No.', key: 'n', width: 55 }, { header: 'Type', key: 't', width: 80 }, { header: 'Severity', key: 's', width: 55 }, { header: 'WBS', key: 'w', width: 40 }, { header: 'Date', key: 'd', width: 65 }, { header: 'Description', key: 'ds', width: 200 }],
    incidents.map((i) => ({ n: i.number, t: String(i.type).replace('_', ' '), s: i.severity, w: i.wbsItemId ? code.get(i.wbsItemId) ?? '—' : '—', d: day(i.date), ds: i.description })), { empty: 'No incidents.' });
  r.end();
}));

// ── Procurement ───────────────────────────────────────────────
templatesRouter.get('/project/:id/procurement.pdf', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const { m, org } = await loadProject(req);
  const [pos, prs] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { organizationId: orgId, projectId: m.projectId }, include: { supplier: { select: { name: true } } }, orderBy: { orderDate: 'desc' }, take: 40 }),
    prisma.purchaseRequest.findMany({ where: { organizationId: orgId, projectId: m.projectId }, orderBy: { createdAt: 'desc' }, take: 40 }),
  ]);
  const wbs = await costByWbs(orgId, m.projectId);
  const r = new ReportPdf(res, { filename: `procurement-${m.code}.pdf`, title: 'Procurement Report', subtitle: `${m.code} - ${m.name}`, org });
  const poTotal = pos.filter((p) => p.status !== 'CANCELLED').reduce((s, p) => s + num(p.total), 0);
  r.kpis([['Purchase orders', String(pos.length)], ['Ordered value', rwf(poTotal)], ['Purchase requests', String(prs.length)], ['Open commitments', rwf(wbs.reduce((s, w) => s + w.committed, 0))]]);
  r.section('Purchase orders');
  r.table([{ header: 'PO', key: 'n', width: 60 }, { header: 'Supplier', key: 's', width: 150 }, { header: 'Ordered', key: 'd', width: 70 }, { header: 'Status', key: 'st', width: 70 }, { header: 'Total', key: 't', width: 110, align: 'right' }],
    pos.map((p) => ({ n: p.number, s: p.supplier.name, d: day(p.orderDate), st: p.status, t: rwf(num(p.total)) })), { empty: 'No purchase orders.' });
  r.section('Purchase requests');
  r.table([{ header: 'PR', key: 'n', width: 60 }, { header: 'Title', key: 'ti', width: 200 }, { header: 'Requested', key: 'd', width: 70 }, { header: 'Status', key: 'st', width: 70 }, { header: 'Total', key: 't', width: 90, align: 'right' }],
    prs.map((p) => ({ n: p.number, ti: p.title, d: day(p.dateRequested), st: p.status, t: rwf(num(p.total)) })), { empty: 'No purchase requests.' });
  r.end();
}));
