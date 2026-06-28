import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok, paginated } from '../../lib/http';
import { BadRequest, NotFound } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { createCrudRouter } from '../../lib/crud';
import { auditFromRequest } from '../../auth/audit';
import { notify } from '../notifications/notify';
import { computePayslip, PayeBand, RssbRates } from './engine';

const num = (v: unknown) => Number(v ?? 0);
const stamp = (data: Record<string, unknown>, req: Request) => {
  if (!('id' in data)) data.createdBy = req.user!.id;
  data.updatedBy = req.user!.id;
  return data;
};

const router = Router();

// ── Statutory rates (PAYE bands + RSSB contributions, date-versioned) ──
const rateSchema = z.object({
  rateType: z.enum(['paye_band', 'rssb_pension', 'rssb_maternity', 'rssb_medical', 'rssb_cbhi']),
  bandFrom: z.number().nonnegative().optional(),
  bandTo: z.number().nonnegative().optional(),
  employeePct: z.number().min(0).max(100).optional(),
  employerPct: z.number().min(0).max(100).optional(),
  fixedAmount: z.number().nonnegative().optional(),
  effectiveFrom: z.string().datetime(),
  note: z.string().optional(),
});
router.use('/statutory-rates', createCrudRouter({
  model: 'statutoryRate', entity: 'statutory-rate',
  readPerm: 'payroll:read', writePerm: 'payroll:write',
  createSchema: rateSchema, updateSchema: rateSchema.partial(),
  filterFields: ['rateType'],
  orderBy: { effectiveFrom: 'desc' }, transform: stamp,
}));

// ── Payroll runs (header) ─────────────────────────────────────
const runSchema = z.object({
  periodMonth: z.string().datetime(),
  note: z.string().optional(),
});
router.use('/runs', createCrudRouter({
  model: 'payrollRun', entity: 'payroll-run',
  readPerm: 'payroll:read', writePerm: 'payroll:write',
  createSchema: runSchema, updateSchema: runSchema.partial(),
  dateField: 'periodMonth',
  filterFields: ['status'],
  sumFields: ['totalGross', 'totalPaye', 'totalNet'],
  orderBy: { periodMonth: 'desc' },
  include: { _count: { select: { payslips: true } } },
  transform: stamp,
}));

/** Load the effective statutory rate set for a given period (latest ≤ period). */
async function loadRates(orgId: string, period: Date): Promise<{ bands: PayeBand[]; rssb: RssbRates }> {
  const rows = await prisma.statutoryRate.findMany({
    where: { organizationId: orgId, effectiveFrom: { lte: period }, deletedAt: null },
    orderBy: { effectiveFrom: 'desc' },
  });

  // PAYE bands: take the rows from the latest effective date that has band rows.
  const bandRows = rows.filter((r) => r.rateType === 'paye_band');
  let bands: PayeBand[] = [];
  if (bandRows.length) {
    const latest = bandRows[0].effectiveFrom.getTime();
    bands = bandRows
      .filter((r) => r.effectiveFrom.getTime() === latest)
      .map((r) => ({ bandFrom: num(r.bandFrom), bandTo: r.bandTo == null ? null : num(r.bandTo), employeePct: num(r.employeePct) }))
      .sort((a, b) => a.bandFrom - b.bandFrom);
  }

  // RSSB: first (latest) row per type wins.
  const pick = (type: string) => rows.find((r) => r.rateType === type);
  const pension = pick('rssb_pension');
  const maternity = pick('rssb_maternity');
  const medical = pick('rssb_medical');
  const cbhi = pick('rssb_cbhi');

  const rssb: RssbRates = {
    pensionEmployee: num(pension?.employeePct),
    pensionEmployer: num(pension?.employerPct),
    maternityEmployee: num(maternity?.employeePct),
    maternityEmployer: num(maternity?.employerPct),
    medicalEmployee: num(medical?.employeePct),
    medicalEmployer: num(medical?.employerPct),
    cbhiEmployee: num(cbhi?.employeePct),
  };
  return { bands, rssb };
}

// ── Compute a run: generate payslips from employees + statutory rates ──
router.post('/runs/:id/compute', authenticate, requirePermission('payroll:write'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!run) throw NotFound('payroll run not found');
  if (run.status === 'POSTED') throw BadRequest('payroll run is posted and cannot be recomputed');

  const period = run.periodMonth;
  const { bands, rssb } = await loadRates(orgId, period);
  if (!bands.length) throw BadRequest('No PAYE bands configured for this period. Add statutory_rates first.');

  const employees = await prisma.employee.findMany({
    where: { organizationId: orgId, status: 'active', deletedAt: null },
  });
  const payable = employees.filter((e) => num(e.grossMonthlySalary) > 0);
  if (!payable.length) throw BadRequest('No active employees with a gross monthly salary to pay.');

  // Pro-rate gross by attendance present-days within the period month, when recorded.
  const monthStart = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0));
  const attendance = await prisma.attendance.groupBy({
    by: ['employeeId'],
    where: { organizationId: orgId, employeeId: { in: payable.map((e) => e.id) }, date: { gte: monthStart, lte: monthEnd } },
    _count: { _all: true },
    _sum: { hoursWorked: true },
  });
  const presentByEmp = new Map<string, number>();
  for (const a of attendance) if (a.employeeId) presentByEmp.set(a.employeeId, a._count._all);

  const totals = { gross: 0, paye: 0, rssbEmp: 0, rssbEr: 0, net: 0 };

  await prisma.$transaction(async (tx) => {
    await tx.payslip.deleteMany({ where: { payrollRunId: run.id } });
    for (const e of payable) {
      const fullGross = num(e.grossMonthlySalary);
      const days = presentByEmp.get(e.id) ?? 0;
      // If attendance exists, prorate over a 26-working-day month; else pay full.
      const gross = days > 0 ? Math.min(fullGross, (fullGross / 26) * days) : fullGross;
      const c = computePayslip(gross, bands, rssb, e.medicalScheme === 'rama');

      await tx.payslip.create({
        data: {
          organizationId: orgId, payrollRunId: run.id, employeeId: e.id,
          daysWorked: days,
          grossSalary: c.grossSalary, payeAmount: c.payeAmount,
          rssbPensionEmployee: c.rssbPensionEmployee, rssbPensionEmployer: c.rssbPensionEmployer,
          rssbMaternityEmployee: c.rssbMaternityEmployee, rssbMaternityEmployer: c.rssbMaternityEmployer,
          rssbMedicalEmployee: c.rssbMedicalEmployee, rssbMedicalEmployer: c.rssbMedicalEmployer,
          cbhiAmount: c.cbhiAmount, otherDeductions: c.otherDeductions, netPay: c.netPay,
        },
      });
      totals.gross += c.grossSalary;
      totals.paye += c.payeAmount;
      totals.rssbEmp += c.rssbPensionEmployee + c.rssbMaternityEmployee + c.rssbMedicalEmployee + c.cbhiAmount;
      totals.rssbEr += c.rssbPensionEmployer + c.rssbMaternityEmployer + c.rssbMedicalEmployer;
      totals.net += c.netPay;
    }
    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'PENDING_APPROVAL',
        totalGross: round2(totals.gross), totalPaye: round2(totals.paye),
        totalRssbEmployee: round2(totals.rssbEmp), totalRssbEmployer: round2(totals.rssbEr),
        totalNet: round2(totals.net), updatedBy: req.user!.id,
      },
    });
  });

  await auditFromRequest(req, 'UPDATE', 'payroll-run', run.id, { newValues: { status: 'PENDING_APPROVAL', ...totals } });
  return ok(res, { runId: run.id, employees: payable.length, totals });
}));

// ── Approve / post a run (post flips it into the finance cash-flow ledger) ──
router.post('/runs/:id/post', authenticate, requirePermission('payroll:write'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!run) throw NotFound('payroll run not found');
  if (run.status === 'POSTED') throw BadRequest('payroll run is already posted');

  await prisma.$transaction([
    prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: 'POSTED', approvedById: req.user!.id, postedToFinanceAt: new Date(), updatedBy: req.user!.id },
    }),
    // Net payroll becomes a company-level cash outflow for cash-flow forecasting.
    prisma.cashFlowEntry.create({
      data: {
        organizationId: orgId, direction: 'OUT', category: 'PAYROLL',
        amount: run.totalNet, date: run.periodMonth,
        reference: `payroll_run:${run.id}`,
        note: `Net payroll for ${run.periodMonth.toISOString().slice(0, 7)}`,
        createdBy: req.user!.id, updatedBy: req.user!.id,
      },
    }),
  ]);

  await auditFromRequest(req, 'APPROVE', 'payroll-run', run.id, { newValues: { status: 'POSTED' } });
  await notify({
    organizationId: orgId, type: 'GENERAL', severity: 'LOW',
    title: 'Payroll posted',
    message: `Payroll for ${run.periodMonth.toISOString().slice(0, 7)} posted (net ${num(run.totalNet).toLocaleString()}).`,
    link: '/payroll',
  });
  return ok(res, { runId: run.id, status: 'POSTED' });
}));

// ── Payslips (read-only; filter by ?runId=) ───────────────────
router.get('/payslips', authenticate, requirePermission('payroll:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const runId = req.query.runId as string | undefined;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));
  const where = { organizationId: orgId, ...(runId ? { payrollRunId: runId } : {}) };
  const [data, total] = await Promise.all([
    prisma.payslip.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      include: { employee: { select: { id: true, fullName: true, employeeNo: true } } },
    }),
    prisma.payslip.count({ where }),
  ]);
  return paginated(res, data, { page, pageSize, total });
}));

// ── Payroll summary (latest run + totals) ─────────────────────
router.get('/summary', authenticate, requirePermission('payroll:read'), asyncHandler(async (req, res) => {
  const orgId = req.user!.orgId;
  const [runs, employees, latest] = await Promise.all([
    prisma.payrollRun.aggregate({ where: { organizationId: orgId }, _count: true }),
    prisma.employee.count({ where: { organizationId: orgId, status: 'active', deletedAt: null } }),
    prisma.payrollRun.findFirst({ where: { organizationId: orgId }, orderBy: { periodMonth: 'desc' } }),
  ]);
  return ok(res, {
    totalRuns: runs._count,
    activeEmployees: employees,
    latestRun: latest && {
      id: latest.id, period: latest.periodMonth, status: latest.status,
      totalGross: num(latest.totalGross), totalPaye: num(latest.totalPaye),
      totalRssbEmployee: num(latest.totalRssbEmployee), totalRssbEmployer: num(latest.totalRssbEmployer),
      totalNet: num(latest.totalNet),
    },
  });
}));

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default router;
