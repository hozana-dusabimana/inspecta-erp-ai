import { env } from '../../config/env';
import { Attachment } from './providers';
import { audioFormat, readDocument, satelliteChat, transcribeAudio } from './satellite';

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const AUDIO_EXT = ['wav', 'mp3', 'm4a', 'mp4', 'webm', 'ogg', 'flac'];

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

function extOf(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/)?.[1] ?? '';
}

/** Describe/transcribe an image with the vision-capable model (billed to the Satellite key). */
export async function describeImage(base64: string, mime: string, question?: string): Promise<string> {
  const r = await satelliteChat(
    [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        {
          type: 'text',
          text: question ||
            'Describe this image for a construction project record. Transcribe ALL visible text, numbers, labels and tables exactly. Note any defects, safety issues or measurements.',
        },
      ],
    }],
    { maxTokens: 1500 },
  );
  return r.text;
}

/** Turn any attachment into text the model can reason over (docs → text, images → description, audio → transcript). */
export async function attachmentToText(a: { filename: string; mime?: string; data: string }, question?: string): Promise<string> {
  const ext = extOf(a.filename);
  const mime = a.mime || MIME_BY_EXT[ext] || '';
  if (mime.startsWith('audio/') || AUDIO_EXT.includes(ext) && !mime.startsWith('video/')) {
    return transcribeAudio(a.data, audioFormat(mime, a.filename));
  }
  if (mime.startsWith('image/') || IMAGE_EXT.includes(ext)) {
    return describeImage(a.data, mime || MIME_BY_EXT[ext] || 'image/png', question);
  }
  const doc = await readDocument(a.filename, a.data);
  return doc.truncated ? `${doc.text}\n…(truncated)` : doc.text;
}

/** Only fetch files from our own Cloudinary account — never arbitrary URLs (SSRF guard). */
export function isAllowedFileUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const cloud = env.cloudinary.cloudName;
  return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com' && Boolean(cloud) && u.pathname.startsWith(`/${cloud}/`);
}

/** Download a record attachment (by its stored link) and read it. Never throws — returns `{ error }`. */
export async function readFileFromUrl(url: string, question?: string): Promise<{ filename: string; text: string } | { error: string }> {
  if (!isAllowedFileUrl(url)) return { error: 'Only files stored in this workspace (Cloudinary links on records) can be read.' };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { error: `Could not download the file (${res.status}).` };
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return { error: 'File is larger than 8 MB.' };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return { error: 'File is larger than 8 MB.' };
    const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file');
    const mime = (res.headers.get('content-type') ?? '').split(';')[0];
    const text = await attachmentToText({ filename, mime, data: buf.toString('base64') }, question);
    return { filename, text: text.slice(0, 60_000) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not read the file.' };
  }
}

/** Fold user-attached files into the prompt for providers that can't take them natively. */
export async function inlineAttachments(attachments: Attachment[]): Promise<string> {
  const parts: string[] = [];
  for (const a of attachments) {
    try {
      parts.push(`ATTACHED ${a.kind.toUpperCase()} "${a.filename}":\n${await attachmentToText(a)}`);
    } catch (e) {
      parts.push(`ATTACHED ${a.kind.toUpperCase()} "${a.filename}": (could not be read — ${e instanceof Error ? e.message : 'error'})`);
    }
  }
  return parts.join('\n\n');
}
