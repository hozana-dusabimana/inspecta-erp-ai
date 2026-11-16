import { Request } from 'express';
import { z } from 'zod';
import { prisma } from './prisma';
import { BadRequest } from './errors';

/**
 * EVIDENCE RULES (T2-09). The System Admin decides which records cannot be saved without
 * photo evidence. The evidence travels WITH the save request (the browser uploads first),
 * so the server can refuse a record that has none: enforcement is not a hidden button.
 * Every item is stamped with the uploader (from the token), the time and, when the device
 * allows it, the site location.
 */
export const EVIDENCE_MODULES = {
  daily_report: 'Daily report',
  attendance: 'Attendance',
  grn: 'Material receipt (GRN)',
  material_test: 'Quality test',
  inspection: 'Inspection',
  safety_inspection: 'Safety inspection',
  incident: 'Safety incident',
} as const;
export type EvidenceModule = keyof typeof EVIDENCE_MODULES;

export const DEFAULT_EVIDENCE_RULES: Record<EvidenceModule, boolean> = {
  daily_report: true, attendance: true, grn: true, material_test: true, inspection: true, safety_inspection: true, incident: true,
};

export async function evidenceRules(orgId: string): Promise<Record<EvidenceModule, boolean>> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { evidenceRules: true } });
  const saved = (org?.evidenceRules ?? {}) as Partial<Record<EvidenceModule, boolean>>;
  return { ...DEFAULT_EVIDENCE_RULES, ...saved };
}

const httpUrl = z.string().min(1).refine((u) => /^https?:\/\//i.test(u.trim()), 'Evidence must be an http(s) link or an uploaded file');
export const evidenceItem = z.object({
  url: httpUrl,
  fileName: z.string().min(1).max(300).optional(),
  sourceType: z.enum(['FILE', 'LINK']).default('LINK'),
  storagePath: z.string().optional(),
  fileType: z.string().optional(),
  mimeType: z.string().optional(),
  capturedLat: z.number().min(-90).max(90).optional(),
  capturedLng: z.number().min(-180).max(180).optional(),
  capturedAt: z.string().datetime().optional(),
});
export type EvidenceItem = z.infer<typeof evidenceItem>;

/** Evidence carried on a save request (`_evidence`), validated. */
export function evidenceFromBody(body: unknown): EvidenceItem[] {
  const raw = (body as Record<string, unknown> | undefined)?._evidence;
  if (raw === undefined || raw === null) return [];
  return z.array(evidenceItem).max(20).parse(raw);
}

/** Refuse the save when the company requires evidence for this record type and none came with it. */
export async function assertEvidence(req: Request, module: EvidenceModule, items: EvidenceItem[], extraCount = 0): Promise<void> {
  if (items.length + extraCount > 0) return;
  const rules = await evidenceRules(req.user!.orgId);
  if (!rules[module]) return;
  throw BadRequest(`Missing evidence: a ${EVIDENCE_MODULES[module].toLowerCase()} needs at least one photo (or a link to one). It is stamped with who took it, when and where. Required by your company's evidence settings.`);
}

/** Store the evidence on the record it proves (project_documents), stamped with uploader, time and place. */
export async function saveEvidence(orgId: string, userId: string, module: string, recordId: string, projectId: string | null, items: EvidenceItem[]): Promise<void> {
  for (const it of items) {
    const isLink = it.sourceType === 'LINK' || !it.storagePath;
    await prisma.projectDocument.create({
      data: {
        organizationId: orgId, projectId, module, recordId,
        fileName: it.fileName ?? it.url.split('/').pop()?.slice(0, 200) ?? 'evidence',
        fileType: it.fileType ?? (isLink ? 'link' : 'photo'),
        mimeType: it.mimeType ?? (isLink ? 'text/uri-list' : 'image/jpeg'),
        sourceType: isLink ? 'LINK' : 'FILE', storagePath: isLink ? null : it.storagePath, externalUrl: it.url.trim(),
        documentCategory: 'site_photo', uploadedBy: userId,
        capturedLat: it.capturedLat ?? null, capturedLng: it.capturedLng ?? null,
        capturedAt: it.capturedAt ? new Date(it.capturedAt) : new Date(),
      },
    });
  }
}
