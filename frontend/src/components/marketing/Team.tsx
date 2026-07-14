import { Link } from 'react-router-dom';
import { UserCircle2, ArrowRight } from 'lucide-react';
import MarketingLayout, { PageHero, CORAL, INK } from './MarketingLayout';

// Placeholder roles — replace names/photos/bios with the real team.
const roles = [
  ['Managing Director', 'Leads the company; qualification, notable projects, and years of experience to be added.'],
  ['Laboratory Manager', 'Materials & geotechnical testing, standards expertise (e.g. ISO/IEC 17025).'],
  ['Lead Structural Engineer', 'Registered engineer; structural design across building types.'],
  ['Project Manager / ERP Lead', 'Delivers projects and runs the Inspecta ERP system.'],
  ['Geotechnical Engineer / Lab Technologist', 'Field investigation and laboratory testing.'],
];

export default function Team() {
  return (
    <MarketingLayout>
      <PageHero eyebrow="Our Team" title="The People Behind the Quality"
        subtitle="Inspecta is powered by civil and structural engineers, laboratory technologists, and project managers who share one obsession: getting it right, and proving it." />

      <section className="px-5 md:px-10 py-10 max-w-5xl mx-auto">
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
          {roles.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-black/8 p-6 text-center">
              <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: '#FC60611a' }}>
                <UserCircle2 className="w-10 h-10" style={{ color: CORAL }} />
              </div>
              <h3 className="font-bold" style={{ color: INK }}>{title}</h3>
              <p className="mt-2 text-sm text-[#161616]/70">{body}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-[#161616]/50 italic">Photos and full profiles to be added — every report we issue and design we stamp carries our team's professional reputation.</p>
      </section>

      <section className="px-5 md:px-10 py-12 text-center" style={{ background: '#FC60610a' }}>
        <h2 className="text-2xl font-extrabold" style={{ color: INK }}>Behind every Inspecta report is a professional who signs it — and stands by it.</h2>
        <Link to="/contact" className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90" style={{ background: CORAL }}>Get in Touch <ArrowRight className="w-4 h-4" /></Link>
      </section>
    </MarketingLayout>
  );
}
