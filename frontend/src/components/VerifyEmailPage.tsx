import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, Mail } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { errorMessage } from '../lib/api';

const CORAL = '#FC6061';

type Status = 'verifying' | 'success' | 'error';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { verifyEmail, resendVerification } = useAuth();
  useTheme(); // ensures theme vars are applied on this standalone page
  const token = params.get('token');

  const [status, setStatus] = useState<Status>('verifying');
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState('');
  const [resent, setResent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against React 18 StrictMode double-invoke
    ran.current = true;
    (async () => {
      if (!token) {
        setStatus('error');
        setError('This verification link is missing its token.');
        return;
      }
      try {
        await verifyEmail(token);
        setStatus('success');
        setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
      } catch (err) {
        setStatus('error');
        setError(errorMessage(err));
      }
    })();
  }, [token, verifyEmail, navigate]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await resendVerification(resendEmail);
    } catch {
      /* generic — resend is best-effort */
    }
    setResent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-[var(--mk-bg)] text-[var(--mk-fg)] px-6">
      <div className="w-full max-w-md text-center">
        <img src="/inspecta-logo.png" alt="Inspecta" className="h-9 w-auto mx-auto mb-10" />

        {status === 'verifying' && (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin" style={{ color: CORAL }} />
            <h1 className="font-display text-2xl font-extrabold mt-6">Verifying your email…</h1>
            <p className="text-[var(--mk-muted)] text-sm mt-2">Just a moment while we activate your account.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: '#FC606115' }}>
              <CheckCircle2 className="h-9 w-9" style={{ color: CORAL }} />
            </div>
            <h1 className="font-display text-2xl font-extrabold">Email verified</h1>
            <p className="text-[var(--mk-muted)] text-sm mt-2">Your account is active. Taking you to your dashboard…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
              <XCircle className="h-9 w-9 text-red-500" />
            </div>
            <h1 className="font-display text-2xl font-extrabold">Verification failed</h1>
            <p className="text-[var(--mk-muted)] text-sm mt-2">{error}</p>

            {resent ? (
              <p className="mt-8 rounded-lg border border-[var(--mk-border)] bg-[var(--mk-surface)] px-4 py-3 text-sm font-semibold">
                If that email has a pending account, a new verification link is on its way.
              </p>
            ) : (
              <form onSubmit={handleResend} className="mt-8 space-y-3 text-left">
                <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="resend-input">Resend the verification link</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                  <input id="resend-input" required type="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} placeholder="name@company.com"
                    className="w-full pl-12 pr-4 py-3 bg-[var(--mk-surface)] border border-[var(--mk-border)] rounded-lg text-sm outline-none" />
                </div>
                <button type="submit" className="w-full py-3 text-white font-bold text-sm rounded-lg shadow-lg active:scale-[0.98] transition-all" style={{ background: CORAL }}>
                  Send new link
                </button>
              </form>
            )}

            <button onClick={() => navigate('/login')} className="mt-6 text-xs font-bold hover:underline" style={{ color: CORAL }}>
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
