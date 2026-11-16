/**
 * Lists duplicate / orphan cost postings and orphan stock movements for review.
 * It NEVER deletes or changes anything (rule 3: posted records are reversed in
 * the app, with a reason, by a person — Finance > Cost integrity).
 *
 *   npx tsx scripts/find-duplicate-costs.ts                # every company
 *   npx tsx scripts/find-duplicate-costs.ts <orgId> [projectId]
 *
 * In production: docker exec inspecta-prod-backend npx tsx scripts/find-duplicate-costs.ts
 */
import { prisma } from '../src/lib/prisma';
import { costIntegrityReport } from '../src/lib/posting';

async function main() {
  const [orgArg, projectArg] = process.argv.slice(2);
  const orgs = orgArg ? [{ id: orgArg, name: orgArg }] : await prisma.organization.findMany({ select: { id: true, name: true } });
  let issues = 0;
  for (const o of orgs) {
    const r = await costIntegrityReport(o.id, projectArg);
    if (r.clean) continue;
    issues++;
    console.log(`\n=== ${o.name} (${o.id}) ===`);
    for (const g of r.duplicates) console.log('DUPLICATE  ', g.map((c) => `${c.id} ${c.projectCode} ${c.source}:${c.sourceRef} ${c.amount}`).join('  |  '));
    for (const c of r.orphans) console.log('ORPHAN COST', `${c.id} ${c.projectCode} ${c.source}:${c.sourceRef} ${c.amount} "${c.description}"`);
    for (const g of r.lookalikes) console.log('LOOKALIKE  ', g.map((c) => `${c.id} ${c.projectCode} ${c.amount} "${c.description}" @${c.createdAt.toISOString()}`).join('  |  '));
    for (const m of r.orphanMovements) console.log('ORPHAN MOVE', `${m.id} ${m.type} ${m.quantity} ${m.material} ref=${m.reference}`);
  }
  console.log(issues ? `\n${issues} compan${issues === 1 ? 'y has' : 'ies have'} postings to review. Nothing was changed.` : 'No duplicate or orphan postings found.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
