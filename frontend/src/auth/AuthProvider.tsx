/**
 * Capa de autenticación.
 *  - Modo "entra": inicio de sesión con la cuenta corporativa de Microsoft 365 (MSAL).
 *  - Modo "demo": si no hay VITE_AZURE_CLIENT_ID configurado, permite entrar sin Microsoft
 *    para ver el dashboard con datos simulados.
 * El resto de la app solo usa el hook `useAuth()`, sin saber qué modo está activo.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  InteractionRequiredAuthError,
  InteractionStatus,
  PublicClientApplication,
  type Configuration,
} from "@azure/msal-browser";
import { MsalProvider, useIsAuthenticated, useMsal } from "@azure/msal-react";

export type AuthMode = "entra" | "password" | "demo";
export interface AuthUser {
  name: string;
  email?: string;
}
interface AuthContextValue {
  mode: AuthMode;
  ready: boolean;
  user: AuthUser | null;
  login: (username?: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
  /** Se llama cuando la API responde 401 (sesión vencida). */
  onUnauthorized?: () => void;
}

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID as string | undefined;
const apiScope = import.meta.env.VITE_API_SCOPE as string | undefined;

const envMode = import.meta.env.VITE_AUTH_MODE as AuthMode | undefined;
export const authMode: AuthMode = envMode ?? (clientId ? "entra" : "demo");
const scopes = apiScope ? [apiScope] : ["User.Read"];

const msalConfig: Configuration = {
  auth: {
    clientId: clientId ?? "",
    authority: `https://login.microsoftonline.com/${tenantId || "organizations"}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: { cacheLocation: "sessionStorage" },
};

export const msalInstance = authMode === "entra" && clientId ? new PublicClientApplication(msalConfig) : null;

const AuthContext = createContext<AuthContextValue | null>(null);

function EntraBridge({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const account = accounts[0];

  const getToken = useCallback(async () => {
    if (!account) return null;
    try {
      const res = await instance.acquireTokenSilent({ scopes, account });
      return res.accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) await instance.acquireTokenRedirect({ scopes, account });
      throw e;
    }
  }, [instance, account]);

  const value = useMemo<AuthContextValue>(
    () => ({
      mode: "entra",
      ready: inProgress === InteractionStatus.None,
      user: isAuthenticated && account ? { name: account.name ?? account.username, email: account.username } : null,
      login: () => instance.loginRedirect({ scopes, prompt: "select_account" }),
      logout: () => instance.logoutRedirect({ account }),
      getToken,
    }),
    [instance, inProgress, isAuthenticated, account, getToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const SESSION_KEY = "comex-session";
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

interface Session { token: string; name: string; exp: number }

function readSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    return s && s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

/** Usuario y contraseña propios (backend con AUTH_MODE=password). */
function PasswordProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);
  const logout = useCallback(async () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* sin storage */ }
    setSession(null);
  }, []);
  const value = useMemo<AuthContextValue>(() => ({
    mode: "password",
    ready: true,
    user: session ? { name: session.name } : null,
    login: async (username = "", password = "") => {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail ?? "No fue posible iniciar sesión");
      const s: Session = { token: body.access_token, name: body.name, exp: Date.now() + body.expires_in * 1000 };
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* sin storage */ }
      setSession(s);
    },
    logout,
    getToken: async () => {
      const s = readSession();
      if (!s) { void logout(); return null; }
      return s.token;
    },
    onUnauthorized: logout,
  }), [session, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const DEMO_KEY = "comex-demo-session";

function DemoProvider({ children }: { children: ReactNode }) {
  const [logged, setLogged] = useState(() => {
    try {
      return sessionStorage.getItem(DEMO_KEY) === "1";
    } catch {
      return false;
    }
  });
  const value = useMemo<AuthContextValue>(
    () => ({
      mode: "demo",
      ready: true,
      user: logged ? { name: "Usuario Demo", email: "demo@empresa.com" } : null,
      login: async () => {
        try { sessionStorage.setItem(DEMO_KEY, "1"); } catch { /* sin storage */ }
        setLogged(true);
      },
      logout: async () => {
        try { sessionStorage.removeItem(DEMO_KEY); } catch { /* sin storage */ }
        setLogged(false);
      },
      getToken: async () => null,
    }),
    [logged],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (authMode === "password") return <PasswordProvider>{children}</PasswordProvider>;
  if (msalInstance) {
    return (
      <MsalProvider instance={msalInstance}>
        <EntraBridge>{children}</EntraBridge>
      </MsalProvider>
    );
  }
  return <DemoProvider>{children}</DemoProvider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
