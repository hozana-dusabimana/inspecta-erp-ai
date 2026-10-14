import { ImportReport, ImportRow, str, numOrU, hasValue, codeCompare } from '../../lib/xlsx-import';

export interface ExistingWbs { id: string; code: string; level: number }

export interface WbsToCreate {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string | null;
  quantity: number | undefined;
  budgetAmount: number | undefined;
  parentId: string | null;
  level: number;
  sortOrder: number;
  weightPct: number;
  progressPct: number;
}

interface Parsed {
  rowNo: number; code: string; name: string; description: string | null; unit: string | null;
  quantity?: number; budgetAmount?: number; weightPct: number; progressPct: number; parentCode?: string;
}

/** "1.2.3" → ["1.2", "1"]: candidate ancestor codes, nearest first. */
export function dottedAncestors(code: string): string[] {
  const parts = code.split('.');
  const out: string[] = [];
  for (let i = parts.length - 1; i >= 1; i--) out.push(parts.slice(0, i).join('.'));
  return out;
}

/**
 * Turn WBS sheet rows into insertable rows with the tree wired up:
 * - existing codes and in-file repeats are skipped (re-importing the same file is safe);
 * - the parent is `parentCode` when given, else the nearest dotted ancestor that
 *   exists ("1.2.3" → "1.2" → "1"), else the item is a root;
 * - `level` is derived from the parent chain, and parents always come first.
 * Problems go to `report`; nothing here touches the database.
 */
export function planWbsImport(rows: ImportRow[], existing: ExistingWbs[], newId: () => string, report: ImportReport): WbsToCreate[] {
  const existingByCode = new Map(existing.map((e) => [e.code.toLowerCase(), e]));
  const parsed: Parsed[] = [];
  const seen = new Set<string>();

  for (const { rowNo, cells: r } of rows) {
    const code = str(r.code); const name = str(r.name);
    if (!code || !name) { report.fail(rowNo, 'code and name are required'); continue; }
    if (existingByCode.has(code.toLowerCase())) { report.exists(rowNo, `WBS code "${code}" already exists`); continue; }
    if (seen.has(code.toLowerCase())) { report.exists(rowNo, `"${code}" appears more than once in the file`); continue; }
    const quantity = numOrU(r.quantity); const budget = numOrU(r.budgetamount); const weight = numOrU(r.weightpct); const progress = numOrU(r.progresspct);
    if (hasValue(r.quantity) && (quantity === undefined || quantity < 0)) { report.fail(rowNo, 'quantity must be a number ≥ 0'); continue; }
    if (hasValue(r.budgetamount) && (budget === undefined || budget < 0)) { report.fail(rowNo, 'budgetAmount must be a number ≥ 0'); continue; }
    if (hasValue(r.weightpct) && (weight === undefined || weight < 0 || weight > 100)) { report.fail(rowNo, 'weightPct must be between 0 and 100'); continue; }
    if (hasValue(r.progresspct) && (progress === undefined || progress < 0 || progress > 100)) { report.fail(rowNo, 'progressPct must be between 0 and 100'); continue; }
    seen.add(code.toLowerCase());
    parsed.push({
      rowNo, code, name, description: str(r.description) || null, unit: str(r.unit) || null,
      quantity, budgetAmount: budget, weightPct: weight ?? 0, progressPct: progress ?? 0,
      parentCode: str(r.parentcode) || undefined,
    });
  }

  const byCode = new Map(parsed.map((p) => [p.code.toLowerCase(), p]));
  const parentOf = new Map<string, string | null>(); // lower code → lower parent code
  const reported = new Set<string>(); // rows already reported as invalid
  const failed = new Set<string>(); // rows rejected because of their parent chain
  for (const p of parsed) {
    const key = p.code.toLowerCase();
    const known = (c: string) => byCode.has(c.toLowerCase()) || existingByCode.has(c.toLowerCase());
    if (p.parentCode) {
      if (p.parentCode.toLowerCase() === key) { report.fail(p.rowNo, 'an item cannot be its own parent'); reported.add(key); continue; }
      if (!known(p.parentCode)) { report.fail(p.rowNo, `parent "${p.parentCode}" was not found in the file or the project`); reported.add(key); continue; }
      parentOf.set(key, p.parentCode.toLowerCase());
    } else {
      const inferred = dottedAncestors(p.code).find(known);
      parentOf.set(key, inferred ? inferred.toLowerCase() : null);
    }
  }

  // Resolve levels parent-first; items on a parent loop (or under a failed row) are rejected.
  const level = new Map<string, number>();
  const resolving = new Set<string>();
  const resolve = (key: string): number | null => {
    const known = level.get(key);
    if (known !== undefined) return known;
    const ex = existingByCode.get(key);
    if (ex) return ex.level;
    if (reported.has(key) || failed.has(key) || resolving.has(key)) return null;
    resolving.add(key);
    const parent = parentOf.get(key) ?? null;
    let lvl: number | null = 1;
    if (parent) { const pl = resolve(parent); lvl = pl === null ? null : pl + 1; }
    resolving.delete(key);
    if (lvl === null) { failed.add(key); return null; }
    level.set(key, lvl);
    return lvl;
  };
  for (const p of parsed) {
    const key = p.code.toLowerCase();
    if (reported.has(key)) continue;
    if (resolve(key) === null) report.fail(p.rowNo, 'its parent chain is circular or points at a row that could not be imported');
  }

  const ok = parsed.filter((p) => level.has(p.code.toLowerCase()));
  const ids = new Map(ok.map((p) => [p.code.toLowerCase(), newId()]));
  const out: WbsToCreate[] = ok.map((p, i) => {
    const key = p.code.toLowerCase();
    const parent = parentOf.get(key) ?? null;
    return {
      id: ids.get(key)!, code: p.code, name: p.name, description: p.description, unit: p.unit,
      quantity: p.quantity, budgetAmount: p.budgetAmount,
      parentId: parent ? (ids.get(parent) ?? existingByCode.get(parent)?.id ?? null) : null,
      level: level.get(key)!, sortOrder: i, weightPct: p.weightPct, progressPct: p.progressPct,
    };
  });
  // Parents before children so a chunked bulk insert never references a later chunk.
  return out.sort((a, b) => a.level - b.level || codeCompare(a.code, b.code));
}
