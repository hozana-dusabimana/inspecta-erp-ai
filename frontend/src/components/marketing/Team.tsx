import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserCircle2, ArrowRight } from 'lucide-react';
import MarketingLayout, { PageHero, CORAL, INK } from './MarketingLayout';
import { api } from '../../lib/api';

interface Member { id: string; name: string; title: string; bio?: string | null; photoUrl?: string | null }

// Placeholder profiles shown until real team members are added in HR → Website Team.
const fallback: Member[] = [
  { id: 'a', name: '[Add your team]', title: 'Managing Director', bio: 'Add real names, titles, bios and photos in the app: Human Resources → Website Team.' },
  { id: 'b', name: '[Add your team]', title: 'Laboratory Manager', bio: 'Materials & geotechnical testing, standards expertise (e.g. ISO/IEC 17025).' },
  { id: 'c', name: '[Add your team]', title: 'Lead Structural Engineer', bio: 'Registered engineer; structural design across building types.' },
  { id: 'd', name: '[Add your team]', title: 'Project Manager / ERP Lead', bio: 'Delivers projects and runs the Inspecta ERP system.' },
];

export default function Team() {
  const { data } = useQuery({ queryKey: ['/public/team'], queryFn: () => api.get<Member[]>('/public/team') });
  const members = (data?.data && data.data.length > 0) ? data.data : fallback;

  return (
    <MarketingLayout>
      <PageHero eyebrow="Our Team" title="The People Behind the Quality"
        subtitle="Inspecta is powered by civil and structural engineers, laboratory technologists, and project managers who share one obsession: getting it right, and proving it." />

      <section className="px-5 md:px-10 py-10 max-w-5xl mx-auto">
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
          {members.map((m) => (
            <div key={m.id} className="rounded-2xl border border-black/8 p-6 text-center">
              {m.photoUrl ? (
                <img src={m.photoUrl} alt={m.name} loading="lazy" className="w-24 h-24 rounded-full mx-auto mb-4 object-cover" />
              ) : (
                <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: '#FC60611a' }}>
                  <UserCircle2 className="w-10 h-10" style={{ color: CORAL }} />
                </div>
              )}
              <h3 className="font-bold" style={{ color: INK }}>{m.name}</h3>
              <p className="text-sm font-semibold" style={{ color: CORAL }}>{m.title}</p>
              {m.bio && <p className="mt-2 text-sm text-[#161616]/70">{m.bio}</p>}
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-[#161616]/50 italic">Manage these profiles in the app: Human Resources → Website Team.</p>
      </section>

      <section className="px-5 md:px-10 py-12 text-center" style={{ background: '#FC60610a' }}>
        <h2 className="text-2xl font-extrabold" style={{ color: INK }}>Behind every Inspecta report is a professional who signs it — and stands by it.</h2>
        <Link to="/contact" className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90" style={{ background: CORAL }}>Get in Touch <ArrowRight className="w-4 h-4" /></Link>
      </section>
    </MarketingLayout>
  );
}
