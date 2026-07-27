import http from 'http';
import { createApp } from './app';
import { env, validateProductionEnv } from './config/env';
import { prisma } from './lib/prisma';
import { initRealtime } from './lib/realtime';
import { ensureSuperAdmin } from './modules/auth/superadmin';

async function main() {
  // Fail fast on insecure production configuration (weak secrets, etc.).
  validateProductionEnv();
  // Fail fast if the database is unreachable.
  await prisma.$connect();

  // Guarantee the platform superadmin on every boot — `npm run dev` and a bare
  // `node dist/index.js` don't run prisma/seed.ts, and an API you can't log
  // into is not a running API. Idempotent; never fatal (a degraded DB should
  // still serve reads rather than crash-loop the container).
  try {
    const admin = await ensureSuperAdmin();
    const note = admin.created
      ? 'created'
      : admin.passwordReset
        ? 'password synced from SEED_ADMIN_PASSWORD'
        : 'ok';
    // eslint-disable-next-line no-console
    console.log(`👤 Super admin ${admin.email} — ${note}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bootstrap] Could not ensure the super admin account:', err);
  }

  const app = createApp();
  const server = http.createServer(app);

  // Realtime layer (M22) — live notifications & events per organization.
  initRealtime(server);

  server.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`🏗️  INSPECTA BUILDOS backend on http://localhost:${env.port} (${env.nodeEnv}) — realtime enabled`);
  });

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received — shutting down...`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal: failed to start backend', err);
  process.exit(1);
});
