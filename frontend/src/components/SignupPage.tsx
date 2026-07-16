import React, { useState } from 'react';
import { Lock, Mail, Eye, EyeOff, ArrowRight, Building2, User, CheckCircle2, MailCheck, Sun, Moon } from 'lucide-react';
import { AppView } from '../types';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { errorMessage } from '../lib/api';

interface SignupPageProps {
  onNavigate: (view: AppView) => void;
}

const CORAL = '#FC6061';
const DARK = '#141821';
const benefits = ['Your own isolated company workspace', 'Full ERP: planning, finance, QA/QC & more', 'You become the system administrator'];

export default function SignupPage({ onNavigate }: SignupPageProps) {
  const { register, resendVerification } = useAuth();
  const { theme, toggle } = useTheme();
  const [organizationName, setOrganizationName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; emailed: boolean } | null>(null);
  const [resent, setResent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await register({ organizationName, fullName, email, password });
      setSent({ email: res.email, emailed: res.emailed });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!sent) return;
    try {
      await resendVerification(sent.email);
      setResent(true);
    } catch {
      /* generic — resend is best-effort */
      setResent(true);
    }
  };

  const input = 'w-full pl-12 pr-4 py-3 bg-[var(--mk-surface)] border border-[var(--mk-border)] rounded-lg text-sm outline-none transition-all focus:ring-2';

  return (
    <div className="min-h-screen flex overflow-hidden font-sans bg-[var(--mk-bg)] text-[var(--mk-fg)]">
      {/* ── Left: brand panel (stays dark in both themes) ── */}
      <section className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center p-12 text-white"
        style={{ background: `linear-gradient(135deg, ${DARK} 0%, #1c1013 100%)` }}>
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full opacity-25 blur-3xl" style={{ background: CORAL }} />
        <div className="absolute -bottom-32 -right-16 w-96 h-96 rounded-full opacity-15 blur-3xl" style={{ background: CORAL }} />
        <div className="relative z-10 max-w-lg">
          <button onClick={() => onNavigate(AppView.LANDING)} className="flex items-center gap-3 mb-10 group">
            <img src="/inspecta-icon.svg" alt="" className="w-11 h-11 rounded-xl shadow-lg" />
            <span className="font-display text-2xl font-extrabold tracking-tight text-white group-hover:opacity-90">INSPECTA</span>
          </button>
          <h1 className="font-display text-4xl md:text-5xl font-extrabold leading-[1.08] mb-6">
            Bring your company<br /><span style={{ color: CORAL }}>onto Inspecta.</span>
          </h1>
          <p className="text-white/70 leading-relaxed">
            Create a workspace for your construction business in minutes — planning, production, quality, and cost control in one system.
          </p>
          <div className="mt-10 rounded-2xl border border-white/15 bg-white/5 backdrop-blur p-6 space-y-3">
            {benefits.map((p) => (
              <div key={p} className="flex items-center gap-3 text-sm font-semibold">
                <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: CORAL }} /> {p}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Right: form panel (theme-aware) ── */}
      <main className="w-full lg:w-1/2 flex flex-col items-center justify-center relative bg-[var(--mk-bg)] py-10">
        <button onClick={toggle} aria-label="Toggle theme" title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          className="absolute top-5 right-5 p-2 rounded-full hover:bg-[var(--mk-tint)] text-[var(--mk-muted)] hover:text-[#FC6061] transition-colors">
          {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
        </button>

        <div className="w-full max-w-md px-8 md:px-12">
          <button onClick={() => onNavigate(AppView.LANDING)} className="mb-8 block">
            <img src="/inspecta-logo.png" alt="Inspecta" className="h-9 w-auto" />
          </button>

          {sent ? (
            /* ── Success: verification email dispatched ── */
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: '#FC606115' }}>
                <MailCheck className="h-8 w-8" style={{ color: CORAL }} />
              </div>
              <h2 className="font-display text-3xl font-extrabold mb-2" style={{ color: 'var(--mk-fg)' }}>Check your inbox</h2>
              <p className="text-[var(--mk-muted)] text-sm mb-2">
                We sent a verification link to <span className="font-bold text-[var(--mk-fg)]">{sent.email}</span>.
                Click it to activate your company account and sign in.
              </p>
              {!sent.emailed && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-700 mt-4">
                  Email delivery isn’t configured on this instance — ask your administrator for the verification link from the server logs.
                </p>
              )}
              <div className="mt-8 space-y-3">
                <button onClick={handleResend} disabled={resent}
                  className="w-full py-3 border border-[var(--mk-border)] rounded-lg text-sm font-bold hover:bg-[var(--mk-tint)] transition-all disabled:opacity-60">
                  {resent ? 'Verification email re-sent' : 'Resend verification email'}
                </button>
                <button onClick={() => onNavigate(AppView.LOGIN)}
                  className="w-full py-3 text-white font-bold text-sm rounded-lg shadow-lg active:scale-[0.98] transition-all" style={{ background: CORAL }}>
                  Go to sign in
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="font-display text-3xl font-extrabold mb-1" style={{ color: 'var(--mk-fg)' }}>Create your account</h2>
              <p className="text-[var(--mk-muted)] text-sm mb-8">Set up your company workspace on Inspecta.</p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="org-input">Company Name</label>
                  <div className="relative">
                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                    <input id="org-input" required minLength={2} type="text" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="Acme Construction Ltd"
                      className={input} style={{ ['--tw-ring-color' as string]: '#FC606126' }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = CORAL)} onBlur={(e) => (e.currentTarget.style.borderColor = '')} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="name-input">Your Full Name</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                    <input id="name-input" required minLength={2} type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe"
                      className={input} style={{ ['--tw-ring-color' as string]: '#FC606126' }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = CORAL)} onBlur={(e) => (e.currentTarget.style.borderColor = '')} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="email-input">Work Email</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                    <input id="email-input" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"
                      className={input} style={{ ['--tw-ring-color' as string]: '#FC606126' }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = CORAL)} onBlur={(e) => (e.currentTarget.style.borderColor = '')} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="password-input">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                    <input id="password-input" required minLength={8} type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
                      className={input.replace('pr-4', 'pr-12')} style={{ ['--tw-ring-color' as string]: '#FC606126' }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = CORAL)} onBlur={(e) => (e.currentTarget.style.borderColor = '')} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--mk-muted)] hover:text-[var(--mk-fg)]">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">{error}</div>}

                <button type="submit" disabled={isSubmitting}
                  className="w-full py-3.5 text-white font-bold text-sm rounded-lg shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60"
                  style={{ background: CORAL }}>
                  <span>{isSubmitting ? 'Creating account…' : 'Create account'}</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </button>

                <p className="text-[11px] text-[var(--mk-muted)] text-center leading-relaxed">
                  By creating an account you agree to Inspecta’s Terms of Service and Privacy Policy.
                </p>
              </form>

              <p className="mt-8 pt-6 border-t border-[var(--mk-border)] text-center text-xs text-[var(--mk-muted)]">
                Already have an account?
                <button onClick={() => onNavigate(AppView.LOGIN)} className="font-bold hover:underline ml-1" style={{ color: CORAL }}>Sign in</button>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
