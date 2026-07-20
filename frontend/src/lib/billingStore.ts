/**
 * The tenant's current subscription state, kept outside React for the same
 * reason as inspect state: the auth context needs it to withhold write
 * permissions once a workspace goes read-only, and the shell needs it to render
 * the banner. The server is the real enforcement point (402 on writes) — this
 * only stops the UI offering buttons that would fail.
 */
export type BillingStatus = 'EXEMPT' | 'TRIAL' | 'ACTIVE' | 'GRACE' | 'LAPSED';

export interface BillingState {
  plan: string;
  planLabel: string;
  status: BillingStatus;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  graceDaysRemaining: number | null;
  readOnly: boolean;
  warn: boolean;
  message: string | null;
}

let current: BillingState | null = null;
const listeners = new Set<() => void>();

export function subscribeBilling(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getBillingState(): BillingState | null {
  return current;
}

export function setBillingState(next: BillingState | null) {
  // Reference equality matters: useSyncExternalStore re-renders on every change,
  // and this is refreshed on a poll.
  if (current === next) return;
  if (current && next && current.status === next.status && current.readOnly === next.readOnly && current.message === next.message) {
    return;
  }
  current = next;
  listeners.forEach((fn) => fn());
}
