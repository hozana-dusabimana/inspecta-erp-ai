import { api } from './api';
import { classifyFileType, compressImage, uploadToCloudinary, withRetry, type SignedUpload } from './upload';

// Attaching evidence to a record, in one place so it behaves identically
// whether it happens on an existing record or is queued on a create form and
// replayed the moment the record gets its id.

export interface AttachTarget {
  module: string;
  recordId: string;
  projectId?: string;
}

export interface AttachMeta {
  documentCategory?: string;
  description?: string;
}

/** Upload the bytes to Cloudinary, then store the resulting link. */
export async function attachFile(
  target: AttachTarget,
  original: File,
  meta: AttachMeta = {},
  onProgress: (pct: number) => void = () => {},
): Promise<void> {
  const file = await compressImage(original); // resize/HEIC-passthrough first
  const mimeType = file.type || 'application/octet-stream';
  const signed = await withRetry(() =>
    api.post<SignedUpload>('/project-documents/upload-url', { ...target, fileName: file.name }),
  );
  const asset = await withRetry(() => uploadToCloudinary(signed.data, file, onProgress));
  await withRetry(() =>
    api.post('/project-documents', {
      ...target,
      sourceType: 'FILE',
      fileName: file.name,
      fileType: classifyFileType(mimeType, file.name),
      mimeType,
      fileSizeBytes: asset.bytes,
      storagePath: asset.publicId,
      externalUrl: asset.secureUrl,
      ...meta,
    }),
  );
}

/** Record a link to evidence that already lives somewhere else. */
export async function attachLink(
  target: AttachTarget,
  url: string,
  label: string | undefined,
  meta: AttachMeta = {},
): Promise<void> {
  const trimmed = url.trim();
  await withRetry(() =>
    api.post('/project-documents', {
      ...target,
      sourceType: 'LINK',
      // Default the display name to the host so the list stays readable when
      // the URL itself is a 200-character signed link.
      fileName: label?.trim() || new URL(trimmed).hostname,
      fileType: 'link',
      externalUrl: trimmed,
      ...meta,
    }),
  );
}

/** An attachment chosen before the record exists, replayed after it is created. */
export type PendingAttachment =
  | { key: string; kind: 'file'; file: File; documentCategory?: string; description?: string }
  | { key: string; kind: 'link'; url: string; label?: string; documentCategory?: string; description?: string };

export const pendingLabel = (p: PendingAttachment) => (p.kind === 'file' ? p.file.name : p.label?.trim() || p.url);

/**
 * Replay queued attachments against a freshly created record. Failures are
 * collected rather than thrown: the record itself already saved, so one bad
 * upload must not read as "creating the record failed".
 */
export async function flushPending(
  target: AttachTarget,
  pending: PendingAttachment[],
  onProgress: (key: string, pct: number) => void = () => {},
): Promise<string[]> {
  const errors: string[] = [];
  for (const item of pending) {
    try {
      const meta = { documentCategory: item.documentCategory, description: item.description };
      if (item.kind === 'file') {
        await attachFile(target, item.file, meta, (pct) => onProgress(item.key, pct));
      } else {
        await attachLink(target, item.url, item.label, meta);
      }
    } catch (e) {
      errors.push(`${pendingLabel(item)}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }
  return errors;
}
