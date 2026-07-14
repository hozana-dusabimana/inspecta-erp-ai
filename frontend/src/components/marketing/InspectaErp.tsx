import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, CheckCircle2, LayoutDashboard, Wallet, ShoppingCart, ClipboardCheck, Users, BarChart3 } from 'lucide-react';
import MarketingLayout, { CORAL, INK, MAROON } from './MarketingLayout';
import { MEDIA } from './media';

const asks = ['"What\'s the budget status of Site B?"', '"Generate this week\'s progress report."', '"Which concrete tests failed this month?"', '"How much cement did we buy in June, and from whom?"'];

const modules = [
  [LayoutDashboard, 'Project Management', 'Planning, scheduling, milestones, and site progress tracking.'],
  [Wallet, 'Cost & Budget Control', 'Budgets, expenses, payment certificates, cash-flow visibility.'],
  [ShoppingCart, 'Procurement & Materials', 'Purchase requests, suppliers, stock and material tracking.'],
  [ClipboardCheck, 'Quality & Lab Integration', 'Test requests, results, and non-conformances linked to site activities.'],
  [Users, 'HR & Equipment', 'Timesheets, workforce allocation, and equipment usage.'],
  [BarChart3, 'Reports & Dashboards', 'Real-time dashboards for owners, PMs, and clients.'],
];

const different = [
  ['Built for construction', 'Not adapted from generic accounting software.'],
  ['AI Copilot included', 'Reports write themselves; alerts flag overruns and failed tests before they become crises.'],
  ['Built and supported in Rwanda', 'Local onboarding, local support, priced for our market.'],
  ['Backed by builders', 'Created by Inspecta — a company that lives construction quality every day.'],
];

export default function InspectaErp() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="relative overflow-hidden px-5 md:px-10 pt-16 pb-16 md:pt-24 text-white" style={{ background: INK }}>
        <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full opacity-20 blur-3xl" style={{ background: CORAL }} />
        <div className="max-w-4xl mx-auto text-center relative">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full" style={{ background: CORAL }}><Sparkles className="w-3.5 h-3.5" /> Inspecta ERP</span>
          <h1 className="mt-6 text-4xl md:text-6xl font-extrabold leading-tight tracking-tight">The Construction ERP<br />You Can <span style={{ color: CORAL }}>Talk To.</span></h1>
          <p className="mt-6 text-white/75 max-w-2xl mx-auto leading-relaxed">Manage projects, budgets, procurement, and quality in one system — and just ask the AI Copilot when you need answers. No complicated software. No lost documents. No surprises.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/contact" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90" style={{ background: CORAL }}>Book a Free Demo <ArrowRight className="w-4 h-4" /></Link>
            <Link to="/login" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm border-2 border-white/30 hover:bg-white/10 transition-all">Client Login</Link>
          </div>
        </div>
      </section>

      {/* Showcase */}
      <section className="px-5 md:px-10 -mt-10 relative z-10">
        <div className="max-w-4xl mx-auto"><img src={MEDIA.erpImage} alt="Team using Inspecta ERP" loading="lazy" className="w-full h-56 md:h-80 object-cover rounded-2xl shadow-2xl border-4 border-white" /></div>
      </section>

      {/* Problem / solution */}
      <section className="px-5 md:px-10 py-14 max-w-4xl mx-auto grid md:grid-cols-2 gap-8">
        <div>
          <h3 className="text-lg font-bold mb-2" style={{ color: MAROON }}>The Problem</h3>
          <p className="text-sm text-[#161616]/75 leading-relaxed">Most construction companies still run on Excel sheets, WhatsApp messages, and paper files. The result: budget overruns discovered too late, missing test records, endless report-writing, and directors who never quite know what's happening on site.</p>
        </div>
        <div>
          <h3 className="text-lg font-bold mb-2" style={{ color: CORAL }}>The Solution</h3>
          <p className="text-sm text-[#161616]/75 leading-relaxed">Inspecta ERP puts your entire operation in one place — and its built-in AI Copilot means anyone on your team can use it from day one, simply by asking.</p>
        </div>
      </section>

      {/* Ask anything */}
      <section className="px-5 md:px-10 py-12 md:py-16" style={{ background: '#FC60610a' }}>
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-extrabold" style={{ color: INK }}>Ask Anything. Get Instant Answers.</h2>
          <div className="mt-8 grid sm:grid-cols-2 gap-3 text-left">
            {asks.map((q) => (
              <div key={q} className="bg-white rounded-xl border border-black/8 px-4 py-3 text-sm font-medium text-[#161616]/80">{q}</div>
            ))}
          </div>
          <p className="mt-6 text-sm text-[#161616]/60">The Copilot answers from your live project data — in seconds, with the numbers to back it up.</p>
        </div>
      </section>

      {/* Core modules */}
      <section className="px-5 md:px-10 py-16 max-w-6xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-extrabold text-center mb-10" style={{ color: INK }}>Core Modules</h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
          {modules.map(([Icon, title, body]) => {
            const I = Icon as typeof LayoutDashboard;
            return (
              <div key={title as string} className="rounded-2xl border border-black/8 p-6">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: '#FC60611a' }}><I className="w-5 h-5" style={{ color: CORAL }} /></div>
                <h3 className="font-bold" style={{ color: INK }}>{title as string}</h3>
                <p className="mt-1 text-sm text-[#161616]/70">{body as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Why different */}
      <section className="px-5 md:px-10 py-14" style={{ background: '#FC60610a' }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-center mb-10" style={{ color: INK }}>Why It's Different</h2>
          <div className="grid sm:grid-cols-2 gap-5">
            {different.map(([t, b]) => (
              <div key={t} className="flex items-start gap-3 bg-white rounded-xl p-5 border border-black/5">
                <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" style={{ color: CORAL }} />
                <div><h4 className="font-bold">{t}</h4><p className="text-sm text-[#161616]/70 mt-0.5">{b}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-5 md:px-10 py-16 md:py-20 text-center">
        <h2 className="text-2xl md:text-3xl font-extrabold" style={{ color: INK }}>See your project answer back.</h2>
        <p className="mt-3 text-[#161616]/70 max-w-xl mx-auto">Book a free 30-minute demo — bring your toughest project question and watch the Copilot answer it.</p>
        <p className="mt-2 text-xs font-semibold" style={{ color: MAROON }}>Founding Clients offer: the first 10 customers get 3 months at 50% off.</p>
        <Link to="/contact" className="mt-7 inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90" style={{ background: CORAL }}>Book a Free Demo <ArrowRight className="w-4 h-4" /></Link>
      </section>
    </MarketingLayout>
  );
}
