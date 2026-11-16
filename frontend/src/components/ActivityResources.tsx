import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import ResourceManager from './ResourceManager';

/**
 * Resources per schedule activity (T2-04): named employees, crews and machines PLANNED on an
 * activity, against what attendance and machine logs show was ACTUALLY used on its WBS item.
 */
const money = (n: unknown) => (n == null ? '—' : 'RWF ' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const hrs = (n: unknown) => (n == null ? '—' : `${Number(n).toLocaleString()} h`);

export default function ActivityResources({ projectId, canWrite }: { projectId?: string; canWrite: boolean }) {
  const [activityId, setActivityId] = useState('');
  const { data: acts } = useQuery({
    queryKey: ['/scheduling', 'activities-for-resources', projectId], enabled: Boolean(projectId),
    queryFn: () => api.get<any[]>(`/scheduling?projectId=${projectId}&pageSize=200`).then((r) => r.data),
  });
  const { data: pva, isLoading } = useQuery({
    queryKey: ['/scheduling/resources/plan-vs-actual', activityId], enabled: Boolean(activityId),
    queryFn: () => api.get<any>(`/scheduling/resources/plan-vs-actual?activityId=${activityId}`).then((r) => r.data),
  });
  if (!projectId) return <p className="text-xs text-brand-on-surface-variant">Pick a project to assign resources to its activities.</p>;
  const p = pva;

  return (
    <div className="space-y-4">
      <ResourceManager
        endpoint="/scheduling/resources"
        entityLabel="Resource Assignment"
        projectId={projectId}
        projectScoped
        canWrite={canWrite}
        searchable={false}
        filters={[{ field: 'resourceType', label: 'Type', options: [{ value: 'EMPLOYEE', label: 'Employee' }, { value: 'CREW', label: 'Crew' }, { value: 'EQUIPMENT', label: 'Equipment' }] }]}
        columns={[
          { key: 'activity', label: 'Activity', render: (r) => (r.activity ? `${r.activity.code} — ${r.activity.name}` : '—') },
          { key: 'resourceType', label: 'Type' },
          { key: 'plannedDays', label: 'Planned days', align: 'right', render: (r) => (r.plannedDays ?? '—') },
          { key: 'plannedHours', label: 'Planned hours', align: 'right', render: (r) => (r.plannedHours ?? '—') },
        ]}
        fields={[
          { name: 'activityId', label: 'Activity', type: 'select', required: true, optionsEndpoint: '/scheduling?pageSize=500', scopeToProject: true, optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'resourceType', label: 'Resource type', type: 'select', required: true, options: [{ value: 'EMPLOYEE', label: 'Employee' }, { value: 'CREW', label: 'Crew' }, { value: 'EQUIPMENT', label: 'Equipment' }] },
          { name: 'employeeId', label: 'Employee (when type is Employee)', type: 'select', optionsEndpoint: '/hr/employees?pageSize=500', optionLabel: (r) => `${r.employeeNo ?? ''} ${r.fullName}`.trim() },
          { name: 'crewId', label: 'Crew (when type is Crew)', type: 'select', optionsEndpoint: '/hr/crews?pageSize=200', optionLabel: (r) => r.name },
          { name: 'equipmentId', label: 'Equipment (when type is Equipment)', type: 'select', optionsEndpoint: '/equipment/register?pageSize=500', optionLabel: (r) => `${r.code ?? ''} ${r.name}`.trim() },
          { name: 'plannedDays', label: 'Planned days', type: 'number' },
          { name: 'plannedHours', label: 'Planned hours (optional)', type: 'number' },
          { name: 'note', label: 'Note', type: 'textarea' },
        ]}
      />

      <div className="rounded-xl border border-brand-outline-variant/20 bg-brand-surface-container-lowest p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-brand-primary">Planned against actual</h3>
          <select aria-label="Activity" value={activityId} onChange={(e) => setActivityId(e.target.value)} className="h-9 rounded-lg border border-brand-outline-variant bg-brand-surface px-2 text-xs">
            <option value="">Choose an activity…</option>
            {(acts ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>
        {!activityId ? <p className="text-xs text-brand-on-surface-variant">Choose an activity to compare its planned people and machines with attendance and machine logs.</p>
          : isLoading || !p ? <div className="h-20 animate-pulse rounded bg-brand-surface-container-low" aria-busy="true" />
          : (
            <>
              {!p.linked && <p className="rounded bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">This activity is not linked to a WBS item, so nothing it used can be measured.</p>}
              <table className="w-full text-xs">
                <thead><tr className="text-left text-brand-on-surface-variant"><th className="py-1">Resource</th><th>Type</th><th className="text-right">Planned</th><th className="text-right">Actual</th><th className="text-right">Actual cost</th></tr></thead>
                <tbody>
                  {p.planned.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-brand-on-surface-variant">Nothing planned on this activity yet.</td></tr>}
                  {p.planned.map((r: any) => (
                    <tr key={r.id} className="border-t border-brand-outline-variant/10">
                      <td className="py-1.5 font-semibold">{r.name}</td><td>{r.type}</td>
                      <td className="text-right font-mono">{r.plannedDays != null ? `${r.plannedDays} d` : ''}{r.plannedHours != null ? ` (${r.plannedHours} h)` : ''}</td>
                      <td className="text-right font-mono">{hrs(r.actualHours)}{r.actualDays != null ? ` · ${r.actualDays} d` : ''}</td>
                      <td className="text-right font-mono">{money(r.actualCost)}</td>
                    </tr>
                  ))}
                  {p.unplanned.map((r: any, i: number) => (
                    <tr key={`u${i}`} className="border-t border-brand-outline-variant/10 text-amber-800">
                      <td className="py-1.5 font-semibold">{r.name} <span className="text-[10px]">(not planned)</span></td><td>{r.type}</td>
                      <td className="text-right">—</td><td className="text-right font-mono">{hrs(r.actualHours)}</td><td className="text-right font-mono">{money(r.actualCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
      </div>
    </div>
  );
}
