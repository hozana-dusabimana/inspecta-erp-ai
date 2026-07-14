import { useState } from 'react';
import { Phone, Mail, MapPin, MessageCircle, Send, CheckCircle2 } from 'lucide-react';
import MarketingLayout, { PageHero, CORAL, INK, WHATSAPP } from './MarketingLayout';
import { api, errorMessage } from '../../lib/api';

const SERVICES = ['Materials Testing', 'Structural Design', 'Project Management', 'Inspecta ERP Demo', 'Other'];

export default function Contact() {
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '', service: SERVICES[0], message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await api.post('/public/contact', form);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const field = 'w-full h-11 bg-[var(--mk-surface)] border border-[var(--mk-border)] rounded-lg px-3 text-sm outline-none focus:border-[#FC6061] transition-colors';

  return (
    <MarketingLayout>
      <PageHero eyebrow="Contact" title="Let's Talk About Your Project"
        subtitle="Whether you need a soil test tomorrow, a structural design for your next building, or a demo of Inspecta ERP — our team responds quickly." />

      <section className="px-5 md:px-10 pb-20 max-w-5xl mx-auto grid md:grid-cols-5 gap-8">
        {/* Details */}
        <div className="md:col-span-2 space-y-4">
          <a href="tel:+250788500266" className="flex items-center gap-3 rounded-xl border border-[var(--mk-border)] p-4 hover:shadow-md transition-all">
            <Phone className="w-5 h-5" style={{ color: CORAL }} /><div><p className="text-[11px] font-bold uppercase tracking-wide text-[var(--mk-muted)]">Phone / WhatsApp</p><p className="font-semibold" style={{ color: INK }}>+250 788 500 266</p></div>
          </a>
          <a href="mailto:inspectafrica@gmail.com" className="flex items-center gap-3 rounded-xl border border-[var(--mk-border)] p-4 hover:shadow-md transition-all">
            <Mail className="w-5 h-5" style={{ color: CORAL }} /><div><p className="text-[11px] font-bold uppercase tracking-wide text-[var(--mk-muted)]">Email</p><p className="font-semibold" style={{ color: INK }}>inspectafrica@gmail.com</p></div>
          </a>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--mk-border)] p-4">
            <MapPin className="w-5 h-5" style={{ color: CORAL }} /><div><p className="text-[11px] font-bold uppercase tracking-wide text-[var(--mk-muted)]">Location</p><p className="font-semibold" style={{ color: INK }}>Kigali, Rwanda</p></div>
          </div>
          <a href={WHATSAPP} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl p-4 font-bold text-white text-sm transition-all hover:opacity-90" style={{ background: '#25D366' }}>
            <MessageCircle className="w-5 h-5" /> Chat on WhatsApp
          </a>
        </div>

        {/* Form */}
        <div className="md:col-span-3">
          {sent ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-emerald-800">Message received</h3>
              <p className="mt-2 text-sm text-emerald-700">Thank you — our team will get back to you within one business day.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="rounded-2xl border border-[var(--mk-border)] p-6 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <input required placeholder="Name *" value={form.name} onChange={set('name')} className={field} />
                <input placeholder="Company (optional)" value={form.company} onChange={set('company')} className={field} />
                <input placeholder="Phone" value={form.phone} onChange={set('phone')} className={field} />
                <input required type="email" placeholder="Email *" value={form.email} onChange={set('email')} className={field} />
              </div>
              <select value={form.service} onChange={set('service')} className={field}>
                {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <textarea required placeholder="Message *" value={form.message} onChange={set('message')} rows={5} className="w-full bg-[var(--mk-surface)] border border-[var(--mk-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FC6061] transition-colors resize-none" />
              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}
              <button type="submit" disabled={sending} className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90 disabled:opacity-60" style={{ background: CORAL }}>
                <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send Message'}
              </button>
            </form>
          )}
        </div>
      </section>
    </MarketingLayout>
  );
}
