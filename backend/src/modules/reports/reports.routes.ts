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

export default router;
