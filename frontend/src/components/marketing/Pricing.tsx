import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, Sparkles, ShieldCheck, Gauge, Wallet } from 'lucide-react';
import MarketingLayout, { PageHero, CORAL, INK, DARK, MAROON } from './MarketingLayout';
import { api } from '../../lib/api';

interface PlanRow {
  plan: string;
  label: string;
  monthlyPrice: string;
  annualPrice: string;
  currency: string;
  description: string | null;
  limits: { maxUsers: number | null; maxProjects: number | null };
  aiCreditsIncluded: number;
}

const money = (v: string | number, currency = 'RWF') =>
  `${currency} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Shown while /api/public/pricing loads, and as a safe fallback if a tier is
// hidden or the API is briefly unreachable — keeps the agreed numbers visible.
const FALLBACK: PlanRow[] = [
  { plan: 'STARTER', label: 'Starter', monthlyPrice: '350000', annualPrice: '3500000', currency: 'RWF', aiCreditsIncluded: 100,
    description: 'For a first project or two, getting off spreadsheets.', limits: { maxUsers: 5, maxProjects: 2 } },
  { plan: 'PROFESSIONAL', label: 'Professional', monthlyPrice: '550000', annualPrice: '5500000', currency: 'RWF', aiCreditsIncluded: 500,
    description: 'Full ERP, Executive Intelligence, and priority support for growing contractors.', limits: { maxUsers: 15, maxProjects: 5 } },
  { plan: 'BUSINESS', label: 'Business', monthlyPrice: '1250000', annualPrice: '12500000', currency: 'RWF', aiCreditsIncluded: 2000,
    description: 'Advanced finance, procurement, inventory, and quality & safety for contractors running several sites at once.', limits: { maxUsers: 40, maxProjects: 15 } },
  { plan: 'ENTERPRISE', label: 'Enterprise', monthlyPrice: '1750000', annualPrice: '17500000', currency: 'RWF', aiCreditsIncluded: 5000,
    description: 'Large or multi-company construction organizations — custom users, projects, integrations, and SLA.', limits: { maxUsers: null, maxProjects: null } },
];

const FEATURES: Record<string, string[]> = {
  STARTER: ['Core ERP modules', 'Portfolio & Planning & Scheduling', 'AI Copilot included'],
  PROFESSIONAL: ['Everything in Starter', 'Advanced reporting & Executive Intelligence', 'Priority support'],
  BUSINESS: ['Everything in Professional', 'Advanced finance, procurement & inventory', 'Quality & Safety module', 'Advanced analytics & integrations'],
  ENTERPRISE: ['Everything in Business', 'Custom users & projects', 'Advanced integrations & workflows', 'Dedicated SLA'],
};

type Period = 'MONTHLY' | 'ANNUAL';

export default function Pricing() {
  const [plans, setPlans] = useState<PlanRow[]>(FALLBACK);
  const [period, setPeriod] = useState<Period>('MONTHLY');

  useEffect(() => {
    api.get<PlanRow[]>('/public/pricing')
      .then((res) => { if (res.data?.length) setPlans(res.data); })
      .catch(() => { /* keep the fallback numbers */ });
  }, []);

  return (
    <MarketingLayout>
      <PageHero eyebrow="Pricing" title="Priced for What It Replaces."
        subtitle="Spreadsheets, site notebooks, and a dozen phone calls a day — or one system with an AI Copilot built in. Choose the plan that matches how many projects you run." />

      <section className="px-5 md:px-10 pb-4">
        <div className="max-w-xs mx-auto flex gap-1.5 bg-[var(--mk-tint)] p-1 rounded-lg mb-10">
          {(['MONTHLY', 'ANNUAL'] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`flex-1 px-4 py-2 rounded-md text-xs font-bold transition-all ${period === p ? 'bg-[var(--mk-surface)] shadow-sm' : 'text-[var(--mk-muted)]'}`}
              style={period === p ? { color: INK } : undefined}>
              {p === 'MONTHLY' ? 'Monthly' : 'Annual (2 months free)'}
            </button>
          ))}
        </div>

        <div className="max-w-6xl mx-auto grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const featured = p.plan === 'PROFESSIONAL';
            const price = period === 'ANNUAL' ? p.annualPrice : p.monthlyPrice;
            const isEnterprise = p.plan === 'ENTERPRISE';
            return (
              <div key={p.plan}
                className="rounded-2xl p-6 flex flex-col relative"
                style={featured
                  ? { background: DARK, color: '#fff', border: `2px solid ${CORAL}` }
                  : { border: '1px solid var(--mk-border)', background: 'var(--mk-surface)' }}>
                {featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full text-white" style={{ background: CORAL }}>
                    <Sparkles className="w-3 h-3" /> Most popular
                  </span>
                )}
                <h3 className="font-extrabold text-lg mt-2">{p.label}</h3>
                <p className={`text-xs mt-1 leading-relaxed ${featured ? 'text-white/70' : 'text-[var(--mk-muted)]'}`}>{p.description}</p>
                <div className="mt-5 mb-1">
                  <span className="text-3xl font-extrabold">{isEnterprise ? 'From ' : ''}{money(price, p.currency)}</span>
                </div>
                <p className={`text-[11px] mb-5 ${featured ? 'text-white/60' : 'text-[var(--mk-muted)]'}`}>{period === 'ANNUAL' ? 'per year' : 'per month'} · billed to your company</p>

                <ul className="space-y-2 text-[13px] mb-6">
                  <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 shrink-0" style={{ color: featured ? CORAL : '#16a34a' }} /> {p.limits.maxUsers ?? 'Custom'} users</li>
                  <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 shrink-0" style={{ color: featured ? CORAL : '#16a34a' }} /> {p.limits.maxProjects ?? 'Custom'} active projects</li>
                  <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 shrink-0" style={{ color: featured ? CORAL : '#16a34a' }} /> {p.aiCreditsIncluded.toLocaleString()} AI credits/month</li>
                  {(FEATURES[p.plan] ?? []).map((f) => (
                    <li key={f} className="flex items-center gap-2"><Check className="w-3.5 h-3.5 shrink-0" style={{ color: featured ? CORAL : '#16a34a' }} /> {f}</li>
                  ))}
                </ul>

                <Link to="/contact"
                  className="mt-auto text-center px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90"
                  style={featured ? { background: CORAL, color: '#fff' } : { border: `2px solid ${INK}`, color: INK }}>
                  {isEnterprise ? 'Talk to Sales' : 'Book a Free Demo'}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-[var(--mk-muted)] mt-6">
          Setup/implementation is quoted separately based on your data migration and integration needs.{' '}
          <Link to="/contact" className="font-semibold" style={{ color: CORAL }}>Ask for a quote</Link>.
        </p>
      </section>

      {/* AI credits explainer */}
      <section className="px-5 md:px-10 py-16 md:py-20" style={{ background: 'var(--mk-tint)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: CORAL }}>AI Copilot Credits</span>
            <h2 className="mt-3 text-2xl md:text-3xl font-extrabold" style={{ color: INK }}>Fair usage, no surprise bills.</h2>
            <p className="mt-4 text-[var(--mk-muted)] leading-relaxed">Every plan includes a monthly pool of AI credits. Simple questions cost less; drafting a record or generating a cross-project report costs more, because it does more work.</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            <div className="bg-[var(--mk-surface)] rounded-xl p-6 border border-[var(--mk-border)]">
              <Gauge className="w-6 h-6 mb-3" style={{ color: CORAL }} />
              <h4 className="font-bold" style={{ color: INK }}>Usage-weighted</h4>
              <p className="text-sm text-[var(--mk-muted)] mt-1.5">A quick chat answer costs 1 credit. Pulling live data or drafting a record costs a few more. A full report or portfolio analysis costs the most.</p>
            </div>
            <div className="bg-[var(--mk-surface)] rounded-xl p-6 border border-[var(--mk-border)]">
              <ShieldCheck className="w-6 h-6 mb-3" style={{ color: CORAL }} />
              <h4 className="font-bold" style={{ color: INK }}>Admin-controlled limit</h4>
              <p className="text-sm text-[var(--mk-muted)] mt-1.5">Your company admin sets the ceiling on any credit top-up. Nothing auto-purchases — every top-up is a request your admin explicitly approves.</p>
            </div>
            <div className="bg-[var(--mk-surface)] rounded-xl p-6 border border-[var(--mk-border)]">
              <Wallet className="w-6 h-6 mb-3" style={{ color: CORAL }} />
              <h4 className="font-bold" style={{ color: INK }}>Top up or upgrade</h4>
              <p className="text-sm text-[var(--mk-muted)] mt-1.5">Run out mid-month? Request more credits at the Starter per-credit rate, or move up a plan for a bigger monthly pool.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 md:px-10 py-16 text-center">
        <h2 className="text-2xl md:text-3xl font-extrabold" style={{ color: INK }}>Not sure which plan fits?</h2>
        <p className="mt-3 text-[var(--mk-muted)] max-w-xl mx-auto">Tell us how many active projects and users you have — we'll recommend a plan and quote setup, free.</p>
        <Link to="/contact" className="mt-7 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90" style={{ background: CORAL }}>
          Talk to Us <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="mt-3 text-xs italic font-semibold" style={{ color: MAROON }}>your quality control partner</p>
      </section>
    </MarketingLayout>
  );
}
