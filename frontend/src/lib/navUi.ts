import { NAV_PARENT } from '../components/ErpLayout';

/**
 * Which sidebar categories are expanded. Kept outside React (and mirrored to
 * localStorage) so the state survives navigation and can be driven from
 * anywhere — the onboarding tour reveals a collapsed category before it tries
 * to spotlight a nav item inside it.
 */
const KEY = 'inspecta.nav.groups.v1';

type OpenMap = Record<string, boolean>;

function load(): OpenMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OpenMap) : {};
  } catch {
    return {};
  }
}

let open: OpenMap = load();
const listeners = new Set<() => void>();

export function subscribeOpenGroups(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getOpenGroups(): OpenMap {
  return open;
}

/** Returns true when this actually changed the state (used to trigger a re-measure). */
export function setGroupOpen(groupId: string, value: boolean): boolean {
  if (!!open[groupId] === value) return false;
  open = { ...open, [groupId]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(open));
  } catch {
    // Private mode / quota — expansion still works for this session.
  }
  listeners.forEach((fn) => fn());
  return true;
}

export function toggleGroup(groupId: string) {
  setGroupOpen(groupId, !open[groupId]);
}

/** Expands the category containing `navId`, if any. Returns true if it opened one. */
export function revealNav(navId: string): boolean {
  const parent = NAV_PARENT[navId];
  return parent ? setGroupOpen(parent, true) : false;
}
