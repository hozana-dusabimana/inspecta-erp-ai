import { prisma } from './prisma';

/**
 * Debug log: one place to see what the system did and why, including the verification / password-reset
 * links (the app's one-time codes) and the reason an email failed to send.
 *
 *  - Viewable only by platform admins (Platform console > Debug log).
 *  - Codes and links are stored in `secret` ONLY while DEBUG_LOG_SECRETS=true on the server. Turn it on while
 *    diagnosing sign-up/email problems and off again afterwards: anyone who can read a verification or reset
 *    link can take over that account.
 *  - Never throws and never slows a request: writes are fire-and-forget.
 */
export type DebugLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type DebugCategory = 'AUTH' | 'EMAIL' | 'HTTP' | 'SYSTEM' | 'NOTIFY';

export interface DebugInput {
  level?: DebugLevel;
  category: DebugCategory;
  message: string;
  meta?: Record<string, unknown>;
  /** A code or link (verification, reset...). Stored only when DEBUG_LOG_SECRETS is on. */
  secret?: string | null;
  organizationId?: string | null;
  userId?: string | null;
}

export const secretsEnabled = () => String(process.env.DEBUG_LOG_SECRETS ?? '').toLowerCase() === 'true';
export const debugLogEnabled = () => String(process.env.DEBUG_LOG ?? 'true').toLowerCase() !== 'false';

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|otp|apikey|api_key/i;

/** Removes anything that looks like a credential from metadata (the secret field is the only place for those). */
export function sanitizeMeta(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value == null ? value : '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeMeta(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message.slice(0, 400) };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[hidden]' : sanitizeMeta(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return value;
}

/** Pulls links/codes (anything with a token) out of an email body so they can be shown in the log. */
export function extractSecrets(text: string): string | null {
  const links = text.match(/https?:\/\/[^\s"'<>]*(?:token|code|otp)=[^\s"'<>]+/gi);
  return links && links.length ? [...new Set(links)].join('\n') : null;
}

const MAX_ROWS = 20_000;
const KEEP_DAYS = 14;
let writes = 0;

async function prune() {
  try {
    await prisma.debugEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
    const total = await prisma.debugEvent.count();
    if (total > MAX_ROWS) {
      const cutoff = await prisma.debugEvent.findMany({ orderBy: { createdAt: 'desc' }, skip: MAX_ROWS, take: 1, select: { createdAt: true } });
      if (cutoff[0]) await prisma.debugEvent.deleteMany({ where: { createdAt: { lte: cutoff[0].createdAt } } });
    }
  } catch { /* pruning is best-effort */ }
}

/** Record an event. Safe to call anywhere; returns immediately. */
export function debugLog(input: DebugInput): void {
  if (!debugLogEnabled()) return;
  const level = input.level ?? 'INFO';
  // Mirror to the server console so `docker logs` shows the same story.
  // eslint-disable-next-line no-console
  console.log(`[debug:${input.category}:${level}] ${input.message}`);
  void (async () => {
    try {
      await prisma.debugEvent.create({
        data: {
          level,
          category: input.category,
          message: input.message.slice(0, 500),
          meta: input.meta ? (sanitizeMeta(input.meta) as object) : undefined,
          secret: input.secret && secretsEnabled() ? input.secret.slice(0, 4000) : null,
          organizationId: input.organizationId ?? null,
          userId: input.userId ?? null,
        },
      });
      if (++writes % 200 === 0) void prune();
    } catch {
      /* the log must never break the app (for example before its table exists) */
    }
  })();
}
