import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * The project the user is working on, shared by every page (picker in the header,
 * module pages, reports, daily entry, planning dashboards). Remembered across
 * pages and reloads; empty string = all projects.
 */
const KEY = 'inspecta.selectedProject';

interface Ctx { projectId: string; setProjectId: (id: string) => void }
const CurrentProjectContext = createContext<Ctx>({ projectId: '', setProjectId: () => undefined });

const read = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };

export function CurrentProjectProvider({ children }: { children: React.ReactNode }) {
  const [projectId, setState] = useState<string>(read);
  const setProjectId = useCallback((id: string) => {
    setState(id);
    try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  }, []);
  // Stay in step when another tab changes the selection.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setState(e.newValue ?? ''); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const value = useMemo(() => ({ projectId, setProjectId }), [projectId, setProjectId]);
  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>;
}

export const useCurrentProject = () => useContext(CurrentProjectContext);
