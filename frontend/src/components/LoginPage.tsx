import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  HardHat, 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  ShieldCheck,
  Bot
} from 'lucide-react';
import { AppView } from '../types';
import { useAuth } from '../lib/auth';

interface LoginPageProps {
  onLoginSuccess: () => void;
  onNavigate: (view: AppView) => void;
}

export default function LoginPage({ onLoginSuccess, onNavigate }: LoginPageProps) {
  const { login } = useAuth();
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

  // SSO providers are not yet provisioned on the backend; surface that honestly
  // instead of faking a successful sign-in.
  const handleSsoClick = () => {
    setError('SSO is not yet enabled for this instance. Please sign in with your email and password.');
  };

  return (
    <div className="min-h-screen bg-brand-surface text-brand-on-surface font-sans flex overflow-hidden" id="login-root">
      {/* Left Side: Visual/Background Canvas */}
      <section id="login-visual-panel" className="hidden lg:flex lg:w-1/2 relative bg-brand-primary-container overflow-hidden items-center justify-center p-12">
        {/* Dynamic Abstract Tech Graphic Pattern */}
        <div className="absolute inset-0 z-0 opacity-40 bg-gradient-to-tr from-brand-primary/95 to-brand-primary-container/30">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.05) 1px, transparent 1px), radial-gradient(circle at 75% 60%, rgba(255,255,255,0.05) 2px, transparent 2px)',
            backgroundSize: '40px 40px'
          }} />
        </div>
        
        {/* Animated Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-tr from-brand-primary/90 to-brand-primary-container/40 z-10"></div>
        
        {/* Brand Message Content */}
        <div className="relative z-20 max-w-lg text-white">
          <div className="mb-4 flex items-center gap-2 cursor-pointer" onClick={() => onNavigate(AppView.LANDING)}>
            <div className="w-10 h-10 rounded-xl bg-brand-secondary-container flex items-center justify-center shadow-lg">
              <HardHat className="text-white w-6 h-6" />
            </div>
            <span className="font-display text-2xl font-bold tracking-tight text-white">Inspecta AI</span>
          </div>
          
          <div className="mb-6 flex items-center gap-2">
            <span className="font-sans text-xs tracking-widest uppercase opacity-80 font-bold text-brand-on-primary-container">Next-Gen Construction ERP</span>
          </div>
          
          <h1 className="font-display text-4xl md:text-5xl font-extrabold mb-6 leading-tight">
            Building the future with AI integrity.
          </h1>
          
          <p className="font-sans text-base opacity-75 leading-relaxed">
            Experience absolute control over your construction projects with real-time AI insights and streamlined enterprise management.
          </p>
          
          {/* Contextual Metric Widget (Glassmorphism) */}
          <div className="mt-12 glass-panel p-6 rounded-xl border border-white/20 shadow-2xl inline-flex flex-col gap-4 max-w-sm w-full bg-white/10">
            <div className="flex items-center justify-between">
              <span className="text-white font-bold font-display text-sm flex items-center gap-1.5">
                <Bot className="w-4 h-4 text-brand-secondary-container" />
                Project Health Score
              </span>
              <span className="bg-brand-tertiary-fixed-dim text-brand-tertiary px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase">
                Optimal
              </span>
            </div>
            
            <div className="flex items-end gap-2">
              <span className="text-4xl font-mono font-bold text-white">98.4</span>
              <span className="text-white/70 text-xs pb-1">+1.2% this week</span>
            </div>
            
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-brand-secondary-container w-[98%] shadow-[0_0_8px_rgba(255,138,0,0.6)]"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Right Side: Login Form Canvas */}
      <main id="login-form-panel" className="w-full lg:w-1/2 flex flex-col items-center justify-center bg-white relative">
        <div className="absolute inset-0 ai-shimmer pointer-events-none opacity-20"></div>
        
        <div className="w-full max-w-md px-8 md:px-12 z-30">
          {/* Header/Logo for Mobile View */}
          <div className="mb-8 flex flex-col items-center lg:items-start">
            <div className="flex items-center gap-2 lg:hidden mb-4 cursor-pointer" onClick={() => onNavigate(AppView.LANDING)}>
              <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center">
                <HardHat className="text-white w-5 h-5" />
              </div>
              <span className="font-display text-xl font-bold text-brand-primary">Inspecta AI</span>
            </div>
            
            <h2 className="font-display text-3xl font-extrabold text-brand-primary mb-1">Welcome back</h2>
            <p className="text-brand-on-surface-variant text-sm font-medium">Log in to manage your construction enterprise.</p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-6" id="login-form">
            {/* Email Field */}
            <div className="space-y-2">
              <label className="font-sans text-xs font-bold text-brand-on-surface-variant block" htmlFor="email-input">
                Corporate Email Address
              </label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-outline w-4 h-4 group-focus-within:text-brand-primary transition-colors" />
                <input 
                  id="email-input"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-12 pr-4 py-3 bg-brand-surface border border-brand-outline-variant rounded-lg text-sm focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary transition-all outline-none"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="font-sans text-xs font-bold text-brand-on-surface-variant block" htmlFor="password-input">
                  Password
                </label>
                <a className="text-xs text-brand-primary hover:underline font-bold transition-all" href="#forgot">
                  Forgot Password?
                </a>
              </div>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-outline w-4 h-4 group-focus-within:text-brand-primary transition-colors" />
                <input 
                  id="password-input"
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-12 py-3 bg-brand-surface border border-brand-outline-variant rounded-lg text-sm focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary transition-all outline-none"
                />
                <button 
                  type="button"
                  id="btn-toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-outline hover:text-brand-on-surface"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center gap-2">
              <input 
                id="remember-checkbox"
                type="checkbox"
                defaultChecked
                className="w-4 h-4 rounded border-brand-outline-variant text-brand-primary focus:ring-brand-primary cursor-pointer"
              />
              <label className="font-sans text-xs text-brand-on-surface-variant cursor-pointer select-none font-medium" htmlFor="remember-checkbox">
                Remember this device for 30 days
              </label>
            </div>

            {/* Auth error */}
            {error && (
              <div id="login-error" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">
                {error}
              </div>
            )}

            {/* Submit Action */}
            <button
              type="submit"
              id="btn-login-submit"
              disabled={isSubmitting}
              className="w-full py-3.5 bg-brand-primary text-white font-bold text-sm rounded-lg shadow-lg hover:bg-brand-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 group cursor-pointer"
            >
              <span>{isSubmitting ? 'Authenticating...' : 'Sign In to Dashboard'}</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
          </form>

          {/* Divider */}
          <div className="my-8 flex items-center gap-4">
            <div className="h-[1px] flex-grow bg-brand-outline-variant opacity-40"></div>
            <span className="font-sans text-[10px] font-bold text-brand-outline shrink-0 tracking-widest">OR CONTINUE WITH</span>
            <div className="h-[1px] flex-grow bg-brand-outline-variant opacity-40"></div>
          </div>

          {/* SSO Options */}
          <div className="grid grid-cols-2 gap-4">
            <button 
              id="btn-sso-google"
              onClick={handleSsoClick}
              className="flex items-center justify-center gap-3 py-3 px-4 border border-brand-outline-variant rounded-lg font-sans text-xs font-semibold text-brand-on-surface hover:bg-brand-surface-container-low transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"></path>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>
              </svg>
              <span>Google</span>
            </button>
            
            <button 
              id="btn-sso-microsoft"
              onClick={handleSsoClick}
              className="flex items-center justify-center gap-3 py-3 px-4 border border-brand-outline-variant rounded-lg font-sans text-xs font-semibold text-brand-on-surface hover:bg-brand-surface-container-low transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path d="M1 1h10v10H1z" fill="#00a4ef"></path>
                <path d="M13 1h10v10H13z" fill="#7fbb00"></path>
                <path d="M1 13h10v10H1z" fill="#ffb900"></path>
                <path d="M13 13h10v10H13z" fill="#f25022"></path>
              </svg>
              <span>Microsoft</span>
            </button>
          </div>

          {/* Footer Support Meta */}
          <div className="mt-12 pt-6 border-t border-brand-outline-variant/30 text-center lg:text-left">
            <p className="font-sans text-xs text-brand-on-surface-variant font-medium">
              Enterprise instance secure connection enabled. 
              <a className="text-brand-primary font-bold hover:underline ml-1" href="#support">
                Contact IT Support
              </a>
            </p>
          </div>
        </div>

        {/* Security Badge */}
        <div id="badge-encrypted" className="absolute bottom-6 right-6 flex items-center gap-1.5 opacity-45 text-brand-on-surface-variant">
          <ShieldCheck className="w-4 h-4" />
          <span className="font-sans text-[10px] tracking-widest uppercase font-bold">AES-256 Encrypted</span>
        </div>
      </main>
    </div>
  );
}
