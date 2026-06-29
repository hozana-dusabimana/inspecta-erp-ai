#!/bin/sh
# Container startup: apply migrations safely, seed, then run the server.
# Uses Prisma Migrate (migrate deploy) instead of db push, so schema changes are
# explicit, reviewable, and never silently destructive.
set -e

STATE=$(node prisma/db-state.js)
if [ "$STATE" = "baseline" ]; then
  echo "[start] Existing schema without migration history — baselining 0_init"
  npx prisma migrate resolve --applied 0_init
fi

echo "[start] Applying migrations (migrate deploy)"
npx prisma migrate deploy

echo "[start] Seeding"
npx tsx prisma/seed.ts

echo "[start] Launching server"
exec node dist/index.js
