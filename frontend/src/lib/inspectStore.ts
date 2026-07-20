/**
 * "Inspect mode" — the tenant a platform admin is currently viewing.
 *
 * Kept outside React (and mirrored to localStorage, like nav state) because two
 * very different consumers need it: the API client, which must stamp the
 * `X-Platform-Org` header onto every request, and the auth context, which
 * downgrades write permissions while it is set. A React-only context would
 * force one of them to reach into the other.
 *
 * The server is the real enforcement point — it rejects any non-GET while the
 * header is present. This store only drives the UI.
 */
const KEY = 'inspecta.inspectOrg.v1';

export interface InspectedOrg {
  id: string;
  name: string;
  slug: string;
}

function load(): InspectedOrg | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as InspectedOrg) : null;
  } catch {
    return null;
  }
}

let current: InspectedOrg | null = load();
const listeners = new Set<() => void>();

export function subscribeInspect(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getInspectedOrg(): InspectedOrg | null {
  return current;
}

function commit(next: InspectedOrg | null) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode / quota — inspect mode still works for this session.
  }
  listeners.forEach((fn) => fn());
}

export function enterInspect(org: InspectedOrg) {
  commit(org);
}

export function exitInspect() {
  commit(null);
}
