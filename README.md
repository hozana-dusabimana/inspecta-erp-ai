# INSPECTA BUILDOS

AI-Powered Construction Productivity & Profitability ERP.

The Google Stitch–generated UI is the **design source of truth** and is preserved.
The system replaces mock data with a real, production-grade backend (PostgreSQL +
Prisma + JWT/RBAC) and an AI Copilot grounded strictly on live project data.

> **Repository layout (enforced):** everything lives in `backend/` or `frontend/`.
> The only root-level files are this `README.md`, `run.ps1`, and `run.sh`.

```
inspecta-erp-ai/
├── README.md          # this file
├── run.ps1            # one-command launcher (local or docker)
├── run.sh             # Linux/WSL launcher (local or docker)
├── backend/           # Node + Express + TypeScript + Prisma API
└── frontend/          # React 19 + Vite + Tailwind (Stitch design, wired to the API)
```

---

## Quick start

### Prerequisites
- Node.js 20+
- One of: a local PostgreSQL 14+ **or** Docker Desktop

### Option A — Local Postgres (`npm start`)
Windows PowerShell:
```powershell
./run.ps1
```

Linux/WSL:
```bash
./run.sh
```

This installs deps, copies `.env` files, then for the backend runs
`prisma generate → db push → seed → API`, and starts the frontend.

Manually:
```bash
cd backend && cp .env.example .env   # set DATABASE_URL to your local Postgres
npm install && npm start             # http://localhost:4000
cd ../frontend && cp .env.example .env
npm install && npm run dev           # http://localhost:3000
```

### Option B — Docker Postgres (`docker compose up`)
Windows PowerShell:
```powershell
./run.ps1 -Docker
```

Linux/WSL:
```bash
./run.sh --docker
```

Manually:
```bash
cd backend && docker-compose up --build   # or: docker compose up --build
cd frontend && npm install && npm run dev
```
In Docker mode `DATABASE_URL` is overridden to the bundled `db` service — you do
**not** need a local Postgres.

### Sign in
| Role | Email | Password |
|---|---|---|
| Platform Superadmin | `superadmin@inspecta.ai` | `Super@12345` |
| System Administrator | `admin@inspecta.ai` | `Admin@12345` |
| Project Manager | `pm@inspecta.ai` | `Demo@12345` |
| Site Engineer | `engineer@inspecta.ai` | `Demo@12345` |
| Quantity Surveyor | `qs@inspecta.ai` | `Demo@12345` |
| Storekeeper | `store@inspecta.ai` | `Demo@12345` |

The superadmin is the only account that sees the **Platform Console** (`/platform`).
Override the seeded credentials with `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`.

---

## Two levels of administration

INSPECTA is multi-tenant, so "admin" means two different things:

| | **System Administrator** (`SYSTEM_ADMIN`) | **Platform Superadmin** (`PLATFORM_ADMIN`) |
|---|---|---|
| Scope | One company | Every company |
| Screen | Administration (`/admin`) | Platform Console (`/platform`) |
| API | the normal `/api/*` modules, org-scoped | `/api/platform/*`, cross-tenant |
| Permission | every `resource:action` except `platform:manage` | all of them, plus `platform:manage` |
| Can | invite/edit users, set roles, edit company settings | provision & suspend companies, set plans/quotas, open any tenant read-only, block/unblock any user anywhere, change any role, reset any password, platform analytics, cross-company audit, global settings & announcements |

A platform admin gets their **own sidebar** — the tenant ERP modules are hidden,
because those are scoped to a single company and are the wrong tool for running a
platform. "My Company" drops them into their own org's ERP; opening a customer
company puts them in inspect mode (below) with that tenant's nav.

**Platform Console pages** (`/platform/*`, real routes)
- **Overview** — companies/users/projects totals, 12-month signup growth, users by role, busiest and newest tenants.
- **Companies** — provision a new tenant + its first admin, search/filter, drill in, set plan & quotas, open read-only, suspend or reinstate.
- **Users** — every user across every company; block/unblock, change role, reset password.
- **Audit Trail** — the audit log of all tenants at once, filterable by action/entity/date.
- **Settings** — global defaults, the self-signup switch, a maintenance banner, and announcements.

All list pages export to CSV/XLSX.

**Inspect mode** — "open" a company to point the whole org-scoped API at that
tenant (`X-Platform-Org` header) and browse its real workspace. It is **strictly
read-only**: the server rejects every non-GET while the header is set, and the UI
withholds every `:write` permission, so no button is offered that would fail. A
red banner names the company you are looking at for as long as you are in it.

**Plans & quotas** — each tenant sits on a tier (Trial / Starter / Professional /
Enterprise) whose seat and project limits are enforced **on the create path**, so
neither the API nor the AI copilot can slip past them. Limits are overridable per
company, and cannot be set below what the tenant already uses. Tenants see their
own usage on `GET /api/organization`.

**Announcements** — push a notification (and email, at MEDIUM+) into one tenant or
every active tenant at once.

**Blocking is enforced immediately.** `authenticate` re-reads the account on every
request, so blocking a user or suspending a company takes effect on their very next
API call — not when their 15-minute access token expires. Both actions also revoke
the affected refresh tokens.

**Guard rails** — a superadmin cannot block, demote or lock out themselves, cannot
suspend the company their own account belongs to, and the last active platform admin
cannot be demoted. `PLATFORM_ADMIN` is not assignable from the company-level
Administration screen or `/api/users` (that would let one tenant mint cross-tenant
access); it can only be granted from the Platform Console.

---

## What is implemented

**Foundation (real, no mocks):**
- Multi-tenant data model (Organization scoping on every record).
- JWT auth with access + rotating refresh tokens; passwords hashed with bcrypt.
- **RBAC** permission matrix (`backend/src/auth/permissions.ts`) enforced on every route.
- **Audit trail** — create/update/delete/login/logout with old/new values.
- **AI Copilot** grounded only on live DB data across every module, provider-agnostic:
  OpenRouter (default, free), Claude, or Gemini — confidence scoring + honest offline mode.
- **Realtime** (Socket.IO) — live notifications pushed per organization.

**ERP modules (full CRUD, RBAC, audit, business formulas):**

| # | Module | Endpoint(s) | Highlights |
|---|---|---|---|
| M1 | Planning | `/planning/wbs`, `/planning/boq` | WBS tree, BOQ with `amount = qty × rate` |
| M2 | Production | `/production` (+`/summary/metrics`) | productivity = output/input, variance %, shortfall alerts |
| M3 | Finance | `/finance/{budget,costs,invoices,payments}` (+`/summary`) | budget vs actual, IPC billing, cost-overrun alerts |
| M4 | Inventory | `/inventory/{materials,movements,stock}` | stock ledger = receipts−issues, reorder alerts |
| M17 | Procurement | `/procurement/{suppliers,purchase-orders}` | supplier scoring, PO line items |
| M5 | QA/QC | `/qaqc/{inspections,ncrs}` | NCR register → notification |
| M6 | HSE | `/hse/{incidents,toolbox-talks}` | incident → safety alert |
| M24 | Risk | `/risk` | score = probability × impact |
| M7 | Documents | `/documents` | versioned register (storage URLs) |
| M9 | Notifications | `/notifications` | delay/cost/stock/safety/NCR + realtime |
| M8 | Reports | `/reports/*` | Excel, CSV, per-project PDF |
| M12/M15 | Dashboards/KPI | `/dashboards/executive` | CPI/SPI, traffic lights, portfolio rollup |
| M13 | Scheduling (CPM) | `/scheduling` (+`/cpm`) | critical path (forward/backward pass), float |
| M14 | Profitability | `/profitability/analysis` | forecast margin, leakage detection |
| M16 | Field Ops | `/fieldops/{diary,tasks,attendance}` | site diary, task assignment, attendance (employee-linked) |
| M05 | Payroll | `/payroll/{statutory-rates,runs,payslips}` | Rwanda PAYE bands + RSSB compute engine, payroll runs, payslips, posts net to cash flow |
| M09 | Point of Sale | `/pos/{products,sessions,transactions,service-invoices}` | till sessions, VAT receipts, mobile-money/cash/bank, stock drawdown, service invoices |
| M06b | Equipment Fuel/Usage | `/equipment/{fuel-logs,usage-logs}` | fuel consumption & cost, daily usage by operator + WBS cost allocation |
| M07b | GRN & Issues | `/inventory/{grn,material-issues}` | goods-received notes + material issues that post to the stock ledger |
| M18 | Workflow | `/approvals` (+`/approve`,`/reject`) | approval requests + escalation notify |
| M23 | Portfolio | `/portfolio/comparison` | multi-project comparison + company KPIs |
| M19 | PWA | (frontend) | installable, offline app shell, online/offline status |
| M22 | Realtime | Socket.IO | live notifications per organization |

**Frontend (Stitch design preserved, wired to real APIs):**
- Real login / session restore / logout; realtime notification bell with unread count.
- Dashboard portfolio + KPIs from real data; "New Project" provisions via API.
- A consistent module workspace (`ErpLayout` + `ResourceManager`) gives every module a
  real list/create/edit/delete UI with project scoping, validation, and summaries.
- Daily Production Entry posts real entries; Copilot + voice input call the live AI.
- Reports page downloads real Excel/CSV/PDF.

A few executive-dashboard chart widgets (S-curve, cost pie) remain visual placeholders
pending their historical-series wiring; all module data, KPIs, and tables are real.

---

## API surface

Base URL: `http://localhost:4000/api` · all responses: `{ success, data, error?, meta? }`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/health` | – | liveness |
| POST | `/auth/register` | – | creates org + first admin |
| POST | `/auth/login` | – | returns user + tokens |
| POST | `/auth/refresh` | – | rotates tokens |
| POST | `/auth/logout` | auth | revokes refresh token |
| GET | `/auth/me` | auth | current user + permissions |
| GET/POST/PUT/DELETE | `/clients` | `client:read` / `client:write` | tenant-scoped |
| GET | `/projects/summary` | `project:read` | portfolio KPIs |
| GET/POST/PUT/DELETE | `/projects` | `project:read` / `project:write` | tenant-scoped |
| GET/POST/PUT | `/users` | `user:read` / `user:write` | invite/manage |
| GET | `/audit` | `audit:read` | audit trail |
| POST | `/ai/chat` | `ai:use` | grounded Copilot |

### RBAC matrix (summary)
| Permission | Admin | PM | Engineer | QS | Store |
|---|:-:|:-:|:-:|:-:|:-:|
| project:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| project:write | ✓ | ✓ | | ✓ | |
| client:write | ✓ | ✓ | | ✓ | |
| user:write | ✓ | | | | |
| audit:read | ✓ | ✓ | | | |
| ai:use | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## AI providers

Set one key in `backend/.env`. Default provider is **OpenRouter** (free models).

```env
AI_PROVIDER=openrouter            # openrouter | claude | gemini
OPENROUTER_API_KEY=...            # https://openrouter.ai/keys (free tier)
ANTHROPIC_API_KEY=...             # optional
GEMINI_API_KEY=...                # optional
```
With no key configured, the Copilot still answers from real data deterministically
(clearly labelled, never fabricated).

---

## Scripts

**backend:** `npm start` (local bootstrap) · `npm run dev` · `npm run build` ·
`npm run seed` · `npm run prisma:migrate` · `npm test`

**frontend:** `npm run dev` · `npm run build` · `npm run lint`

---

## Importing a dataset (BuildCore sample workbook)

`backend/prisma/import-dataset.ts` (`npm run import:dataset`) loads the 27-sheet
BuildCore workbook (projects → employees → DSR → payroll → equipment → materials →
procurement → finance → QA → HSE) into the data model. It builds Excel-id → cuid
maps, creates Trade/EquipmentCategory/Client lookups, maps the workbook's lowercase
values to the app enums, and splits the stock ledger in/out columns into signed
movements.

- **Dry run (default, no writes):** `npm run import:dataset -- "<path>/workbook.xlsx"`
- **Load (wipes the org's business data, then loads — idempotent):** add `--confirm`.
  Users, the organization and statutory rates are preserved.

> ⚠️ The workbook contains PII (national IDs, salaries, payslips). **Never commit it**
> (`*.xlsx` is gitignored). To load it into **production**, upload it to the server and
> run the manual GitHub Actions workflow **"Import Sample Dataset (manual)"**
> (`.github/workflows/import-dataset.yml`), which runs the importer inside the prod
> backend container and deletes the temp copy afterward:
> ```bash
> scp "workbook.xlsx" root@<server>:/home/inspectaapi/app/dataset.xlsx
> # then GitHub → Actions → Import Sample Dataset (manual) → Run workflow → type WIPE-AND-LOAD
> ```

---

## Deployment

Pushing to `main` triggers CI/CD (`.github/workflows/{backend,frontend}-deploy.yml`):
backend builds + tests, then ships over SSH and runs `docker compose up --build`
(the container applies the schema via `prisma db push` + seed on start); frontend
builds with the prod API URL and ships the static bundle. Required repo secret:
`SSH_PASSWORD`. Live at `inspecta.isiri.rw` / `api-inspecta.isiri.rw`. Schema changes
ship as delta files under `backend/prisma/migrations/` (apply to an existing DB with
`prisma db execute`, or rely on `db push` for fresh ones).

---

## Tests

```bash
cd backend && npm test    # RBAC matrix + ERP formula unit tests (Jest)
```

## Module coverage

All 24 modules from the specification are implemented end-to-end (data model + API +
RBAC + audit + frontend), with real business formulas and the AI Copilot grounded on
live data. Document uploads use a Supabase signed-upload endpoint when configured
(`SUPABASE_*` env), and fall back to registering external file URLs otherwise.

**Known limitations (honest):**
- PWA offline is an installable **app shell** with an online/offline indicator; a full
  offline **mutation queue with background sync** is not implemented (reads cache; writes need connectivity).
- QR tracking is scoped to reference codes; camera-based QR scanning is not wired.
- CPM uses finish-to-start dependencies (the common case); SS/FF/lead-lag are future work.
