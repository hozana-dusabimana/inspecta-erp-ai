import { PassThrough } from 'stream';
import { ReportPdf, rwf } from '../src/lib/pdf-kit';

function render(build: (r: ReportPdf) => void): Promise<Buffer> {
  return new Promise((resolve) => {
    const out = new PassThrough();
    (out as unknown as { setHeader: () => void }).setHeader = () => undefined;
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    const r = new ReportPdf(out as never, { filename: 't.pdf', title: 'Test', subtitle: 'sub', org: 'Org' });
    build(r);
    r.end();
  });
}

/** Counts page objects (a "/Type /Page" that is not "/Type /Pages"). */
const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

describe('PDF report kit', () => {
  it('a short report is one page (the footer must not add blank pages)', async () => {
    const b = await render((r) => {
      r.kpis([['A', 'RWF 72,000,000'], ['B', 'No data']]);
      r.section('S');
      r.table([{ header: 'x', key: 'x', width: 100 }], [{ x: 1 }, { x: 2 }]);
    });
    expect(b.slice(0, 5).toString()).toBe('%PDF-');
    expect(pages(b)).toBe(1);
  });

  it('a long table flows onto more pages with no blank trailing page', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ x: i }));
    const b = await render((r) => { r.section('Long'); r.table([{ header: 'x', key: 'x', width: 100 }], rows); });
    expect(pages(b)).toBeGreaterThan(1);
    expect(pages(b)).toBeLessThan(6);
  });

  it('formats missing money as No data', () => {
    expect(rwf(null)).toBe('No data');
    expect(rwf(1234567)).toBe('RWF 1,234,567');
  });
});
