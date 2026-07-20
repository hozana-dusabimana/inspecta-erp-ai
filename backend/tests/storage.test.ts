import crypto from 'crypto';

// Credentials must exist before the module reads env at import time.
process.env.CLOUDINARY_CLOUD_NAME = 'testcloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
process.env.CLOUDINARY_FOLDER = 'inspecta';

import { classifyFileType, normalizeExternalUrl, safeFileName, signUpload } from '../src/lib/storage';

describe('attachment links', () => {
  it('accepts http as well as https — internal doc servers are often plain http', () => {
    expect(normalizeExternalUrl('https://drive.example.com/a.pdf')).toBe('https://drive.example.com/a.pdf');
    expect(normalizeExternalUrl('http://10.0.0.5/specs/itp.pdf')).toBe('http://10.0.0.5/specs/itp.pdf');
  });

  it('trims surrounding whitespace from a pasted link', () => {
    expect(normalizeExternalUrl('  https://example.com/x.pdf  ')).toBe('https://example.com/x.pdf');
  });

  it('rejects XSS-capable schemes and non-URLs', () => {
    // These render as an anchor href, so they must never reach the database.
    expect(() => normalizeExternalUrl('javascript:alert(1)')).toThrow();
    expect(() => normalizeExternalUrl('data:text/html,<script>alert(1)</script>')).toThrow();
    expect(() => normalizeExternalUrl('just some text')).toThrow();
    expect(() => normalizeExternalUrl('')).toThrow();
  });
});

describe('Cloudinary upload signing', () => {
  const expected = (params: Record<string, string>) =>
    crypto.createHash('sha1')
      .update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + 'test-secret')
      .digest('hex');

  it('signs exactly the folder/public_id/timestamp triple Cloudinary expects', () => {
    const signed = signUpload('org1/proj1/risk/rec1', 'site photo.jpg');
    const { signature, api_key, ...toSign } = signed.params;
    expect(signature).toBe(expected(toSign));
    expect(api_key).toBe('test-key');
    // api_key and signature are sent but must NOT be part of the signed payload.
    expect(Object.keys(toSign).sort()).toEqual(['folder', 'public_id', 'timestamp']);
  });

  it('never exposes the api secret to the client payload', () => {
    const signed = signUpload('org1/documents', 'a.pdf');
    expect(JSON.stringify(signed)).not.toContain('test-secret');
  });

  it('namespaces uploads under the configured folder', () => {
    expect(signUpload('org1/proj1/ncr/rec9', 'x.pdf').folder).toBe('inspecta/org1/proj1/ncr/rec9');
  });

  it('posts to the account-scoped auto endpoint so any file type is accepted', () => {
    expect(signUpload('org1', 'x.docx').uploadUrl).toBe('https://api.cloudinary.com/v1_1/testcloud/auto/upload');
  });

  it('timestamps public_id so re-uploading the same name never overwrites an older version', () => {
    const a = signUpload('org1', 'report.pdf').params.public_id;
    const b = signUpload('org1', 'report.pdf').params.public_id;
    expect(a).not.toBe(b);
  });

  it('sanitises names that would break the storage path', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFileName('photo (1).jpg')).toBe('photo__1_.jpg');
    expect(safeFileName('')).toBe('file');
  });
});

describe('file kind classification', () => {
  it('maps the formats site evidence actually arrives in', () => {
    expect(classifyFileType('image/jpeg', 'a.jpg')).toBe('photo');
    expect(classifyFileType('application/pdf', 'a.pdf')).toBe('pdf');
    expect(classifyFileType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')).toBe('excel');
    expect(classifyFileType('application/msword', 'a.doc')).toBe('doc');
    expect(classifyFileType('application/octet-stream', 'a.dwg')).toBe('other');
  });

  it('falls back to the file extension when the browser sends no mime type', () => {
    expect(classifyFileType('', 'scan.pdf')).toBe('pdf');
    expect(classifyFileType('', 'boq.csv')).toBe('excel');
  });
});
