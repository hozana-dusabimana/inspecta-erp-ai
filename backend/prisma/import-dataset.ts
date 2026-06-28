/**
 * Dataset importer — loads the BuildCore 6-month sample workbook
 * ("inspecta data excel.xlsx", 27 raw tables) into the live data model.
 *
 * Usage:
 *   tsx prisma/import-dataset.ts "F:\\projects\\inspect_erp\\inspecta data excel.xlsx" --confirm
 *
 * Without --confirm it runs a DRY RUN (parses + reports row counts, no DB writes).
 * With --confirm it WIPES the target organization's business data and reloads it
 * from the workbook (idempotent: safe to re-run). Users/org/statutory rates are kept.
 *
 * Handles the schema differences vs. the flat Excel: builds Excel-id → cuid maps,
 * creates Trade / EquipmentCategory / Client lookups, maps lowercase values to the
 * app's enums, and splits stock_ledger in/out into signed movements.
 */
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

const ORG_SLUG = process.env.IMPORT_ORG_SLUG ?? 'inspecta-gc-corp';
const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm') || process.env.IMPORT_CONFIRM === '1';
const FILE = args.find((a) => !a.startsWith('--')) ?? process.env.DATA_XLSX ?? 'F:\\projects\\inspect_erp\\inspecta data excel.xlsx';

// ── cell / sheet helpers ──────────────────────────────────────
type Row = Record<string, unknown>;
function cv(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return o.result;
    if ('text' in o) return o.text;
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    return null;
  }
  return v;
}
function readSheet(wb: ExcelJS.Workbook, name: string): Row[] {
  const ws = wb.getWorksheet(name);
  if (!ws) return [];
  const cols: { col: number; name: string }[] = [];
  ws.getRow(4).eachCell((cell, col) => { const n = cv(cell.value); if (n != null && String(n).trim() !== '') cols.push({ col, name: String(n).trim() }); });
  const rows: Row[] = [];
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Row = {};
    let any = false;
    for (const { col, name } of cols) {
      const val = cv(row.getCell(col).value);
      obj[name] = val;
      if (val != null && val !== '') any = true;
    }
    if (any) rows.push(obj);
  }
  return rows;
}

// ── value coercion / enum mapping ─────────────────────────────
const S = (v: unknown) => (v == null ? null : String(v).trim());
const N = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const D = (v: unknown) => (v == null || v === '' ? null : v instanceof Date ? v : new Date(String(v)));
const UP = (v: unknown) => (v == null ? null : String(v).trim().toUpperCase());

const COST_CAT: Record<string, string> = { labor: 'LABOR', material: 'MATERIAL', equipment: 'EQUIPMENT', subcontract: 'SUBCONTRACTOR', overhead: 'OVERHEAD' };
const MOVE: Record<string, string> = { opening: 'OPENING', grn: 'RECEIPT', receipt: 'RECEIPT', issue: 'ISSUE', pos_sale: 'POS_SALE', adjustment: 'ADJUSTMENT', transfer: 'TRANSFER', return: 'RETURN', waste: 'WASTE' };
const PO_STATUS: Record<string, string> = { draft: 'DRAFT', sent: 'ISSUED', confirmed: 'ISSUED', partially_received: 'PARTIAL', received: 'RECEIVED', cancelled: 'CANCELLED' };
const RESULT: Record<string, string> = { pass: 'PASS', fail: 'FAIL', pending: 'PENDING' };
const costCat = (v: unknown) => COST_CAT[String(v ?? '').toLowerCase()] ?? 'OTHER';
const moveType = (v: unknown) => MOVE[String(v ?? '').toLowerCase()] ?? 'ADJUSTMENT';

async function main() {
  console.log(`\n📥 BuildCore dataset import  (${CONFIRM ? 'LIVE — will wipe & load' : 'DRY RUN — no writes'})`);
  console.log(`   file: ${FILE}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  // Parse every sheet up-front.
  const D_ = (n: string) => readSheet(wb, n);
  const projects = D_('R01_projects');
  const crews = D_('R01_crews');
  const employees = D_('R01_employees');
  const wbsItems = D_('R02_wbs_items');
  const dailyReports = D_('R02_daily_reports');
  const dsrLines = D_('R02_dsr_activity_lines');
  const attendance = D_('R03_attendance_records');
  const payrollRuns = D_('R03_payroll_runs');
  const payslips = D_('R03_payslips');
  const equipment = D_('R04_equipment');
  const usageLogs = D_('R04_equipment_usage_logs');
  const fuelLogs = D_('R04_fuel_logs');
  const materials = D_('R05_materials');
  const stockLedger = D_('R05_stock_ledger');
  const materialIssues = D_('R05_material_issues');
  const suppliers = D_('R06_suppliers');
  const purchaseRequests = D_('R06_purchase_requests');
  const purchaseOrders = D_('R06_purchase_orders');
  const grns = D_('R06_grns');
  const budgets = D_('R07_budgets');
  const actualCosts = D_('R07_actual_costs');
  const ipcs = D_('R07_ipc_certificates');
  const inspections = D_('R08_inspections');
  const ncrs = D_('R08_ncr_register');
  const incidents = D_('R09_incidents');
  const riskAssessments = D_('R09_risk_assessments');
  const toolboxTalks = D_('R09_toolbox_talks');

  const counts: Record<string, number> = {
    projects: projects.length, crews: crews.length, employees: employees.length, wbsItems: wbsItems.length,
    dailyReports: dailyReports.length, dsrLines: dsrLines.length, attendance: attendance.length,
    payrollRuns: payrollRuns.length, payslips: payslips.length, equipment: equipment.length,
    usageLogs: usageLogs.length, fuelLogs: fuelLogs.length, materials: materials.length,
    stockLedger: stockLedger.length, materialIssues: materialIssues.length, suppliers: suppliers.length,
    purchaseRequests: purchaseRequests.length, purchaseOrders: purchaseOrders.length, grns: grns.length,
    budgets: budgets.length, actualCosts: actualCosts.length, ipcs: ipcs.length,
    inspections: inspections.length, ncrs: ncrs.length, incidents: incidents.length,
    riskAssessments: riskAssessments.length, toolboxTalks: toolboxTalks.length,
  };
  console.log('   parsed rows:', JSON.stringify(counts));

  if (!CONFIRM) {
    console.log('\n✅ Dry run OK — every sheet parsed. Re-run with --confirm to wipe & load.');
    return;
  }

  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: { name: 'Inspecta GC Corp', slug: ORG_SLUG, currency: 'RWF', country: 'Rwanda' },
  });
  const oid = org.id;

  // ── 0. Wipe existing business data (keep users/org/statutory rates) ──
  console.log('   wiping existing org business data…');
  const wipe = [
    'payslip', 'payrollRun', 'fuelLog', 'equipmentUsageLog', 'equipmentMaintenance', 'equipmentUtilization', 'equipment', 'equipmentCategory',
    'materialIssue', 'goodsReceipt', 'stockMovement', 'materialRequirement', 'material',
    'rfqQuote', 'rfq', 'delivery', 'purchaseOrder', 'purchaseRequest', 'supplier',
    'productionMaterial', 'productionEntry', 'dailyReport',
    'payment', 'invoice', 'costEntry', 'budgetLine', 'cashFlowEntry',
    'correctiveAction', 'ncr', 'inspection', 'materialTest', 'rework',
    'incident', 'riskAssessment', 'toolboxTalk', 'ppeCheck', 'safetyInspection', 'risk',
    'scheduleDependency', 'scheduleActivity', 'siteDiary', 'fieldTask', 'attendance', 'approvalRequest', 'laborAvailability',
    'crewMember', 'crew', 'employee', 'trade',
    'wbsItem', 'boqItem', 'contract', 'project', 'client',
  ];
  for (const m of wipe) {
    try { await (prisma as unknown as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[m].deleteMany({ where: { organizationId: oid } }); }
    catch (e) { console.warn(`     (skip ${m}: ${(e as Error).message.split('\n')[0]})`); }
  }

  // ── 1. Clients (unique by name) + Projects + Contracts ──
  const clientMap = new Map<string, string>();
  for (const p of projects) {
    const cname = S(p.client_name)!;
    if (!clientMap.has(cname)) {
      const c = await prisma.client.create({ data: { organizationId: oid, name: cname, clientType: S(p.client_type) ?? 'private' } });
      clientMap.set(cname, c.id);
    }
  }
  const projMap = new Map<string, string>();
  for (const p of projects) {
    const proj = await prisma.project.create({
      data: {
        organizationId: oid, code: S(p.id)!, name: S(p.name)!, projectType: S(p.project_type),
        clientId: clientMap.get(S(p.client_name)!), status: 'ACTIVE',
        budget: N(p.contract_value), currency: 'RWF', location: S(p.location),
        startDate: D(p.start_date), endDate: D(p.planned_finish_date),
      },
    });
    projMap.set(S(p.id)!, proj.id);
    await prisma.contract.create({
      data: {
        organizationId: oid, clientId: clientMap.get(S(p.client_name)!)!, projectId: proj.id,
        reference: `${S(p.id)}-CON`, value: N(p.contract_value), currency: 'RWF',
        retentionPct: p.retention_pct == null ? null : N(p.retention_pct), status: 'ACTIVE',
      },
    });
  }

  // ── 2. Trades (from employees) + Employees (project set; crew later) ──
  const tradeMap = new Map<string, string>();
  for (const t of [...new Set(employees.map((e) => S(e.trade)).filter(Boolean) as string[])]) {
    const tr = await prisma.trade.create({ data: { organizationId: oid, name: t } });
    tradeMap.set(t, tr.id);
  }
  const empMap = new Map<string, string>();
  const empName = new Map<string, string>();
  const empProject = new Map<string, string | null>();
  for (const e of employees) {
    const emp = await prisma.employee.create({
      data: {
        organizationId: oid, employeeNo: S(e.id), fullName: S(e.full_name)!,
        tradeId: e.trade ? tradeMap.get(S(e.trade)!) : null,
        projectId: e.project_id ? projMap.get(S(e.project_id)!) : null,
        grossMonthlySalary: N(e.gross_monthly_salary), medicalScheme: S(e.medical_scheme) ?? 'rama',
        status: S(e.status) ?? 'active', hireDate: D(e.hire_date),
      },
    });
    empMap.set(S(e.id)!, emp.id);
    empName.set(S(e.id)!, S(e.full_name)!);
    empProject.set(S(e.id)!, e.project_id ? projMap.get(S(e.project_id)!) ?? null : null);
  }

  // ── 3. Crews (foreman) → backfill employee.crewId + crew members ──
  const crewMap = new Map<string, string>();
  for (const c of crews) {
    const cr = await prisma.crew.create({
      data: { organizationId: oid, name: S(c.name)!, projectId: c.project_id ? projMap.get(S(c.project_id)!) : null, foremanId: c.foreman_id ? empMap.get(S(c.foreman_id)!) : null },
    });
    crewMap.set(S(c.id)!, cr.id);
  }
  for (const e of employees) {
    if (e.crew_id && crewMap.has(S(e.crew_id)!)) {
      const empId = empMap.get(S(e.id)!)!;
      const crewId = crewMap.get(S(e.crew_id)!)!;
      await prisma.employee.update({ where: { id: empId }, data: { crewId } });
      await prisma.crewMember.create({ data: { organizationId: oid, crewId, employeeId: empId } });
    }
  }

  // ── 4. WBS (two-pass for parent links) + code lookup ──
  const wbsMap = new Map<string, string>();
  const wbsByCode = new Map<string, string>(); // `${projectId}|${wbs_code}` → wbsId
  for (const w of wbsItems) {
    const item = await prisma.wbsItem.create({
      data: {
        organizationId: oid, projectId: projMap.get(S(w.project_id)!)!, code: S(w.wbs_code)!, name: S(w.name)!,
        unit: S(w.unit), quantity: w.planned_quantity == null ? null : N(w.planned_quantity),
        budgetAmount: w.budget_amount == null ? null : N(w.budget_amount),
      },
    });
    wbsMap.set(S(w.id)!, item.id);
    wbsByCode.set(`${projMap.get(S(w.project_id)!)}|${S(w.wbs_code)}`, item.id);
  }
  for (const w of wbsItems) {
    if (w.parent_id && wbsMap.has(S(w.parent_id)!)) {
      await prisma.wbsItem.update({ where: { id: wbsMap.get(S(w.id)!)! }, data: { parentId: wbsMap.get(S(w.parent_id)!) } });
    }
  }

  // ── 5. Daily reports → production entries ──
  const drMap = new Map<string, { id: string; date: Date | null; projectId: string }>();
  for (const d of dailyReports) {
    const pid = projMap.get(S(d.project_id)!)!;
    const rep = await prisma.dailyReport.create({
      data: { organizationId: oid, projectId: pid, reportNumber: S(d.id)!, reportDate: D(d.report_date) ?? new Date(), preparedById: d.prepared_by ? empMap.get(S(d.prepared_by)!) : null, weather: S(d.weather), status: (UP(d.status) ?? 'DRAFT') as never, notes: S(d.notes) },
    });
    drMap.set(S(d.id)!, { id: rep.id, date: D(d.report_date), projectId: pid });
  }
  await prisma.productionEntry.createMany({
    data: dsrLines.map((l) => {
      const dr = drMap.get(S(l.daily_report_id)!);
      const pid = projMap.get(S(l.project_id)!)!;
      return {
        organizationId: oid, projectId: pid, dailyReportId: dr?.id, date: dr?.date ?? new Date(),
        wbsActivity: S(l.activity_name) ?? '', wbsItemId: wbsByCode.get(`${pid}|${S(l.wbs_code)}`),
        crewId: l.crew_id ? crewMap.get(S(l.crew_id)!) : null, unit: S(l.unit) ?? 'unit',
        plannedQty: N(l.planned_qty), actualQty: N(l.actual_qty), laborHours: N(l.labor_hours), equipmentHours: N(l.equipment_hours), remarks: S(l.remarks),
      };
    }),
  });

  // ── 6. Attendance (employee-linked; project derived) ──
  await prisma.attendance.createMany({
    data: attendance.map((a) => ({
      organizationId: oid, employeeId: empMap.get(S(a.employee_id)!), projectId: empProject.get(S(a.employee_id)!) ?? Object.values(Object.fromEntries(projMap))[0],
      workerName: empName.get(S(a.employee_id)!) ?? S(a.employee_id)!, date: D(a.date) ?? new Date(),
      status: S(a.status) ?? 'present', hoursWorked: N(a.hours_worked), present: ['present', 'half_day'].includes(String(a.status)),
    })).filter((r) => r.projectId),
  });

  // ── 7. Payroll runs + payslips ──
  const runMap = new Map<string, string>();
  for (const r of payrollRuns) {
    const run = await prisma.payrollRun.create({ data: { organizationId: oid, periodMonth: D(r.period_month) ?? new Date(), status: (UP(r.status) ?? 'DRAFT') as never } });
    runMap.set(S(r.id)!, run.id);
  }
  await prisma.payslip.createMany({
    data: payslips.filter((p) => runMap.has(S(p.payroll_run_id)!) && empMap.has(S(p.employee_id)!)).map((p) => ({
      organizationId: oid, payrollRunId: runMap.get(S(p.payroll_run_id)!)!, employeeId: empMap.get(S(p.employee_id)!)!,
      grossSalary: N(p.gross_salary), payeAmount: N(p.paye_amount),
      rssbPensionEmployee: N(p.rssb_pension_employee), rssbPensionEmployer: N(p.rssb_pension_employer),
      rssbMaternityEmployee: N(p.rssb_maternity_employee), rssbMaternityEmployer: N(p.rssb_maternity_employer),
      rssbMedicalEmployee: N(p.rssb_medical_employee), netPay: N(p.net_pay),
    })),
  });
  // Roll run totals up from payslips.
  for (const [excelId, runId] of runMap) {
    void excelId;
    const ps = await prisma.payslip.findMany({ where: { payrollRunId: runId } });
    await prisma.payrollRun.update({
      where: { id: runId },
      data: {
        totalGross: ps.reduce((s, x) => s + Number(x.grossSalary), 0),
        totalPaye: ps.reduce((s, x) => s + Number(x.payeAmount), 0),
        totalNet: ps.reduce((s, x) => s + Number(x.netPay), 0),
        totalRssbEmployee: ps.reduce((s, x) => s + Number(x.rssbPensionEmployee) + Number(x.rssbMaternityEmployee) + Number(x.rssbMedicalEmployee), 0),
        totalRssbEmployer: ps.reduce((s, x) => s + Number(x.rssbPensionEmployer) + Number(x.rssbMaternityEmployer), 0),
      },
    });
  }

  // ── 8. Equipment categories + equipment + usage + fuel ──
  const catMap = new Map<string, string>();
  for (const cat of [...new Set(equipment.map((e) => S(e.category)).filter(Boolean) as string[])]) {
    const c = await prisma.equipmentCategory.create({ data: { organizationId: oid, name: cat } });
    catMap.set(cat, c.id);
  }
  const eqMap = new Map<string, string>();
  for (const e of equipment) {
    const eq = await prisma.equipment.create({
      data: {
        organizationId: oid, code: S(e.id), name: S(e.description)!, categoryId: e.category ? catMap.get(S(e.category)!) : null,
        ownershipStatus: (UP(e.ownership_type) as string) ?? 'OWNED', fuelType: S(e.fuel_type) ?? 'diesel',
        dailyRate: e.daily_rate == null ? null : N(e.daily_rate), primaryProjectId: e.primary_project_id ? projMap.get(S(e.primary_project_id)!) : null,
      },
    });
    eqMap.set(S(e.id)!, eq.id);
  }
  await prisma.equipmentUsageLog.createMany({
    data: usageLogs.filter((u) => eqMap.has(S(u.equipment_id)!)).map((u) => ({
      organizationId: oid, equipmentId: eqMap.get(S(u.equipment_id)!)!, projectId: u.project_id ? projMap.get(S(u.project_id)!) : null, date: D(u.date) ?? new Date(), hoursUsed: N(u.hours_used),
    })),
  });
  await prisma.fuelLog.createMany({
    data: fuelLogs.filter((f) => eqMap.has(S(f.equipment_id)!)).map((f) => ({
      organizationId: oid, equipmentId: eqMap.get(S(f.equipment_id)!)!, date: D(f.date) ?? new Date(), liters: N(f.liters), costPerLiter: N(f.cost_per_liter), totalCost: N(f.total_cost),
    })),
  });

  // ── 9. Materials + stock ledger + material issues ──
  const matMap = new Map<string, string>();
  for (const m of materials) {
    const mat = await prisma.material.create({ data: { organizationId: oid, code: S(m.id)!, name: S(m.name)!, unit: S(m.unit) ?? 'unit', category: S(m.category), reorderLevel: N(m.reorder_level), unitCost: N(m.unit_cost) } });
    matMap.set(S(m.id)!, mat.id);
  }
  await prisma.stockMovement.createMany({
    data: stockLedger.filter((s) => matMap.has(S(s.material_id)!)).map((s) => ({
      organizationId: oid, materialId: matMap.get(S(s.material_id)!)!, projectId: s.project_id ? projMap.get(S(s.project_id)!) : null,
      type: moveType(s.transaction_type) as never, date: D(s.transaction_date) ?? new Date(),
      quantity: Math.max(N(s.quantity_in), N(s.quantity_out)), runningBalance: s.running_balance == null ? null : N(s.running_balance), referenceId: S(s.reference_id),
    })),
  });
  await prisma.materialIssue.createMany({
    data: materialIssues.filter((i) => matMap.has(S(i.material_id)!) && i.project_id).map((i) => ({
      organizationId: oid, materialId: matMap.get(S(i.material_id)!)!, projectId: projMap.get(S(i.project_id)!)!, dateIssued: D(i.date_issued) ?? new Date(), quantityIssued: N(i.quantity_issued), issuedTo: i.issued_to ? (empName.get(S(i.issued_to)!) ?? S(i.issued_to)) : null,
    })),
  });

  // ── 10. Suppliers + PR + PO + GRN ──
  const supMap = new Map<string, string>();
  const supName = new Map<string, string>();
  for (const s of suppliers) {
    const sup = await prisma.supplier.create({ data: { organizationId: oid, name: S(s.name)!, category: S(s.category) } });
    supMap.set(S(s.id)!, sup.id); supName.set(S(s.id)!, S(s.name)!);
  }
  const prMap = new Map<string, string>();
  for (const pr of purchaseRequests) {
    const mat = pr.material_id ? matMap.get(S(pr.material_id)!) : null;
    const created = await prisma.purchaseRequest.create({
      data: {
        organizationId: oid, projectId: pr.project_id ? projMap.get(S(pr.project_id)!) : null, number: S(pr.id)!,
        status: (UP(pr.status) ?? 'DRAFT') as never, requestedById: pr.requested_by ? empMap.get(S(pr.requested_by)!) : null,
        total: N(pr.quantity), items: { create: mat ? [{ materialId: mat, description: S(pr.material_id) ?? 'item', quantity: N(pr.quantity), estimatedRate: 0, amount: 0 }] : [] },
      },
    });
    prMap.set(S(pr.id)!, created.id);
  }
  const poMap = new Map<string, string>();
  for (const po of purchaseOrders) {
    const mat = po.material_id ? matMap.get(S(po.material_id)!) : null;
    const created = await prisma.purchaseOrder.create({
      data: {
        organizationId: oid, supplierId: supMap.get(S(po.supplier_id)!)!, projectId: po.project_id ? projMap.get(S(po.project_id)!) : null,
        purchaseRequestId: po.purchase_request_id ? prMap.get(S(po.purchase_request_id)!) : null, number: S(po.id)!,
        status: (PO_STATUS[String(po.status ?? '').toLowerCase()] ?? 'DRAFT') as never, total: N(po.total_value), orderDate: D(po.po_date) ?? new Date(),
        items: { create: mat ? [{ materialId: mat, description: S(po.material_id) ?? 'item', quantity: N(po.quantity), rate: N(po.unit_price), amount: N(po.total_value) }] : [] },
      },
    });
    poMap.set(S(po.id)!, created.id);
  }
  await prisma.goodsReceipt.createMany({
    data: grns.filter((g) => matMap.has(S(g.material_id)!)).map((g) => ({
      organizationId: oid, materialId: matMap.get(S(g.material_id)!)!, projectId: g.project_id ? projMap.get(S(g.project_id)!) : null,
      purchaseOrderId: g.purchase_order_id ? poMap.get(S(g.purchase_order_id)!) : null, grnNumber: S(g.id), quantityReceived: N(g.quantity_received), dateReceived: D(g.date_received) ?? new Date(), supplierName: g.supplier_id ? supName.get(S(g.supplier_id)!) : null,
    })),
  });

  // ── 11. Finance: budgets, actual costs, IPC ──
  await prisma.budgetLine.createMany({
    data: budgets.filter((b) => b.project_id).map((b) => ({
      organizationId: oid, projectId: projMap.get(S(b.project_id)!)!, wbsItemId: b.wbs_item_id ? wbsMap.get(S(b.wbs_item_id)!) : null,
      category: costCat(b.cost_category) as never, description: S(b.wbs_activity_name) ?? 'Budget', amount: N(b.budget_amount),
    })),
  });
  await prisma.costEntry.createMany({
    data: actualCosts.filter((c) => c.project_id).map((c) => ({
      organizationId: oid, projectId: projMap.get(S(c.project_id)!)!, category: costCat(c.cost_category) as never,
      amount: N(c.amount), date: D(c.date_incurred) ?? new Date(), sourceRef: S(c.source_reference), description: `${S(c.cost_category) ?? 'cost'}`,
    })),
  });
  await prisma.invoice.createMany({
    data: ipcs.filter((i) => i.project_id).map((i) => ({
      organizationId: oid, projectId: projMap.get(S(i.project_id)!)!, number: S(i.id)!, isIpc: true, certificateNumber: S(i.id),
      periodStart: D(i.period_start), periodEnd: D(i.period_end), grossValuation: N(i.gross_amount), retentionAmount: N(i.retention_amount),
      certifiedAmount: N(i.certified_amount), amount: N(i.certified_amount), status: (UP(i.status) ?? 'DRAFT') as never, issueDate: D(i.period_end) ?? new Date(),
    })),
  });

  // ── 12. QA + HSE ──
  const inspMap = new Map<string, string>();
  for (const ins of inspections) {
    const created = await prisma.inspection.create({
      data: {
        organizationId: oid, projectId: projMap.get(S(ins.project_id)!)!, title: S(ins.inspection_type) ?? 'Inspection', type: S(ins.inspection_type) ?? 'General',
        date: D(ins.date) ?? new Date(), inspector: ins.inspector_id ? empName.get(S(ins.inspector_id)!) ?? S(ins.inspector_id) : null, result: (RESULT[String(ins.result ?? '').toLowerCase()] ?? 'PENDING') as never,
      },
    });
    inspMap.set(S(ins.id)!, created.id);
  }
  await prisma.ncr.createMany({
    data: ncrs.filter((n) => n.project_id).map((n) => ({
      organizationId: oid, projectId: projMap.get(S(n.project_id)!)!, inspectionId: n.inspection_id ? inspMap.get(S(n.inspection_id)!) : null,
      number: S(n.id)!, description: S(n.description) ?? 'NCR', status: (UP(n.status) ?? 'OPEN') as never, reworkCost: n.rework_cost == null ? null : N(n.rework_cost),
    })),
  });
  await prisma.incident.createMany({
    data: incidents.filter((i) => i.project_id).map((i) => ({
      organizationId: oid, projectId: projMap.get(S(i.project_id)!)!, type: (UP(i.incident_type) ?? 'NEAR_MISS') as never, severity: (UP(i.severity) ?? 'LOW') as never,
      description: `${S(i.incident_type) ?? 'Incident'}`, date: D(i.date) ?? new Date(), involvedEmployeeId: i.involved_employee_id ? empMap.get(S(i.involved_employee_id)!) : null,
    })),
  });
  await prisma.riskAssessment.createMany({
    data: riskAssessments.filter((r) => r.project_id).map((r) => ({
      organizationId: oid, projectId: projMap.get(S(r.project_id)!)!, activityName: S(r.activity_name) ?? 'Activity', riskLevel: S(r.risk_level) ?? 'medium', validFrom: D(r.valid_from), validUntil: D(r.valid_until),
    })),
  });
  await prisma.toolboxTalk.createMany({
    data: toolboxTalks.filter((t) => t.project_id).map((t) => ({
      organizationId: oid, projectId: projMap.get(S(t.project_id)!)!, topic: S(t.topic) ?? 'Toolbox talk', date: D(t.date) ?? new Date(), presenter: t.conducted_by ? empName.get(S(t.conducted_by)!) ?? S(t.conducted_by) : null, attendees: N(t.attendee_count),
    })),
  });

  console.log('\n✅ Import complete. Loaded dataset into org:', org.slug);
}

main()
  .catch((e) => { console.error('Import failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
