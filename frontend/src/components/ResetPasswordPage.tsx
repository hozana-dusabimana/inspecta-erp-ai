import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Eye, EyeOff, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { errorMessage } from '../lib/api';

const CORAL = '#FC6061';
const MIN_LENGTH = 8; // must match the server's reset-password schema

/**
 * Step 2 of the forgot-password flow. The emailed token arrives in the query
 * string; a successful reset also signs the user in, so this lands straight in
 * the workspace rather than bouncing back to the login form.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { resetPassword, user } = useAuth();
  useTheme();
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    try {
      await resetPassword(token!, password);
      setDone(true);
      // The session is live at this point; a platform admin belongs in the
      // console, everyone else on their dashboard.
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const input = 'w-full pl-12 pr-12 py-3 bg-[var(--mk-surface)] border border-[var(--mk-border)] rounded-lg text-sm outline-none transition-all focus:ring-2';

  return (
    <div className="min-h-screen flex items-center justify-center font-sans bg-[var(--mk-bg)] text-[var(--mk-fg)] px-6">
      <div className="w-full max-w-md">
        <button onClick={() => navigate('/')} className="mb-10 block mx-auto">
          <img src="/inspecta-logo.png" alt="Inspecta" className="h-9 w-auto" />
        </button>

        {!token ? (
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
              <XCircle className="h-9 w-9 text-red-500" />
            </div>
            <h1 className="font-display text-2xl font-extrabold">Link is incomplete</h1>
            <p className="text-[var(--mk-muted)] text-sm mt-2">This reset link is missing its token. Request a new one.</p>
            <button onClick={() => navigate('/forgot-password')} className="mt-6 text-xs font-bold hover:underline" style={{ color: CORAL }}>
              Send a new reset link
            </button>
          </div>
        ) : done ? (
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: '#FC606115' }}>
              <CheckCircle2 className="h-9 w-9" style={{ color: CORAL }} />
            </div>
            <h1 className="font-display text-2xl font-extrabold">Password updated</h1>
            <p className="text-[var(--mk-muted)] text-sm mt-2">
              You&apos;re signed in as {user?.email}. Taking you to your workspace…
            </p>
          </div>
        ) : (
          <>
            <h1 className="font-display text-3xl font-extrabold mb-1">Choose a new password</h1>
            <p className="text-[var(--mk-muted)] text-sm mb-8">
              Pick something at least {MIN_LENGTH} characters long. Setting it signs you out of every other device.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="new-password">New password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                  <input id="new-password" required autoFocus type={showPassword ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={input}
                    style={{ ['--tw-ring-color' as string]: '#FC606126' }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = CORAL)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = '')} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--mk-muted)] hover:text-[var(--mk-fg)]">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--mk-muted)] block" htmlFor="confirm-password">Confirm new password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mk-muted)]" />
                  <input id="confirm-password" required type={showPassword ? 'text' : 'password'} value={confirm}
                    onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" className={input}
                    style={{ ['--tw-ring-color' as string]: '#FC606126' }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = CORAL)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = '')} />
                </div>
              </div>

              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">{error}</div>}

              <button type="submit" disabled={isSubmitting}
                className="w-full py-3.5 text-white font-bold text-sm rounded-lg shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60"
                style={{ background: CORAL }}>
                <span>{isSubmitting ? 'Updating…' : 'Update password'}</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </button>
            </form>

            <button onClick={() => navigate('/login')} className="mt-8 mx-auto block text-xs font-bold hover:underline" style={{ color: CORAL }}>
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
