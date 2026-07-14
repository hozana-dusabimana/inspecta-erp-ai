import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, ChevronDown, Menu, X } from 'lucide-react';

export const CORAL = '#FC6061';
export const INK = '#161616';
export const MAROON = '#471519';
export const WHATSAPP = 'https://wa.me/250788500266';

const serviceLinks = [
  ['/services/materials-testing', 'Materials Testing Laboratory'],
  ['/services/structural-design', 'Structural Design'],
  ['/services/project-management', 'Project Management'],
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [mobile, setMobile] = useState(false);
  return (
    <div className="min-h-screen bg-white text-[#161616] font-sans">
      {/* ── Nav ── */}
      <nav className="h-16 w-full sticky top-0 z-40 bg-white/90 backdrop-blur-md flex justify-between items-center px-5 md:px-10 border-b border-black/5">
        <Link to="/" className="flex items-center"><img src="/inspecta-logo.png" alt="Inspecta" className="h-9 w-auto" /></Link>

        <div className="hidden md:flex items-center gap-6 text-sm font-semibold">
          <Link to="/" className="hover:text-[#FC6061] transition-colors">Home</Link>
          <Link to="/about" className="hover:text-[#FC6061] transition-colors">About</Link>
          <div className="relative group">
            <button className="inline-flex items-center gap-1 hover:text-[#FC6061] transition-colors">Services <ChevronDown className="w-3.5 h-3.5" /></button>
            <div className="absolute left-0 top-full pt-2 hidden group-hover:block">
              <div className="bg-white rounded-xl shadow-xl border border-black/8 py-2 w-60">
                {serviceLinks.map(([to, label]) => (
                  <Link key={to} to={to} className="block px-4 py-2 text-[13px] hover:bg-black/[0.03] hover:text-[#FC6061]">{label}</Link>
                ))}
              </div>
            </div>
          </div>
          <Link to="/inspecta-erp" className="hover:text-[#FC6061] transition-colors">Inspecta ERP</Link>
          <Link to="/team" className="hover:text-[#FC6061] transition-colors">Team</Link>
          <Link to="/contact" className="hover:text-[#FC6061] transition-colors">Contact</Link>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/login" className="hidden sm:inline px-4 py-2 text-sm font-semibold hover:bg-black/5 rounded-lg transition-all">Client Login</Link>
          <Link to="/contact" className="hidden sm:inline px-4 py-2 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90" style={{ background: CORAL }}>Request a Quote</Link>
          <button className="md:hidden p-2" onClick={() => setMobile((v) => !v)} aria-label="Menu">{mobile ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}</button>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobile && (
        <div className="md:hidden border-b border-black/5 bg-white px-5 py-3 space-y-1 text-sm font-semibold">
          {[['/', 'Home'], ['/about', 'About'], ...serviceLinks, ['/inspecta-erp', 'Inspecta ERP'], ['/team', 'Team'], ['/contact', 'Contact'], ['/login', 'Client Login']].map(([to, label]) => (
            <Link key={to} to={to} onClick={() => setMobile(false)} className="block py-2 hover:text-[#FC6061]">{label}</Link>
          ))}
        </div>
      )}

      <main>{children}</main>

      {/* ── Footer ── */}
      <footer className="bg-white border-t border-black/8 px-5 md:px-10 py-12">
        <div className="max-w-6xl mx-auto grid sm:grid-cols-2 md:grid-cols-4 gap-8 text-sm">
          <div>
            <img src="/inspecta-logo.png" alt="Inspecta" className="h-8 w-auto mb-3" />
            <p className="text-[#161616]/60 leading-relaxed">Your quality control partner. Materials testing, structural design, and ERP-driven project management — Kigali, Rwanda.</p>
          </div>
          <div>
            <h5 className="font-bold mb-3">Quick Links</h5>
            <ul className="space-y-1.5 text-[#161616]/70">
              <li><Link to="/" className="hover:text-[#FC6061]">Home</Link></li>
              <li><Link to="/about" className="hover:text-[#FC6061]">About Us</Link></li>
              <li><Link to="/inspecta-erp" className="hover:text-[#FC6061]">Inspecta ERP</Link></li>
              <li><Link to="/team" className="hover:text-[#FC6061]">Our Team</Link></li>
              <li><Link to="/contact" className="hover:text-[#FC6061]">Contact</Link></li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold mb-3">Services</h5>
            <ul className="space-y-1.5 text-[#161616]/70">
              {serviceLinks.map(([to, label]) => <li key={to}><Link to={to} className="hover:text-[#FC6061]">{label}</Link></li>)}
            </ul>
          </div>
          <div>
            <h5 className="font-bold mb-3">Contact</h5>
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

      <a href={WHATSAPP} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp"
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-xl text-white transition-transform hover:scale-105" style={{ background: '#25D366' }}>
        <MessageCircle className="w-7 h-7" />
      </a>
    </div>
  );
}

/** Simple page hero used across marketing sub-pages. Optional banner image. */
export function PageHero({ eyebrow, title, subtitle, image }: { eyebrow?: string; title: string; subtitle?: string; image?: string }) {
  return (
    <section className="relative overflow-hidden px-5 md:px-10 pt-14 pb-10 md:pt-20 md:pb-12 text-center">
      <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-10 blur-3xl" style={{ background: CORAL }} />
      <div className="max-w-3xl mx-auto relative">
        {eyebrow && <span className="text-xs font-bold uppercase tracking-widest" style={{ color: CORAL }}>{eyebrow}</span>}
        <h1 className="mt-3 text-3xl md:text-5xl font-extrabold tracking-tight" style={{ color: INK }}>{title}</h1>
        {subtitle && <p className="mt-4 text-[#161616]/70 text-base md:text-lg leading-relaxed">{subtitle}</p>}
      </div>
      {image && (
        <div className="max-w-4xl mx-auto mt-10">
          <img src={image} alt="" loading="lazy" className="w-full h-56 md:h-80 object-cover rounded-2xl shadow-lg" />
        </div>
      )}
    </section>
  );
}
