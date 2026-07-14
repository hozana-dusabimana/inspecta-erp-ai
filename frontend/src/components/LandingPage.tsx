import { FlaskConical, DraftingCompass, LayoutDashboard, ArrowRight, ShieldCheck, CheckCircle2, Phone, Mail, MessageCircle, Sparkles, MapPin } from 'lucide-react';
import { AppView } from '../types';

interface LandingPageProps {
  onNavigate: (view: AppView) => void;
  onBookDemo: () => void;
}

// Inspecta brand palette (from the website brief).
const CORAL = '#FC6061';
const INK = '#161616';
const MAROON = '#471519';
const WHATSAPP = 'https://wa.me/250788500266';

const services = [
  {
    icon: FlaskConical,
    title: 'Materials Testing Laboratory',
    body: 'Geotechnical investigations, soil, concrete, aggregates, and steel testing — accurate results that verify your ground and materials meet specification.',
  },
  {
    icon: DraftingCompass,
    title: 'Structural Design',
    body: 'Safe, economical structural engineering for buildings of every scale — with foundation designs grounded in our own laboratory data.',
  },
  {
    icon: LayoutDashboard,
    title: 'Project Management (ERP-Driven)',
    body: 'Disciplined, transparent project delivery powered by our ERP system — live budgets, schedules, quality dashboards, and documents in one place.',
  },
];

const whyPoints = [
  ['One accountable partner', 'Testing, design, and management integrated; no gaps between consultants.'],
  ['Evidence-based engineering', 'Our designs are grounded in our own lab data, not assumptions.'],
  ['Digital transparency', 'Real-time ERP visibility of quality, progress, and cost.'],
  ['Standards-driven', 'Recognized national and international standards and codes (ISO/IEC 17025, ISO 9001 principles).'],
];

export default function LandingPage({ onNavigate }: LandingPageProps) {
  const login = () => onNavigate(AppView.LOGIN);
  return (
    <div className="min-h-screen bg-white text-[#161616] font-sans">
      {/* ── Nav ───────────────────────────────────────────── */}
      <nav className="h-16 w-full sticky top-0 z-40 bg-white/90 backdrop-blur-md flex justify-between items-center px-5 md:px-10 border-b border-black/5">
        <a href="#top" className="flex items-center"><img src="/inspecta-logo.png" alt="Inspecta" className="h-9 w-auto" /></a>
        <div className="hidden md:flex items-center gap-7 text-sm font-semibold">
          <a href="#services" className="text-[#161616] hover:text-[#FC6061] transition-colors">Services</a>
          <a href="#why" className="text-[#161616] hover:text-[#FC6061] transition-colors">Why Inspecta</a>
          <a href="#erp" className="text-[#161616] hover:text-[#FC6061] transition-colors">Inspecta ERP</a>
          <a href="#contact" className="text-[#161616] hover:text-[#FC6061] transition-colors">Contact</a>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={login} className="px-4 py-2 text-sm font-semibold text-[#161616] hover:bg-black/5 rounded-lg transition-all">Client Login</button>
          <a href="#contact" className="px-4 py-2 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90" style={{ background: CORAL }}>Request a Quote</a>
        </div>
      </nav>

      <main id="top">
        {/* ── Hero ──────────────────────────────────────────── */}
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
              <a href="#contact" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm shadow-lg transition-all hover:opacity-90" style={{ background: CORAL }}>
                Request a Quote <ArrowRight className="w-4 h-4" />
              </a>
              <a href="#services" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm border-2 transition-all hover:bg-black/[0.03]" style={{ borderColor: INK, color: INK }}>
                Explore Our Services
              </a>
            </div>
          </div>
        </section>

        {/* ── Intro strip ───────────────────────────────────── */}
        <section className="px-5 md:px-10 pb-4">
          <p className="max-w-3xl mx-auto text-center text-[#161616]/70 text-sm md:text-base leading-relaxed border-y border-black/5 py-6">
            From the soil beneath your foundation to the day of handover, Inspecta gives you the data, engineering, and controls to build safely, on budget, and to standard.
          </p>
        </section>

        {/* ── Services snapshot ─────────────────────────────── */}
        <section id="services" className="px-5 md:px-10 py-16 md:py-20 max-w-6xl mx-auto scroll-mt-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-extrabold" style={{ color: INK }}>Our Services</h2>
            <p className="mt-3 text-[#161616]/60 text-sm">Three integrated disciplines, one accountable partner.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {services.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.title} className="group rounded-2xl border border-black/8 p-7 hover:shadow-xl transition-all hover:-translate-y-1 bg-white">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: '#FC60611a' }}>
                    <Icon className="w-6 h-6" style={{ color: CORAL }} />
                  </div>
                  <h3 className="text-lg font-bold mb-2" style={{ color: INK }}>{s.title}</h3>
                  <p className="text-sm text-[#161616]/70 leading-relaxed">{s.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Why Inspecta ──────────────────────────────────── */}
        <section id="why" className="px-5 md:px-10 py-16 md:py-20 scroll-mt-20" style={{ background: '#FC60610a' }}>
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-extrabold text-center mb-12" style={{ color: INK }}>Why Inspecta</h2>
            <div className="grid sm:grid-cols-2 gap-6">
              {whyPoints.map(([title, body]) => (
                <div key={title} className="flex items-start gap-4 bg-white rounded-xl p-5 border border-black/5">
                  <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" style={{ color: CORAL }} />
                  <div>
                    <h4 className="font-bold text-[#161616]">{title}</h4>
                    <p className="text-sm text-[#161616]/70 mt-0.5">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Featured product banner: Inspecta ERP ─────────── */}
        <section id="erp" className="px-5 md:px-10 py-16 md:py-20 scroll-mt-20">
          <div className="max-w-6xl mx-auto rounded-3xl overflow-hidden relative p-8 md:p-14 text-white" style={{ background: INK }}>
            <div className="absolute -bottom-16 -right-16 w-80 h-80 rounded-full opacity-20 blur-3xl" style={{ background: CORAL }} />
            <div className="relative max-w-2xl">
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4" style={{ background: CORAL }}>
                <Sparkles className="w-3.5 h-3.5" /> New
              </span>
              <h2 className="text-3xl md:text-4xl font-extrabold leading-tight">Inspecta ERP with AI Copilot</h2>
              <p className="mt-4 text-white/75 text-sm md:text-base leading-relaxed">
                The construction ERP you can talk to. Ask your project anything — budgets, progress, test results — and get instant answers. Project management, cost control, and quality tracking with a built-in AI assistant.
              </p>
              <button onClick={login} className="mt-7 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90" style={{ background: CORAL }}>
                Discover Inspecta ERP <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

        {/* ── Closing CTA / Contact ─────────────────────────── */}
        <section id="contact" className="px-5 md:px-10 py-16 md:py-24 text-center scroll-mt-20" style={{ background: '#FC60610a' }}>
          <h2 className="text-3xl md:text-4xl font-extrabold" style={{ color: INK }}>Ready to build on solid ground?</h2>
          <p className="mt-3 text-[#161616]/70">Talk to our engineers today.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a href="tel:+250788500266" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-white border border-black/8 hover:shadow-md transition-all" style={{ color: INK }}>
              <Phone className="w-4 h-4" style={{ color: CORAL }} /> +250 788 500 266
            </a>
            <a href="mailto:inspectafrica@gmail.com" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-white border border-black/8 hover:shadow-md transition-all" style={{ color: INK }}>
              <Mail className="w-4 h-4" style={{ color: CORAL }} /> inspectafrica@gmail.com
            </a>
            <a href={WHATSAPP} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90" style={{ background: CORAL }}>
              <MessageCircle className="w-4 h-4" /> Get in Touch
            </a>
          </div>
          <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-[#161616]/50"><MapPin className="w-3.5 h-3.5" /> Kigali, Rwanda</p>
        </section>
      </main>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="bg-white border-t border-black/8 px-5 md:px-10 py-12">
        <div className="max-w-6xl mx-auto grid sm:grid-cols-2 md:grid-cols-4 gap-8 text-sm">
          <div>
            <img src="/inspecta-logo.png" alt="Inspecta" className="h-8 w-auto mb-3" />
            <p className="text-[#161616]/60 leading-relaxed">Your quality control partner. Materials testing, structural design, and ERP-driven project management — Kigali, Rwanda.</p>
          </div>
          <div>
            <h5 className="font-bold mb-3" style={{ color: INK }}>Quick Links</h5>
            <ul className="space-y-1.5 text-[#161616]/70">
              <li><a href="#top" className="hover:text-[#FC6061]">Home</a></li>
              <li><a href="#why" className="hover:text-[#FC6061]">Why Inspecta</a></li>
              <li><a href="#erp" className="hover:text-[#FC6061]">Inspecta ERP</a></li>
              <li><button onClick={login} className="hover:text-[#FC6061]">Client Login</button></li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold mb-3" style={{ color: INK }}>Services</h5>
            <ul className="space-y-1.5 text-[#161616]/70">
              <li>Materials Testing Laboratory</li>
              <li>Structural Design</li>
              <li>Project Management</li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold mb-3" style={{ color: INK }}>Contact</h5>
            <ul className="space-y-1.5 text-[#161616]/70">
              <li>+250 788 500 266</li>
              <li>inspectafrica@gmail.com</li>
              <li>Kigali, Rwanda</li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-10 pt-6 border-t border-black/5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#161616]/50">
          <span>© 2026 Inspecta Ltd. All rights reserved.</span>
          <span className="italic font-semibold" style={{ color: MAROON }}>your quality control partner</span>
        </div>
      </footer>

      {/* Floating WhatsApp */}
      <a href={WHATSAPP} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp"
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-xl text-white transition-transform hover:scale-105"
        style={{ background: '#25D366' }}>
        <MessageCircle className="w-7 h-7" />
      </a>
    </div>
  );
}
