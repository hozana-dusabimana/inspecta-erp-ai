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
    create: { name: 'Inspecta GC Corp', slug: 'inspecta-gc-corp' },
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
      update: { fullName: spec.fullName, role: spec.role },
      create: {
        organizationId: org.id,
        email: spec.email,
        fullName: spec.fullName,
        role: spec.role,
        passwordHash: spec.hash,
      },
    });
    users[spec.role] = u.id;
  }

  // Clients
  const clientSpecs = [
    { name: 'Meridian Developments', contactName: 'Jordan Blake', email: 'jordan@meridian.com', phone: '+1 312 555 0101' },
    { name: 'Austin Civic Authority', contactName: 'Casey Lin', email: 'casey@austincivic.gov', phone: '+1 512 555 0144' },
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

    console.log('   Seeded module demo data for Skyline Tower A.');
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
