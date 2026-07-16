import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, tokenStore } from './api';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  organizationId: string;
  permissions: string[];
}

export interface RegisterResult {
  verificationRequired: boolean;
  email: string;
  emailed: boolean;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    organizationName: string;
    fullName: string;
    email: string;
    password: string;
  }) => Promise<RegisterResult>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount if a token exists.
  useEffect(() => {
    (async () => {
      if (!tokenStore.access) {
        setLoading(false);
        return;
      }
      try {
        const res = await api.get<AuthUser>('/auth/me');
        setUser(res.data);
      } catch {
        tokenStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<AuthResponse>('/auth/login', { email, password });
    tokenStore.set(res.data.accessToken, res.data.refreshToken);
    setUser(res.data.user);
  }, []);

  const register = useCallback(
    async (input: { organizationName: string; fullName: string; email: string; password: string }) => {
      // Registration creates a dormant account and emails a verification link;
      // it does NOT log the user in until they verify.
      const res = await api.post<RegisterResult>('/auth/register', input);
      return res.data;
    },
    [],
  );

  const verifyEmail = useCallback(async (token: string) => {
    const res = await api.post<AuthResponse>('/auth/verify-email', { token });
    tokenStore.set(res.data.accessToken, res.data.refreshToken);
    setUser(res.data.user);
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    await api.post('/auth/resend-verification', { email });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.refresh ?? undefined });
    } catch {
      /* best effort */
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => Boolean(user?.permissions.includes(permission)),
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, register, verifyEmail, resendVerification, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
