#!/usr/bin/env node
/**
 * `npm start` — local bootstrap against a LOCAL Postgres (DATABASE_URL in .env).
 * Steps: generate Prisma client -> sync schema -> seed -> run the API server.
 *
 * For Docker, use `docker compose up` instead (see backend/docker-compose.yml),
 * which points DATABASE_URL at the bundled Postgres service.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  const res = spawnSync(isWin ? `${cmd}.cmd` : cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...opts,
  });
  if (res.status !== 0) {
    console.error(`\n✖ Step failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
}

// Ensure a .env exists so DATABASE_URL is available.
if (!fs.existsSync(path.join(root, '.env'))) {
  console.warn('⚠  No backend/.env found — copying from .env.example. Edit DATABASE_URL if needed.');
  fs.copyFileSync(path.join(root, '.env.example'), path.join(root, '.env'));
}

console.log('▶ Generating Prisma client...');
run('npx', ['prisma', 'generate']);

console.log('▶ Syncing database schema (db push)...');
run('npx', ['prisma', 'db', 'push']);

console.log('▶ Seeding baseline data...');
run('npx', ['tsx', 'prisma/seed.ts']);

console.log('▶ Starting API server...');
run('npx', ['tsx', 'src/index.ts']);
