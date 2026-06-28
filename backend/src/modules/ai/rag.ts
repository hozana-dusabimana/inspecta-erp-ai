import { prisma } from '../../lib/prisma';

export interface RagSource {
  source: string;
  snippet: string;
}

const STOP = new Set(['the', 'and', 'for', 'are', 'was', 'why', 'what', 'which', 'how', 'our', 'this', 'that', 'with', 'from', 'have', 'has', 'is', 'in', 'on', 'of', 'to', 'a', 'an', 'project', 'projects', 'show', 'me', 'my', 'we', 'about']);

/** Extract meaningful keywords (≥4 chars, not stopwords) from a question. */
function keywords(prompt: string): string[] {
  return [...new Set(prompt.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)))].slice(0, 6);
}

const truncate = (s: string | null | undefined, n = 160) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : '');

/**
 * Lightweight RAG: keyword-search the org's real records (NCRs, inspections,
 * daily production, compliance docs, contracts) and return cited snippets the
 * AI can ground on. Org-scoped; no data leaves the tenant. (Vector/semantic
 * retrieval is a heavier follow-up — this gives source citations now.)
 */
export async function retrieve(orgId: string, prompt: string, projectId?: string): Promise<RagSource[]> {
  const kws = keywords(prompt);
  if (kws.length === 0) return [];
  const scope = { organizationId: orgId, ...(projectId ? { projectId } : {}) };
  const orFor = (fields: string[]) => fields.flatMap((f) => kws.map((k) => ({ [f]: { contains: k, mode: 'insensitive' as const } })));

  const [ncrs, inspections, entries, docs, contracts] = await Promise.all([
    prisma.ncr.findMany({ where: { ...scope, OR: orFor(['description', 'rootCause', 'correctiveAction']) }, take: 4, orderBy: { createdAt: 'desc' } }).catch(() => []),
    prisma.inspection.findMany({ where: { ...scope, OR: orFor(['title', 'notes', 'type']) }, take: 3, orderBy: { date: 'desc' } }).catch(() => []),
    prisma.productionEntry.findMany({ where: { ...scope, OR: orFor(['wbsActivity', 'remarks', 'issues', 'delays']) }, take: 4, orderBy: { date: 'desc' } }).catch(() => []),
    prisma.complianceDocument.findMany({ where: { organizationId: orgId, OR: orFor(['title', 'reference', 'notes']) }, take: 3, orderBy: { createdAt: 'desc' } }).catch(() => []),
    prisma.contract.findMany({ where: { organizationId: orgId, OR: orFor(['reference', 'contractNumber']) }, take: 2 }).catch(() => []),
  ]);

  const sources: RagSource[] = [];
  for (const n of ncrs) sources.push({ source: `NCR ${n.number}`, snippet: `${n.severity}/${n.status}: ${truncate(n.description)}${n.rootCause ? ` — root cause: ${truncate(n.rootCause, 80)}` : ''}` });
  for (const i of inspections) sources.push({ source: `Inspection "${i.title}"`, snippet: `${i.result}, ${i.defects} defects${i.notes ? `: ${truncate(i.notes)}` : ''}` });
  for (const e of entries) sources.push({ source: `Daily entry ${e.wbsActivity} (${e.date.toISOString().slice(0, 10)})`, snippet: `${truncate(e.issues || e.delays || e.remarks)}`.trim() || `actual ${Number(e.actualQty)} / planned ${Number(e.plannedQty)}` });
  for (const d of docs) sources.push({ source: `Document "${d.title}"`, snippet: `${d.docType} (${d.status})${d.reference ? ` ref ${d.reference}` : ''}` });
  for (const c of contracts) sources.push({ source: `Contract ${c.reference}`, snippet: `${c.type} ${c.status}, value ${Number(c.value).toLocaleString()}` });

  return sources.slice(0, 10);
}
