import express, { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { BadRequest } from './errors';
import { recordAudit } from '../auth/audit';

/**
 * Shared building blocks for the Excel importers. Every importer follows the
 * same contract: parse the first worksheet → validate row by row → skip (and
 * report) bad rows → write the good ones in ONE statement/transaction, and
 * answer `{ created, updated, skipped, errors }`.
 */

export const MAX_IMPORT_ROWS = 5000;
const MAX_REPORTED_ERRORS = 50;

/** Raw-body parser for the .xlsx upload (any content-type is accepted). */
export const xlsxRaw = express.raw({ type: () => true, limit: '8mb' });

/** Header normalisation: "Duration Days", "duration_days" and "durationDays" all match. */
export const normHeader = (v: unknown) => str(v).toLowerCase().replace(/[^a-z0-9]/g, '');

export const str = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join('').trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
  }
  return String(v).trim();
};

export const numOrU = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = str(v).replace(/[, ]/g, '');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** True when the cell holds something (so "not a number" can be told from "blank"). */
export const hasValue = (v: unknown) => str(v) !== '';

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Parse a date cell: a real Excel date, an Excel serial number, or a text date
 * (YYYY-MM-DD, DD/MM/YYYY). Returns undefined for blank and `null` for a value
 * that is present but not a date.
 */
export function dateOrU(v: unknown): Date | undefined | null {
  if (!hasValue(v)) return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    if (v < 1 || v > 80000) return null;
    return new Date(EXCEL_EPOCH_MS + Math.round(v * 86400000));
  }
  const s = str(v);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) {
    const d = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
    return d.getUTCMonth() === Number(dmy[2]) - 1 ? d : null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const boolOrU = (v: unknown): boolean | undefined => {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  if (['true', 'yes', 'y', '1', 'milestone'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'task'].includes(s)) return false;
  return undefined;
};

export const splitList = (v: unknown): string[] =>
  str(v).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

export interface ImportRow { rowNo: number; cells: Record<string, unknown> }

/** Parse the first worksheet into header-keyed rows (headers normalised, row numbers kept). */
export async function rowsFromXlsx(buf: Buffer): Promise<ImportRow[]> {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) throw BadRequest('No file received — upload an .xlsx file.');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw BadRequest('That file could not be read — upload a valid .xlsx workbook.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw BadRequest('The workbook has no sheets.');
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = normHeader(cell.value); });
  if (!headers.some(Boolean)) throw BadRequest('The first row must contain column headers (download the template).');
  const rows: ImportRow[] = [];
  ws.eachRow((row, rowNo) => {
    if (rowNo === 1) return;
    const cells: Record<string, unknown> = {};
    row.eachCell((cell, col) => { if (headers[col]) cells[headers[col]] = cell.value; });
    if (Object.values(cells).some((v) => hasValue(v))) rows.push({ rowNo, cells });
  });
  if (rows.length === 0) throw BadRequest('The sheet has no data rows.');
  if (rows.length > MAX_IMPORT_ROWS) throw BadRequest(`Too many rows (${rows.length}) — import at most ${MAX_IMPORT_ROWS} at a time.`);
  return rows;
}

export interface TemplateColumn { header: string; width?: number; example: unknown; note?: string }

/** Stream a ready-to-fill workbook: header row, one example row and a Notes sheet. */
export async function sendTemplate(res: Response, sheetName: string, columns: TemplateColumn[], filename: string, intro?: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'INSPECTA BUILDOS';
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.header, width: c.width ?? Math.max(14, c.header.length + 4) }));
  ws.getRow(1).font = { bold: true };
  ws.addRow(Object.fromEntries(columns.map((c) => [c.header, c.example])));
  const notes = wb.addWorksheet('Notes');
  notes.columns = [{ header: 'Column', key: 'c', width: 22 }, { header: 'Notes', key: 'n', width: 90 }];
  notes.getRow(1).font = { bold: true };
  if (intro) notes.addRow({ c: '', n: intro });
  columns.forEach((c) => notes.addRow({ c: c.header, n: c.note ?? '' }));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

export interface ImportOutcome {
  created: number;
  updated: number;
  /** Rows not imported (invalid rows + rows that already exist). */
  skipped: number;
  errors: string[];
  errorCount: number;
}

/** Collects per-row problems; `fail` marks a row invalid, `exists` marks a harmless duplicate. */
export class ImportReport {
  private errs: string[] = [];
  skipped = 0;
  created = 0;
  updated = 0;
  fail(rowNo: number, message: string) { this.skipped++; this.errs.push(`Row ${rowNo}: ${message}`); }
  exists(rowNo: number, message: string) { this.skipped++; this.errs.push(`Row ${rowNo}: ${message} (skipped)`); }
  outcome(): ImportOutcome {
    return {
      created: this.created, updated: this.updated, skipped: this.skipped,
      errors: this.errs.slice(0, MAX_REPORTED_ERRORS), errorCount: this.errs.length,
    };
  }
}

/** Audit one import as a single entry (per-row audit would flood the trail). */
export async function auditImport(req: Request, entity: string, outcome: ImportOutcome, extra?: Record<string, unknown>) {
  await recordAudit({
    organizationId: req.user!.orgId,
    userId: req.user!.id,
    action: 'CREATE',
    entity: `import:${entity}`,
    entityId: 'bulk',
    newValues: { created: outcome.created, updated: outcome.updated, skipped: outcome.skipped, ...extra },
    ipAddress: req.ip ?? null,
    userAgent: req.headers?.['user-agent'] ?? null,
  }).catch(() => undefined);
}

/** Natural-order comparator for hierarchical codes ("1.2" < "1.10"). */
export const codeCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
