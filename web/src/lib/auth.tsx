import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (employeeNo: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const login = async (employeeNo: string, password: string) => {
    const r = await api.login(employeeNo, password);
    setUser(r.user);
  };
  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
  };
  const can = (perm: string) => !!user?.perms?.includes(perm);

  return <Ctx.Provider value={{ user, loading, login, logout, can }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
