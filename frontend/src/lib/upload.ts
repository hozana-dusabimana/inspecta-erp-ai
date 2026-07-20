// Shared browser-side upload plumbing, used by both the per-record evidence
// panel (DocumentAttachments) and the generic upload-or-link form field
// (FileOrUrlInput). Site connections are slow and unreliable, so every step is
// compressed where possible and retried.

/** Client-side compression so a 10–20MB phone photo doesn't choke a weak site
 *  connection. HEIC/HEIF is stored as-is (browsers can't reliably decode it). */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || /heic|heif/i.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1920;
    let { width, height } = bitmap;
    if (Math.max(width, height) > maxDim) {
      const s = maxDim / Math.max(width, height);
      width = Math.round(width * s); height = Math.round(height * s);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    for (const q of [0.8, 0.6, 0.45, 0.3]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', q));
      if (blob && (blob.size <= 2 * 1024 * 1024 || q === 0.3)) {
        return new File([blob], file.name.replace(/\.(png|heic|heif|webp|jpeg)$/i, '.jpg'), { type: 'image/jpeg' });
      }
    }
    return file;
  } catch {
    return file;
  }
}

/** What the backend hands us so the browser can upload straight to Cloudinary. */
export interface SignedUpload {
  uploadUrl: string;
  params: Record<string, string>;
}

/** The bits of Cloudinary's upload response we persist. */
export interface UploadedAsset {
  secureUrl: string;
  publicId: string;
  bytes: number;
}

/**
 * POST the file straight to Cloudinary with per-file progress (fetch can't
 * report upload progress, hence XHR). The file never touches our API server.
 */
export function uploadToCloudinary(
  signed: SignedUpload,
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(signed.params)) body.append(k, v);
    body.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', signed.uploadUrl);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let json: Record<string, any> = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300 && json.secure_url) {
        resolve({ secureUrl: json.secure_url, publicId: json.public_id, bytes: json.bytes ?? file.size });
      } else {
        // Cloudinary reports the real reason here (bad signature, size limit,
        // unsupported format) — surface it rather than a bare status code.
        reject(new Error(json?.error?.message || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(body);
  });
}

/** Retry flaky steps (site internet is unreliable) with a short backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
  throw lastErr;
}

export type FileKind = 'photo' | 'pdf' | 'excel' | 'doc' | 'link' | 'other';

/** Mirrors the backend's classifyFileType so icons/filters agree either way. */
export function classifyFileType(mime: string, fileName = ''): FileKind {
  const m = (mime || '').toLowerCase();
  const n = fileName.toLowerCase();
  if (m.startsWith('image/')) return 'photo';
  if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv') || /\.(xlsx?|csv)$/.test(n)) return 'excel';
  if (m.includes('word') || m.includes('document') || /\.(docx?|rtf|odt|txt)$/.test(n)) return 'doc';
  return 'other';
}

/** Accepted upload types — deliberately broad: site evidence arrives as photos,
 *  scanned PDFs, spreadsheets, Word method statements and CAD exports. */
export const ACCEPT_ANY_DOCUMENT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,.ppt,.pptx,.dwg,.dxf,.zip';

/** Both http and https are fine — plenty of internal document servers are http.
 *  Anything else (javascript:, data:) is refused, matching the backend. */
export function isAcceptableUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const kb = (n?: number | null) => (n ? `${Math.round(n / 1024)} KB` : '');
