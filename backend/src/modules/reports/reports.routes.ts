import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';

const router = Router();
router.use(authenticate);

// ── Projects export (Excel) ───────────────────────────────────
router.get(
  '/projects.xlsx',
  requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      where: { organizationId: req.user!.orgId },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'INSPECTA BUILDOS';
    const ws = wb.addWorksheet('Projects');
    ws.columns = [
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Client', key: 'client', width: 24 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Health', key: 'health', width: 12 },
      { header: 'Progress %', key: 'progress', width: 12 },
      { header: 'Budget', key: 'budget', width: 16 },
    ];
    ws.getRow(1).font = { bold: true };
    projects.forEach((p) =>
      ws.addRow({
        code: p.code,
        name: p.name,
        client: p.client?.name ?? '',
        location: p.location ?? '',
        status: p.status,
        health: p.health,
        progress: p.progressPct,
        budget: Number(p.budget),
      }),
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="projects.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }),
);

// ── Projects export (CSV) ─────────────────────────────────────
router.get(
  '/projects.csv',
  requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      where: { organizationId: req.user!.orgId },
      orderBy: { createdAt: 'desc' },
    });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Code', 'Name', 'Location', 'Status', 'Health', 'Progress %', 'Budget'];
    const lines = [header.join(',')];
    for (const p of projects) {
      lines.push(
        [p.code, p.name, p.location, p.status, p.health, p.progressPct, Number(p.budget)].map(esc).join(','),
      );
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="projects.csv"');
    res.send(lines.join('\n'));
  }),
);

// ── Single-project status report (PDF) ────────────────────────
router.get(
  '/project/:id.pdf',
  requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.orgId;
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      include: { client: true, manager: { select: { fullName: true } } },
    });
    if (!project) throw NotFound('Project not found');

    const [budgetAgg, costAgg, ncrOpen, incidents, prodAgg] = await Promise.all([
      prisma.budgetLine.aggregate({ where: { projectId: project.id }, _sum: { amount: true } }),
      prisma.costEntry.aggregate({ where: { projectId: project.id }, _sum: { amount: true } }),
      prisma.ncr.count({ where: { projectId: project.id, status: { not: 'CLOSED' } } }),
      prisma.incident.count({ where: { projectId: project.id } }),
      prisma.productionEntry.aggregate({
        where: { projectId: project.id },
        _sum: { plannedQty: true, actualQty: true },
      }),
    ]);

    const budget = Number(budgetAgg._sum.amount ?? 0) || Number(project.budget);
    const actual = Number(costAgg._sum.amount ?? 0);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="project-${project.code}.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).fillColor('#00286a').text('INSPECTA BUILDOS', { continued: false });
    doc.fontSize(12).fillColor('#444').text('Project Status Report');
    doc.moveDown();

    doc.fontSize(16).fillColor('#000').text(`${project.name} (${project.code})`);
    doc.fontSize(10).fillColor('#555');
    doc.text(`Client: ${project.client?.name ?? '—'}`);
    doc.text(`Manager: ${project.manager?.fullName ?? '—'}`);
    doc.text(`Location: ${project.location ?? '—'}`);
    doc.text(`Status: ${project.status}    Health: ${project.health}    Progress: ${project.progressPct}%`);
    doc.moveDown();

    const row = (label: string, value: string) => {
      doc.fillColor('#000').fontSize(11).text(label, { continued: true }).fillColor('#00286a').text(`   ${value}`);
    };
    doc.fontSize(13).fillColor('#00286a').text('Financials');
    doc.moveDown(0.3);
    row('Budget:', budget.toLocaleString());
    row('Actual cost:', actual.toLocaleString());
    row('Cost variance:', (budget - actual).toLocaleString());
    doc.moveDown();

    doc.fontSize(13).fillColor('#00286a').text('Production');
    doc.moveDown(0.3);
    row('Planned qty:', String(Number(prodAgg._sum.plannedQty ?? 0)));
    row('Actual qty:', String(Number(prodAgg._sum.actualQty ?? 0)));
    doc.moveDown();

    doc.fontSize(13).fillColor('#00286a').text('Compliance & Safety');
    doc.moveDown(0.3);
    row('Open NCRs:', String(ncrOpen));
    row('Incidents logged:', String(incidents));
    doc.moveDown(2);

    doc.fontSize(8).fillColor('#999').text(`Generated by INSPECTA BUILDOS · ${new Date().toISOString()}`);
    doc.end();
  }),
);

// ── Shared xlsx sender ────────────────────────────────────────
const num = (v: unknown) => Number(v ?? 0);
async function sendWorkbook(res: import('express').Response, wb: ExcelJS.Workbook, filename: string) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}
function addSheet(wb: ExcelJS.Workbook, name: string, columns: Partial<ExcelJS.Column>[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns as ExcelJS.Column[];
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  return ws;
}

// ── Executive report (portfolio KPIs across all projects) ─────
router.get('/executive.xlsx', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const scope = { organizationId: req.user!.orgId };
  const [projects, costByP, invByP, ncrByP, incByP] = await Promise.all([
    prisma.project.findMany({ where: scope, include: { client: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.costEntry.groupBy({ by: ['projectId'], where: scope, _sum: { amount: true } }),
    prisma.invoice.groupBy({ by: ['projectId'], where: scope, _sum: { amount: true } }),
    prisma.ncr.groupBy({ by: ['projectId'], where: { ...scope, status: { not: 'CLOSED' } }, _count: { _all: true } }),
    prisma.incident.groupBy({ by: ['projectId'], where: scope, _count: { _all: true } }),
  ]);
  const m = (g: any[], v = (x: any) => num(x._sum?.amount)) => new Map(g.map((x) => [x.projectId, v(x)]));
  const cost = m(costByP); const inv = m(invByP);
  const ncr = new Map(ncrByP.map((x) => [x.projectId, x._count._all]));
  const inc = new Map(incByP.map((x) => [x.projectId, x._count._all]));
  const wb = new ExcelJS.Workbook(); wb.creator = 'INSPECTA BUILDOS';
  addSheet(wb, 'Executive Summary', [
    { header: 'Code', key: 'code', width: 14 }, { header: 'Project', key: 'name', width: 30 },
    { header: 'Client', key: 'client', width: 22 }, { header: 'Status', key: 'status', width: 12 },
    { header: 'Health', key: 'health', width: 10 }, { header: 'Progress %', key: 'progress', width: 12 },
    { header: 'Budget', key: 'budget', width: 16 }, { header: 'Actual Cost', key: 'actual', width: 16 },
    { header: 'Cost Variance', key: 'variance', width: 16 }, { header: 'Billed', key: 'billed', width: 16 },
    { header: 'Open NCRs', key: 'ncrs', width: 12 }, { header: 'Incidents', key: 'incidents', width: 12 },
  ], projects.map((p) => {
    const budget = num(p.budget); const actual = cost.get(p.id) ?? 0;
    return { code: p.code, name: p.name, client: p.client?.name ?? '—', status: p.status, health: p.health, progress: p.progressPct, budget, actual, variance: budget - actual, billed: inv.get(p.id) ?? 0, ncrs: ncr.get(p.id) ?? 0, incidents: inc.get(p.id) ?? 0 };
  }));
  await sendWorkbook(res, wb, 'executive-report.xlsx');
}));

// ── Financial report (project-scoped) ─────────────────────────
router.get('/financial.xlsx', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw NotFound('projectId is required');
  const scope = { organizationId: orgId, projectId };
  const [budgetByCat, costByCat, invoices, payments, cash] = await Promise.all([
    prisma.budgetLine.groupBy({ by: ['category'], where: scope, _sum: { amount: true } }),
    prisma.costEntry.groupBy({ by: ['category'], where: scope, _sum: { amount: true } }),
    prisma.invoice.findMany({ where: scope, orderBy: { issueDate: 'desc' } }),
    prisma.payment.findMany({ where: scope, orderBy: { date: 'desc' } }),
    prisma.cashFlowEntry.findMany({ where: scope, orderBy: { date: 'desc' } }),
  ]);
  const wb = new ExcelJS.Workbook(); wb.creator = 'INSPECTA BUILDOS';
  addSheet(wb, 'Budget vs Actual', [{ header: 'Category', key: 'cat', width: 18 }, { header: 'Budget', key: 'budget', width: 16 }, { header: 'Actual', key: 'actual', width: 16 }],
    [...new Set([...budgetByCat.map((b) => b.category), ...costByCat.map((c) => c.category)])].map((cat) => ({
      cat, budget: num(budgetByCat.find((b) => b.category === cat)?._sum.amount), actual: num(costByCat.find((c) => c.category === cat)?._sum.amount),
    })));
  addSheet(wb, 'Invoices', [{ header: 'Number', key: 'number', width: 16 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Amount', key: 'amount', width: 16 }, { header: 'Net', key: 'net', width: 16 }, { header: 'Issued', key: 'issued', width: 14 }],
    invoices.map((i) => ({ number: i.number, status: i.status, amount: num(i.amount), net: num(i.netAmount), issued: i.issueDate?.toISOString().slice(0, 10) })));
  addSheet(wb, 'Payments', [{ header: 'Reference', key: 'ref', width: 18 }, { header: 'Amount', key: 'amount', width: 16 }, { header: 'Date', key: 'date', width: 14 }],
    payments.map((p) => ({ ref: p.reference, amount: num(p.amount), date: p.date.toISOString().slice(0, 10) })));
  addSheet(wb, 'Cash Flow', [{ header: 'Direction', key: 'dir', width: 10 }, { header: 'Category', key: 'cat', width: 18 }, { header: 'Amount', key: 'amount', width: 16 }, { header: 'Date', key: 'date', width: 14 }],
    cash.map((c) => ({ dir: c.direction, cat: c.category, amount: num(c.amount), date: c.date.toISOString().slice(0, 10) })));
  await sendWorkbook(res, wb, 'financial-report.xlsx');
}));

// ── Compliance report (project-scoped) ────────────────────────
router.get('/compliance.xlsx', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw NotFound('projectId is required');
  const scope = { organizationId: orgId, projectId };
  const [ncrs, inspections, incidents, safety] = await Promise.all([
    prisma.ncr.findMany({ where: scope, orderBy: { createdAt: 'desc' } }),
    prisma.inspection.findMany({ where: scope, orderBy: { date: 'desc' } }),
    prisma.incident.findMany({ where: scope, orderBy: { date: 'desc' } }),
    prisma.safetyInspection.findMany({ where: scope, orderBy: { date: 'desc' } }),
  ]);
  const wb = new ExcelJS.Workbook(); wb.creator = 'INSPECTA BUILDOS';
  addSheet(wb, 'NCRs', [{ header: 'Number', key: 'n', width: 14 }, { header: 'Severity', key: 's', width: 12 }, { header: 'Status', key: 'st', width: 16 }, { header: 'Description', key: 'd', width: 40 }, { header: 'Responsible', key: 'r', width: 18 }],
    ncrs.map((n) => ({ n: n.number, s: n.severity, st: n.status, d: n.description, r: n.responsiblePerson ?? '—' })));
  addSheet(wb, 'Inspections', [{ header: 'Title', key: 't', width: 28 }, { header: 'Type', key: 'ty', width: 14 }, { header: 'Result', key: 'r', width: 10 }, { header: 'Defects', key: 'd', width: 10 }, { header: 'Date', key: 'dt', width: 14 }],
    inspections.map((i) => ({ t: i.title, ty: i.type, r: i.result, d: i.defects, dt: i.date.toISOString().slice(0, 10) })));
  addSheet(wb, 'Incidents', [{ header: 'Type', key: 't', width: 16 }, { header: 'Severity', key: 's', width: 12 }, { header: 'Description', key: 'd', width: 40 }, { header: 'Date', key: 'dt', width: 14 }],
    incidents.map((i) => ({ t: i.type, s: i.severity, d: i.description, dt: i.date.toISOString().slice(0, 10) })));
  addSheet(wb, 'Safety Inspections', [{ header: 'Title', key: 't', width: 28 }, { header: 'Result', key: 'r', width: 10 }, { header: 'Score', key: 'sc', width: 10 }, { header: 'Date', key: 'dt', width: 14 }],
    safety.map((s) => ({ t: s.title, r: s.result, sc: s.score ?? '', dt: s.date.toISOString().slice(0, 10) })));
  await sendWorkbook(res, wb, 'compliance-report.xlsx');
}));

export default router;
