import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ArrowRight, ArrowLeft, MailCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';

const CORAL = '#FC6061';

/**
 * Step 1 of the forgot-password flow: ask for the address, then show the same
 * confirmation whatever the answer. The server never reveals whether an email
 * is registered, and neither does this screen.
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { requestPasswordReset } = useAuth();
  useTheme(); // applies the theme vars on this standalone page

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await requestPasswordReset(email);
    } catch {
      /* Best-effort by design — a failure here must not hint that the address
         is (or isn't) registered. Rate-limit rejections land here too. */
    }
    setIsSubmitting(false);
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-[var(--mk-bg)] text-[var(--mk-fg)] px-6">
      <div className="w-full max-w-md">
        <button onClick={() => navigate('/')} className="mb-10 block mx-auto">
          <img src="/inspecta-logo.png" alt="Inspecta" className="h-9 w-auto" />
        </button>

        {sent ? (
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: '#FC606115' }}>
              <MailCheck className="h-9 w-9" style={{ color: CORAL }} />
            </div>
            <h1 className="font-display text-2xl font-extrabold">Check your inbox</h1>
            <p className="text-[var(--mk-muted)] text-sm mt-2">
              If <span className="font-semibold text-[var(--mk-fg)]">{email}</span> has an Inspecta account, a reset link is on its way.
              It expires in 1 hour and can only be used once.
            </p>
            <button onClick={() => { setSent(false); }} className="mt-6 text-xs font-bold hover:underline" style={{ color: CORAL }}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <h1 className="font-display text-3xl font-extrabold mb-1">Forgot your password?</h1>
            <p className="text-[var(--mk-muted)] text-sm mb-8">
              Enter the email you sign in with and we&apos;ll send you a link to choose a new password.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="forgot-email">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                  <input id="forgot-email" required type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full pl-12 pr-4 py-3 bg-[var(--mk-surface)] border border-[var(--mk-border)] rounded-lg text-sm outline-none transition-all focus:ring-2"
                    style={{ ['--tw-ring-color' as string]: '#FC606126' }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = CORAL)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = '')} />
                </div>
              </div>

              <button type="submit" disabled={isSubmitting}
                className="w-full py-3.5 text-white font-bold text-sm rounded-lg shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60"
                style={{ background: CORAL }}>
                <span>{isSubmitting ? 'Sending…' : 'Send reset link'}</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </button>
            </form>
          </>
        )}

        <button onClick={() => navigate('/login')}
          className="mt-8 mx-auto flex items-center gap-1.5 text-xs font-bold hover:underline" style={{ color: CORAL }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
        </button>
      </div>
    </div>
  );
}
