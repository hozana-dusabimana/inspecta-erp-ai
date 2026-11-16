import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { siteLocation } from '../lib/evidence';
import FileOrUrlInput from './FileOrUrlInput';

/** Close an incident (T2-06): corrective action + its own photo evidence, by someone other than the reporter. */
export default function CloseIncident({ row, onClose }: { row: Record<string, any>; onClose: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState(row.correctiveAction ?? '');
  const [photo, setPhoto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = useMutation({
    mutationFn: async () => {
      const geo = await siteLocation();
      return api.post(`/hse/incidents/${row.id}/close`, {
        correctiveAction: action.trim(),
        _evidence: [{ url: photo, sourceType: 'LINK', fileName: 'corrective-action', capturedAt: new Date().toISOString(), ...(geo ? { capturedLat: geo.lat, capturedLng: geo.lng } : {}) }],
      });
    },
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Close incident">
      <form onSubmit={(e) => { e.preventDefault(); close.mutate(); }} className="w-full max-w-md space-y-3 rounded-xl bg-brand-surface-container-lowest p-5 shadow-xl">
        <h3 className="text-sm font-bold text-brand-primary">Close incident {row.number}</h3>
        <p className="text-xs text-brand-on-surface-variant">Closing needs the corrective action and a photo (or link) showing it done. The person who reported it cannot close it. Closing restores the safety score.</p>
        <label className="block text-[11px] font-bold uppercase text-brand-on-surface-variant" htmlFor="ci-action">Corrective action</label>
        <textarea id="ci-action" rows={3} value={action} onChange={(e) => setAction(e.target.value)} className="w-full rounded-lg border border-brand-outline-variant bg-brand-surface p-2 text-xs" />
        <p className="text-[11px] font-bold uppercase text-brand-on-surface-variant">Evidence of the fix</p>
        <FileOrUrlInput value={photo} onChange={setPhoto} required />
        {error && <p className="text-[11px] font-semibold text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-brand-outline-variant px-3 py-1.5 text-xs font-bold">Cancel</button>
          <button type="submit" disabled={action.trim().length < 5 || !photo || close.isPending} className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Close incident</button>
        </div>
      </form>
    </div>
  );
}
