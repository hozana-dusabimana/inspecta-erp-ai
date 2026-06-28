# INSPECTA BUILDOS — Go-Live Status & Hardening Report

Outcome of the Production Hardening pass (Phases 1–5). The five ERP modules are
feature-complete; this document records what was hardened, what remains, known
technical debt, and the V2 roadmap.

- **Deployment checklist** → see [`DEPLOYMENT.md`](./DEPLOYMENT.md) §5.
- **UAT checklist** → see [`UAT_CHECKLIST.md`](./UAT_CHECKLIST.md).

---

## What was done in this pass

**Phase 1 — Hardening (security & correctness)**
- Fixed cross-user notification tampering (mark-as-read was org-scoped, not user-scoped).
- Closed FK-injection gaps: payments→invoice and production-materials→production-entry now validated against the caller's org.
- Error handler now maps Prisma `P2003`/`P2014`/validation errors to `400` (were generic `500`).
- ResourceManager: delete failures now surface (inline banner) instead of silently no-op'ing; delete disabled while pending.

**Phase 2 — Performance**
- Eliminated two `5N+1` query patterns (`/portfolio/comparison`, `/profitability/analysis`) → ~6 grouped queries each.
- Added composite indexes: `(organizationId, projectId)` on `budget_lines, invoices, payments, incidents, reworks, material_tests, safety_inspections, compliance_documents`; `(organizationId, materialId, type)` on `stock_movements`.

**Phase 3 — Reports**
- Executive / Financial / Compliance Excel exports + Export buttons in the UI (project-status PDF and projects Excel/CSV already existed).

**Phase 4 — Deployment readiness**
- `validateProductionEnv()` fail-fast on insecure prod config; `/api/health/ready` DB readiness probe; backup/restore scripts; ops runbook + UAT checklist.

**Phase 5 — UX polish**
- Loading states for compliance/planning dashboards; mobile horizontal scroll on the remaining wide tables; optimistic user activate/deactivate; removed hardcoded demo names (now dynamic user/project).

---

## 1. Remaining issues (open)

Ordered by priority. None are release-blocking on their own; the security items
should be scheduled early.

| # | Sev | Area | Issue | Suggested fix |
|---|-----|------|-------|---------------|
| ~~1~~ | ~~Med~~ | Scheduling | ✅ **RESOLVED** — dependencies now reject cross-project edges, project mismatch, and self-references via a new reusable `validate` hook on `createCrudRouter`. | Done (commit `6adf675`). |
| 2 | Med | HSE | `/hse/kpis` "PPE expiring soon" counts **org-wide** PPE, not project-scoped, while sibling metrics are project-scoped (wrong number, not a leak). | Decide intended scope; add `projectId` to the `ppeIssue` query or document org-wide intent. |
| 3 | Low | RBAC | `/compliance/ai-risk` is gated on `qaqc:read` but also surfaces HSE/incident aggregates. | Require an HSE permission too, or introduce a dedicated `compliance:read`. |
| 4 | Low | Validation | Several analytics endpoints read `?projectId` / action bodies without zod (value always lands in an org-scoped `where`, so no leak — worst case a 500 on an array-valued param). | Add `z.string()` parsing for hygiene. |
| 5 | Low | Finance | `/costs` and `/inventory` `afterChange` use unscoped `findUnique`/aggregate (safe today via prior org validation, but fragile). | Scope by `organizationId` for defense-in-depth. |
| 6 | Low | Procurement | Quote-award `updateMany` lacks explicit `organizationId` (safe — only touches quotes under an org-verified RFQ). | Add `organizationId` for defense-in-depth. |

---

## 2. Technical debt

| Area | Debt | Impact / when to pay |
|------|------|----------------------|
| Soft-delete | Models have `deletedAt` but **no query filters `deletedAt: null`** — soft-deleted rows are still listed/aggregated. | Decide whether soft-delete is a product feature. If yes: add the filter everywhere + make indexes partial. If no: drop the columns. Do this before relying on soft-delete. |
| Inventory valuation | `/inventory/valuation` replays **every** stock movement in the org in JS (unbounded; grows with history). | Add a periodic valuation-snapshot table so only post-snapshot movements are replayed; optionally scope by `?projectId`/`?materialId`. |
| Production analytics | `/production/summary/metrics` and the AI productivity tool `findMany` production entries with no `take` (project-scoped, but long projects accumulate thousands). | Add a date-window or pagination for org-wide calls. |
| Caching | Executive/dashboard/AI metric endpoints recompute on every load (already `Promise.all`-batched). | Add a 30–60s in-memory TTL cache keyed by `(orgId, projectId, endpoint)` — biggest win for the Copilot. |
| Dead code | `ProductionSummary` / `FinanceSummary` panels are unused; `noUnusedLocals` is off so they don't fail the build. | Remove, and turn on `noUnusedLocals` to prevent drift. |
| Formatting | Date/number/currency formatting is inconsistent across components. | Extract shared `formatDate`/`formatMoney` utils. |
| Realtime scaling | WebSocket layer is in-process — blocks horizontal scaling of the backend. | Move to a shared broker (Redis pub/sub) before running multiple instances. |
| Tests | Calculation engines are unit-tested; HTTP/integration coverage of the new module endpoints is thin. | Add supertest-level tests for isolation + RBAC on critical routes. |

---

## 3. V2 roadmap (recommended)

**Deferred from this pass (explicitly out of scope for go-live):**
- **Provider-native streaming** — stream tokens directly from the LLM provider instead of the current server-computed-then-chunked SSE.
- **Vector RAG** — replace keyword retrieval with embeddings + a vector store for semantic grounding.

**Proposed V2 themes (priority order):**
1. **AI depth** — provider-native streaming, vector RAG over documents/records, tool-calling expansion, per-conversation memory.
2. **Scale & performance** — Redis-backed realtime + caching; valuation snapshots; pagination/date-windows on high-volume analytics; partial indexes once soft-delete is decided.
3. **Reporting** — scheduled report email delivery; branded PDF variants of the executive/financial/compliance reports; report builder.
4. **Mobile** — dedicated responsive/PWA field experience for daily entries, inspections, and incident capture (offline-first).
5. **Governance** — finer-grained permissions (e.g. `compliance:read`), full audit-log UI, SSO/OIDC, configurable approval workflows.
6. **Quality** — integration test suite for tenant isolation + RBAC across all modules in CI; load testing of dashboard/AI endpoints.

---

## Verification snapshot (local)

- Backend & frontend typecheck clean (host-dep type stubs excluded); frontend production build green.
- `/portfolio/comparison` & `/profitability/analysis` return correct values post-batching.
- Bogus cross-org `invoiceId` on a payment → `400` (was a silent accept / `500`).
- `/api/health` (liveness) and `/api/health/ready` (DB probe) both healthy.
- Executive / Financial / Compliance `.xlsx` exports produce valid workbooks with real rows.
