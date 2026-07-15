import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HardHat, Bot, Bell, Search, LogOut, Menu, X, HelpCircle, ChevronRight } from 'lucide-react';
import { AppView } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useViewNavigate, viewForPath } from '../lib/routes';
import { getOpenGroups, revealNav, subscribeOpenGroups, toggleGroup } from '../lib/navUi';
import { NAV_TREE, NavItem, isGroup } from './ErpLayout';
import ThemeToggle from './ThemeToggle';
import OnboardingTour from './OnboardingTour';

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
function roleLabel(role?: string) {
  if (!role) return 'User';
  return role.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Chrome props handed to every shell child route via <Outlet context>. Keeps the
// pages' existing `onNavigate`/`onLogout` prop contract intact.
export interface ShellChrome {
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

function NavLink({ item, active, nested, onSelect }: {
  item: NavItem;
  active: boolean;
  nested?: boolean;
  onSelect: (view: AppView) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      id={item.id}
      onClick={() => onSelect(item.view)}
      className={`w-full flex items-center gap-3 py-2.5 rounded-lg transition-all text-xs text-left ${nested ? 'pl-8 pr-4' : 'px-4'} ${
        active
          ? 'text-white border-l-4 border-brand-secondary-container bg-white/10 font-semibold'
          : 'text-brand-on-primary-container/85 hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-brand-secondary-container' : ''}`} />
      <span>{item.label}</span>
    </button>
  );
}

function Sidebar({ open, onClose, onLogout }: { open: boolean; onClose: () => void; onLogout: () => void }) {
  const { hasPermission } = useAuth();
  const navigateView = useViewNavigate();
  const location = useLocation();
  const active = viewForPath(location.pathname);
  const openGroups = useSyncExternalStore(subscribeOpenGroups, getOpenGroups);

  const visible = (item: NavItem) => !item.perm || hasPermission(item.perm);

  // Keep the category holding the current page open, so a fresh session (or a
  // deep link into a collapsed category) never hides where the user actually is.
  const activeItemId = NAV_TREE.flatMap((e) => (isGroup(e) ? e.children : [e])).find((i) => i.view === active)?.id;
  useEffect(() => {
    if (activeItemId) revealNav(activeItemId);
  }, [activeItemId]);

  const go = (view: AppView) => {
    navigateView(view);
    onClose();
  };

  return (
    <>
      {/* Mobile drawer backdrop */}
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} />}

      <aside
        className={`w-64 h-screen fixed lg:sticky top-0 left-0 bg-brand-nav border-r border-brand-outline-variant flex flex-col justify-between py-4 shadow-md z-50 shrink-0 transition-transform duration-300 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <button
          onClick={onClose}
          className="lg:hidden absolute top-3 right-3 p-1.5 rounded-lg text-white/80 hover:bg-white/10"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex flex-col gap-6">
          <div className="px-6 py-2 flex items-center gap-3 cursor-pointer" onClick={() => go(AppView.DASHBOARD)}>
            <div className="w-10 h-10 rounded-xl bg-brand-secondary-container flex items-center justify-center shadow-lg shadow-brand-secondary-container/20">
              <HardHat className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-white leading-none">Inspecta AI</h1>
              <p className="text-brand-on-primary-container text-[10px] uppercase font-bold tracking-widest mt-1">Construction ERP</p>
            </div>
          </div>

          <nav className="px-3 space-y-1 overflow-y-auto custom-scrollbar max-h-[calc(100vh-180px)]">
            {NAV_TREE.map((entry) => {
              if (!isGroup(entry)) {
                return visible(entry)
                  ? <NavLink key={entry.id} item={entry} active={entry.view === active} onSelect={go} />
                  : null;
              }

              const children = entry.children.filter(visible);
              if (children.length === 0) return null;

              const Icon = entry.icon;
              const expanded = !!openGroups[entry.id];
              const hasActive = children.some((c) => c.view === active);

              return (
                <div key={entry.id}>
                  <button
                    id={entry.id}
                    onClick={() => toggleGroup(entry.id)}
                    aria-expanded={expanded}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all text-xs text-left ${
                      hasActive && !expanded
                        ? 'text-white bg-white/10 font-semibold'
                        : 'text-brand-on-primary-container/85 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${hasActive ? 'text-brand-secondary-container' : ''}`} />
                    <span className="flex-1">{entry.label}</span>
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
                  </button>

                  {expanded && (
                    <div className="mt-1 space-y-1 border-l border-brand-on-primary-container/15 ml-5">
                      {children.map((c) => (
                        <NavLink key={c.id} item={c} active={c.view === active} nested onSelect={go} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="px-4 py-2 space-y-3">
          <div className="h-[1px] bg-brand-on-primary-container/20 my-2" />
          <div className="flex items-center justify-between text-brand-on-primary-container/70 text-xs px-2">
            <button className="flex items-center gap-2 hover:text-white transition-all text-[11px] font-bold" onClick={onLogout}>
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
            <span className="text-[9px] font-mono opacity-60">V3.14-AI</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function TopHeader({ onOpenSidebar, onStartTour }: { onOpenSidebar: () => void; onStartTour: () => void }) {
  const { user } = useAuth();
  const navigateView = useViewNavigate();

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 20_000,
  });
  const unreadCount = unread?.data.count ?? 0;

  return (
    <header className="h-16 w-full sticky top-0 z-40 bg-brand-surface-container-lowest/90 backdrop-blur-md flex justify-between items-center px-6 md:px-8 border-b border-brand-outline-variant/10 shadow-sm">
      <div className="flex items-center gap-3 flex-1">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden p-2 -ml-1 rounded-lg text-brand-primary hover:bg-brand-surface shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="relative max-w-md w-full hidden md:block">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-on-surface-variant w-4 h-4" />
          <input
            type="text"
            placeholder="Search..."
            className="w-full pl-10 pr-4 py-2 bg-brand-surface border-none rounded-lg focus:ring-2 focus:ring-brand-primary/10 text-xs outline-none font-medium"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          id="tour-ask-ai"
          onClick={() => navigateView(AppView.COPILOT)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-primary/5 text-brand-primary font-bold text-xs hover:bg-brand-primary/10 transition-all border border-brand-primary/10 cursor-pointer"
        >
          <Bot className="w-4 h-4 text-brand-secondary-container" />
          <span className="hidden sm:inline">Ask AI</span>
        </button>

        <button
          id="tour-help"
          onClick={onStartTour}
          className="p-2 rounded-full hover:bg-brand-surface transition-colors text-brand-on-surface-variant"
          aria-label="Take the product tour"
          title="Take the product tour"
        >
          <HelpCircle className="w-4.5 h-4.5" />
        </button>

        <ThemeToggle />

        <button
          id="tour-notifications"
          onClick={() => navigateView(AppView.NOTIFICATIONS)}
          className="p-2 rounded-full hover:bg-brand-surface transition-colors relative"
          aria-label="Notifications"
        >
          <Bell className="w-4.5 h-4.5 text-brand-on-surface-variant" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-brand-status-critical text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        <div className="h-6 w-[1px] bg-brand-outline-variant/30" />

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-brand-on-surface">{user?.fullName ?? 'User'}</p>
            <p className="text-[9px] text-brand-on-surface-variant uppercase font-bold tracking-widest">{roleLabel(user?.role)}</p>
          </div>
          <div className="w-10 h-10 rounded-full border-2 border-brand-primary-container/20 bg-brand-primary flex items-center justify-center text-white font-bold text-sm">
            {user ? initials(user.fullName) : '··'}
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * Persistent application chrome. The sidebar and header mount exactly once and
 * stay put; only the routed page content (the <Outlet/>) animates on navigation,
 * so the sidebar no longer flashes/re-animates when switching pages.
 */
export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const navigateView = useViewNavigate();
  const { logout, user } = useAuth();

  // First-run walkthrough: auto-start once per user (until they finish/skip it).
  const tourKey = user ? `inspecta.tour.v1.${user.id}` : null;
  useEffect(() => {
    if (!tourKey) return;
    if (localStorage.getItem(tourKey)) return;
    const t = setTimeout(() => setTourOpen(true), 900); // let the shell settle first
    return () => clearTimeout(t);
  }, [tourKey]);

  const closeTour = () => {
    setTourOpen(false);
    if (tourKey) localStorage.setItem(tourKey, 'done');
  };
  const startTour = () => {
    setSidebarOpen(false);
    setTourOpen(true);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const chrome: ShellChrome = { onNavigate: navigateView, onLogout: handleLogout };

  return (
    <div className="min-h-screen bg-brand-surface text-brand-on-surface font-sans flex" id="erp-root">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <TopHeader onOpenSidebar={() => setSidebarOpen(true)} onStartTour={startTour} />

        {/* Only the page content animates — the chrome above is untouched. */}
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <Outlet context={chrome} />
          </motion.div>
        </AnimatePresence>
      </div>

      <OnboardingTour open={tourOpen} onClose={closeTour} />
    </div>
  );
}
