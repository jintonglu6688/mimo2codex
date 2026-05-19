import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type AuthMeResponse, type AuthUser } from "../api/client";

interface AuthState {
  loading: boolean;
  authMode: "off" | "on";
  user: AuthUser | null;
  needsBootstrap: boolean;
  allowRegister: boolean;
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const initialState: AuthState = {
  loading: true,
  authMode: "off",
  user: null,
  needsBootstrap: false,
  allowRegister: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>(initialState);

  const refresh = useCallback(async () => {
    try {
      const me: AuthMeResponse = await api.authMe();
      setState({
        loading: false,
        authMode: me.authMode,
        user: me.user,
        needsBootstrap: me.needsBootstrap,
        allowRegister: me.allowRegister,
      });
    } catch {
      // Endpoint unreachable: treat as local mode to avoid locking the UI out.
      setState({
        loading: false,
        authMode: "off",
        user: null,
        needsBootstrap: false,
        allowRegister: false,
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string) => {
      await api.login({ username, password });
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      await refresh();
    }
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ ...state, refresh, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
