import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { AppView } from '../types';
import { api } from '../lib/api';
import ErpLayout from './ErpLayout';

interface Notification {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

const sevIcon = (s: string) =>
  s === 'CRITICAL' ? AlertTriangle : s === 'HIGH' ? AlertCircle : Info;

export default function NotificationsPage({ onNavigate, onLogout }: { onNavigate: (v: AppView) => void; onLogout: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Notification[]>('/notifications'),
    refetchInterval: 20_000,
  });
  const rows = data?.data ?? [];

  const markRead = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });
  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  return (
    <ErpLayout
      active={AppView.NOTIFICATIONS}
      title="Notifications"
      subtitle="Delay, cost, stock, safety & quality alerts (Module 9)"
      onNavigate={onNavigate}
      onLogout={onLogout}
      actions={
        <button onClick={() => markAll.mutate()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary-container">
          <CheckCheck className="w-4 h-4" /> Mark all read
        </button>
      }
    >
      <div className="space-y-3 max-w-3xl">
        {rows.length === 0 && (
          <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 p-10 text-center text-brand-on-surface-variant text-sm flex flex-col items-center gap-2">
            <Bell className="w-8 h-8 opacity-40" /> No notifications yet.
          </div>
        )}
        {rows.map((n) => {
          const Icon = sevIcon(n.severity);
          return (
            <div
              key={n.id}
              className={`bg-brand-surface-container-lowest rounded-xl border p-4 flex gap-3 items-start ${
                n.isRead ? 'border-brand-outline-variant/20 opacity-70' : 'border-l-4 border-brand-secondary-container shadow-sm'
              }`}
            >
              <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${n.severity === 'CRITICAL' ? 'text-red-600' : n.severity === 'HIGH' ? 'text-amber-600' : 'text-brand-primary'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-bold text-sm text-brand-primary">{n.title}</h4>
                  <span className="text-[10px] font-mono text-brand-on-surface-variant shrink-0">{new Date(n.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-xs text-brand-on-surface-variant mt-1 leading-relaxed">{n.message}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-surface text-brand-on-surface-variant">{n.type.replace(/_/g, ' ')}</span>
                  {!n.isRead && (
                    <button onClick={() => markRead.mutate(n.id)} className="text-[11px] font-bold text-brand-primary hover:underline">Mark read</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ErpLayout>
  );
}
