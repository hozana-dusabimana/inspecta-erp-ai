import { useParams, Link, Navigate } from 'react-router-dom';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import MarketingLayout, { PageHero, CORAL, INK } from './MarketingLayout';
import { MEDIA } from './media';

interface ServiceDef {
  eyebrow: string;
  title: string;
  subtitle: string;
  image: string;
  headline: string;
  intro: string;
  listTitle: string;
  list: string[];
  extraTitle: string;
  extra: string;
  cta: string;
}

const SERVICES: Record<string, ServiceDef> = {
  'materials-testing': {
    eyebrow: 'Materials Testing Laboratory',
    title: 'Know Your Ground. Trust Your Materials.',
    subtitle: 'Soil, concrete, aggregates, and steel testing plus geotechnical site investigations — accurate, standards-based laboratory results.',
    image: MEDIA.materialsImage,
    headline: 'Verified data, before problems reach your building',
    intro: 'Every strong structure starts with verified data. Our civil engineering laboratory tests the ground you build on and the materials you build with — before, during, and after construction — so problems are caught in the lab, not discovered in your building.',
    listTitle: 'Laboratory & Field Testing Services',
    list: [
      'Geotechnical site investigations: trial pits, boreholes, sampling, and soil profiling',
      'Soil testing: classification, Atterberg limits, compaction (Proctor), CBR, bearing capacity',
      'Concrete testing: mix design, slump, cube/cylinder compressive strength, non-destructive testing',
      'Aggregates & pavement materials: grading, ACV/AIV, abrasion, asphalt testing',
      'Construction water, blocks, pavers, and steel reinforcement testing',
      'On-site quality control: field density, sampling, and continuous QC testing during works',
    ],
    extraTitle: "Who It's For",
    extra: 'Developers verifying a site before purchase or design. Contractors proving compliance to supervisors. Consultants requiring independent test evidence. Homeowners who want certainty before investing their savings.',
    cta: 'Request Testing Services',
  },
  'structural-design': {
    eyebrow: 'Structural Design',
    title: 'Engineering You Can Stand On.',
    subtitle: 'Structural analysis and design for residential, commercial, industrial, and institutional buildings — grounded in real geotechnical data.',
    image: MEDIA.structuralImage,
    headline: 'Designs grounded in your actual site',
    intro: 'Our structural design office translates test data and architectural intent into safe, economical structures. Because we run our own geotechnical laboratory, our foundation designs are grounded in real measurements from your actual site — not assumptions.',
    listTitle: 'What We Design',
    list: [
      'Structural analysis and design of residential, commercial, industrial, and institutional buildings',
      'Foundation design informed directly by our own geotechnical investigations',
      'Reinforced concrete and steel structures, with full detailing and bar bending schedules',
      'Structural assessments, audits, and remedial or strengthening design for existing buildings',
      'Design review and value engineering for cost-effective construction',
    ],
    extraTitle: 'The Inspecta Difference',
    extra: "Most designers receive a soil report from a third party and hope it's right. At Inspecta, the engineer who designs your foundation can walk into our lab and examine your soil samples personally. That integration means safer structures and fewer costly over-designs.",
    cta: 'Talk to Our Engineers',
  },
  'project-management': {
    eyebrow: 'Project Management',
    title: 'Your Project, Under Control — In Real Time.',
    subtitle: 'Transparent, technology-enabled construction project management in Rwanda — schedules, budgets, quality, and documents in one system.',
    image: MEDIA.projectImage,
    headline: 'One platform connecting site, lab, and office',
    intro: 'Inspecta manages construction projects on a modern ERP platform that connects site, laboratory, and office. While others manage projects through scattered spreadsheets and phone calls, our clients see live dashboards of progress, cost, and quality — at any moment, from anywhere.',
    listTitle: 'What You Get',
    list: [
      'Integrated planning and scheduling with clear milestones and responsibilities',
      'Budget and cost control, procurement tracking, and materials management',
      'Live quality dashboards linking site progress to laboratory test results',
      'Document control — drawings, reports, approvals, and correspondence in one system',
      'Transparent progress reporting: see status, risks, and costs at any time',
    ],
    extraTitle: 'Powered by Inspecta ERP',
    extra: 'Our project management runs on Inspecta ERP with a built-in AI Copilot, so you can simply ask your project a question and get an instant, data-backed answer.',
    cta: 'Request a Consultation',
  },
};

export default function ServicePage() {
  const { slug } = useParams<{ slug: string }>();
  const svc = slug ? SERVICES[slug] : undefined;
  if (!svc) return <Navigate to="/" replace />;

  return (
    <MarketingLayout>
      <PageHero eyebrow={svc.eyebrow} title={svc.title} subtitle={svc.subtitle} image={svc.image} />

      <section className="px-5 md:px-10 pb-8 max-w-3xl mx-auto">
        <h2 className="text-xl md:text-2xl font-extrabold mb-3" style={{ color: INK }}>{svc.headline}</h2>
        <p className="text-[#161616]/75 leading-relaxed">{svc.intro}</p>
      </section>

      <section className="px-5 md:px-10 py-10 max-w-3xl mx-auto">
        <h3 className="text-lg font-bold mb-4" style={{ color: INK }}>{svc.listTitle}</h3>
        <ul className="space-y-3">
          {svc.list.map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm text-[#161616]/80">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: CORAL }} /> {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="px-5 md:px-10 py-12 md:py-14" style={{ background: '#FC60610a' }}>
        <div className="max-w-3xl mx-auto">
          <h3 className="text-lg font-bold mb-2" style={{ color: INK }}>{svc.extraTitle}</h3>
          <p className="text-[#161616]/75 leading-relaxed text-sm md:text-base">{svc.extra}</p>
        </div>
      </section>

      <section className="px-5 md:px-10 py-14 text-center">
        <Link to="/contact" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90" style={{ background: CORAL }}>{svc.cta} <ArrowRight className="w-4 h-4" /></Link>
      </section>
    </MarketingLayout>
  );
}
