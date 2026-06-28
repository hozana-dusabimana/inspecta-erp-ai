# INSPECTA BUILDOS — User Acceptance Testing (UAT) Checklist

Run by a business stakeholder against the staging/prod environment before
sign-off. Use two test users in **different organizations** to validate tenant
isolation throughout. Mark each: ✅ pass / ❌ fail (+ note) / ⏭ N/A.

## 0. Access & roles
- [ ] Admin can log in; password rotation works.
- [ ] Each role (Project Manager, Site Engineer, Quantity Surveyor, Storekeeper) sees only its permitted modules.
- [ ] A non-admin is denied admin/user-management and finance write actions (no UI affordance + API returns 403).
- [ ] Org A user cannot see, edit, or export any Org B record (projects, finance, compliance).

## 1. Planning & Resources
- [ ] Create a project; it appears in the dashboard with correct status/health.
- [ ] Build a WBS tree (drag to reparent / to root); structure persists on reload.
- [ ] Import a BOQ (Excel); totals match the file.
- [ ] Create a BOQ version snapshot; compare two versions shows correct Δ cost / added / removed lines.
- [ ] Add equipment, crews, trades, materials, suppliers; all list/edit/delete correctly.
- [ ] Build a schedule with dependencies; CPM/critical path displays.

## 2. Production & Profitability
- [ ] Submit a daily production entry (planned vs actual qty, materials consumed).
- [ ] Header shows the **logged-in user** and the **selected project** (no demo names).
- [ ] Productivity analytics show variance vs standard; trends render.
- [ ] Profitability analysis lists per-project forecast margin + leakage flags.
- [ ] Empty project shows friendly empty states (no blank panels).

## 3. Finance & Cost Control
- [ ] Create budget lines (by category & WBS); cost-by-WBS shows budget vs actual.
- [ ] Record cost entries, invoices (IPC net calc), payments.
- [ ] "Post production costs" rolls production into cost entries; finance summary updates.
- [ ] Cash-flow shows inflows/outflows, cumulative position, deficit months flagged.
- [ ] EVM tab shows CPI/SPI/EAC/ETC/VAC with sensible values.
- [ ] A payment cannot be linked to another org's invoice (rejected with 400).

## 4. Quality, Safety & Compliance (QSC)
- [ ] Raise an NCR; lifecycle status transitions work; corrective action links.
- [ ] Log inspections, material tests, rework, incidents, safety inspections, PPE issues.
- [ ] QA/QC and HSE KPI panels show correct counts and rates.
- [ ] Compliance Insights (AI) shows a score + recommendations.
- [ ] Risk matrix heatmap buckets risks by score band correctly.

## 5. Executive Intelligence & AI Copilot
- [ ] Executive dashboard shows portfolio KPIs + live AI alerts (traffic lights).
- [ ] Copilot greeting is generic (no hardcoded names); suggestion chips are module-aware.
- [ ] Ask Copilot a data question (e.g. "cost overrun risk") → answer cites live records.
- [ ] SSE streaming renders the answer progressively.
- [ ] New chat / conversation history load and reopen correctly.

## 6. Reports & Exports
- [ ] Executive report (.xlsx) downloads; rows match the dashboard.
- [ ] Financial report (.xlsx) downloads for a project; budget/invoices/payments/cash sheets correct.
- [ ] Compliance report (.xlsx) downloads; NCR/inspection/incident/safety sheets correct.
- [ ] Project status PDF downloads and is readable.
- [ ] Projects Excel/CSV export works.

## 7. UX & resilience
- [ ] All wide tables scroll horizontally on a phone-width screen (no clipped data).
- [ ] Dark and light mode both render correctly across modules.
- [ ] Deleting a record that fails (e.g. FK-protected) shows an inline error, not a silent no-op.
- [ ] Toggling a user active/inactive updates instantly (optimistic) and rolls back on error.
- [ ] Loading states appear while data fetches; empty states are friendly.
- [ ] Notifications appear in-app for delays/cost-overruns/low-stock/safety.

## 8. Operational
- [ ] `GET /api/health` and `/api/health/ready` return healthy.
- [ ] A manual DB backup runs and a restore into a scratch DB succeeds.
- [ ] After a redeploy, the build SHA updates on both frontend and backend.

**Sign-off:** _______________________  **Date:** ____________
