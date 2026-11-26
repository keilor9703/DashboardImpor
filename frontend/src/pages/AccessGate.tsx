/**
 * Verifica con el backend que el usuario autenticado tenga permiso para ver el tablero.
 * Con Microsoft, el acceso se da asignando el rol «Dashboard.Viewer» en Entra ID; si falta,
 * se muestra una explicación clara en lugar de un tablero vacío.
 */
import type { ReactNode } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import { useApi } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { ProductLogo } from "../components/Brand";

export function AccessGate({ children }: { children: ReactNode }) {
  const { user, logout, mode } = useAuth();
  const { status, loading, data, error } = useApi<{ name: string }>("/api/me");

  if (loading && !data && !error) return <div className="empty" style={{ paddingTop: 120 }}>Verificando acceso…</div>;
  if (status === 403) {
    return (
      <div className="denied">
        <div className="denied-box">
          <ProductLogo size="md" />
          <ShieldAlert size={36} className="denied-icon" />
          <h1>Su cuenta no tiene acceso al tablero</h1>
          <p>
            Inició sesión como <b>{user?.email ?? user?.name}</b>, pero esta cuenta aún no está autorizada.
            {mode === "entra" && <> Solicite al administrador de SIACOMEX que le asigne el rol <b>«Lector del tablero»</b> en la aplicación.</>}
          </p>
          <button className="btn" onClick={logout}><LogOut size={14} /> Cerrar sesión y usar otra cuenta</button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
