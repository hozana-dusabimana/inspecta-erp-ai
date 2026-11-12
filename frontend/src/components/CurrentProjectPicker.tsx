import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban } from 'lucide-react';
import { api } from '../lib/api';
import { useCurrentProject } from '../lib/currentProject';

/** Header picker for the project the user is working on; the choice follows them to every page. */
export default function CurrentProjectPicker() {
  const { projectId, setProjectId } = useCurrentProject();
  const { data } = useQuery({
    queryKey: ['projects', 'picker'],
    queryFn: () => api.get<{ id: string; name: string; code: string }[]>('/projects?pageSize=200'),
    staleTime: 60_000,
  });
  const projects = data?.data ?? [];
  // A remembered project that no longer exists falls back to "All projects".
  useEffect(() => {
    if (projectId && data && !projects.some((p) => p.id === projectId)) setProjectId('');
  }, [projectId, data, projects, setProjectId]);
  if (!projects.length) return null;
  return (
    <label className="flex items-center gap-2 px-2.5 h-9 rounded-lg border border-brand-outline-variant/30 bg-brand-surface text-xs font-semibold text-brand-primary" title="The project you are working on. Every page follows it.">
      <FolderKanban className="w-4 h-4 text-brand-on-surface-variant shrink-0" />
      <select
        id="current-project-picker"
        aria-label="Current project"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        className="bg-transparent outline-none max-w-[190px] truncate cursor-pointer"
      >
        <option value="">All projects</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
      </select>
    </label>
  );
}
