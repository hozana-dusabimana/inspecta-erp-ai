// Typed API client for the INSPECTA BUILDOS backend.
// Handles bearer-token auth, transparent refresh, and a uniform response shape.
import { getInspectedOrg } from './inspectStore';

const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_URL ??
  'http://localhost:4000/api';

const ACCESS_KEY = 'inspecta.accessToken';
const REFRESH_KEY = 'inspecta.refreshToken';

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export interface ValidationDetails {
  formErrors?: string[];
  fieldErrors?: Record<string, string[]>;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
  details?: ValidationDetails;
  meta?: { page: number; pageSize: number; total: number };
}

export class ApiError extends Error {
  status: number;
  details?: ValidationDetails;
  constructor(status: number, message: string, details?: ValidationDetails) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Human-readable, field-aware message from an ApiError (or any error). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.details?.fieldErrors) {
    const parts = Object.entries(e.details.fieldErrors)
      .map(([field, msgs]) => `${field}: ${(msgs ?? []).join(', ')}`);
    if (parts.length) return `${e.message} — ${parts.join('; ')}`;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refresh = tokenStore.refresh;
  if (!refresh) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh }),
        });
        if (!res.ok) return false;
        const json = (await res.json()) as ApiEnvelope<{ accessToken: string; refreshToken: string }>;
        tokenStore.set(json.data.accessToken, json.data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/**
 * Headers common to every call: bearer token, plus the inspected-tenant header
 * when a platform admin is viewing another company's workspace (the server
 * scopes the request to that tenant and refuses anything but reads).
 */
function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  const headers = { ...base };
  const access = tokenStore.access;
  if (access) headers.Authorization = `Bearer ${access}`;
  const inspected = getInspectedOrg();
  if (inspected) headers['X-Platform-Org'] = inspected.id;
  return headers;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<ApiEnvelope<T>> {
  const headers = authHeaders({ 'Content-Type': 'application/json' });

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && tokenStore.refresh) {
    const ok = await tryRefresh();
    if (ok) return request<T>(method, path, body, false);
    tokenStore.clear();
  }

  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || json.success === false) {
    throw new ApiError(res.status, json.error || `Request failed (${res.status})`, json.details);
  }
  return json;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),

  /** Authenticated file download (Excel/CSV/PDF reports). */
  async download(path: string, filename: string) {
    const headers = authHeaders();
    const res = await fetch(`${API_URL}${path}`, { headers });
    if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** POST and consume a Server-Sent-Events stream. Calls onEvent per data frame. */
  async stream(path: string, body: unknown, onEvent: (evt: any) => void): Promise<void> {
    const headers = authHeaders({ 'Content-Type': 'application/json' });
    const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok || !res.body) throw new ApiError(res.status, `Stream failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop() ?? '';
      for (const f of frames) {
        const line = f.split('\n').find((l) => l.startsWith('data: '));
        if (line) { try { onEvent(JSON.parse(line.slice(6))); } catch { /* ignore */ } }
      }
    }
  },

  /** Upload a file as the raw request body (e.g. .xlsx import). */
  async upload<T>(path: string, file: File): Promise<ApiEnvelope<T>> {
    const headers = authHeaders({ 'Content-Type': file.type || 'application/octet-stream' });
    const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: file });
    const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (!res.ok || json.success === false) {
      throw new ApiError(res.status, json.error || `Upload failed (${res.status})`, json.details);
    }
    return json;
  },
};
