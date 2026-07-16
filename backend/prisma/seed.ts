import { PrismaClient, Role, ProjectStatus, ProjectHealth } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@inspecta.ai';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';

async function main() {
  console.log('🌱 Seeding INSPECTA BUILDOS...');

  const org = await prisma.organization.upsert({
    where: { slug: 'inspecta-gc-corp' },
    update: {},
    create: {
      name: 'Inspecta GC Corp', slug: 'inspecta-gc-corp',
      currency: 'RWF', country: 'Rwanda', tinNumber: '100000000', workingDaysPerWeek: 6,
    },
  });

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const demoHash = await bcrypt.hash('Demo@12345', 10);

  // One user per role so RBAC can be exercised end-to-end.
  const userSpecs: Array<{ email: string; fullName: string; role: Role; hash: string }> = [
    { email: ADMIN_EMAIL, fullName: 'Alex Thompson', role: Role.SYSTEM_ADMIN, hash: passwordHash },
    { email: 'pm@inspecta.ai', fullName: 'Priya Mehta', role: Role.PROJECT_MANAGER, hash: demoHash },
    { email: 'engineer@inspecta.ai', fullName: 'Sam Okoro', role: Role.SITE_ENGINEER, hash: demoHash },
    { email: 'qs@inspecta.ai', fullName: 'Lena Fischer', role: Role.QUANTITY_SURVEYOR, hash: demoHash },
    { email: 'store@inspecta.ai', fullName: 'Diego Ramos', role: Role.STOREKEEPER, hash: demoHash },
  ];

  const users: Record<string, string> = {};
  for (const spec of userSpecs) {
    const u = await prisma.user.upsert({
      where: { organizationId_email: { organizationId: org.id, email: spec.email } },
      update: { fullName: spec.fullName, role: spec.role, emailVerified: true },
      create: {
        organizationId: org.id,
        email: spec.email,
        fullName: spec.fullName,
        role: spec.role,
        passwordHash: spec.hash,
        emailVerified: true,
      },
    });
    users[spec.role] = u.id;
  }

  // Clients
  const clientSpecs = [
    { name: 'Meridian Developments', clientType: 'private', contactName: 'Jordan Blake', email: 'jordan@meridian.com', phone: '+1 312 555 0101' },
    { name: 'Austin Civic Authority', clientType: 'government', contactName: 'Casey Lin', email: 'casey@austincivic.gov', phone: '+1 512 555 0144' },
  ];
  const clients: string[] = [];
  for (const c of clientSpecs) {
    const existing = await prisma.client.findFirst({
      where: { organizationId: org.id, name: c.name },
    });
    const client = existing
      ? await prisma.client.update({ where: { id: existing.id }, data: c })
      : await prisma.client.create({ data: { ...c, organizationId: org.id } });
    clients.push(client.id);
  }

  // Projects (idempotent on org+code) — matches the original dashboard demo set.
  const projectSpecs = [
    {
      code: 'SKY-A', name: 'Skyline Tower A', location: 'Chicago, IL',
      status: ProjectStatus.ACTIVE, health: ProjectHealth.OPTIMAL,
      budget: 84_000_000, progressPct: 78.4, clientId: clients[0],
    },
    {
      code: 'NEX-LH', name: 'Nexus Logistics Hub', location: 'Austin, TX',
      status: ProjectStatus.ACTIVE, health: ProjectHealth.WARNING,
      budget: 41_500_000, progressPct: 45.2, clientId: clients[1],
    },
    {
      code: 'RVR-PL', name: 'Riverfront Plaza', location: 'New York, NY',
      status: ProjectStatus.ACTIVE, health: ProjectHealth.OPTIMAL,
      budget: 62_000_000, progressPct: 91.0, clientId: clients[0],
    },
  ];

  for (const p of projectSpecs) {
    await prisma.project.upsert({
      where: { organizationId_code: { organizationId: org.id, code: p.code } },
      update: {
        name: p.name, location: p.location, status: p.status, health: p.health,
        budget: p.budget, progressPct: p.progressPct, clientId: p.clientId,
        managerId: users[Role.PROJECT_MANAGER],
      },
      create: {
        organizationId: org.id,
        code: p.code, name: p.name, location: p.location,
        status: p.status, health: p.health, budget: p.budget,
        progressPct: p.progressPct, clientId: p.clientId,
        managerId: users[Role.PROJECT_MANAGER],
      },
    });
  }

  // ── Statutory rates (Rwanda RRA PAYE / RSSB) — idempotent ─────
  // Admin-configurable & date-versioned; these are sensible current defaults.
  const ratesSeeded = await prisma.statutoryRate.count({ where: { organizationId: org.id } });
  if (ratesSeeded === 0) {
    const effectiveFrom = new Date('2024-01-01T00:00:00.000Z');
    await prisma.statutoryRate.createMany({
      data: [
        // PAYE monthly bands (RWF) — 0 / 10 / 20 / 30%
        { organizationId: org.id, rateType: 'paye_band', bandFrom: 0, bandTo: 60000, employeePct: 0, effectiveFrom, note: 'Band 1' },
        { organizationId: org.id, rateType: 'paye_band', bandFrom: 60000, bandTo: 100000, employeePct: 10, effectiveFrom, note: 'Band 2' },
        { organizationId: org.id, rateType: 'paye_band', bandFrom: 100000, bandTo: 200000, employeePct: 20, effectiveFrom, note: 'Band 3' },
        { organizationId: org.id, rateType: 'paye_band', bandFrom: 200000, bandTo: null, employeePct: 30, effectiveFrom, note: 'Top band' },
        // RSSB contributions (employee % / employer %)
        { organizationId: org.id, rateType: 'rssb_pension', employeePct: 3, employerPct: 5, effectiveFrom, note: 'Pension (rising through 2030 — version, do not overwrite)' },
        { organizationId: org.id, rateType: 'rssb_maternity', employeePct: 0.3, employerPct: 0.3, effectiveFrom, note: 'Maternity leave' },
        { organizationId: org.id, rateType: 'rssb_medical', employeePct: 7.5, employerPct: 7.5, effectiveFrom, note: 'RAMA medical (applies when scheme=rama)' },
        { organizationId: org.id, rateType: 'rssb_cbhi', employeePct: 0.5, effectiveFrom, note: 'CBHI (% of net)' },
      ],
    });
    console.log('   Seeded Rwanda statutory rates (PAYE bands + RSSB).');
  }

  // ── Module demo data (only if not already seeded) ─────────────
  const sky = await prisma.project.findUnique({
    where: { organizationId_code: { organizationId: org.id, code: 'SKY-A' } },
  });
  const alreadySeeded = await prisma.productionEntry.count({ where: { organizationId: org.id } });

  if (sky && alreadySeeded === 0) {
    const oid = org.id;
    const pid = sky.id;
    const day = (n: number) => new Date(Date.now() - n * 86_400_000);

    // M2 — Production
    await prisma.productionEntry.createMany({
      data: [
        { organizationId: oid, projectId: pid, date: day(5), wbsActivity: 'Reinforced Concrete Slab', unit: 'm3', plannedQty: 120, actualQty: 108, laborHours: 96, equipmentHours: 24, weatherCondition: 'Windy' },
        { organizationId: oid, projectId: pid, date: day(4), wbsActivity: 'Reinforced Concrete Slab', unit: 'm3', plannedQty: 120, actualQty: 126, laborHours: 90, equipmentHours: 22, weatherCondition: 'Clear' },
        { organizationId: oid, projectId: pid, date: day(3), wbsActivity: 'Formwork', unit: 'm2', plannedQty: 200, actualQty: 185, laborHours: 110, equipmentHours: 0, weatherCondition: 'Clear' },
        { organizationId: oid, projectId: pid, date: day(2), wbsActivity: 'Rebar Fixing', unit: 'ton', plannedQty: 18, actualQty: 19, laborHours: 80, equipmentHours: 0, weatherCondition: 'Cloudy' },
      ],
    });

    // M3 — Finance
    await prisma.budgetLine.createMany({
      data: [
        { organizationId: oid, projectId: pid, category: 'LABOR', description: 'Site labor budget', amount: 12_000_000 },
        { organizationId: oid, projectId: pid, category: 'MATERIAL', description: 'Concrete & steel', amount: 9_500_000 },
        { organizationId: oid, projectId: pid, category: 'EQUIPMENT', description: 'Cranes & plant', amount: 4_000_000 },
      ],
    });
    await prisma.costEntry.createMany({
      data: [
        { organizationId: oid, projectId: pid, category: 'LABOR', description: 'Week 18 payroll', amount: 480_000, date: day(7) },
        { organizationId: oid, projectId: pid, category: 'MATERIAL', description: 'Concrete delivery', amount: 320_000, date: day(5) },
        { organizationId: oid, projectId: pid, category: 'EQUIPMENT', description: 'Crane hire', amount: 150_000, date: day(3) },
      ],
    });
    const invoice = await prisma.invoice.create({
      data: { organizationId: oid, projectId: pid, number: 'IPC-001', description: 'Interim Payment Certificate 1', amount: 2_400_000, status: 'SUBMITTED', issueDate: day(10) },
    });
    await prisma.payment.create({
      data: { organizationId: oid, projectId: pid, invoiceId: invoice.id, reference: 'PMT-001', amount: 1_800_000, date: day(2) },
    });

    // M4 — Inventory
    const cement = await prisma.material.create({
      data: { organizationId: oid, code: 'CEM-42', name: 'Cement OPC 42.5', unit: 'bag', reorderLevel: 200, unitCost: 9.5 },
    });
    const rebar = await prisma.material.create({
      data: { organizationId: oid, code: 'RBR-16', name: 'Rebar 16mm', unit: 'ton', reorderLevel: 5, unitCost: 720 },
    });
    await prisma.stockMovement.createMany({
      data: [
        { organizationId: oid, materialId: cement.id, projectId: pid, type: 'RECEIPT', quantity: 1000, unitCost: 9.5, reference: 'GRN-001', date: day(8) },
        { organizationId: oid, materialId: cement.id, projectId: pid, type: 'ISSUE', quantity: 850, reference: 'ISS-001', date: day(4) },
        { organizationId: oid, materialId: rebar.id, projectId: pid, type: 'RECEIPT', quantity: 20, unitCost: 720, reference: 'GRN-002', date: day(8) },
        { organizationId: oid, materialId: rebar.id, projectId: pid, type: 'ISSUE', quantity: 16, reference: 'ISS-002', date: day(2) },
      ],
    });

    // M17 — Procurement
    const supplier = await prisma.supplier.create({
      data: { organizationId: oid, name: 'Apex Building Materials', contactName: 'Rita Ndlovu', email: 'sales@apexbm.com', rating: 4.3, leadTimeDays: 5 },
    });
    await prisma.purchaseOrder.create({
      data: {
        organizationId: oid, supplierId: supplier.id, projectId: pid, number: 'PO-1001', status: 'ISSUED', total: 38_000, orderDate: day(6),
        items: { create: [
          { description: 'Cement OPC 42.5', unit: 'bag', quantity: 2000, rate: 9.5, amount: 19_000 },
          { description: 'Rebar 16mm', unit: 'ton', quantity: 26, rate: 720, amount: 18_720 },
        ] },
      },
    });

    // M5 — QA/QC
    await prisma.inspection.create({
      data: { organizationId: oid, projectId: pid, title: 'Slab pour pre-check', type: 'Concrete', result: 'PASS', inspector: 'Sam Okoro', date: day(5) },
    });
    await prisma.ncr.create({
      data: { organizationId: oid, projectId: pid, number: 'NCR-001', description: 'Honeycombing on column C3', severity: 'MEDIUM', status: 'OPEN', raisedBy: 'Lena Fischer' },
    });

    // M6 — HSE
    await prisma.incident.create({
      data: { organizationId: oid, projectId: pid, type: 'NEAR_MISS', severity: 'LOW', description: 'Unsecured scaffold board near gridline B', location: 'Level 4', reportedBy: 'Sam Okoro', date: day(3) },
    });
    await prisma.toolboxTalk.create({
      data: { organizationId: oid, projectId: pid, topic: 'Working at height', presenter: 'HSE Officer', attendees: 24, date: day(1) },
    });

    // M24 — Risk
    await prisma.risk.create({
      data: { organizationId: oid, projectId: pid, title: 'Steel delivery delay', category: 'Supply Chain', probability: 4, impact: 4, score: 16, status: 'OPEN', mitigation: 'Dual-source rebar supplier', owner: 'Priya Mehta' },
    });

    // M13 — Scheduling (CPM): a small network with a clear critical path.
    await prisma.scheduleActivity.createMany({
      data: [
        { organizationId: oid, projectId: pid, code: 'A10', name: 'Site Mobilization', durationDays: 5, predecessors: [], progressPct: 100 },
        { organizationId: oid, projectId: pid, code: 'A20', name: 'Excavation', durationDays: 10, predecessors: ['A10'], progressPct: 80 },
        { organizationId: oid, projectId: pid, code: 'A30', name: 'Foundations', durationDays: 14, predecessors: ['A20'], progressPct: 40 },
        { organizationId: oid, projectId: pid, code: 'A40', name: 'Site Offices', durationDays: 6, predecessors: ['A10'], progressPct: 100 },
        { organizationId: oid, projectId: pid, code: 'A50', name: 'Superstructure', durationDays: 30, predecessors: ['A30'], progressPct: 10 },
      ],
    });

    // M16 — Field Ops
    await prisma.siteDiary.create({
      data: { organizationId: oid, projectId: pid, date: day(1), weather: 'Clear', workforce: 86, notes: 'Slab pour on level 4 completed; 2 concrete trucks delayed 45 min.' },
    });
    await prisma.fieldTask.createMany({
      data: [
        { organizationId: oid, projectId: pid, title: 'Fix honeycomb on column C3', assignee: 'Sam Okoro', status: 'IN_PROGRESS' },
        { organizationId: oid, projectId: pid, title: 'Survey gridline B setting-out', assignee: 'Survey Team', status: 'TODO' },
      ],
    });
    await prisma.attendance.createMany({
      data: [
        { organizationId: oid, projectId: pid, date: day(1), workerName: 'Crew A (Concrete)', trade: 'Concrete', hoursWorked: 8, present: true },
        { organizationId: oid, projectId: pid, date: day(1), workerName: 'Crew B (Steel)', trade: 'Steel Fixing', hoursWorked: 7.5, present: true },
      ],
    });

    // M18 — Workflow
    await prisma.approvalRequest.create({
      data: { organizationId: oid, projectId: pid, title: 'PO-1001 — Apex Building Materials', entityType: 'purchase-order', amount: 38_000, status: 'PENDING', requestedById: users[Role.STOREKEEPER] },
    });

    // M05 — Payroll: a few employees with monthly salaries + attendance.
    const empA = await prisma.employee.create({
      data: { organizationId: oid, employeeNo: 'EMP001', fullName: 'Eric Habimana', nationalId: '1199080012345678', status: 'active', grossMonthlySalary: 450_000, medicalScheme: 'rama', hireDate: day(400), bankAccountNumber: '0001234567' },
    });
    const empB = await prisma.employee.create({
      data: { organizationId: oid, employeeNo: 'EMP002', fullName: 'Claudine Uwase', nationalId: '1198570087654321', status: 'active', grossMonthlySalary: 180_000, medicalScheme: 'rama', hireDate: day(300), bankAccountNumber: '0007654321' },
    });
    await prisma.attendance.createMany({
      data: [
        { organizationId: oid, projectId: pid, employeeId: empA.id, date: day(1), workerName: empA.fullName, status: 'present', hoursWorked: 8, present: true },
        { organizationId: oid, projectId: pid, employeeId: empB.id, date: day(1), workerName: empB.fullName, status: 'present', hoursWorked: 8, present: true },
      ],
    });

    // M06 — Equipment + fuel/usage
    const excavator = await prisma.equipment.create({
      data: { organizationId: oid, code: 'EQ-001', name: 'Excavator CAT 320', ownershipStatus: 'OWNED', status: 'IN_USE', fuelType: 'diesel', hourlyRate: 45_000 },
    });
    await prisma.fuelLog.create({
      data: { organizationId: oid, equipmentId: excavator.id, date: day(2), liters: 120, costPerLiter: 1_650, totalCost: 198_000, odometerReading: 3420, supplier: 'SP Rwanda' },
    });
    await prisma.equipmentUsageLog.create({
      data: { organizationId: oid, equipmentId: excavator.id, projectId: pid, date: day(2), hoursUsed: 7.5, note: 'Bulk excavation gridline B' },
    });

    // M09 — POS: product + open till + sale (draws down cement stock)
    const posCement = await prisma.posProduct.create({
      data: { organizationId: oid, materialId: cement.id, name: 'Cement OPC 42.5 (retail)', productType: 'material', unit: 'bag', unitPrice: 12_000, vatApplicable: true },
    });
    const till = await prisma.tillSession.create({
      data: { organizationId: oid, openedById: users[Role.STOREKEEPER], openingFloat: 50_000, status: 'OPEN' },
    });
    const sale = await prisma.posTransaction.create({
      data: {
        organizationId: oid, tillSessionId: till.id, receiptNumber: 'RCT-0001', clientName: 'Walk-in client',
        subtotal: 120_000, vatAmount: 21_600, totalAmount: 141_600, paymentMethod: 'CASH', status: 'COMPLETED',
        createdById: users[Role.STOREKEEPER],
        lines: { create: [{ organizationId: oid, posProductId: posCement.id, quantity: 10, unitPrice: 12_000, lineTotal: 120_000 }] },
      },
    });
    await prisma.stockMovement.create({
      data: { organizationId: oid, materialId: cement.id, type: 'POS_SALE', quantity: 10, reference: sale.receiptNumber, referenceId: sale.id, note: 'POS sale RCT-0001' },
    });
    await prisma.serviceInvoice.create({
      data: { organizationId: oid, invoiceNumber: 'SI-0001', clientId: clients[0], description: 'Geotechnical soil testing', amount: 350_000, vatAmount: 63_000, totalAmount: 413_000, status: 'PENDING', dueDate: day(-14) },
    });

    console.log('   Seeded module demo data for Skyline Tower A (incl. payroll, POS, fuel).');
  }

  console.log('✅ Seed complete.');
  console.log(`   Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log('   Demo users (password Demo@12345): pm@ / engineer@ / qs@ / store@ inspecta.ai');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
