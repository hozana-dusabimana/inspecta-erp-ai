import React, { useState } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate, useOutletContext } from 'react-router-dom';
import { AppView, DailyProductionEntry } from './types';
import { useAuth } from './lib/auth';
import { useRealtime } from './lib/realtime';
import { useOnlineStatus } from './lib/useOnlineStatus';
import { useViewNavigate, pathForView } from './lib/routes';
import { ChatProvider, useChat } from './lib/chat';
import LandingPage from './components/LandingPage';
import AboutPage from './components/marketing/About';
import ServicePage from './components/marketing/ServicePage';
import InspectaErpPage from './components/marketing/InspectaErp';
import TeamPage from './components/marketing/Team';
import ContactPage from './components/marketing/Contact';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import VerifyEmailPage from './components/VerifyEmailPage';
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
import PlatformConsole from './components/PlatformConsole';
import PlanningDashboards from './components/PlanningDashboards';
import ExecutiveDashboard from './components/ExecutiveDashboard';
import AppShell, { ShellChrome } from './components/AppShell';
import BookDemoModal from './components/BookDemoModal';
import { MODULES } from './modules';

/**
 * Supplies the shell-provided chrome props ({onNavigate, onLogout}) to a page so
 * the existing page prop contracts keep working unchanged under the router. Pages
 * live inside <AppShell>, which exposes chrome via <Outlet context>.
 */
function Chromed({ render }: { render: (chrome: ShellChrome) => React.ReactElement }) {
  const chrome = useOutletContext<ShellChrome>();
  return render(chrome);
}

// Gate every authenticated route behind a resolved session.
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-surface text-brand-on-surface-variant text-sm font-semibold">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/**
 * Where a signed-in user belongs. A platform admin runs the platform, so their
 * home is the console — not one company's dashboard.
 */
function homePath(user: { isPlatformAdmin?: boolean } | null): string {
  return user?.isPlatformAdmin ? '/platform' : '/dashboard';
}

function LandingRoute() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to={homePath(user)} replace />;
  return <LandingPage />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const navigateView = useViewNavigate();
  if (!loading && user) return <Navigate to={homePath(user)} replace />;
  return <LoginPage onLoginSuccess={() => navigate('/')} onNavigate={navigateView} />;
}

function SignupRoute() {
  const { user, loading } = useAuth();
  const navigateView = useViewNavigate();
  if (!loading && user) return <Navigate to={homePath(user)} replace />;
  return <SignupPage onNavigate={navigateView} />;
}

// Copilot + Daily Entry are standalone full-screen pages (their own header, no
// sidebar), so they render directly — not inside the AppShell chrome.
function CopilotRoute() {
  const navigateView = useViewNavigate();
  const { chatHistory, addMessage, setHistory, pageContext } = useChat();
  return (
    <CopilotWorkspace
      onNavigate={navigateView}
      chatHistory={chatHistory}
      onAddMessage={addMessage}
      onSetHistory={setHistory}
      pageContext={pageContext}
    />
  );
}

function DailyEntryRoute() {
  const navigateView = useViewNavigate();
  const { addMessage } = useChat();
  const handleSubmitSuccess = (entry: DailyProductionEntry) => {
    addMessage({
      id: Math.random().toString(),
      sender: 'assistant',
      text: `System Alert: A new daily entry for activity [${entry.wbsActivity}] has been synchronized to the ERP with a measured Productivity Index of ${entry.actualQty / entry.plannedQty > 1 ? '1.05' : '0.88'}. Let me know if you would like me to audit this entry.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  };
  return <DailyEntry onNavigate={navigateView} onSubmitSuccess={handleSubmitSuccess} />;
}

export default function App() {
  const { user } = useAuth();
  useRealtime(Boolean(user));
  const online = useOnlineStatus();

  return (
    <ChatProvider>
      {!online && (
        <div className="fixed top-0 inset-x-0 z-[60] bg-amber-500 text-white text-[11px] font-bold text-center py-1.5 shadow">
          Offline — showing cached data. Changes will need a connection to sync.
        </div>
      )}

      <Routes>
        <Route path="/" element={<LandingRoute />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/signup" element={<SignupRoute />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        {/* Public marketing site */}
        <Route path="/about" element={<AboutPage />} />
        <Route path="/services/:slug" element={<ServicePage />} />
        <Route path="/inspecta-erp" element={<InspectaErpPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/contact" element={<ContactPage />} />

        <Route element={<RequireAuth />}>
          {/* Full-screen pages (own chrome) */}
          <Route path="/copilot" element={<CopilotRoute />} />
          <Route path="/daily-entry" element={<DailyEntryRoute />} />

          {/* Pages that share the persistent sidebar + header */}
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<Chromed render={(c) => <Dashboard {...c} />} />} />
            <Route path="/executive" element={<Chromed render={(c) => <ExecutiveDashboard {...c} />} />} />
            <Route path="/portfolio" element={<Chromed render={(c) => <PortfolioPage {...c} />} />} />
            <Route path="/planning-dashboards" element={<Chromed render={(c) => <PlanningDashboards {...c} />} />} />
            <Route path="/profitability" element={<Chromed render={(c) => <ProfitabilityPage {...c} />} />} />
            <Route path="/reports" element={<Chromed render={(c) => <ReportsPage {...c} />} />} />
            <Route path="/approvals" element={<Chromed render={(c) => <ApprovalsPage {...c} />} />} />
            <Route path="/notifications" element={<Chromed render={(c) => <NotificationsPage {...c} />} />} />
            <Route path="/admin" element={<Chromed render={(c) => <AdminPage {...c} />} />} />
            <Route path="/platform" element={<Chromed render={(c) => <PlatformConsole tab="overview" {...c} />} />} />
            <Route path="/platform/companies" element={<Chromed render={(c) => <PlatformConsole tab="companies" {...c} />} />} />
            <Route path="/platform/users" element={<Chromed render={(c) => <PlatformConsole tab="users" {...c} />} />} />
            <Route path="/platform/projects" element={<Chromed render={(c) => <PlatformConsole tab="projects" {...c} />} />} />
            <Route path="/platform/watchlist" element={<Chromed render={(c) => <PlatformConsole tab="watchlist" {...c} />} />} />
            <Route path="/platform/finance" element={<Chromed render={(c) => <PlatformConsole tab="finance" {...c} />} />} />
            <Route path="/platform/adoption" element={<Chromed render={(c) => <PlatformConsole tab="adoption" {...c} />} />} />
            <Route path="/platform/audit" element={<Chromed render={(c) => <PlatformConsole tab="audit" {...c} />} />} />
            <Route path="/platform/settings" element={<Chromed render={(c) => <PlatformConsole tab="settings" {...c} />} />} />
            {Object.values(MODULES).map((def) => (
              <Route
                key={def.view}
                path={pathForView(def.view)}
                element={<Chromed render={(c) => <ModuleWorkspace def={def} {...c} />} />}
              />
            ))}
          </Route>
        </Route>

        {/* Unknown URL → send authed users to the dashboard, guests to login. */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ChatProvider>
  );
}
