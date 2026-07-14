import { Link } from 'react-router-dom';
import { FlaskConical, DraftingCompass, LayoutDashboard, ArrowRight, ShieldCheck, CheckCircle2, Phone, Mail, MessageCircle, Sparkles, MapPin } from 'lucide-react';
import MarketingLayout, { CORAL, INK, MAROON, WHATSAPP } from './marketing/MarketingLayout';
import { MEDIA } from './marketing/media';

const services = [
  { icon: FlaskConical, to: '/services/materials-testing', title: 'Materials Testing Laboratory', body: 'Geotechnical investigations, soil, concrete, aggregates, and steel testing — accurate results that verify your ground and materials meet specification.' },
  { icon: DraftingCompass, to: '/services/structural-design', title: 'Structural Design', body: 'Safe, economical structural engineering for buildings of every scale — with foundation designs grounded in our own laboratory data.' },
  { icon: LayoutDashboard, to: '/services/project-management', title: 'Project Management (ERP-Driven)', body: 'Disciplined, transparent project delivery powered by our ERP system — live budgets, schedules, quality dashboards, and documents in one place.' },
];

const whyPoints = [
  ['One accountable partner', 'Testing, design, and management integrated; no gaps between consultants.'],
  ['Evidence-based engineering', 'Our designs are grounded in our own lab data, not assumptions.'],
  ['Digital transparency', 'Real-time ERP visibility of quality, progress, and cost.'],
  ['Standards-driven', 'Recognized national and international standards and codes (ISO/IEC 17025, ISO 9001 principles).'],
];

export default function LandingPage() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="relative overflow-hidden px-5 md:px-10 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: CORAL }} />
        <div className="max-w-5xl mx-auto text-center relative">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full" style={{ color: MAROON, background: '#FC60611a' }}>
            <ShieldCheck className="w-3.5 h-3.5" /> Kigali, Rwanda · Quality Control Partner
          </span>
          <h1 className="mt-6 text-4xl md:text-6xl font-extrabold leading-[1.05] tracking-tight" style={{ color: INK }}>
            Build with Confidence.<br /><span style={{ color: CORAL }}>Quality You Can Verify.</span>
          </h1>
          <p className="mt-6 text-base md:text-lg text-[#161616]/70 max-w-2xl mx-auto leading-relaxed">
            Inspecta is your quality control partner — combining a civil engineering materials testing laboratory, structural design expertise, and ERP-driven project management under one roof.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/contact" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm shadow-lg transition-all hover:opacity-90" style={{ background: CORAL }}>Request a Quote <ArrowRight className="w-4 h-4" /></Link>
            <a href="#services" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm border-2 transition-all hover:bg-black/[0.03]" style={{ borderColor: INK, color: INK }}>Explore Our Services</a>
          </div>
          <div className="mt-12 max-w-4xl mx-auto">
            <img src={MEDIA.heroImage} alt="Inspecta engineers on a construction site" loading="lazy" className="w-full h-64 md:h-96 object-cover rounded-3xl shadow-xl" />
          </div>
        </div>
      </section>

      {/* Intro strip */}
      <section className="px-5 md:px-10 pb-4">
        <p className="max-w-3xl mx-auto text-center text-[#161616]/70 text-sm md:text-base leading-relaxed border-y border-black/5 py-6">
          From the soil beneath your foundation to the day of handover, Inspecta gives you the data, engineering, and controls to build safely, on budget, and to standard.
        </p>
      </section>

      {/* Services snapshot */}
      <section id="services" className="px-5 md:px-10 py-16 md:py-20 max-w-6xl mx-auto scroll-mt-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-extrabold" style={{ color: INK }}>Our Services</h2>
          <p className="mt-3 text-[#161616]/60 text-sm">Three integrated disciplines, one accountable partner.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {services.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.title} to={s.to} className="group rounded-2xl border border-black/8 p-7 hover:shadow-xl transition-all hover:-translate-y-1 bg-white block">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: '#FC60611a' }}><Icon className="w-6 h-6" style={{ color: CORAL }} /></div>
                <h3 className="text-lg font-bold mb-2" style={{ color: INK }}>{s.title}</h3>
                <p className="text-sm text-[#161616]/70 leading-relaxed">{s.body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold" style={{ color: CORAL }}>Learn more <ArrowRight className="w-3.5 h-3.5" /></span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Why Inspecta */}
      <section id="why" className="px-5 md:px-10 py-16 md:py-20 scroll-mt-20" style={{ background: '#FC60610a' }}>
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-extrabold text-center mb-12" style={{ color: INK }}>Why Inspecta</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {whyPoints.map(([title, body]) => (
              <div key={title} className="flex items-start gap-4 bg-white rounded-xl p-5 border border-black/5">
                <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" style={{ color: CORAL }} />
                <div><h4 className="font-bold text-[#161616]">{title}</h4><p className="text-sm text-[#161616]/70 mt-0.5">{body}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Inspecta ERP banner */}
      <section id="erp" className="px-5 md:px-10 py-16 md:py-20 scroll-mt-20">
        <div className="max-w-6xl mx-auto rounded-3xl overflow-hidden relative p-8 md:p-14 text-white" style={{ background: INK }}>
          <div className="absolute -bottom-16 -right-16 w-80 h-80 rounded-full opacity-20 blur-3xl" style={{ background: CORAL }} />
          <div className="relative max-w-2xl">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4" style={{ background: CORAL }}><Sparkles className="w-3.5 h-3.5" /> New</span>
            <h2 className="text-3xl md:text-4xl font-extrabold leading-tight">Inspecta ERP with AI Copilot</h2>
            <p className="mt-4 text-white/75 text-sm md:text-base leading-relaxed">The construction ERP you can talk to. Ask your project anything — budgets, progress, test results — and get instant answers. Project management, cost control, and quality tracking with a built-in AI assistant.</p>
            <Link to="/inspecta-erp" className="mt-7 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90" style={{ background: CORAL }}>Discover Inspecta ERP <ArrowRight className="w-4 h-4" /></Link>
          </div>
        </div>
      </section>

      {/* Contact CTA */}
      <section className="px-5 md:px-10 py-16 md:py-24 text-center" style={{ background: '#FC60610a' }}>
        <h2 className="text-3xl md:text-4xl font-extrabold" style={{ color: INK }}>Ready to build on solid ground?</h2>
        <p className="mt-3 text-[#161616]/70">Talk to our engineers today.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a href="tel:+250788500266" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-white border border-black/8 hover:shadow-md transition-all" style={{ color: INK }}><Phone className="w-4 h-4" style={{ color: CORAL }} /> +250 788 500 266</a>
          <a href="mailto:inspectafrica@gmail.com" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-white border border-black/8 hover:shadow-md transition-all" style={{ color: INK }}><Mail className="w-4 h-4" style={{ color: CORAL }} /> inspectafrica@gmail.com</a>
          <a href={WHATSAPP} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90" style={{ background: CORAL }}><MessageCircle className="w-4 h-4" /> Get in Touch</a>
        </div>
        <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-[#161616]/50"><MapPin className="w-3.5 h-3.5" /> Kigali, Rwanda</p>
      </section>
    </MarketingLayout>
  );
}
