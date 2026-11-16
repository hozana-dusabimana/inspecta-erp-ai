import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { classifyFileType, compressImage, uploadToCloudinary, withRetry, type SignedUpload } from './upload';
import type { PendingAttachment } from './attachments';

/**
 * Evidence that must travel WITH a save (T2-09): the company's rules say which record types
 * cannot be saved without photo evidence; the server refuses them otherwise. Each item is
 * stamped with when and where it was taken (the server adds who uploaded it).
 */
export interface EvidenceRules { rules: Record<string, boolean>; labels: Record<string, string>; dailyReportCutoff: string }

export function useEvidenceRules() {
  return useQuery({
    queryKey: ['/organization/evidence-rules'],
    queryFn: () => api.get<EvidenceRules>('/organization/evidence-rules').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function siteLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    const t = setTimeout(() => resolve(null), 5000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 300000 },
    );
  });
}

/** Upload queued attachments now and return them as stamped evidence for the save request. */
export async function pendingToEvidence(module: string, projectId: string | undefined, pending: PendingAttachment[]) {
  const geo = await siteLocation();
  const stamp = { capturedAt: new Date().toISOString(), ...(geo ? { capturedLat: geo.lat, capturedLng: geo.lng } : {}) };
  const out: Array<Record<string, unknown>> = [];
  for (const p of pending) {
    if (p.kind === 'link') { out.push({ url: p.url.trim(), sourceType: 'LINK', fileName: p.label?.trim() || p.url, ...stamp }); continue; }
    const file = await compressImage(p.file);
    const mimeType = file.type || 'application/octet-stream';
    const signed = await withRetry(() => api.post<SignedUpload>('/project-documents/upload-url', { module, recordId: 'new', projectId, fileName: file.name }));
    const asset = await withRetry(() => uploadToCloudinary(signed.data, file, () => {}));
    out.push({ url: asset.secureUrl, sourceType: 'FILE', storagePath: asset.publicId, fileName: file.name, fileType: classifyFileType(mimeType, file.name), mimeType, ...stamp });
  }
  return out;
}
