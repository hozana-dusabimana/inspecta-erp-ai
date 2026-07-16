import React, { useState } from 'react';
import { Lock, Mail, Eye, EyeOff, ArrowRight, ShieldCheck, CheckCircle2, Sun, Moon } from 'lucide-react';
import { AppView } from '../types';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';

interface LoginPageProps {
  onLoginSuccess: () => void;
  onNavigate: (view: AppView) => void;
}

const CORAL = '#FC6061';
const DARK = '#141821';
const pillars = ['Materials Testing Laboratory', 'Structural Design', 'ERP-Driven Project Management'];

export default function LoginPage({ onLoginSuccess, onNavigate }: LoginPageProps) {
  const { login } = useAuth();
  const { theme, toggle } = useTheme();
  const [email, setEmail] = useState('admin@inspecta.ai');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      onLoginSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSsoClick = () => setError('SSO is not yet enabled for this instance. Please sign in with your email and password.');

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
            Build with Confidence.<br /><span style={{ color: CORAL }}>Quality You Can Verify.</span>
          </h1>
          <p className="text-white/70 leading-relaxed">
            Your quality control partner — a materials testing laboratory, structural design office, and ERP-driven project management, in one system.
          </p>
          <div className="mt-10 rounded-2xl border border-white/15 bg-white/5 backdrop-blur p-6 space-y-3">
            {pillars.map((p) => (
              <div key={p} className="flex items-center gap-3 text-sm font-semibold">
                <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: CORAL }} /> {p}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Right: form panel (theme-aware) ── */}
      <main className="w-full lg:w-1/2 flex flex-col items-center justify-center relative bg-[var(--mk-bg)]">
        <button onClick={toggle} aria-label="Toggle theme" title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          className="absolute top-5 right-5 p-2 rounded-full hover:bg-[var(--mk-tint)] text-[var(--mk-muted)] hover:text-[#FC6061] transition-colors">
          {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
        </button>

        <div className="w-full max-w-md px-8 md:px-12">
          <button onClick={() => onNavigate(AppView.LANDING)} className="mb-8 block">
            <img src="/inspecta-logo.png" alt="Inspecta" className="h-9 w-auto" />
          </button>

          <h2 className="font-display text-3xl font-extrabold mb-1" style={{ color: 'var(--mk-fg)' }}>Welcome back</h2>
          <p className="text-[var(--mk-muted)] text-sm mb-8">Sign in to manage your projects, quality, and costs.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="email-input">Email Address</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                <input id="email-input" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"
                  className={input} style={{ ['--tw-ring-color' as string]: '#FC606126', borderColor: undefined }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = CORAL)} onBlur={(e) => (e.currentTarget.style.borderColor = '')} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="password-input">Password</label>
                <a className="text-xs font-bold hover:underline" style={{ color: CORAL }} href="#forgot">Forgot Password?</a>
              </div>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                <input id="password-input" required type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  className={input.replace('pr-4', 'pr-12')} style={{ ['--tw-ring-color' as string]: '#FC606126' }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = CORAL)} onBlur={(e) => (e.currentTarget.style.borderColor = '')} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--mk-muted)] hover:text-[var(--mk-fg)]">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input id="remember-checkbox" type="checkbox" defaultChecked className="w-4 h-4 rounded cursor-pointer accent-[#FC6061]" />
              <label className="text-xs text-[var(--mk-muted)] cursor-pointer select-none" htmlFor="remember-checkbox">Remember this device for 30 days</label>
            </div>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">{error}</div>}

            <button type="submit" disabled={isSubmitting}
              className="w-full py-3.5 text-white font-bold text-sm rounded-lg shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60"
              style={{ background: CORAL }}>
              <span>{isSubmitting ? 'Signing in…' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
          </form>

          <div className="my-7 flex items-center gap-4">
            <div className="h-px flex-grow bg-[var(--mk-border)]" />
            <span className="text-[10px] font-bold text-[var(--mk-muted)] shrink-0 tracking-widest">OR CONTINUE WITH</span>
            <div className="h-px flex-grow bg-[var(--mk-border)]" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleSsoClick} className="flex items-center justify-center gap-2 py-3 px-4 border border-[var(--mk-border)] rounded-lg text-xs font-semibold hover:bg-[var(--mk-tint)] transition-all">
              <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
              <span>Google</span>
            </button>
            <button onClick={handleSsoClick} className="flex items-center justify-center gap-2 py-3 px-4 border border-[var(--mk-border)] rounded-lg text-xs font-semibold hover:bg-[var(--mk-tint)] transition-all">
              <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M1 1h10v10H1z" fill="#f25022" /><path d="M13 1h10v10H13z" fill="#7fbb00" /><path d="M1 13h10v10H1z" fill="#00a4ef" /><path d="M13 13h10v10H13z" fill="#ffb900" /></svg>
              <span>Microsoft</span>
            </button>
          </div>

          <p className="mt-10 pt-6 border-t border-[var(--mk-border)] text-center text-xs text-[var(--mk-muted)]">
            New to Inspecta?
            <button onClick={() => onNavigate(AppView.SIGNUP)} className="font-bold hover:underline ml-1" style={{ color: CORAL }}>Create a company account</button>
          </p>
        </div>

        <div className="absolute bottom-5 right-5 flex items-center gap-1.5 opacity-50 text-[var(--mk-muted)]">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-[10px] tracking-widest uppercase font-bold">Secure connection</span>
        </div>
      </main>
    </div>
  );
}
