import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { initRealtime } from './lib/realtime';

async function main() {
  // Fail fast if the database is unreachable.
  await prisma.$connect();
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
