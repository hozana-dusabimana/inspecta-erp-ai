import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  // Public web app base URL, used to build links in emails (e.g. the email
  // verification link). Defaults to the first configured CORS origin.
  webUrl:
    process.env.APP_URL ??
    (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim(),

  databaseUrl: required('DATABASE_URL'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },

  ai: {
    provider: (process.env.AI_PROVIDER ?? 'openrouter').toLowerCase(),
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY ?? '',
      model: process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free',
    },
    claude: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY ?? '',
      model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
    },
  },

  // File/document storage — Cloudinary holds the bytes, our DB holds the link.
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
    // Everything is uploaded under this prefix so one Cloudinary account can be
    // shared with other apps without the media libraries colliding.
    folder: process.env.CLOUDINARY_FOLDER ?? 'inspecta',
  },

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.EMAIL_FROM ?? 'INSPECTA BUILDOS <no-reply@inspecta.ai>',
    // Where org-wide alerts are also sent (e.g. a monitored inbox).
    fallbackTo: process.env.NOTIFY_FALLBACK_EMAIL ?? '',
  },

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@inspecta.ai',
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345',
  },
};

/**
 * Fail-fast guardrails for production. Called once at boot (index.ts). Refuses
 * to start with dev-default secrets/credentials, and warns about soft-missing
 * config (AI keys, storage, SMTP) that degrades gracefully but is likely a
 * misconfiguration in production.
 */
export function validateProductionEnv(): void {
  if (!env.isProd) return;
  const fatal: string[] = [];
  const warn: string[] = [];

  if (env.jwt.accessSecret === 'dev-access-secret') fatal.push('JWT_ACCESS_SECRET is the insecure dev default');
  if (env.jwt.refreshSecret === 'dev-refresh-secret') fatal.push('JWT_REFRESH_SECRET is the insecure dev default');
  if (env.jwt.accessSecret.length < 24) fatal.push('JWT_ACCESS_SECRET is too short (use ≥ 32 random chars)');
  if (env.jwt.refreshSecret.length < 24) fatal.push('JWT_REFRESH_SECRET is too short (use ≥ 32 random chars)');
  if (env.seed.adminPassword === 'Admin@12345') warn.push('SEED_ADMIN_PASSWORD is the public default — change it after first login');

  const providerKey = { openrouter: env.ai.openrouter.apiKey, claude: env.ai.claude.apiKey, gemini: env.ai.gemini.apiKey }[env.ai.provider];
  if (!providerKey) warn.push(`AI provider "${env.ai.provider}" has no API key — Copilot runs in offline/deterministic mode`);
  if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
    warn.push('Cloudinary not configured — file uploads will fail (attaching links still works)');
  }
  if (!env.smtp.host) warn.push('SMTP not configured — email notifications will not be delivered');

  for (const w of warn) console.warn(`[env] WARNING: ${w}`); // eslint-disable-line no-console
  if (fatal.length) {
    for (const f of fatal) console.error(`[env] FATAL: ${f}`); // eslint-disable-line no-console
    throw new Error(`Refusing to start in production with insecure configuration (${fatal.length} issue(s)). See logs above.`);
  }
}
