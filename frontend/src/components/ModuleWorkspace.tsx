import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppView } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import ErpLayout from './ErpLayout';
import ResourceManager, { Column, Field, FilterDef, SummaryCardDef } from './ResourceManager';

export interface TabDef {
  key: string;
  label: string;
  endpoint: string;
  entityLabel: string;
  projectScoped?: boolean;
  readPerm: string;
  writePerm: string;
  columns: Column[];
  fields: Field[];
  /** Toolbar controls (all optional, default off except search). */
  searchable?: boolean;
  dateFilter?: boolean;
  filters?: FilterDef[];
  summaryCards?: SummaryCardDef[];
  /** Enable per-record document attachments on the edit form (project_documents module key, e.g. 'ncr'). */
  attachModule?: string;
  /** Optional custom renderer; when set it replaces the generic ResourceManager. */
  component?: React.ComponentType<{ projectId?: string; canWrite: boolean }>;
}

export interface ModuleDef {
  view: AppView;
  title: string;
  subtitle: string;
  tabs: TabDef[];
  /** Optional summary banner rendered above the tabs. */
  summary?: (projectId?: string) => React.ReactNode;
}

interface Props {
  def: ModuleDef;
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

export default function ModuleWorkspace({ def, onNavigate, onLogout }: Props) {
  const { hasPermission } = useAuth();
  const visibleTabs = def.tabs.filter((t) => hasPermission(t.readPerm));
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(
    () => searchParams.get('tab') ?? visibleTabs[0]?.key ?? def.tabs[0]?.key,
  );
  // Deep-linkable: ?projectId= preselects a project (and ?tab= a tab), so the
  // platform console can land straight on one record inside a tenant, and any
  // module view is shareable as a URL.
  const [projectId, setProjectId] = useState<string>(() => searchParams.get('projectId') ?? '');

  const needsProject = def.tabs.some((t) => t.projectScoped);
  const { data: projects } = useQuery({
    queryKey: ['projects', 'picker'],
    queryFn: () => api.get<{ id: string; name: string; code: string }[]>('/projects?pageSize=200'),
    enabled: needsProject,
  });

  const current = visibleTabs.find((t) => t.key === activeTab) ?? visibleTabs[0];

  const projectSelector = needsProject ? (
    <select
      value={projectId}
      onChange={(e) => setProjectId(e.target.value)}
      className="h-10 bg-brand-surface-container-lowest border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary min-w-[220px]"
    >
      <option value="">All projects (read-only)</option>
      {(projects?.data ?? []).map((p) => (
        <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
      ))}
    </select>
  ) : undefined;

  return (
    <ErpLayout
      active={def.view}
      title={def.title}
      subtitle={def.subtitle}
      onNavigate={onNavigate}
      onLogout={onLogout}
      actions={projectSelector}
    >
      {def.summary && <div className="mb-6">{def.summary(projectId || undefined)}</div>}

      {visibleTabs.length > 1 && (
        <div className="flex flex-wrap gap-1.5 bg-brand-surface-container p-1 rounded-lg border border-brand-outline-variant/10 mb-5 w-fit">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                current?.key === t.key ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant hover:text-brand-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {current && (
        <React.Fragment key={current.key}>
          {current.component ? (
            <current.component
              projectId={current.projectScoped ? (projectId || undefined) : undefined}
              canWrite={hasPermission(current.writePerm)}
            />
          ) : (
            <ResourceManager
              endpoint={current.endpoint}
              entityLabel={current.entityLabel}
              columns={current.columns}
              fields={current.fields}
              canWrite={hasPermission(current.writePerm)}
              projectScoped={current.projectScoped}
              projectId={current.projectScoped ? (projectId || undefined) : undefined}
              searchable={current.searchable}
              dateFilter={current.dateFilter}
              filters={current.filters}
              summaryCards={current.summaryCards}
              attachModule={current.attachModule}
            />
          )}
        </React.Fragment>
      )}
    </ErpLayout>
  );
}
