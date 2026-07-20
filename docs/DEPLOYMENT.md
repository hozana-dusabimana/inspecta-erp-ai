# INSPECTA BUILDOS — Deployment & Operations Runbook

Production ERP for construction. Node/Express + Prisma/PostgreSQL backend,
React/Vite frontend. This is the operational runbook for go-live and ongoing ops.

---

## 1. Architecture

| Component | Tech | Production URL |
|-----------|------|----------------|
| Frontend  | React + Vite (static build) | https://inspecta.isiri.rw |
| Backend   | Node 20 + Express + Prisma  | https://api-inspecta.isiri.rw |
| Database  | PostgreSQL 15+              | (managed / container) |
| Realtime  | WebSocket (per-org channels) | same host as backend |

Deployment is automated via GitHub Actions on push to `main`. The backend
container `CMD` runs `prisma/start.sh` (migrate deploy, auto-baselining a
pre-existing DB) → `seed` (idempotent) → `node dist`.

The deployed commit SHA is exposed for verification:
- Frontend: `<meta name="x-build">` tag in `index.html`.
- Backend: `build` field in `GET /api/health`.

---

## 2. Environment variables

Copy `backend/.env.example` → `.env` and set the following. The backend
**refuses to start in production** (`NODE_ENV=production`) with insecure
defaults (see `src/config/env.ts → validateProductionEnv`).

### Required (fatal in prod if weak/missing)
| Var | Notes |
|-----|-------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?schema=public` |
| `JWT_ACCESS_SECRET` | ≥ 32 random chars. Must NOT be the dev default. |
| `JWT_REFRESH_SECRET` | ≥ 32 random chars. Must NOT be the dev default. |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | Exact frontend origin, e.g. `https://inspecta.isiri.rw` |

Generate secrets: `openssl rand -base64 48`

### Recommended (warns in prod if missing; degrades gracefully)
| Var | Effect if unset |
|-----|-----------------|
| `SEED_ADMIN_PASSWORD` | Defaults to public `Admin@12345` — **change immediately** |
| `AI_PROVIDER` + provider key (`OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) | Copilot runs in offline/deterministic mode (still answers from live data) |
| `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET` | File uploads disabled (attaching links still works) |
| `SMTP_HOST` + creds | Email notifications disabled (in-app still works) |

---

## 3. Health & monitoring

| Endpoint | Purpose | Healthy response |
|----------|---------|------------------|
| `GET /api/health` | Liveness (cheap, no DB). Use for load-balancer/CI. | `200 {status:"ok", build, uptime}` |
| `GET /api/health/ready` | Readiness — pings DB. Use for orchestrator readiness gates. | `200 {status:"ready", db:"up"}` / `503` if DB down |

Configure your monitor to:
- Poll `/api/health/ready` every 30–60s; alert on 2 consecutive non-200s.
- Track the `build` SHA after each deploy to confirm rollout.
- Watch container logs for `[env] WARNING/FATAL` lines at boot.

Request logging is via `morgan` (combined format in prod). Ship stdout/stderr
to your log aggregator.

---

## 4. Backup & restore

Scripts in `scripts/` (require `pg_dump`/`psql` on the host).

```bash
# Nightly backup (cron). Keeps BACKUP_RETENTION_DAYS (default 14).
DATABASE_URL=...  ./scripts/backup-db.sh /var/backups/inspecta

# Restore a dump (DESTRUCTIVE — prompts for confirmation).
DATABASE_URL=...  ./scripts/restore-db.sh /var/backups/inspecta/inspecta-YYYYMMDD-HHMMSS.sql.gz
```

Suggested cron (daily 02:00, off-peak):
```
0 2 * * *  cd /opt/inspecta && DATABASE_URL=$DATABASE_URL ./scripts/backup-db.sh /var/backups/inspecta >> /var/log/inspecta-backup.log 2>&1
```

**Test the restore path quarterly** against a scratch database — an untested
backup is not a backup.

---

## 5. Deployment checklist (go-live)

### Pre-deploy
- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` set to fresh 48-byte secrets (not defaults).
- [ ] `NODE_ENV=production`, `CORS_ORIGIN` = exact frontend origin.
- [ ] `DATABASE_URL` points at the production DB; DB reachable from the backend host.
- [ ] AI provider key set (or accept offline Copilot mode — confirmed acceptable).
- [ ] Supabase + SMTP configured if document upload / email are in scope.
- [ ] `SEED_ADMIN_PASSWORD` set to a strong value (or plan to rotate on first login).
- [ ] Backup cron installed and a first manual backup taken & verified.

### Deploy
- [ ] Merge to `main`; CI builds & deploys frontend + backend.
- [ ] Backend boot logs show no `[env] FATAL`; container healthy.
- [ ] `GET /api/health` returns the expected new `build` SHA.
- [ ] `GET /api/health/ready` returns `db:"up"`.
- [ ] Frontend `x-build` meta matches the deployed SHA.

### Post-deploy smoke (prod)
- [ ] Log in as admin; rotate the admin password.
- [ ] Create an organization/project; confirm multi-tenant isolation (a 2nd org cannot see the 1st's data).
- [ ] Walk one record through each module (planning → production → finance → QSC).
- [ ] Export one report from each of Executive / Finance / Compliance.
- [ ] Trigger one notification; confirm it appears in-app (and via email if SMTP set).
- [ ] Confirm RBAC: a non-admin role is blocked from admin/finance routes.

### Rollback
- [ ] Revert the offending commit on `main` (CI redeploys the prior build), **or** redeploy the last-good image.
- [ ] If a bad migration shipped: restore the most recent pre-deploy backup, then redeploy the prior build.

---

## 6. Operational notes

- **Migrations**: production uses **Prisma Migrate** (`prisma migrate deploy`) on
  boot, via `prisma/start.sh`. On a database that predates migration history
  (built earlier by `db push`), the startup script auto-baselines the `0_init`
  migration (`prisma/db-state.js` detects "schema exists, no history") so deploy
  never recreates tables. To add a schema change: edit `schema.prisma`, run
  `npx prisma migrate dev --name <change>` locally to generate a migration,
  commit the `prisma/migrations/**` files, and `migrate deploy` applies them on
  the next deploy. Migrations are explicit and reviewable — no silent
  destructive changes (unlike the previous `db push --accept-data-loss`).
- **Indexes**: Module 1–5 hot paths are covered by composite indexes
  (`(organizationId, projectId)` on finance/compliance tables;
  `(organizationId, materialId, type)` on `stock_movements`). New high-volume
  query patterns should add matching indexes.
- **Rate limiting**: global `/api` limiter + stricter auth limiter (counts only
  failed logins). Health endpoints are exempt.
- **Scaling**: backend is stateless except the in-process WebSocket layer; to
  run multiple instances, move realtime to a shared broker (see V2 roadmap).
