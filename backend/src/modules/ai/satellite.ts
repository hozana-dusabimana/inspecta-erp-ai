import { env } from '../../config/env';

/**
 * Thin client for the Satellite API (https://satellite.isiri.rw/docs).
 * Chat-completions compatible; files, images and audio travel as base64 inside
 * the JSON body. Tool calls are NOT supported natively — the provider emulates them.
 */

export function satelliteConfigured(): boolean {
  return Boolean(env.ai.satellite.apiKey);
}

async function satelliteFetch(path: string, body: unknown, timeoutMs = 90_000): Promise<Response> {
  return fetch(`${env.ai.satellite.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ai.satellite.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function failure(what: string, res: Response): Promise<Error> {
  let detail = '';
  try {
    const j = (await res.json()) as { error?: { message?: string } | string };
    detail = typeof j.error === 'string' ? j.error : j.error?.message ?? '';
  } catch { /* non-JSON body */ }
  return new Error(`Satellite ${what} failed (${res.status})${detail ? `: ${detail}` : ''}`);
}

/** Strip an optional `data:<mime>;base64,` prefix. */
export function stripDataUrl(data: string): string {
  const i = data.indexOf('base64,');
  return data.startsWith('data:') && i >= 0 ? data.slice(i + 7) : data;
}

export interface SatelliteChatResult {
  text: string;
  model: string;
  finishReason?: string;
  creditsUsed?: number;
}

/** Plain chat-completions call. `messages` is already in wire shape (content may be parts). */
export async function satelliteChat(messages: unknown[], opts: { maxTokens?: number; model?: string } = {}): Promise<SatelliteChatResult> {
  const model = opts.model ?? env.ai.satellite.model;
  const res = await satelliteFetch('/chat/completions', { model, messages, max_tokens: opts.maxTokens ?? 4096 });
  if (!res.ok) throw await failure('chat', res);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { credits_used?: number };
  };
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    model,
    finishReason: json.choices?.[0]?.finish_reason,
    creditsUsed: json.usage?.credits_used,
  };
}

const AUDIO_FORMATS = ['wav', 'mp3', 'm4a', 'mp4', 'webm', 'ogg', 'flac'];

/** Derive an audio format Satellite accepts from a mime type or filename. */
export function audioFormat(mime?: string, filename?: string): string {
  const fromMime = mime?.toLowerCase().match(/audio\/(?:x-)?([a-z0-9]+)/)?.[1];
  const fromName = filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const raw = fromMime ?? fromName ?? 'webm';
  const map: Record<string, string> = { mpeg: 'mp3', mpga: 'mp3', wave: 'wav', mp4a: 'm4a', aac: 'm4a' };
  const f = map[raw] ?? raw;
  return AUDIO_FORMATS.includes(f) ? f : 'webm';
}

/** Speech → text. Recordings up to ~4 MB (≈2 minutes). */
export async function transcribeAudio(base64: string, format: string): Promise<string> {
  const res = await satelliteFetch('/audio/transcriptions', { audio: stripDataUrl(base64), format });
  if (res.status === 422) throw new Error('No speech was detected in that recording.');
  if (res.status >= 500) throw new Error('Voice transcription is temporarily unavailable. Please type your message instead.');
  if (!res.ok) throw await failure('transcription', res);
  const json = (await res.json()) as { text?: string };
  return (json.text ?? '').trim();
}

export interface ReadDocumentResult {
  filename: string;
  text: string;
  characters: number;
  truncated: boolean;
}

/** Extract text from PDF/DOCX/XLSX/PPTX/ODF/text files, with no model involved (free). */
export async function readDocument(filename: string, base64: string, maxChars = 120_000): Promise<ReadDocumentResult> {
  const res = await satelliteFetch('/documents/read', { filename, data: stripDataUrl(base64), max_chars: maxChars });
  if (res.status === 422) throw new Error(`"${filename}" has no readable text (a scan? send it as an image instead).`);
  if (!res.ok) throw await failure('document read', res);
  return (await res.json()) as ReadDocumentResult;
}
