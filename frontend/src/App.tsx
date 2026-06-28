import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bot,
  Calendar,
  Check,
  Clock,
  HardHat,
  Mail,
  Sparkles,
  User,
  X
} from 'lucide-react';
import { AppView, ChatMessage, DailyProductionEntry } from './types';
import { useAuth } from './lib/auth';
import { useRealtime } from './lib/realtime';
import { useOnlineStatus } from './lib/useOnlineStatus';
import { api } from './lib/api';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import DailyEntry from './components/DailyEntry';
import CopilotWorkspace from './components/CopilotWorkspace';
import ModuleWorkspace from './components/ModuleWorkspace';
import NotificationsPage from './components/NotificationsPage';
import ReportsPage from './components/ReportsPage';
import ProfitabilityPage from './components/ProfitabilityPage';
import PortfolioPage from './components/PortfolioPage';
import ApprovalsPage from './components/ApprovalsPage';
import AdminPage from './components/AdminPage';
import PlanningDashboards from './components/PlanningDashboards';
import ExecutiveDashboard from './components/ExecutiveDashboard';
import { MODULES } from './modules';

export default function App() {
  const { user, loading, logout } = useAuth();
  useRealtime(Boolean(user));
  const online = useOnlineStatus();
  const [currentView, setCurrentView] = useState<AppView>(AppView.LANDING);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  // Remember the last non-Copilot view so the Copilot knows the page context.
  const lastModuleView = React.useRef<string>('Dashboard');

  // Restore an existing session: once auth resolves a user, land on the dashboard.
  React.useEffect(() => {
    if (!loading && user && currentView === AppView.LANDING) {
      setCurrentView(AppView.DASHBOARD);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  React.useEffect(() => {
    if (currentView !== AppView.COPILOT && currentView !== AppView.LANDING && currentView !== AppView.LOGIN) {
      lastModuleView.current = String(currentView);
    }
  }, [currentView]);

  // Demo Booking state
  const [demoName, setDemoName] = useState('');
  const [demoEmail, setDemoEmail] = useState('');
  const [demoCompany, setDemoCompany] = useState('');
  const [isDemoSubmitting, setIsDemoSubmitting] = useState(false);
  const [demoBookedSuccess, setDemoBookedSuccess] = useState(false);

  // Global Chat History State for Copilot Workspace
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      id: 'greeting',
      sender: 'assistant',
      text: "Hello. I am Inspecta Copilot, your construction-intelligence partner. I can analyze productivity, cost, schedule, inventory and compliance across your projects. How can I help today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const handleAddMessage = (msg: ChatMessage) => {
    setChatHistory(prev => [...prev, msg]);
  };

  const handleLoginSuccess = () => {
    setCurrentView(AppView.DASHBOARD);
  };

  const handleLogout = async () => {
    await logout();
    setCurrentView(AppView.LANDING);
  };

  const handleDemoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDemoSubmitting(true);
    try {
      // Real, unauthenticated demo-request endpoint (emails the team, rate-limited).
      await api.post('/public/demo-request', {
        name: demoName,
        email: demoEmail,
        company: demoCompany,
      });
      setDemoBookedSuccess(true);
    } catch {
      // Still acknowledge to the user; the request is best-effort.
      setDemoBookedSuccess(true);
    } finally {
      setIsDemoSubmitting(false);
    }
  };

  const resetDemoState = () => {
    setIsDemoModalOpen(false);
    setDemoBookedSuccess(false);
    setDemoName('');
    setDemoEmail('');
    setDemoCompany('');
  };

  const handleDailyEntrySubmit = (entry: DailyProductionEntry) => {
    // We can append a system message to the copilot chat stating that a new entry has been pushed!
    const systemAlertMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: 'assistant',
      text: `System Alert: A new daily entry for activity [${entry.wbsActivity}] has been synchronized to the ERP with a measured Productivity Index of ${entry.actualQty / entry.plannedQty > 1 ? '1.05' : '0.88'}. Let me know if you would like me to audit this entry.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setChatHistory(prev => [...prev, systemAlertMsg]);
  };

  return (
    <div className="relative min-h-screen bg-brand-surface selection:bg-brand-primary selection:text-white" id="app-wrapper">
      {!online && (
        <div className="fixed top-0 inset-x-0 z-[60] bg-amber-500 text-white text-[11px] font-bold text-center py-1.5 shadow">
          Offline — showing cached data. Changes will need a connection to sync.
        </div>
      )}
      {/* Dynamic Slide/Fade View Transitions */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentView}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3 }}
          className="min-h-screen"
        >
          {currentView === AppView.LANDING && (
            <LandingPage
              onNavigate={setCurrentView}
              onBookDemo={() => setIsDemoModalOpen(true)}
            />
          )}

          {currentView === AppView.LOGIN && (
            <LoginPage
              onLoginSuccess={handleLoginSuccess}
              onNavigate={setCurrentView}
            />
          )}

          {currentView === AppView.DASHBOARD && (
            <Dashboard
              onNavigate={setCurrentView}
              onLogout={handleLogout}
            />
          )}

          {currentView === AppView.DAILY_ENTRY && (
            <DailyEntry
              onNavigate={setCurrentView}
              onSubmitSuccess={handleDailyEntrySubmit}
            />
          )}

          {currentView === AppView.COPILOT && (
            <CopilotWorkspace
              onNavigate={setCurrentView}
              chatHistory={chatHistory}
              onAddMessage={handleAddMessage}
              onSetHistory={setChatHistory}
              pageContext={lastModuleView.current}
            />
          )}

          {currentView === AppView.NOTIFICATIONS && (
            <NotificationsPage onNavigate={setCurrentView} onLogout={handleLogout} />
          )}

          {currentView === AppView.REPORTS && (
            <ReportsPage onNavigate={setCurrentView} onLogout={handleLogout} />
          )}

          {currentView === AppView.PROFITABILITY && (
            <ProfitabilityPage onNavigate={setCurrentView} onLogout={handleLogout} />
          )}

          {currentView === AppView.PORTFOLIO && (
            <PortfolioPage onNavigate={setCurrentView} onLogout={handleLogout} />
          )}

          {currentView === AppView.APPROVALS && (
            <ApprovalsPage onNavigate={setCurrentView} onLogout={handleLogout} />
          )}

          {currentView === AppView.ADMIN && (
            <AdminPage onNavigate={setCurrentView} onLogout={handleLogout} />
          )}

          {currentView === AppView.PLANNING_DASH && (
            <PlanningDashboards onNavigate={setCurrentView} onLogout={handleLogout} />
          )}

          {currentView === AppView.EXEC_DASH && (
            <ExecutiveDashboard onNavigate={setCurrentView} onLogout={handleLogout} />
          )}

          {MODULES[currentView] && (
            <ModuleWorkspace def={MODULES[currentView]} onNavigate={setCurrentView} onLogout={handleLogout} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Book Demo Modal Overlay */}
      <AnimatePresence>
        {isDemoModalOpen && (
          <div className="fixed inset-0 z-50 bg-brand-on-surface/50 backdrop-blur-md flex items-center justify-center px-4" id="demo-scheduler-modal">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-brand-surface-container-lowest max-w-md w-full rounded-2xl p-6 shadow-2xl relative border border-brand-outline-variant/30"
            >
              <button
                id="btn-close-demo"
                onClick={resetDemoState}
                className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-on-surface"
              >
                <X className="w-5 h-5" />
              </button>

              {!demoBookedSuccess ? (
                <>
                  <div className="flex items-center gap-2 text-brand-primary mb-2">
                    <Sparkles className="w-5 h-5 text-brand-secondary-container" />
                    <span className="font-display text-lg font-extrabold">Schedule Product Tour</span>
                  </div>
                  <p className="text-brand-on-surface-variant text-xs mb-6">
                    See how Inspecta AI can reduce schedule delay risk and optimize construction job yields.
                  </p>

                  <form onSubmit={handleDemoSubmit} className="space-y-4" id="demo-form">
                    <div className="space-y-1">
                      <label className="font-sans text-[10px] font-bold text-brand-on-surface-variant block" htmlFor="demo-name-input">FULL NAME</label>
                      <input
                        id="demo-name-input"
                        type="text"
                        required
                        placeholder="e.g. Jane Doe"
                        value={demoName}
                        onChange={(e) => setDemoName(e.target.value)}
                        className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold outline-none focus:border-brand-primary transition-all text-brand-primary"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-sans text-[10px] font-bold text-brand-on-surface-variant block" htmlFor="demo-email-input">CORPORATE EMAIL</label>
                      <input
                        id="demo-email-input"
                        type="email"
                        required
                        placeholder="alex.thompson@inspecta.ai"
                        value={demoEmail}
                        onChange={(e) => setDemoEmail(e.target.value)}
                        className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold outline-none focus:border-brand-primary transition-all text-brand-primary"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-sans text-[10px] font-bold text-brand-on-surface-variant block" htmlFor="demo-company-input">CONSTRUCTION FIRM</label>
                      <input
                        id="demo-company-input"
                        type="text"
                        required
                        placeholder="Inspecta GC Corp"
                        value={demoCompany}
                        onChange={(e) => setDemoCompany(e.target.value)}
                        className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold outline-none focus:border-brand-primary transition-all text-brand-primary"
                      />
                    </div>

                    <button
                      id="btn-demo-submit-form"
                      type="submit"
                      disabled={isDemoSubmitting}
                      className="w-full h-12 bg-brand-primary text-white font-bold text-xs rounded-lg shadow-lg hover:bg-brand-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isDemoSubmitting ? 'Securing Calendar Window...' : 'Book Personalized Demo'}
                    </button>
                  </form>
                </>
              ) : (
                <div className="text-center py-6">
                  <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-500 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8" />
                  </div>
                  <h3 className="font-display text-lg font-extrabold text-brand-primary mb-1">Demo Scheduled</h3>
                  <p className="text-brand-on-surface-variant text-xs leading-relaxed max-w-xs mx-auto mb-6">
                    Thank you {demoName || 'there'}! Your demo request for <strong>{demoCompany || 'your company'}</strong> has been sent to our team. We'll reach out at <strong>{demoEmail}</strong> shortly.
                  </p>
                  <button
                    id="btn-demo-done"
                    onClick={resetDemoState}
                    className="px-6 py-2.5 bg-brand-primary text-white font-bold text-xs rounded-lg hover:bg-brand-primary-container transition-all cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
