import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { X, ChevronLeft, ChevronRight, Sparkles, HardHat } from 'lucide-react';

/**
 * First-run guided walkthrough. Each step optionally targets an element by CSS
 * selector (the sidebar nav items expose stable ids like `#nav-finance`, and key
 * header controls expose `#tour-*` ids). Steps whose target isn't in the DOM
 * (permission-gated module, or hidden sidebar on mobile) are skipped gracefully,
 * falling back to a centered card. Nothing here mutates app data.
 */
export interface TourStep {
  title: string;
  body: string;
  selector?: string;
}

export const TOUR_STEPS: TourStep[] = [
  { title: 'Welcome to Inspecta BUILDOS 👋', body: 'Your AI-powered construction ERP — every part of a project, from bid to handover, in one place. This 2-minute tour shows what each area does. You can skip anytime and replay it later from the “?” button.' },
  { title: 'Dashboard', body: 'Your home base: portfolio KPIs, project health (optimal / warning / critical), and AI insight alerts at a glance.', selector: '#nav-dashboard' },
  { title: 'Executive Intelligence', body: 'AI-blended cross-module metrics — cost, schedule, productivity, safety — summarised for leadership.', selector: '#nav-exec' },
  { title: 'Portfolio', body: 'Compare all your projects side by side: progress, cost variance, and top risks across the company.', selector: '#nav-portfolio' },
  { title: 'Planning Suite', body: 'Set up projects, clients and contracts, then build the WBS and Bill of Quantities (BOQ) — with Excel import/export.', selector: '#nav-planning' },
  { title: 'Human Resources', body: 'Your people: employees, trades, crews and wage rates — the basis for attendance and payroll.', selector: '#nav-hr' },
  { title: 'Payroll', body: 'Run Rwanda RRA payroll: PAYE bands + RSSB (pension, maternity, medical, CBHI) computed into payslips, posted to cash flow.', selector: '#nav-payroll' },
  { title: 'Point of Sale', body: 'Open a till, sell materials/services with VAT receipts, reconcile cash, and raise service invoices.', selector: '#nav-pos' },
  { title: 'Equipment', body: 'Plant register with fuel logs, daily usage by operator, utilization and maintenance schedules.', selector: '#nav-equipment' },
  { title: 'Planning Dashboards', body: 'Visual roll-ups of resource, labour and material planning across the portfolio.', selector: '#nav-planning-dash' },
  { title: 'Scheduling (CPM)', body: 'Critical Path Method scheduling with a Gantt view, float, and delay forecasting.', selector: '#nav-scheduling' },
  { title: 'Production', body: 'Daily Site Reports, productivity vs. standard, Earned Value (CPI/SPI) and shortfall alerts.', selector: '#nav-production' },
  { title: 'Field Ops', body: 'On-site basics: site diary, task assignment and worker attendance.', selector: '#nav-fieldops' },
  { title: 'Finance', body: 'Budget vs. actual, cost entries, invoices & IPC certificates, payments and cash-flow forecasting.', selector: '#nav-finance' },
  { title: 'Profitability', body: 'Forecast margin per project and detect profit leakage (e.g. rework cost erosion).', selector: '#nav-profitability' },
  { title: 'Inventory', body: 'Materials register, stock ledger with running balances, goods-received notes (GRN) and material issues.', selector: '#nav-inventory' },
  { title: 'Procurement', body: 'Suppliers and the full chain — purchase requests → orders → GRNs — plus RFQs and MRP.', selector: '#nav-procurement' },
  { title: 'QA / QC', body: 'Inspections, the NCR register, material tests, and rework tracking with cost impact.', selector: '#nav-qaqc' },
  { title: 'HSE', body: 'Health & safety: incidents, activity risk assessments, toolbox talks and PPE checks.', selector: '#nav-hse' },
  { title: 'Risk Register', body: 'Log and score project risks (probability × impact) and track mitigation.', selector: '#nav-risk' },
  { title: 'Approvals', body: 'Review and approve requests (purchase requests, reports, etc.) with an audit trail.', selector: '#nav-approvals' },
  { title: 'Documents', body: 'A versioned document register for drawings, certificates and contracts.', selector: '#nav-documents' },
  { title: 'Reports', body: 'Download Excel, CSV and per-project PDF reports for any module.', selector: '#nav-reports' },
  { title: 'AI Copilot', body: 'Ask questions in plain language — answers are grounded strictly in your live project data, never invented.', selector: '#nav-copilot' },
  { title: 'Administration', body: 'Admins manage users, roles & permissions, and company settings here.', selector: '#nav-admin' },
  { title: 'Ask AI anywhere', body: 'This button opens the Copilot from any screen — quick answers without leaving your work.', selector: '#tour-ask-ai' },
  { title: 'Notifications', body: 'Live alerts for delays, cost overruns, low stock, safety incidents and NCRs appear here.', selector: '#tour-notifications' },
  { title: 'Every module works the same', body: 'Inside a module you get summary cards (totals), search, status & date-range filters, sortable columns, Add/Edit/Delete, and Export to Excel/CSV. Learn it once, use it everywhere.' },
  { title: 'You’re all set 🎉', body: 'That’s the whole platform. Pick a project at the top of any module to begin. Replay this tour anytime from the “?” button in the top bar.' },
];

interface Rect { left: number; top: number; width: number; height: number }

function getRect(selector?: string): Rect | null {
  if (!selector) return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null; // hidden (e.g. mobile drawer)
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export default function OnboardingTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const steps = TOUR_STEPS;

  // Resolve the current step's target, skipping steps whose element is absent.
  const resolve = useCallback((index: number, dir: 1 | -1) => {
    let idx = index;
    while (idx >= 0 && idx < steps.length) {
      const s = steps[idx];
      if (!s.selector) return { idx, r: null };
      const r = getRect(s.selector);
      if (r) return { idx, r };
      idx += dir; // gated/hidden target — skip in the travel direction
    }
    return null;
  }, [steps]);

  useLayoutEffect(() => {
    if (!open) return;
    const found = resolve(i, i === 0 ? 1 : 1);
    if (!found) { onClose(); return; }
    if (found.idx !== i) { setI(found.idx); return; }
    setRect(found.r);
  }, [open, i, resolve, onClose]);

  // Keep the spotlight aligned on resize/scroll.
  useEffect(() => {
    if (!open) return;
    const sync = () => setRect(getRect(steps[i]?.selector));
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => { window.removeEventListener('resize', sync); window.removeEventListener('scroll', sync, true); };
  }, [open, i, steps]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i]);

  if (!open) return null;

  const step = steps[i];
  const isFirst = i === 0;
  const isLast = i === steps.length - 1;

  const next = () => {
    if (isLast) { onClose(); return; }
    const found = resolve(i + 1, 1);
    if (!found) { onClose(); return; }
    setI(found.idx);
  };
  const back = () => {
    if (isFirst) return;
    const found = resolve(i - 1, -1);
    if (found) setI(found.idx);
  };

  // Card placement: near the target, else centered.
  const vw = window.innerWidth, vh = window.innerHeight;
  const CARD_W = Math.min(360, vw - 32);
  let cardStyle: CSSProperties;
  if (rect) {
    const below = rect.top + rect.height + 280 < vh;
    const top = below ? rect.top + rect.height + 14 : Math.max(16, rect.top - 14 - 240);
    let left = rect.left + rect.width + 14;
    if (left + CARD_W > vw - 16) left = Math.max(16, rect.left - CARD_W - 14); // place left of target (sidebar)
    if (left < 16) left = 16;
    cardStyle = { position: 'fixed', top, left, width: CARD_W, zIndex: 102 };
  } else {
    cardStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: CARD_W, zIndex: 102 };
  }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Click blocker so the app underneath isn't interactable mid-tour */}
      <div className="absolute inset-0" />
      {/* Spotlight (visual dim via huge box-shadow) or plain dim for centered steps */}
      {rect ? (
        <div
          className="pointer-events-none"
          style={{
            position: 'fixed', left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12,
            borderRadius: 12, border: '2px solid #ff8a00', boxShadow: '0 0 0 9999px rgba(2,6,23,0.66)', transition: 'all .2s ease', zIndex: 101,
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/70" style={{ zIndex: 101 }} />
      )}

      {/* Tour card */}
      <div style={cardStyle} className="bg-brand-surface-container-lowest rounded-2xl shadow-2xl border border-brand-outline-variant/30 p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 text-brand-primary">
            {isFirst ? <HardHat className="w-5 h-5 text-brand-secondary-container" /> : <Sparkles className="w-4 h-4 text-brand-secondary-container" />}
            <h3 className="font-display text-base font-extrabold leading-tight">{step.title}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant shrink-0" aria-label="Skip tour"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs leading-relaxed text-brand-on-surface-variant">{step.body}</p>

        <div className="flex items-center justify-between mt-4">
          <span className="text-[10px] font-mono font-bold text-brand-on-surface-variant">{i + 1} / {steps.length}</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-[11px] font-bold text-brand-on-surface-variant hover:bg-brand-surface rounded-lg">Skip</button>
            {!isFirst && (
              <button onClick={back} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-brand-outline-variant text-[11px] font-bold hover:bg-brand-surface"><ChevronLeft className="w-3.5 h-3.5" /> Back</button>
            )}
            <button onClick={next} className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-brand-primary text-white text-[11px] font-bold hover:bg-brand-primary-container">
              {isLast ? 'Finish' : 'Next'}{!isLast && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* progress bar */}
        <div className="mt-3 h-1 rounded-full bg-brand-surface overflow-hidden">
          <div className="h-full bg-brand-secondary-container transition-all" style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
