import React from 'react';
import { Link } from 'react-router-dom';
import { Lock, Compass } from 'lucide-react';
import { AppView } from '../types';
import { useAuth } from '../lib/auth';
import ErpLayout, { NAV } from './ErpLayout';

/**
 * Standard screens (T1-08, T1-09): one "no access" message on every blocked page (never an empty
 * shell with 403s in the console) and a real "Page not found" for unknown addresses.
 */
export const NO_ACCESS_TEXT = 'You do not have access to this page. Ask your company administrator if you need it for your work.';

export function NoAccessPanel({ what }: { what?: string }) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-10 text-center">
      <Lock className="mx-auto mb-3 h-8 w-8 text-brand-on-surface-variant" />
      <p className="font-bold text-brand-primary">No access{what ? ` to ${what}` : ''}</p>
      <p className="mt-2 text-xs text-brand-on-surface-variant">{NO_ACCESS_TEXT}</p>
      <Link to="/dashboard" className="mt-4 inline-block rounded-lg bg-brand-primary px-4 py-2 text-xs font-bold text-white">Back to the dashboard</Link>
    </div>
  );
}

export function NoAccessPage({ view, title, onNavigate, onLogout }: { view: AppView; title: string; onNavigate: (v: AppView) => void; onLogout: () => void }) {
  return (
    <ErpLayout active={view} title={title} subtitle="No access" onNavigate={onNavigate} onLogout={onLogout}>
      <NoAccessPanel what={title} />
    </ErpLayout>
  );
}

/** Wraps a page: shows the standard message when the user lacks the page's permission (from the sidebar table). */
export function Guard({ view, onNavigate, onLogout, children }: { view: AppView; onNavigate: (v: AppView) => void; onLogout: () => void; children: React.ReactElement }) {
  const { hasPermission } = useAuth();
  const item = NAV.find((n) => n.view === view);
  if (item?.perm && !hasPermission(item.perm)) return <NoAccessPage view={view} title={item.label} onNavigate={onNavigate} onLogout={onLogout} />;
  return children;
}

export function NotFoundPage() {
  const { user } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-surface p-6">
      <div className="max-w-md rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-10 text-center">
        <Compass className="mx-auto mb-3 h-8 w-8 text-brand-on-surface-variant" />
        <h1 className="font-bold text-brand-primary">Page not found</h1>
        <p className="mt-2 text-xs text-brand-on-surface-variant">There is no page at <span className="font-mono">{typeof window !== 'undefined' ? window.location.pathname : ''}</span>. Check the address, or use the menu.</p>
        <Link to={user ? '/dashboard' : '/'} className="mt-4 inline-block rounded-lg bg-brand-primary px-4 py-2 text-xs font-bold text-white">{user ? 'Go to the dashboard' : 'Go to the home page'}</Link>
      </div>
    </div>
  );
}

/** Placeholder block shown until a request finishes, so no figure reads 0 or "No data" before it is known. */
export function Skeleton({ className = 'h-6 w-24' }: { className?: string }) {
  return <span aria-busy="true" aria-label="Loading" className={`inline-block animate-pulse rounded bg-brand-surface-container-high/70 ${className}`} />;
}
