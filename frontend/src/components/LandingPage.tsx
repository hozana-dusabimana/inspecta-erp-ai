import { motion } from 'motion/react';
import { 
  Sparkles, 
  ArrowRight, 
  Calendar, 
  TrendingUp, 
  DollarSign, 
  ShieldCheck, 
  Bot, 
  Check, 
  Globe, 
  Share2, 
  UserCircle2,
  HardHat,
  Percent,
  Play
} from 'lucide-react';
import { AppView } from '../types';

interface LandingPageProps {
  onNavigate: (view: AppView) => void;
  onBookDemo: () => void;
}

export default function LandingPage({ onNavigate, onBookDemo }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-brand-surface text-brand-on-surface font-sans" id="landing-root">
      {/* Top Navigation */}
      <nav id="landing-nav" className="h-16 w-full sticky top-0 z-40 bg-brand-surface/80 backdrop-blur-md flex justify-between items-center px-6 md:px-12 border-b border-brand-glass-border">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => onNavigate(AppView.LANDING)}>
          <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center">
            <HardHat className="text-white w-5 h-5" />
          </div>
          <span className="font-display text-xl font-bold text-brand-primary">Inspecta AI</span>
        </div>
        
        <div className="hidden md:flex items-center gap-8">
          <a className="font-sans text-sm font-medium text-brand-primary hover:opacity-80 transition-all" href="#features">Product</a>
          <a className="font-sans text-sm text-brand-on-surface-variant hover:text-brand-primary transition-all" href="#solutions">Solutions</a>
          <a className="font-sans text-sm text-brand-on-surface-variant hover:text-brand-primary transition-all" href="#pricing">Pricing</a>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            id="btn-login"
            onClick={() => onNavigate(AppView.LOGIN)}
            className="px-4 py-2 text-sm font-medium text-brand-primary hover:bg-brand-primary/5 rounded-lg transition-all"
          >
            Sign In
          </button>
          <button 
            id="btn-book-demo-nav"
            onClick={onBookDemo}
            className="px-5 py-2 rounded-lg font-sans text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary-container transition-all"
          >
            Book Demo
          </button>
        </div>
      </nav>

      <main>
        {/* Hero Section */}
        <section id="hero-section" className="relative pt-16 pb-24 overflow-hidden px-6 md:px-12 max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="relative z-10"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-primary/10 border border-brand-primary/20 text-brand-primary mb-6">
                <Sparkles className="w-4 h-4 text-brand-secondary-container" />
                <span className="font-sans text-[11px] font-bold uppercase tracking-wider">Next-Gen Construction ERP</span>
              </div>
              
              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 leading-tight text-brand-primary">
                Increase Construction Productivity and Maximize Profitability <span className="text-brand-secondary-container">with AI</span>
              </h1>
              
              <p className="font-sans text-base md:text-lg text-brand-on-surface-variant mb-10 max-w-xl leading-relaxed">
                Plan smarter, track productivity, control costs, manage resources, ensure compliance, and forecast project profitability from one intelligent platform.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <button 
                  id="btn-start-hero"
                  onClick={() => onNavigate(AppView.LOGIN)}
                  className="px-6 py-4 rounded-xl bg-brand-primary text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xl shadow-brand-primary/20 hover:-translate-y-0.5 transition-all cursor-pointer"
                >
                  Launch App Console
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button 
                  id="btn-demo-hero"
                  onClick={onBookDemo}
                  className="px-6 py-4 rounded-xl border-2 border-brand-primary/10 bg-white/50 backdrop-blur-sm text-brand-primary font-semibold text-sm hover:bg-white transition-all cursor-pointer"
                >
                  Book Demo Tour
                </button>
              </div>
            </motion.div>

            {/* Dashboard Mockup Visual */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative group"
            >
              <div className="relative z-10 glass-panel p-5 rounded-2xl shadow-2xl overflow-hidden border-brand-outline-variant/30">
                <div className="flex items-center justify-between border-b border-brand-outline-variant/20 pb-4 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                  </div>
                  <div className="h-6 w-40 rounded bg-brand-surface-variant/50 ai-shimmer"></div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 space-y-4">
                    <div className="rounded-xl bg-brand-primary-container/5 border border-brand-primary-container/10 p-4 relative overflow-hidden">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-sans text-xs text-brand-on-surface-variant font-semibold">Project Health</span>
                        <span className="w-2.5 h-2.5 rounded-full bg-brand-status-warning animate-pulse"></span>
                      </div>
                      <div className="font-mono text-2xl font-bold text-brand-primary">84% Yield</div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-xl border border-brand-outline-variant/20 p-3 bg-white/40">
                        <div className="font-sans text-[11px] text-brand-on-surface-variant font-semibold">Active Crews</div>
                        <div className="font-mono text-lg font-bold text-brand-on-surface">12</div>
                      </div>
                      <div className="rounded-xl border border-brand-outline-variant/20 p-3 bg-white/40">
                        <div className="font-sans text-[11px] text-brand-on-surface-variant font-semibold">Cost Variance</div>
                        <div className="font-mono text-lg font-bold text-brand-status-critical">+$14.2k</div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-1 rounded-xl bg-brand-surface-ai p-3.5 border border-brand-secondary-container/20 flex flex-col justify-between">
                    <div className="flex items-center gap-1.5 text-brand-secondary-container">
                      <Bot className="w-4 h-4" />
                      <span className="font-sans text-xs font-bold">AI Assistant</span>
                    </div>
                    <div className="text-[10px] leading-relaxed text-brand-on-surface-variant bg-white p-2 rounded shadow-sm border border-brand-glass-border">
                      "Excavation is 15% behind schedule. Recommend reallocating Crew C from Zone 4."
                    </div>
                    <div className="h-6 rounded bg-brand-secondary-container/10 flex items-center justify-between px-2">
                      <div className="flex gap-0.5 items-end h-3">
                        <div className="w-0.5 bg-brand-secondary-container h-1 animate-bounce"></div>
                        <div className="w-0.5 bg-brand-secondary-container h-3 animate-bounce [animation-delay:0.2s]"></div>
                        <div className="w-0.5 bg-brand-secondary-container h-2 animate-bounce [animation-delay:0.4s]"></div>
                      </div>
                      <span className="text-[8px] font-mono font-semibold text-brand-secondary-container">ACTIVE</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Decorative Orbs */}
              <div className="absolute -top-10 -right-10 w-64 h-64 bg-brand-primary/5 blur-[100px] rounded-full -z-10"></div>
              <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-brand-secondary-container/5 blur-[100px] rounded-full -z-10"></div>
            </motion.div>
          </div>
        </section>

        {/* Feature Grid Bento Section */}
        <section id="features" className="py-20 bg-brand-surface-container-low px-6 md:px-12">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="font-display text-3xl md:text-4xl font-extrabold text-brand-primary mb-4">Enterprise-Grade Modules</h2>
              <p className="font-sans text-sm text-brand-on-surface-variant max-w-2xl mx-auto">
                The foundational pillars of construction intelligence, unified into a single ecosystem powered by Inspecta AI.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Planning Card */}
              <div className="md:col-span-8 group relative overflow-hidden rounded-2xl bg-white border border-brand-outline-variant/30 hover:shadow-xl transition-all p-8 flex flex-col justify-between min-h-[260px]">
                <div className="max-w-md">
                  <div className="w-12 h-12 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary mb-6">
                    <Calendar className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-xl font-bold text-brand-primary mb-2">Adaptive Planning</h3>
                  <p className="font-sans text-sm text-brand-on-surface-variant leading-relaxed">
                    Auto-generate optimized schedules based on historical performance and resource availability. Adjust in real-time as site conditions change.
                  </p>
                </div>
                <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-brand-primary/5 text-brand-primary px-3 py-1 rounded-full text-xs font-semibold">
                  <span>Explore scheduler</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Production Card */}
              <div className="md:col-span-4 bg-brand-primary text-white rounded-2xl p-8 flex flex-col justify-between min-h-[260px]">
                <div>
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-brand-on-primary-container mb-6">
                    <TrendingUp className="w-6 h-6 text-brand-on-primary-container" />
                  </div>
                  <h3 className="font-display text-xl font-bold text-brand-on-primary-container mb-2">Production Tracking</h3>
                  <p className="font-sans text-sm text-brand-on-primary-container/80 leading-relaxed mb-4">
                    Real-time daily reporting and productivity analysis. Compare field output against budget benchmarks instantly.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-bold font-mono text-brand-on-primary-container">98.2%</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-on-primary-container/75">Site Efficiency</span>
                </div>
              </div>

              {/* Finance Card */}
              <div className="md:col-span-4 glass-panel rounded-2xl p-8 border-brand-secondary-container/20 flex flex-col justify-between min-h-[260px] bg-white">
                <div>
                  <div className="w-12 h-12 rounded-xl bg-brand-secondary-container/10 flex items-center justify-center text-brand-secondary-container mb-6">
                    <DollarSign className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-xl font-bold text-brand-primary mb-2">Cost Control</h3>
                  <p className="font-sans text-sm text-brand-on-surface-variant leading-relaxed mb-6">
                    Automated job costing and budget forecasting. Identify margin erosion before it impacts your bottom line.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold text-brand-on-surface-variant">
                    <span>Material Budget Sync</span>
                    <span>75%</span>
                  </div>
                  <div className="h-1.5 bg-brand-outline-variant/20 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-secondary-container w-3/4 rounded-full"></div>
                  </div>
                </div>
              </div>

              {/* Compliance Card */}
              <div className="md:col-span-8 rounded-2xl bg-white border border-brand-outline-variant/30 p-8 flex flex-col md:flex-row gap-8 items-center min-h-[260px]">
                <div className="flex-1">
                  <div className="w-12 h-12 rounded-xl bg-brand-tertiary-fixed-dim/20 flex items-center justify-center text-brand-tertiary mb-6">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-xl font-bold text-brand-primary mb-2">Automated Compliance</h3>
                  <p className="font-sans text-sm text-brand-on-surface-variant leading-relaxed">
                    Streamline QA/QC and HSE workflows. Use AI to scan field photos for safety violations and document missing logs automatically.
                  </p>
                </div>
                <div className="flex-none w-36 h-36 rounded-xl bg-brand-surface-container-high relative flex items-center justify-center border border-brand-outline-variant/20">
                  <ShieldCheck className="text-4xl text-brand-primary/30" />
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500 animate-ping"></div>
                  <div className="absolute bottom-2 left-2 text-[9px] font-mono text-brand-on-surface-variant bg-white px-2 py-0.5 rounded shadow">
                    ISO-9001
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AI Copilot Showcase */}
        <section id="solutions" className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1 relative">
              <div className="absolute inset-0 bg-brand-secondary-container/5 blur-[120px] rounded-full"></div>
              
              <div className="relative z-10 space-y-6">
                {/* Chat Bubble 1 */}
                <div className="flex justify-start">
                  <div className="bg-white p-4 rounded-2xl rounded-bl-none shadow-md border border-brand-outline-variant/20 max-w-sm">
                    <p className="text-brand-on-surface font-sans text-sm italic">
                      "Why is excavation productivity below target in Section 2?"
                    </p>
                  </div>
                </div>

                {/* AI Response */}
                <div className="flex justify-end">
                  <div className="glass-panel p-5 rounded-2xl rounded-br-none shadow-xl border-brand-secondary-container/20 max-w-md bg-white">
                    <div className="flex items-center gap-2 mb-3 text-brand-secondary-container">
                      <Bot className="w-4 h-4" />
                      <span className="font-sans text-xs font-bold">Inspecta Copilot</span>
                    </div>
                    <p className="text-brand-on-surface font-sans text-sm leading-relaxed mb-4">
                      Analysis shows a 12% delay due to unexpected soil density in Section 2. Comparing this with your equipment logs, Excavator #402 is under-performing. 
                    </p>
                    <div className="p-3 bg-brand-secondary-container/5 rounded-lg border border-brand-secondary-container/10">
                      <p className="text-[10px] font-bold text-brand-secondary-container uppercase mb-1">Recommended Action</p>
                      <p className="text-xs text-brand-on-surface">Re-sequence backfill from Section 1 to offset labor idle-time. Est. savings: $4,200.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <h2 className="font-display text-3xl md:text-4xl font-extrabold text-brand-primary mb-6 leading-tight">Your Construction Intelligence Partner</h2>
              <p className="font-sans text-sm md:text-base text-brand-on-surface-variant mb-8 leading-relaxed">
                The Inspecta AI Copilot lives across every module, constantly analyzing millions of data points to give you the "Why" behind the "What." It's like having a senior project manager and data scientist in your pocket, 24/7.
              </p>
              
              <ul className="space-y-4">
                {[
                  'Predictive risk identification and mitigation',
                  'Natural language querying of project data',
                  'Automated report generation and distribution'
                ].map((item, idx) => (
                  <li key={idx} className="flex items-center gap-3">
                    <Check className="text-brand-secondary-container w-5 h-5 flex-shrink-0" />
                    <span className="font-sans text-sm font-semibold text-brand-on-surface">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-20 bg-brand-surface-container-highest/20 px-6 md:px-12 border-t border-brand-outline-variant/10">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="font-display text-3xl md:text-4xl font-extrabold text-brand-primary mb-4">Scalable Plans for Every Scale</h2>
              <p className="font-sans text-sm text-brand-on-surface-variant">From specialist subcontractors to global general contractors.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 items-stretch">
              {/* Starter */}
              <div className="bg-white p-8 rounded-2xl border border-brand-outline-variant/30 flex flex-col justify-between hover:shadow-lg transition-all">
                <div>
                  <div className="mb-6">
                    <h3 className="font-display text-lg font-bold text-brand-primary mb-1">Starter</h3>
                    <p className="text-brand-on-surface-variant text-xs">For growing regional teams.</p>
                  </div>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-brand-primary font-mono">$499</span>
                    <span className="text-brand-on-surface-variant text-sm font-semibold">/mo</span>
                  </div>
                  <ul className="space-y-4 mb-8">
                    <li className="flex items-center gap-2 text-xs font-medium text-brand-on-surface">
                      <Check className="text-brand-primary w-4 h-4" /> Up to 5 Active Projects
                    </li>
                    <li className="flex items-center gap-2 text-xs font-medium text-brand-on-surface">
                      <Check className="text-brand-primary w-4 h-4" /> Core ERP Modules
                    </li>
                    <li className="flex items-center gap-2 text-xs text-brand-on-surface-variant/55">
                      <span className="w-4 text-center font-bold">×</span> AI Copilot Insights
                    </li>
                  </ul>
                </div>
                <button 
                  id="btn-starter-get"
                  onClick={() => onNavigate(AppView.LOGIN)}
                  className="w-full py-3 rounded-xl border border-brand-primary text-brand-primary font-semibold text-xs hover:bg-brand-primary/5 transition-all cursor-pointer"
                >
                  Get Started
                </button>
              </div>

              {/* Professional */}
              <div className="bg-white p-8 rounded-2xl border-2 border-brand-secondary-container shadow-xl relative flex flex-col justify-between scale-105 z-10 hover:shadow-2xl transition-all">
                <div className="absolute top-0 right-8 transform -translate-y-1/2 bg-brand-secondary-container text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  Popular
                </div>
                <div>
                  <div className="mb-6">
                    <h3 className="font-display text-lg font-bold text-brand-primary mb-1">Professional</h3>
                    <p className="text-brand-on-surface-variant text-xs">For established GCs and developers.</p>
                  </div>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-brand-primary font-mono">$1,299</span>
                    <span className="text-brand-on-surface-variant text-sm font-semibold">/mo</span>
                  </div>
                  <ul className="space-y-4 mb-8">
                    <li className="flex items-center gap-2 text-xs font-medium text-brand-on-surface">
                      <Check className="text-brand-secondary-container w-4 h-4" /> Unlimited Projects
                    </li>
                    <li className="flex items-center gap-2 text-xs font-bold text-brand-on-surface">
                      <Check className="text-brand-secondary-container w-4 h-4" /> AI Copilot Standard
                    </li>
                    <li className="flex items-center gap-2 text-xs font-medium text-brand-on-surface">
                      <Check className="text-brand-secondary-container w-4 h-4" /> Advanced Analytics
                    </li>
                  </ul>
                </div>
                <button 
                  id="btn-pro-trial"
                  onClick={() => onNavigate(AppView.LOGIN)}
                  className="w-full py-3.5 rounded-xl bg-brand-secondary-container text-white font-bold text-xs shadow-lg shadow-brand-secondary-container/20 hover:bg-brand-secondary hover:translate-y-[-1px] transition-all cursor-pointer"
                >
                  Start Free Trial
                </button>
              </div>

              {/* Enterprise */}
              <div className="bg-brand-primary text-white p-8 rounded-2xl border border-brand-primary flex flex-col justify-between hover:shadow-lg transition-all">
                <div>
                  <div className="mb-6">
                    <h3 className="font-display text-lg font-bold text-brand-on-primary-container mb-1">Enterprise</h3>
                    <p className="text-brand-on-primary-container/70 text-xs">Global infrastructure & complex projects.</p>
                  </div>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white font-mono">Custom</span>
                  </div>
                  <ul className="space-y-4 mb-8">
                    <li className="flex items-center gap-2 text-xs font-medium text-brand-on-primary-container">
                      <Check className="text-brand-on-primary-container w-4 h-4" /> Full Platform White-labeling
                    </li>
                    <li className="flex items-center gap-2 text-xs font-medium text-brand-on-primary-container">
                      <Check className="text-brand-on-primary-container w-4 h-4" /> Custom AI Training
                    </li>
                    <li className="flex items-center gap-2 text-xs font-medium text-brand-on-primary-container">
                      <Check className="text-brand-on-primary-container w-4 h-4" /> Dedicated Success Partner
                    </li>
                  </ul>
                </div>
                <button 
                  id="btn-ent-contact"
                  onClick={onBookDemo}
                  className="w-full py-3 rounded-xl bg-white text-brand-primary font-bold text-xs hover:bg-brand-surface-container-high transition-all cursor-pointer"
                >
                  Contact Sales
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="py-24 bg-brand-primary relative overflow-hidden px-6 md:px-12 text-center text-white">
          <div className="max-w-4xl mx-auto relative z-10">
            <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-extrabold mb-6">Build More. Waste Less. Earn More.</h2>
            <p className="font-sans text-sm md:text-base text-brand-on-primary-container mb-10 max-w-xl mx-auto">
              Join the digital transformation of construction. Start your journey with Inspecta AI today.
            </p>
            <button 
              id="btn-cta-personalized"
              onClick={onBookDemo}
              className="px-8 py-4 rounded-xl bg-brand-secondary-container text-white font-bold text-sm shadow-2xl hover:scale-105 transition-all cursor-pointer"
            >
              Request a Personalized Demo
            </button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-12 bg-white border-t border-brand-outline-variant">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col items-center md:items-start gap-2">
            <span className="font-display text-xl font-bold text-brand-primary">Inspecta AI</span>
            <p className="font-sans text-xs text-brand-on-surface-variant">© 2026 Inspecta AI. All rights reserved.</p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4 text-xs font-medium text-brand-on-surface-variant">
            <a href="#features" className="hover:text-brand-primary transition-all">Product</a>
            <a href="#solutions" className="hover:text-brand-primary transition-all">Solutions</a>
            <a href="#pricing" className="hover:text-brand-primary transition-all">Pricing</a>
            <a href="#safety" className="hover:text-brand-primary transition-all">Safety</a>
            <a href="#support" className="hover:text-brand-primary transition-all">Support</a>
          </div>
          
          <div className="flex gap-4">
            <button 
              id="footer-share"
              className="w-10 h-10 rounded-full border border-brand-outline-variant flex items-center justify-center text-brand-on-surface-variant hover:border-brand-primary hover:text-brand-primary transition-all"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <button 
              id="footer-language"
              className="w-10 h-10 rounded-full border border-brand-outline-variant flex items-center justify-center text-brand-on-surface-variant hover:border-brand-primary hover:text-brand-primary transition-all"
            >
              <Globe className="w-4 h-4" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
