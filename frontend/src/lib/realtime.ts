import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { tokenStore } from './api';

const SOCKET_URL =
  (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_URL?.replace(/\/api$/, '') ??
  'http://localhost:4000';

let socket: Socket | null = null;

/**
 * Connects to the backend realtime channel (Module 22) and invalidates
 * notification queries whenever a live event arrives, so the bell + list update
 * without polling. Safe to call once near the app root after authentication.
 */
export function useRealtime(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const token = tokenStore.access;
    if (!token) return;

    socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });

    socket.on('notification', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    });

    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [enabled, queryClient]);
}
