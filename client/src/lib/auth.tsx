import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

interface User {
  id: number;
  username: string;
}
interface AuthState {
  loading: boolean;
  user: User | null;
  needsSetup: boolean;
  requiresSetupToken: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ loading: true, user: null as User | null, needsSetup: false, requiresSetupToken: false });

  const refresh = useCallback(async () => {
    const s = await api.get<{ user: User | null; needsSetup: boolean; requiresSetupToken: boolean }>('/auth/status');
    setState({ loading: false, ...s });
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh().catch(() => setState((s) => ({ ...s, loading: false })));
    const onUnauthorized = () => setState((s) => ({ ...s, user: null }));
    window.addEventListener('vx:unauthorized', onUnauthorized);
    return () => window.removeEventListener('vx:unauthorized', onUnauthorized);
  }, [refresh]);

  return <Ctx.Provider value={{ ...state, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth hors AuthProvider');
  return v;
}
