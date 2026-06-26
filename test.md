# INSPECTA BUILDOS — Test Plan & QA Workbook

Production-readiness test plan. A tester should be able to run this top-to-bottom and
sign off that every feature works. Mark each row **PASS / FAIL** in the Result column.

- **Frontend (prod):** https://inspecta.isiri.rw
- **Backend API (prod):** https://api-inspecta.isiri.rw/api
- **Local:** frontend http://localhost:3000 · backend http://localhost:4000/api

> Legend: `✅` expected pass · `🔒` security/authorization check · `📴` offline/PWA · `⚙️` automated.

---

## 0. Test accounts & seeded data

Seeded on first boot (`npm run seed`). Passwords below.

| Role | Email | Password |
|---|---|---|
| System Administrator | `admin@inspecta.ai` | `Admin@12345` |
| Project Manager | `pm@inspecta.ai` | `Demo@12345` |
| Site Engineer | `engineer@inspecta.ai` | `Demo@12345` |
| Quantity Surveyor | `qs@inspecta.ai` | `Demo@12345` |
| Storekeeper | `store@inspecta.ai` | `Demo@12345` |

Seeded fixtures (org **Inspecta GC Corp**): projects **SKY-A** (Skyline Tower A),
**NEX-LH** (Nexus Logistics Hub), **RVR-PL** (Riverfront Plaza); 2 clients; production
entries, budget/cost/invoice/payment, materials + stock, supplier + PO, inspection, NCR,
incident, toolbox talk, risk, 5 CPM activities, site diary, field tasks, attendance, an
approval request — all on **SKY-A**.

---

## 1. Tooling & helper snippets

Most API tests use a bearer token. Get one (PowerShell or bash):

```bash
# bash — set API to local or prod
API=https://api-inspecta.isiri.rw/api
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@inspecta.ai","password":"Admin@12345"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")
# get the Skyline project id for project-scoped calls
PID=$(curl -s "$API/projects?search=Skyline" -H "Authorization: Bearer $TOKEN" \
  | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")
auth(){ curl -s -H "Authorization: Bearer $TOKEN" "$@"; }   # helper
```

Response envelope is always `{ success, data, error?, meta? }`.

---

## 2. Automated suites (run first) ⚙️

| ID | Suite | Command | Expected | Result |
|---|---|---|---|---|
| A1 | Backend unit tests | `cd backend && npm test` | 3 suites / **15 tests pass** (permissions, formulas, cpm) | |
| A2 | Backend typecheck | `cd backend && npx tsc --noEmit` | exit 0, no errors | |
| A3 | Backend prod build | `cd backend && npm run build` | exit 0, `dist/` emitted | |
| A4 | Frontend typecheck | `cd frontend && npx tsc --noEmit` | exit 0 | |
| A5 | Frontend build | `cd frontend && npm run build` | exit 0, `dist/index.html` + hashed assets | |
| A6 | Prisma schema valid | `cd backend && npx prisma validate` | "schema is valid" | |

---

## 3. Environment / deployment smoke

| ID | Test | Steps | Expected | Result |
|---|---|---|---|---|
| E1 | Local via npm | `cd backend && npm start` (local Postgres) | generate→db push→seed→`listening on :4000` | |
| E2 | Local via Docker | `cd backend && docker compose up` | Postgres + backend healthy | |
| E3 | One-command launcher | `./run.ps1` (local) / `./run.ps1 -Docker` | backend + frontend start, prints URLs | |
| E4 | API health (prod) | `curl $API/health` | `{"success":true,"data":{"status":"ok",...,"build":"<sha>"}}` | |
| E5 | Frontend served (prod) | open https://inspecta.isiri.rw | landing page renders, HTTP 200 | |
| E6 | HTTPS valid | check both domains | valid Let's Encrypt cert, no warning | |
| E7 | Build stamp matches | compare `health.build` and `<meta x-build>` to deployed commit SHA | both equal the live commit | |

---

## 4. Authentication & sessions

| ID | Test | Steps | Expected | Result |
|---|---|---|---|---|
| AU1 | Login success | POST `/auth/login` admin creds | 200, returns `user`, `accessToken`, `refreshToken`, `permissions[]` | |
| AU2 | Login wrong password | POST `/auth/login` bad pw | 🔒 401 `Invalid credentials` | |
| AU3 | Login unknown email | POST `/auth/login` random email | 🔒 401 (no user enumeration difference) | |
| AU4 | Register new org | POST `/auth/register` new org+admin | 201, new org + SYSTEM_ADMIN, tokens | |
| AU5 | Me (valid token) | GET `/auth/me` with token | 200, current user + permissions | |
| AU6 | Me (no token) | GET `/auth/me` no header | 🔒 401 | |
| AU7 | Me (garbage token) | GET `/auth/me` `Bearer xx` | 🔒 401 invalid/expired | |
| AU8 | Refresh rotation | POST `/auth/refresh` with refreshToken | 200, new tokens; old refresh now revoked (reuse → 401) | |
| AU9 | Logout | POST `/auth/logout` | 200; refresh token revoked | |
| AU10 | UI login → dashboard | login on site, land on Executive Overview | dashboard with real data | |
| AU11 | UI session restore | reload after login | stays logged in (token persisted) | |
| AU12 | UI logout | click Sign Out | returns to landing, token cleared | |
| AU13 | UI SSO honesty | click Google/Microsoft on login | shows "SSO not enabled" message (no fake login) | |

---

## 5. RBAC / authorization 🔒

Log in as each role and confirm the permission matrix. Spot-checks (expect **403** when
the role lacks the permission, **200/201** when it has it):

| ID | Role | Action | Expected | Result |
|---|---|---|---|---|
| R1 | SYSTEM_ADMIN | POST `/users` (invite) | 201 | |
| R2 | PROJECT_MANAGER | POST `/users` | 🔒 403 (no `user:write`) | |
| R3 | SITE_ENGINEER | GET `/finance/summary` | 🔒 403 (no `finance:read`) | |
| R4 | SITE_ENGINEER | POST `/production` (entry) | 201 (`production:write`) | |
| R5 | STOREKEEPER | POST `/finance/costs` | 🔒 403 | |
| R6 | STOREKEEPER | POST `/inventory/movements` | 201 (`inventory:write`) | |
| R7 | QUANTITY_SURVEYOR | POST `/finance/invoices` | 201 (`finance:write`) | |
| R8 | QUANTITY_SURVEYOR | POST `/hse/incidents` | 🔒 403 (no `hse:write`) | |
| R9 | any non-admin | GET `/audit` | 🔒 403 unless PM/admin | |
| R10 | UI nav reflects role | login as Storekeeper | sidebar hides Finance/QA/HSE write modules per perms | |
| R11 | Write buttons gated | login as Site Engineer in Finance (read denied) | no "Add" actions where unauthorized | |

---

## 6. Multi-tenant isolation 🔒

| ID | Test | Steps | Expected | Result |
|---|---|---|---|---|
| T1 | New org sees nothing | register Org B, GET `/projects` | empty list (no Org A data) | |
| T2 | Cross-tenant fetch | Org B token, GET `/projects/{OrgA_projectId}` | 🔒 404 (not found, not 403-leak) | |
| T3 | Cross-tenant ref reject | Org B create production with Org A projectId | 🔒 400 "does not belong to your organization" | |
| T4 | Audit scoped | Org B GET `/audit` | only Org B entries | |

---

## 7. Module functional tests (M1–M24)

For each: as an authorized role, **create → list → get → update → delete** where
applicable, and verify computed fields. Project-scoped modules use `?projectId=$PID`.

### M1 — Planning (WBS / BOQ)
| ID | Test | Expected | Result |
|---|---|---|---|
| M1.1 | GET `/planning/wbs?projectId=$PID` | 200, list | |
| M1.2 | POST `/planning/boq` (qty=10, rate=5) | 201, **amount auto = 50** | |
| M1.3 | Update BOQ qty/rate | amount recomputed | |
| M1.4 | UI: Planning Suite → WBS/BOQ tabs, add item | row appears, amount correct | |

### M2 — Production Control
| ID | Test | Expected | Result |
|---|---|---|---|
| M2.1 | POST `/production` planned>actual by >10% | 201; triggers **DELAY notification** | |
| M2.2 | GET `/production/summary/metrics?projectId=$PID` | productivity=output/hours, variance % | |
| M2.3 | UI: Daily Entry form → select project → submit | persists; productivity index shown | |
| M2.4 | UI: Production workspace summary cards | real entries/variance | |

### M3 — Finance & Cost
| ID | Test | Expected | Result |
|---|---|---|---|
| M3.1 | GET `/finance/summary?projectId=$PID` | budget, actual, variance, billed, forecastProfit, costByCategory | |
| M3.2 | POST `/finance/costs` exceeding budget | **COST_OVERRUN notification** | |
| M3.3 | Invoices + payments CRUD | totals reflected in summary | |
| M3.4 | UI: Finance tabs (Budget/Costs/Invoices/Payments) + summary banner | real figures | |

### M4 — Inventory
| ID | Test | Expected | Result |
|---|---|---|---|
| M4.1 | GET `/inventory/stock` | per-material stock = receipts − issues, stockValue, needsReorder | |
| M4.2 | POST issue movement dropping below reorder level | **LOW_STOCK notification** | |
| M4.3 | UI: Materials + Movements tabs, FK material picker | works; stock card updates | |

### M5 — QA/QC
| ID | Test | Expected | Result |
|---|---|---|---|
| M5.1 | POST `/qaqc/ncrs` | 201; **NCR notification** | |
| M5.2 | Inspections CRUD; NCR status OPEN→CLOSED | persists | |
| M5.3 | UI: Inspections + NCR register | works | |

### M6 — HSE
| ID | Test | Expected | Result |
|---|---|---|---|
| M6.1 | POST `/hse/incidents` | 201; **SAFETY_INCIDENT notification** | |
| M6.2 | Toolbox talks CRUD | works | |
| M6.3 | UI: Incidents + Toolbox tabs | works | |

### M7 — Documents
| ID | Test | Expected | Result |
|---|---|---|---|
| M7.1 | POST `/documents` (name + URL) | 201, versioned | |
| M7.2 | POST `/documents/upload-url` (no Supabase env) | 400 with clear guidance (honest) | |
| M7.3 | POST `/documents/upload-url` (Supabase env set) | returns signed `uploadUrl` + `publicUrl` | |
| M7.4 | UI: Documents register, open link | opens file URL | |

### M8 — Reporting
| ID | Test | Expected | Result |
|---|---|---|---|
| M8.1 | GET `/reports/projects.xlsx` | 200, valid `.xlsx` opens in Excel | |
| M8.2 | GET `/reports/projects.csv` | 200, CSV parses | |
| M8.3 | GET `/reports/project/$PID.pdf` | 200, PDF with financials/production/compliance | |
| M8.4 | UI: Reports page download buttons | files download | |

### M9 — Notifications
| ID | Test | Expected | Result |
|---|---|---|---|
| M9.1 | GET `/notifications` after triggers above | contains DELAY/COST_OVERRUN/LOW_STOCK/NCR/SAFETY entries | |
| M9.2 | GET `/notifications/unread-count` | matches unread | |
| M9.3 | PUT `/notifications/:id/read` & `/read-all` | marks read | |
| M9.4 | UI: bell badge + notifications page | badge count + mark read works | |

### M10 — Audit trail
| ID | Test | Expected | Result |
|---|---|---|---|
| M10.1 | Create/update/delete any record, GET `/audit` | entries with action, entity, old/new values, user, ip | |
| M10.2 | Login/logout audited | LOGIN/LOGOUT rows | |
| M10.3 | Approval approve/reject audited | APPROVE/REJECT rows | |

### M11 / M20 — AI Copilot
| ID | Test | Expected | Result |
|---|---|---|---|
| M11.1 | POST `/ai/chat` `{prompt:"active projects & total budget?"}` | 200; answer references **real numbers**, `confidence`, `provider`, `offline` flag | |
| M11.2 | No AI key set | `offline:true`, deterministic real-data summary (no fabrication) | |
| M11.3 | With `OPENROUTER_API_KEY`/Claude/Gemini | live reasoning, grounded only on snapshot | |
| M11.4 | UI: Copilot workspace + sidebar mini-copilot | replies render; voice button uses Web Speech (or honest fallback) | |

### M12 / M15 — Dashboards & KPIs
| ID | Test | Expected | Result |
|---|---|---|---|
| M12.1 | GET `/dashboards/executive` | portfolio, finance, KPIs (CPI/SPI + traffic lights), compliance | |
| M12.2 | UI: dashboard charts | S-curve, cost pie, productivity = **real** (not mock) | |
| M12.3 | UI: progress KPI = avg of project progress | matches summary | |

### M13 — Scheduling (CPM)
| ID | Test | Expected | Result |
|---|---|---|---|
| M13.1 | GET `/scheduling/cpm?projectId=$PID` | duration **59 days**, criticalPath `A10→A20→A30→A50`, ES/EF/LS/LF/float | |
| M13.2 | Add activity with circular predecessors | 400 "circular dependency" | |
| M13.3 | UI: Scheduling → CPM panel + activities tab | critical rows highlighted | |

### M14 — Profitability Intelligence
| ID | Test | Expected | Result |
|---|---|---|---|
| M14.1 | GET `/profitability/analysis` | per-project revenue/cost/forecast margin + leakage flags + totals.atRisk | |
| M14.2 | UI: Profitability page | margin %, leakage warnings | |

### M16 — Field Ops
| ID | Test | Expected | Result |
|---|---|---|---|
| M16.1 | Site diary / tasks / attendance CRUD | works (project-scoped) | |
| M16.2 | UI: Field Ops 3 tabs | add/edit/delete works | |

### M17 — Procurement
| ID | Test | Expected | Result |
|---|---|---|---|
| M17.1 | POST `/procurement/suppliers` | 201 (rating, leadTime) | |
| M17.2 | POST `/procurement/purchase-orders` with items[] | 201, **total auto-sum of qty×rate** | |
| M17.3 | UI: Suppliers + PO tabs, supplier picker | works | |

### M18 — Workflow / Approvals
| ID | Test | Expected | Result |
|---|---|---|---|
| M18.1 | POST `/approvals` | 201; **APPROVAL notification** to org | |
| M18.2 | POST `/approvals/:id/approve` `{note}` | status APPROVED, audited, requester notified | |
| M18.3 | POST `/approvals/:id/reject` | status REJECTED | |
| M18.4 | UI: Approvals page approve/reject buttons | status updates live | |

### M19 — PWA / Mobile 📴
| ID | Test | Expected | Result |
|---|---|---|---|
| M19.1 | `/manifest.webmanifest` + `/sw.js` served | 200 | |
| M19.2 | Install prompt (Chrome → Install app) | installable as standalone | |
| M19.3 | Go offline (DevTools → Offline), reload | app shell loads from SW cache | |
| M19.4 | Offline banner | amber "Offline — cached data" banner shows | |
| M19.5 | Voice input (Chrome) | Web Speech captures a query; non-Chrome shows honest notice | |

### M21 — Security (see §9 for details) 🔒
### M22 — Realtime
| ID | Test | Expected | Result |
|---|---|---|---|
| M22.1 | Open app in two tabs (same org); trigger an NCR/incident in one | other tab's bell updates live (Socket.IO) | |
| M22.2 | Socket connects with JWT | unauthenticated socket rejected | |

### M23 — Portfolio
| ID | Test | Expected | Result |
|---|---|---|---|
| M23.1 | GET `/portfolio/comparison` | per-project KPIs + company rollup, atRiskProjects | |
| M23.2 | UI: Portfolio comparison table | health dots, cost variance colors | |

### M24 — Risk
| ID | Test | Expected | Result |
|---|---|---|---|
| M24.1 | POST `/risk` (probability=4, impact=4) | 201, **score auto = 16** | |
| M24.2 | UI: Risk register | score color (red ≥15) | |

---

## 8. Input validation & errors

| ID | Test | Expected | Result |
|---|---|---|---|
| V1 | POST any create with missing required field | 400 + Zod `details` | |
| V2 | POST with wrong types (string where number) | 400 | |
| V3 | Unknown route | 404 `Route not found` | |
| V4 | Duplicate unique (e.g. project `code`) | 409 conflict | |
| V5 | GET `/:id` non-existent | 404 | |

---

## 9. Security tests 🔒

| ID | Test | Expected | Result |
|---|---|---|---|
| S1 | All protected routes require Bearer token | 401 without it | |
| S2 | Expired/invalid access token | 401; refresh flow recovers | |
| S3 | Permission enforced server-side (not just UI) | 403 even if UI hidden | |
| S4 | Tenant isolation (see §6) | no cross-org data | |
| S5 | Passwords hashed (bcrypt) | DB `passwordHash` never plaintext; never returned in API | |
| S6 | Refresh tokens hashed at rest | `refresh_tokens.tokenHash` only | |
| S7 | Security headers (helmet) | response has `X-... ` security headers | |
| S8 | CORS | only `CORS_ORIGIN` allowed | |
| S9 | Secrets not committed | `ssh.md`, `.env`, `deploy-secrets.txt` gitignored; not in repo | |
| S10 | No secrets in client bundle | search `dist` for keys/passwords → none | |

---

## 10. Performance / production readiness

| ID | Test | Expected | Result |
|---|---|---|---|
| P1 | API p95 latency (health, list endpoints) | < ~500 ms warm | |
| P2 | Dashboard executive aggregate | returns < ~1.5 s with seed data | |
| P3 | Container restart resilience | `docker compose restart backend` → healthy, data intact | |
| P4 | DB persistence | restart stack → seeded data still present (named volume) | |
| P5 | Graceful shutdown | SIGTERM closes server + Prisma cleanly | |
| P6 | Logs | no unhandled promise rejections / crash loops | |

---

## 11. CI/CD pipeline tests ⚙️

| ID | Test | Expected | Result |
|---|---|---|---|
| C1 | Edit a `backend/**` file, push to `main` | **only** Backend CI/CD runs; tsc+jest pass; deploys; health check green | |
| C2 | Edit a `frontend/**` file, push | **only** Frontend CI/CD runs; build; deploys; smoke check green | |
| C3 | Build stamp updates | live `health.build` + `<meta x-build>` == new commit SHA | |
| C4 | Path filtering | backend-only change does NOT redeploy frontend (and vice versa) | |
| C5 | Failing tests block deploy | break a unit test, push → deploy job does not run | |
| C6 | Secret present | `SSH_PASSWORD` set in repo secrets; `SSH_HOST`/`SSH_USER` in workflow env | |

Quick live verification (after a push), poll until the SHA appears:
```bash
SHA=$(git rev-parse HEAD)
curl -s $API/health | grep -q "\"build\":\"$SHA\"" && echo "backend deployed $SHA"
curl -s "https://inspecta.isiri.rw/?cb=$RANDOM" | grep -q "content=\"$SHA\"" && echo "frontend deployed $SHA"
```

---

## 12. End-to-end UI regression (Playwright/Chromium) ⚙️

Automated script lives in the QA scratchpad (`uitest.mjs`); covers the core journey.
Manual equivalent / acceptance:

| ID | Flow | Expected | Result |
|---|---|---|---|
| U1 | Landing loads, branding visible | HTTP 200, "Inspecta" present | |
| U2 | Login as admin | reaches Executive Overview | |
| U3 | Real data on dashboard | seeded "Skyline Tower A" visible; charts populated | |
| U4 | Navigate every sidebar module | each page loads without console errors | |
| U5 | Create a record in a module, see it listed | CRUD round-trips | |
| U6 | Copilot answers from real data | grounded reply + confidence | |
| U7 | No console/page errors across journey | clean console | |
| U8 | Design integrity | matches original Google Stitch design (no layout regressions) | |

Run automated UI suite:
```bash
# from a scratch dir with playwright installed
node uitest.mjs   # expect "8/8 checks passed", 0 console errors
```

---

## 13. Full live smoke (copy-paste)

```bash
API=https://api-inspecta.isiri.rw/api
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@inspecta.ai","password":"Admin@12345"}' | python -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")
PID=$(curl -s "$API/projects?search=Skyline" -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")
for ep in projects projects/summary clients users dashboards/executive finance/summary \
  production/summary/metrics inventory/stock procurement/suppliers \
  "qaqc/ncrs?projectId=$PID" "hse/incidents?projectId=$PID" "risk?projectId=$PID" \
  "planning/boq?projectId=$PID" "scheduling/cpm?projectId=$PID" profitability/analysis \
  portfolio/comparison "fieldops/tasks?projectId=$PID" approvals documents notifications audit; do
  printf "%-40s %s\n" "$ep" "$(curl -s -o /dev/null -w '%{http_code}' $API/$ep -H "Authorization: Bearer $TOKEN")"
done
# all must print 200
```

---

## 14. Acceptance sign-off

| Area | Owner | Date | Pass/Fail |
|---|---|---|---|
| Automated suites (§2) | | | |
| Auth & RBAC (§4–5) | | | |
| Multi-tenant isolation (§6) | | | |
| All modules M1–M24 (§7) | | | |
| Reporting & notifications (§7) | | | |
| Security (§9) | | | |
| Performance/prod-readiness (§10) | | | |
| CI/CD (§11) | | | |
| UI E2E (§12) | | | |

**Release approved by:** ____________________  **Date:** __________

> Known, documented limitations (not defects): AI runs in offline mode until an API
> key is configured; PWA offline is app-shell + cached reads (no offline write queue);
> QR is reference-code based (no camera scanning); CPM models finish-to-start
> dependencies. A few executive-dashboard tiles (productivity index, SPI, budget util)
> are static pending their historical-series wiring; all module data is real.
