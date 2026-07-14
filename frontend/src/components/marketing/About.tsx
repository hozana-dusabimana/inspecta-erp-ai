import { Link } from 'react-router-dom';
import { Target, Compass, CheckCircle2, ArrowRight } from 'lucide-react';
import MarketingLayout, { PageHero, CORAL, INK } from './MarketingLayout';

const values = [
  ['Integrity', 'Our test results and professional opinions are independent, accurate, and impartial.'],
  ['Precision', 'We follow recognized standards and calibrated procedures in everything we measure and design.'],
  ['Accountability', 'Our ERP system makes every project milestone, test, and cost traceable.'],
  ['Partnership', "We work as an extension of our clients' teams, from feasibility to handover."],
];

export default function About() {
  return (
    <MarketingLayout>
      <PageHero eyebrow="About Us" title="Your Quality Control Partner in Construction"
        subtitle="Inspecta Ltd is a Kigali-based company combining a materials testing laboratory, a structural design office, and ERP-driven project management." />

      <section className="px-5 md:px-10 pb-8 max-w-3xl mx-auto space-y-5 text-[#161616]/75 leading-relaxed">
        <p>Inspecta Ltd is a Rwandan construction-sector company built around one promise: <strong style={{ color: INK }}>quality you can verify.</strong> We serve developers, contractors, consultants, public institutions, and homeowners as an independent quality control partner — combining a civil engineering materials testing laboratory, a structural design office, and technology-enabled project management under one roof.</p>
        <p>Construction failures rarely begin on the day a crack appears. They begin with untested soil, unverified concrete, undocumented decisions, and unmanaged budgets. Inspecta exists to close those gaps — with laboratory evidence, sound engineering, and disciplined management.</p>
      </section>

      <section className="px-5 md:px-10 py-12 max-w-5xl mx-auto grid md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-black/8 p-7">
          <Compass className="w-7 h-7 mb-3" style={{ color: CORAL }} />
          <h3 className="text-lg font-bold" style={{ color: INK }}>Our Vision</h3>
          <p className="mt-2 text-sm text-[#161616]/70">To be the region's most trusted quality control partner in the construction industry.</p>
        </div>
        <div className="rounded-2xl border border-black/8 p-7">
          <Target className="w-7 h-7 mb-3" style={{ color: CORAL }} />
          <h3 className="text-lg font-bold" style={{ color: INK }}>Our Mission</h3>
          <p className="mt-2 text-sm text-[#161616]/70">To safeguard the quality, safety, and durability of construction projects by delivering accurate laboratory testing, sound structural engineering, and disciplined, technology-enabled project management.</p>
        </div>
      </section>

      <section className="px-5 md:px-10 py-12 md:py-16" style={{ background: '#FC60610a' }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-center mb-10" style={{ color: INK }}>Our Core Values</h2>
          <div className="grid sm:grid-cols-2 gap-5">
            {values.map(([t, b]) => (
              <div key={t} className="flex items-start gap-3 bg-white rounded-xl p-5 border border-black/5">
                <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" style={{ color: CORAL }} />
                <div><h4 className="font-bold">{t}</h4><p className="text-sm text-[#161616]/70 mt-0.5">{b}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 md:px-10 py-14 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl md:text-3xl font-extrabold" style={{ color: INK }}>Our Approach</h2>
        <p className="mt-4 text-[#161616]/75 leading-relaxed">Quality control is not a service we offer on the side — it is our identity. Every test follows documented procedures with calibrated equipment. Every design passes internal checking and review. Every project decision is recorded in our ERP for full traceability. We align our laboratory and management practices with international best practice, including ISO/IEC 17025 principles for testing laboratories and ISO 9001 principles for quality management.</p>
        <Link to="/contact" className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90" style={{ background: CORAL }}>Work With Us <ArrowRight className="w-4 h-4" /></Link>
      </section>
    </MarketingLayout>
  );
}
