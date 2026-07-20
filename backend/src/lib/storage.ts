import crypto from 'crypto';
import { env } from '../config/env';
import { BadRequest } from './errors';

/**
 * File storage — Cloudinary holds the bytes, our database holds the link.
 *
 * The browser uploads straight to Cloudinary; the API only signs the request,
 * so file data never passes through (or is stored on) our server. That keeps
 * uploads fast on a weak site connection and keeps the API container
 * stateless. What we persist is the returned `secure_url` plus the `public_id`
 * needed to manage the asset later.
 *
 * The api_secret never leaves the backend — only a per-upload signature does.
 */

export function storageConfigured(): boolean {
  const c = env.cloudinary;
  return Boolean(c.cloudName && c.apiKey && c.apiSecret);
}

/** Uniform, actionable error — every caller surfaces the same guidance. */
export function assertStorageConfigured(): void {
  if (storageConfigured()) return;
  throw BadRequest(
    'File storage is not configured yet, so uploads are unavailable. Set CLOUDINARY_CLOUD_NAME, ' +
      'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in backend/.env. ' +
      'In the meantime you can still attach evidence by pasting a link to it.',
  );
}

export const MAX_UPLOAD_BYTES = 52428800; // 50 MB

/** Strip anything that could break a storage path or escape its prefix. */
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file';
}

/**
 * Cloudinary signs the alphabetically-sorted upload parameters concatenated
 * with the api_secret. `file`, `api_key` and `resource_type` are excluded —
 * they travel in the request but are not part of the signed payload.
 */
function sign(params: Record<string, string>): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + env.cloudinary.apiSecret).digest('hex');
}

export interface SignedUpload {
  /** POST the file here as multipart/form-data, together with `params`. */
  uploadUrl: string;
  /** Form fields that must accompany the file, signature included. */
  params: Record<string, string>;
  /** Where the asset will live — echoed back so the caller can store it. */
  folder: string;
}

/**
 * Build a signed direct-upload request for the browser.
 *
 * `resource_type: auto` lets one endpoint accept photos, PDFs, spreadsheets and
 * Word files alike — site evidence arrives in all of those.
 */
export function signUpload(folderSuffix: string, fileName: string): SignedUpload {
  assertStorageConfigured();
  const folder = `${env.cloudinary.folder}/${folderSuffix}`.replace(/\/+/g, '/').replace(/\/$/, '');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Unique public_id: re-uploading a file of the same name must never overwrite
  // the version an existing record still points at. The random suffix matters —
  // a timestamp alone collides when two people upload the same filename within
  // the same millisecond, and Cloudinary would silently replace the first.
  const unique = `${Date.now()}${crypto.randomBytes(4).toString('hex')}`;
  const publicId = `${unique}_${safeFileName(fileName).replace(/\.[^.]+$/, '')}`;

  const signed: Record<string, string> = { folder, public_id: publicId, timestamp };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/auto/upload`,
    params: { ...signed, signature: sign(signed), api_key: env.cloudinary.apiKey },
    folder,
  };
}

/**
 * Accept a user-supplied link. http and https are both allowed — plenty of
 * internal/on-prem document servers and lab portals are plain http, and
 * rejecting them just pushes the URL into a notes field. Everything else
 * (notably `javascript:` and `data:`, which are XSS vectors once rendered as an
 * anchor) is refused.
 */
export function normalizeExternalUrl(raw: string): string {
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw BadRequest('Enter a full link including http:// or https:// (e.g. https://drive.example.com/report.pdf)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw BadRequest(`Links must start with http:// or https:// — "${parsed.protocol}" is not allowed.`);
  }
  return parsed.toString();
}

/** Best-effort file-kind classification used for the attachment icons/filters. */
export function classifyFileType(mimeType: string, fileName = ''): string {
  const mime = (mimeType || '').toLowerCase();
  const name = fileName.toLowerCase();
  if (mime.startsWith('image/')) return 'photo';
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv') || /\.(xlsx?|csv)$/.test(name)) return 'excel';
  if (mime.includes('word') || mime.includes('document') || /\.(docx?|rtf|odt|txt)$/.test(name)) return 'doc';
  return 'other';
}
