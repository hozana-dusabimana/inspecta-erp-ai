import { Response } from 'express';
import ExcelJS from 'exceljs';

/** Flatten a record to scalar columns for CSV/XLSX export (drops relations). */
export function flattenForExport(row: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) { out[k] = ''; continue; }
    if (v instanceof Date) { out[k] = v.toISOString().slice(0, 19).replace('T', ' '); continue; }
    if (Array.isArray(v)) { out[k] = v.join('; '); continue; }
    if (typeof v === 'object') {
      // Prisma Decimal exposes toNumber(); other relation objects are skipped.
      const dec = v as { toNumber?: () => number };
      if (typeof dec.toNumber === 'function') out[k] = dec.toNumber();
      continue;
    }
    out[k] = v as string | number;
  }
  return out;
}

/**
 * Streams a row set to the client as CSV or XLSX. Shared by the CRUD factory
 * and the platform console so every download in the product looks the same.
 */
export async function sendTabularExport(
  res: Response,
  rows: Record<string, unknown>[],
  name: string,
  format: 'csv' | 'xlsx',
): Promise<void> {
  const flat = rows.map(flattenForExport);
  const headers = flat.length ? Object.keys(flat[0]) : ['id'];
  const filename = `${name}-${new Date().toISOString().slice(0, 10)}`;

  if (format === 'csv') {
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(','), ...flat.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.send('﻿' + csv); // BOM so Excel reads UTF-8
    return;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'INSPECTA BUILDOS';
  const ws = wb.addWorksheet(name.slice(0, 31)); // Excel caps sheet names at 31 chars
  ws.columns = headers.map((h) => ({ header: h, key: h, width: 18 }));
  ws.getRow(1).font = { bold: true };
  flat.forEach((r) => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/** Normalizes a `?format=` query param. Defaults to xlsx. */
export function exportFormat(raw: unknown): 'csv' | 'xlsx' {
  return raw === 'csv' ? 'csv' : 'xlsx';
}
