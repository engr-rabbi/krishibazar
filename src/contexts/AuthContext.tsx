import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { User } from '../types';
import { SHEETS_ENABLED, UNAUTHORIZED_EVENT, loginRequest, logoutRequest } from '../lib/sheetsApi';
import { clearToken, getToken, setToken } from '../lib/session';

export interface LoginResult { ok: boolean; error?: string }

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const USER_KEY = 'kb_user';

const readStoredUser = (): User | null => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(() => {
    setUser(null);
    clearToken();
    try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  }, []);

  // Restore session. With a backend, a stored user without a token is not trusted.
  useEffect(() => {
    const stored = readStoredUser();
    if (stored && (!SHEETS_ENABLED || getToken())) setUser(stored);
    else if (stored) clearSession();
    setLoading(false);
  }, [clearSession]);

  // Backend says the session is gone → send the user back to the login page
  useEffect(() => {
    const handler = () => clearSession();
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    let found: User | null = null;

    if (SHEETS_ENABLED) {
      const res = await loginRequest(email.trim(), password);
      if (!res.success || !res.data) return { ok: false, error: res.error ?? 'Login failed.' };
      setToken(res.data.token);
      found = res.data.user;
    } else if (!import.meta.env.VITE_APPS_SCRIPT_URL) {
      // Local/offline demo mode only (this branch is removed from builds that have a backend URL)
      const { DEMO_ACCOUNTS } = await import('../lib/demoAccounts');
      const acc = DEMO_ACCOUNTS.find(a => a.email === email.trim().toLowerCase() && a.password === password);
      if (!acc) return { ok: false, error: 'Invalid email or password.' };
      found = { id: acc.id, email: acc.email, name: acc.name, role: acc.role, phone: acc.phone, location: acc.location };
    }

    if (!found) return { ok: false, error: 'Login failed.' };
    setUser(found);
    try { localStorage.setItem(USER_KEY, JSON.stringify(found)); } catch { /* ignore */ }
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    if (SHEETS_ENABLED) void logoutRequest();
    clearSession();
  }, [clearSession]);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
