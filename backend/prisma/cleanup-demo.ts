/**
 * One-off data clean-up before selling: removes demo projects and the test records
 * created on PRJ-0008, so a client starts with empty data.
 *
 *   npx tsx prisma/cleanup-demo.ts --org <organizationId>            # DRY RUN: only counts
 *   npx tsx prisma/cleanup-demo.ts --org <organizationId> --apply    # really deletes
 *
 * Safe by design: it never runs without --org, lists what it will touch first, and
 * only deletes with --apply. Take a database backup before running with --apply.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const APPLY = process.argv.includes('--apply');
const DEMO_PROJECT_NAMES = ['TRAINING – 11kV Line Extension', 'TRAINING - 11kV Line Extension', 'construction', 'Riverfront Plaza', 'Nexus Logistics Hub', 'Skyline Tower A'];
const TEST_PROJECT_CODE = 'PRJ-0008';

async function main() {
  const orgId = arg('org');
  if (!orgId) throw new Error('Pass --org <organizationId> (refusing to guess which company to clean).');
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org) throw new Error(`Organization ${orgId} not found.`);
  console.log(`${APPLY ? 'APPLYING to' : 'DRY RUN for'} organization: ${org.name}`);

  const demoProjects = await prisma.project.findMany({
    where: { organizationId: orgId, name: { in: DEMO_PROJECT_NAMES.map((n) => n) } },
    select: { id: true, code: true, name: true },
  });
  console.log('Demo projects:', demoProjects.map((p) => `${p.code} ${p.name}`));

  const test = await prisma.project.findFirst({ where: { organizationId: orgId, code: TEST_PROJECT_CODE }, select: { id: true } });
  const scope = test ? { organizationId: orgId, projectId: test.id } : null;

  // Test records on PRJ-0008, in dependency order. Material issues also reverse their stock movement.
  const steps: Array<[string, () => Promise<number>, () => Promise<unknown>]> = [];
  const add = (label: string, count: () => Promise<number>, del: () => Promise<unknown>) => steps.push([label, count, del]);

  if (scope) {
    const issues = await prisma.materialIssue.findMany({ where: scope, select: { id: true } });
    const issueIds = issues.map((i) => i.id);
    const grns = await prisma.goodsReceipt.findMany({ where: { organizationId: orgId, projectId: test!.id }, select: { id: true } });
    add('cost entries (incl. posted material/equipment cost)', () => prisma.costEntry.count({ where: scope }), () => prisma.costEntry.deleteMany({ where: scope }));
    add('stock movements of issues/GRNs', () => prisma.stockMovement.count({ where: { organizationId: orgId, referenceId: { in: [...issueIds, ...grns.map((g) => g.id)] } } }),
      () => prisma.stockMovement.deleteMany({ where: { organizationId: orgId, referenceId: { in: [...issueIds, ...grns.map((g) => g.id)] } } }));
    add('material issues', () => prisma.materialIssue.count({ where: scope }), () => prisma.materialIssue.deleteMany({ where: scope }));
    add('goods receipts (GRN)', () => prisma.goodsReceipt.count({ where: { organizationId: orgId, projectId: test!.id } }), () => prisma.goodsReceipt.deleteMany({ where: { organizationId: orgId, projectId: test!.id } }));
    add('budget lines', () => prisma.budgetLine.count({ where: scope }), () => prisma.budgetLine.deleteMany({ where: scope }));
    add('production entries', () => prisma.productionEntry.count({ where: scope }), () => prisma.productionEntry.deleteMany({ where: scope }));
    add('material tests', () => prisma.materialTest.count({ where: scope }), () => prisma.materialTest.deleteMany({ where: scope }));
    add('NCRs + corrective actions', () => prisma.ncr.count({ where: scope }), () => prisma.ncr.deleteMany({ where: scope }));
    add('approval requests', () => prisma.approvalRequest.count({ where: scope }), () => prisma.approvalRequest.deleteMany({ where: scope }));
    add('requisitions', () => prisma.materialRequisition.count({ where: scope }), () => prisma.materialRequisition.deleteMany({ where: scope }));
    add('schedule activity A10', () => prisma.scheduleActivity.count({ where: { ...scope, code: 'A10' } }), () => prisma.scheduleActivity.deleteMany({ where: { ...scope, code: 'A10' } }));
  }
  add('demo projects (cascades their own records)', async () => demoProjects.length, () => prisma.project.deleteMany({ where: { id: { in: demoProjects.map((p) => p.id) } } }));

  for (const [label, count, del] of steps) {
    const n = await count();
    console.log(`  ${label}: ${n}`);
    if (APPLY && n > 0) await del();
  }
  console.log(APPLY ? 'Done.' : 'Dry run only. Re-run with --apply to delete.');
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
