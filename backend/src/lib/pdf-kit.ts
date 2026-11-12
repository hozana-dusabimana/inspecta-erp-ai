import PDFDocument from 'pdfkit';
import { Response } from 'express';

/**
 * Small design kit for the PDF report templates: one consistent look (brand header band,
 * KPI tiles, zebra tables with repeating headers, page footer with page numbers).
 */
export const BRAND = { primary: '#471519', accent: '#fc6061', ink: '#1f2328', muted: '#6b7280', line: '#e5e7eb', soft: '#faf5f5', good: '#047857', bad: '#b91c1c', warn: '#b45309' };
const M = 40; // page margin

export type Tone = 'good' | 'bad' | 'warn' | undefined;
export interface Column { header: string; key: string; width: number; align?: 'left' | 'right' | 'center' }

export class ReportPdf {
  readonly doc: InstanceType<typeof PDFDocument>;
  private readonly title: string;
  private readonly subtitle: string;
  private readonly org: string;

  constructor(res: Response, opts: { filename: string; title: string; subtitle?: string; org?: string }) {
    this.doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: opts.title, Author: 'INSPECTA BUILDOS' } });
    this.title = opts.title; this.subtitle = opts.subtitle ?? ''; this.org = opts.org ?? '';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${opts.filename}"`);
    // Build the whole file first and send it with a Content-Length: a sized body downloads reliably in
    // every browser and behind proxies, where a chunked stream can stall.
    const chunks: Buffer[] = [];
    this.doc.on('data', (c: Buffer) => chunks.push(c));
    this.doc.on('end', () => {
      const body = Buffer.concat(chunks);
      res.setHeader('Content-Length', String(body.length));
      res.end(body);
    });
    this.header();
  }

  private get width() { return this.doc.page.width - M * 2; }

  private header() {
    const d = this.doc;
    d.rect(0, 0, d.page.width, 78).fill(BRAND.primary);
    d.rect(0, 78, d.page.width, 3).fill(BRAND.accent);
    d.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('INSPECTA BUILDOS', M, 20, { characterSpacing: 1.5 });
    d.font('Helvetica-Bold').fontSize(19).text(this.title, M, 34, { width: this.width * 0.7 });
    d.font('Helvetica').fontSize(9).fillColor('#f3d6d6');
    if (this.subtitle) d.text(this.subtitle, M, 58, { width: this.width * 0.7 });
    d.text(new Date().toISOString().slice(0, 10), M, 22, { width: this.width, align: 'right' });
    if (this.org) d.text(this.org, M, 34, { width: this.width, align: 'right' });
    d.fillColor(BRAND.ink);
    d.y = 98;
  }

  private ensure(h: number) {
    if (this.doc.y + h > this.doc.page.height - 56) { this.doc.addPage(); this.doc.y = M; }
  }

  section(title: string) {
    this.ensure(40);
    const d = this.doc;
    d.moveDown(0.6);
    d.font('Helvetica-Bold').fontSize(12).fillColor(BRAND.primary).text(title, M, d.y);
    d.moveTo(M, d.y + 2).lineTo(M + this.width, d.y + 2).lineWidth(0.6).strokeColor(BRAND.line).stroke();
    d.y += 10; d.fillColor(BRAND.ink);
  }

  note(text: string) {
    this.ensure(24);
    this.doc.font('Helvetica-Oblique').fontSize(9).fillColor(BRAND.muted).text(text, M, this.doc.y, { width: this.width });
    this.doc.fillColor(BRAND.ink).moveDown(0.4);
  }

  /** A row of KPI tiles: [label, value, tone?]. */
  kpis(items: Array<[string, string, Tone?]>) {
    const d = this.doc;
    const per = Math.min(items.length, 4);
    const gap = 10;
    const w = (this.width - gap * (per - 1)) / per;
    for (let i = 0; i < items.length; i += per) {
      this.ensure(62);
      const y = d.y;
      items.slice(i, i + per).forEach(([label, value, tone], j) => {
        const x = M + j * (w + gap);
        d.roundedRect(x, y, w, 52, 6).fillAndStroke(BRAND.soft, BRAND.line);
        d.fillColor(BRAND.muted).font('Helvetica-Bold').fontSize(7.5).text(label.toUpperCase(), x + 10, y + 9, { width: w - 20, characterSpacing: 0.6 });
        let size = 15;
        d.font('Helvetica-Bold');
        while (size > 8 && d.fontSize(size).widthOfString(value) > w - 20) size -= 0.5;
        d.fillColor(tone ? BRAND[tone] : BRAND.primary).fontSize(size).text(value, x + 10, y + 24, { width: w - 20, lineBreak: false });
      });
      d.y = y + 62;
    }
    d.fillColor(BRAND.ink);
  }

  /** Zebra table with a repeating header row. */
  table(columns: Column[], rows: Array<Record<string, string | number | null | undefined>>, opts: { empty?: string } = {}) {
    const d = this.doc;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const scale = this.width / total;
    const cols = columns.map((c) => ({ ...c, w: c.width * scale }));
    const drawHeader = () => {
      this.ensure(40);
      const y = d.y;
      d.rect(M, y, this.width, 20).fill(BRAND.primary);
      let x = M;
      d.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      for (const c of cols) { d.text(c.header, x + 6, y + 6, { width: c.w - 12, align: c.align ?? 'left', lineBreak: false }); x += c.w; }
      d.y = y + 20; d.fillColor(BRAND.ink);
    };
    drawHeader();
    if (!rows.length) {
      d.font('Helvetica-Oblique').fontSize(9).fillColor(BRAND.muted).text(opts.empty ?? 'Nothing to show yet.', M + 6, d.y + 6);
      d.y += 24; d.fillColor(BRAND.ink); return;
    }
    rows.forEach((r, i) => {
      if (d.y + 20 > d.page.height - 56) { d.addPage(); d.y = M; drawHeader(); }
      const y = d.y;
      if (i % 2 === 0) d.rect(M, y, this.width, 20).fill('#fbf8f8');
      let x = M;
      d.fillColor(BRAND.ink).font('Helvetica').fontSize(8.5);
      for (const c of cols) { d.text(String(r[c.key] ?? '—'), x + 6, y + 6, { width: c.w - 12, align: c.align ?? 'left', lineBreak: false, ellipsis: true }); x += c.w; }
      d.y = y + 20;
    });
    d.moveTo(M, d.y).lineTo(M + this.width, d.y).lineWidth(0.6).strokeColor(BRAND.line).stroke();
    d.y += 8;
  }

  /** Footer with page numbers on every page, then close. */
  end() {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      d.switchToPage(range.start + i);
      const y = d.page.height - 34;
      const bottomMargin = d.page.margins.bottom;
      d.page.margins.bottom = 0; // writing inside the bottom margin must not add a page
      d.moveTo(M, y - 6).lineTo(M + this.width, y - 6).lineWidth(0.5).strokeColor(BRAND.line).stroke();
      d.font('Helvetica').fontSize(8).fillColor(BRAND.muted);
      d.text(`INSPECTA BUILDOS  |  ${this.title}`, M, y, { width: this.width / 2, lineBreak: false });
      d.text(`Page ${i + 1} of ${range.count}`, M + this.width / 2, y, { width: this.width / 2, align: 'right', lineBreak: false });
      d.page.margins.bottom = bottomMargin;
    }
    d.end();
  }
}

export const rwf = (v: number | null | undefined) => (v == null ? 'No data' : 'RWF ' + Math.round(v).toLocaleString('en-US'));
export const pct = (v: number | null | undefined) => (v == null ? 'No data' : `${v}%`);
export const idx = (v: number | null | undefined) => (v == null ? 'No data' : v.toFixed(2));
export const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
