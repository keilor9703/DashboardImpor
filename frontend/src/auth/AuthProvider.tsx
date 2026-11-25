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

export type AuthMode = "entra" | "demo";
export interface AuthUser {
  name: string;
  email?: string;
}
interface AuthContextValue {
  mode: AuthMode;
  ready: boolean;
  user: AuthUser | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID as string | undefined;
const apiScope = import.meta.env.VITE_API_SCOPE as string | undefined;

export const authMode: AuthMode = clientId ? "entra" : "demo";
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

export const msalInstance = authMode === "entra" ? new PublicClientApplication(msalConfig) : null;

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
