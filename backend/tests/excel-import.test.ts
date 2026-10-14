import ExcelJS from 'exceljs';
import {
  rowsFromXlsx, dateOrU, numOrU, boolOrU, splitList, normHeader, ImportReport,
} from '../src/lib/xlsx-import';
import { planWbsImport, dottedAncestors } from '../src/modules/planning/wbs-import';
import { wouldCreateCycle } from '../src/modules/scheduling/graph';

async function sheet(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('xlsx-import helpers', () => {
  it('normalises headers so spacing/case/underscores do not matter', () => {
    expect(normHeader('Duration Days')).toBe('durationdays');
    expect(normHeader('weight_pct')).toBe('weightpct');
    expect(normHeader('parentCode')).toBe('parentcode');
  });

  it('parses numbers, dates, booleans and lists', () => {
    expect(numOrU('1,250.5')).toBe(1250.5);
    expect(numOrU('abc')).toBeUndefined();
    expect(numOrU('')).toBeUndefined();
    expect(dateOrU('2026-03-05')?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(dateOrU('05/03/2026')?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(dateOrU(46086)?.toISOString().slice(0, 10)).toBe('2026-03-05'); // Excel serial
    expect(dateOrU('')).toBeUndefined();
    expect(dateOrU('not a date')).toBeNull();
    expect(dateOrU('31/02/2026')).toBeNull();
    expect(boolOrU('Yes')).toBe(true);
    expect(boolOrU('no')).toBe(false);
    expect(boolOrU('maybe')).toBeUndefined();
    expect(splitList('A10, A20;A30')).toEqual(['A10', 'A20', 'A30']);
  });

  it('reads a workbook into numbered, header-keyed rows and drops blank rows', async () => {
    const buf = await sheet([['Code', 'Duration Days'], ['A10', 5], [], ['A20', 3]]);
    const rows = await rowsFromXlsx(buf);
    expect(rows.map((r) => r.rowNo)).toEqual([2, 4]);
    expect(rows[1].cells.durationdays).toBe(3);
  });

  it('rejects empty, corrupt and header-only uploads with a clear message', async () => {
    await expect(rowsFromXlsx(Buffer.alloc(0))).rejects.toThrow(/No file/);
    await expect(rowsFromXlsx(Buffer.from('not an xlsx'))).rejects.toThrow(/could not be read/);
    await expect(rowsFromXlsx(await sheet([['code', 'name']]))).rejects.toThrow(/no data rows/);
  });

  it('reports row-level problems with the sheet row number', () => {
    const r = new ImportReport();
    r.fail(3, 'code is required');
    r.exists(5, 'already there');
    const o = r.outcome();
    expect(o.skipped).toBe(2);
    expect(o.errors).toEqual(['Row 3: code is required', 'Row 5: already there (skipped)']);
  });
});

describe('planWbsImport', () => {
  const run = (cells: Record<string, unknown>[], existing: { id: string; code: string; level: number }[] = []) => {
    let n = 0;
    const report = new ImportReport();
    const plan = planWbsImport(cells.map((c, i) => ({ rowNo: i + 2, cells: c })), existing, () => `id${++n}`, report);
    return { plan, outcome: report.outcome() };
  };

  it('infers parents from dotted codes and derives levels, parents first', () => {
    const { plan, outcome } = run([
      { code: '1.1.1', name: 'Footings' },
      { code: '1', name: 'Substructure' },
      { code: '1.1', name: 'Foundations' },
    ]);
    expect(outcome.skipped).toBe(0);
    expect(plan.map((p) => [p.code, p.level])).toEqual([['1', 1], ['1.1', 2], ['1.1.1', 3]]);
    const byCode = Object.fromEntries(plan.map((p) => [p.code, p]));
    expect(byCode['1'].parentId).toBeNull();
    expect(byCode['1.1'].parentId).toBe(byCode['1'].id);
    expect(byCode['1.1.1'].parentId).toBe(byCode['1.1'].id);
  });

  it('uses an explicit parentCode and attaches to items already in the project', () => {
    const { plan } = run(
      [{ code: 'FND-A', name: 'Pad A', parentcode: '1' }, { code: '1.2', name: 'Slab' }],
      [{ id: 'exist1', code: '1', level: 1 }],
    );
    const byCode = Object.fromEntries(plan.map((p) => [p.code, p]));
    expect(byCode['FND-A'].parentId).toBe('exist1');
    expect(byCode['FND-A'].level).toBe(2);
    expect(byCode['1.2'].parentId).toBe('exist1');
  });

  it('skips codes that already exist or repeat, so re-importing is safe', () => {
    const { plan, outcome } = run(
      [{ code: '1', name: 'Dup of existing' }, { code: '2', name: 'New' }, { code: '2', name: 'Repeat' }],
      [{ id: 'e', code: '1', level: 1 }],
    );
    expect(plan.map((p) => p.code)).toEqual(['2']);
    expect(outcome.skipped).toBe(2);
  });

  it('rejects bad numbers, unknown parents, self-parents and parent loops', () => {
    const { plan, outcome } = run([
      { code: 'A', name: 'a', quantity: -1 },
      { code: 'B', name: 'b', parentcode: 'ZZZ' },
      { code: 'C', name: 'c', parentcode: 'C' },
      { code: 'D', name: 'd', parentcode: 'E' },
      { code: 'E', name: 'e', parentcode: 'D' },
      { code: 'OK', name: 'fine', weightpct: 40 },
      { name: 'no code' },
    ]);
    expect(plan.map((p) => p.code)).toEqual(['OK']);
    expect(outcome.errorCount).toBe(6);
    expect(outcome.errors.join('\n')).toMatch(/quantity must be/);
    expect(outcome.errors.join('\n')).toMatch(/parent "ZZZ" was not found/);
    expect(outcome.errors.join('\n')).toMatch(/its own parent/);
    expect(outcome.errors.join('\n')).toMatch(/circular/);
  });

  it('lists dotted ancestors nearest first', () => {
    expect(dottedAncestors('1.2.3')).toEqual(['1.2', '1']);
    expect(dottedAncestors('1')).toEqual([]);
  });
});

describe('wouldCreateCycle', () => {
  const edges = [['A', 'B'], ['B', 'C']] as const; // A → B → C
  it('allows forward links and rejects ones that close a loop', () => {
    expect(wouldCreateCycle(edges, 'A', 'C')).toBe(false);
    expect(wouldCreateCycle(edges, 'C', 'A')).toBe(true);
    expect(wouldCreateCycle(edges, 'C', 'B')).toBe(true);
    expect(wouldCreateCycle(edges, 'X', 'X')).toBe(true);
    expect(wouldCreateCycle([], 'A', 'B')).toBe(false);
  });
});
