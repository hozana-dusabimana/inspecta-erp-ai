// Offline queue for the single daily report form. Site signal comes and goes, so a
// report that cannot be sent is stored on the phone (photos included) and sent when
// the connection returns. The `clientRef` doubles as an idempotency key on the
// server, so a retry after a dropped response can never create a second report.
import { api, ApiError } from './api';
import { compressImage, uploadToCloudinary, withRetry, type SignedUpload } from './upload';

const DB = 'inspecta-offline';
const STORE = 'daily-reports';

export interface QueuedReport {
  id: string; // = clientRef
  payload: Record<string, unknown>;
  photos: File[];
  sheet: File | null;
  createdAt: number;
  lastError?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const queueReport = (r: QueuedReport) => tx('readwrite', (s) => s.put(r)).then(() => undefined);
export const listQueued = () => tx<QueuedReport[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedReport[]>).catch(() => [] as QueuedReport[]);
export const removeQueued = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined);

export function newClientRef(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
}

/** A thrown error that is not an API answer means the request never got through. */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);

async function uploadPhoto(original: File): Promise<string> {
  const file = await compressImage(original);
  const signed = await withRetry(() => api.post<SignedUpload>('/documents/upload-url', { filename: file.name }), 2);
  const asset = await withRetry(() => uploadToCloudinary(signed.data, file, () => {}), 2);
  return asset.secureUrl;
}

export interface SubmitResult {
  reportNumber?: string; entries: number; attendance: number; materials: number; equipmentLogs: number; duplicate?: boolean;
}

/** Upload the photos, then send the report. Throws on failure so the caller can queue it. */
export async function sendReport(r: QueuedReport): Promise<SubmitResult> {
  const photos = await Promise.all(r.photos.map(uploadPhoto));
  const signedSheetUrl = r.sheet ? await uploadPhoto(r.sheet) : undefined;
  const res = await api.post<SubmitResult>('/production/field-report', { ...r.payload, photos, signedSheetUrl });
  return res.data;
}

/** Try every queued report in order; stops at the first network failure. */
export async function flushQueue(): Promise<{ sent: number; failed: number; remaining: number }> {
  let sent = 0; let failed = 0;
  for (const r of await listQueued()) {
    try {
      await sendReport(r);
      await removeQueued(r.id);
      sent += 1;
    } catch (e) {
      if (isNetworkError(e)) break;
      // The server rejected it (e.g. a deleted activity): keep it and show why.
      failed += 1;
      await queueReport({ ...r, lastError: e instanceof Error ? e.message : 'Rejected' });
    }
  }
  return { sent, failed, remaining: (await listQueued()).length };
}
