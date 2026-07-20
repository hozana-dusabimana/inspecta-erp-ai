import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppView } from '../types';

// Single source of truth mapping each in-app view to a real URL path. The
// router (App.tsx) builds <Route>s from these, and useViewNavigate() lets the
// existing `onNavigate(AppView.X)` call sites drive the URL instead of state.
export const VIEW_TO_PATH: Record<AppView, string> = {
  [AppView.LANDING]: '/',
  [AppView.LOGIN]: '/login',
  [AppView.SIGNUP]: '/signup',
  [AppView.VERIFY_EMAIL]: '/verify-email',
  [AppView.DASHBOARD]: '/dashboard',
  [AppView.EXEC_DASH]: '/executive',
  [AppView.PORTFOLIO]: '/portfolio',
  [AppView.PLANNING]: '/planning',
  [AppView.HR]: '/human-resources',
  [AppView.PAYROLL]: '/payroll',
  [AppView.POS]: '/point-of-sale',
  [AppView.EQUIPMENT]: '/equipment',
  [AppView.PLANNING_DASH]: '/planning-dashboards',
  [AppView.SCHEDULING]: '/scheduling',
  [AppView.PRODUCTION]: '/production',
  [AppView.FIELDOPS]: '/field-ops',
  [AppView.FINANCE]: '/finance',
  [AppView.PROFITABILITY]: '/profitability',
  [AppView.INVENTORY]: '/inventory',
  [AppView.PROCUREMENT]: '/procurement',
  [AppView.QAQC]: '/qaqc',
  [AppView.HSE]: '/hse',
  [AppView.RISK]: '/risk',
  [AppView.APPROVALS]: '/approvals',
  [AppView.DOCUMENTS]: '/documents',
  [AppView.REPORTS]: '/reports',
  [AppView.COPILOT]: '/copilot',
  [AppView.NOTIFICATIONS]: '/notifications',
  [AppView.DAILY_ENTRY]: '/daily-entry',
  [AppView.ADMIN]: '/admin',
  [AppView.BILLING]: '/billing',
  [AppView.PLATFORM]: '/platform',
  [AppView.PLATFORM_COMPANIES]: '/platform/companies',
  [AppView.PLATFORM_USERS]: '/platform/users',
  [AppView.PLATFORM_PROJECTS]: '/platform/projects',
  [AppView.PLATFORM_WATCHLIST]: '/platform/watchlist',
  [AppView.PLATFORM_FINANCE]: '/platform/finance',
  [AppView.PLATFORM_ADOPTION]: '/platform/adoption',
  [AppView.PLATFORM_AUDIT]: '/platform/audit',
  [AppView.PLATFORM_SETTINGS]: '/platform/settings',
  [AppView.PLATFORM_SUBSCRIPTIONS]: '/platform/subscriptions',
};

export const PATH_TO_VIEW: Record<string, AppView> = Object.fromEntries(
  Object.entries(VIEW_TO_PATH).map(([view, path]) => [path, view as AppView]),
) as Record<string, AppView>;

export function pathForView(view: AppView): string {
  return VIEW_TO_PATH[view] ?? '/dashboard';
}

export function viewForPath(pathname: string): AppView | undefined {
  return PATH_TO_VIEW[pathname];
}

/**
 * Drop-in replacement for the old `onNavigate(view)` callback that now pushes a
 * real URL. Components keep calling `onNavigate(AppView.X)` unchanged.
 */
export function useViewNavigate() {
  const navigate = useNavigate();
  return useCallback((view: AppView) => navigate(pathForView(view)), [navigate]);
}
