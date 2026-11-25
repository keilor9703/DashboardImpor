import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3, Building2, Database, FileText, LogOut, Menu, Moon, RefreshCw, Ship, Sun, Table2, Warehouse,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { apiPost, useApi } from "../api/client";
import type { FuenteEstado } from "../api/types";
import { horaRelativa } from "../lib/format";
import { useTheme } from "../lib/theme";

/* ---- Sincronización: versión de datos + refresco manual y automático ---- */
interface SyncCtx { version: number; refreshing: boolean; refresh: () => Promise<void> }
const Sync = createContext<SyncCtx>({ version: 0, refreshing: false, refresh: async () => {} });
export const useSync = () => useContext(Sync);
const AUTO_REFRESH_MS = 2 * 60 * 1000;

const PAGES: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Resumen ejecutivo", subtitle: "Indicadores clave de la operación de comercio exterior" },
  "/operaciones": { title: "Operaciones", subtitle: "Detalle de cada DO con búsqueda y filtros" },
  "/fuente": { title: "Fuente de datos", subtitle: "Estado de la conexión con el Excel en SharePoint" },
};

export function Layout() {
  const { user, logout, getToken, mode } = useAuth();
  const { resolved, setPref } = useTheme();
  const [version, setVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  const page = PAGES[loc.pathname] ?? PAGES["/"];
  const { data: fuente } = useApi<FuenteEstado>("/api/datos/estado", { v: version });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await apiPost("/api/datos/refrescar", getToken);
    } finally {
      setRefreshing(false);
      setVersion((v) => v + 1);
    }
  }, [getToken]);

  useEffect(() => {
    const id = setInterval(() => setVersion((v) => v + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setMenuOpen(false), [loc.pathname]);

  const initials = (user?.name ?? "U").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <Sync.Provider value={{ version, refreshing, refresh }}>
      <div className="shell">
        <aside className={`sidebar ${menuOpen ? "open" : ""}`} onClick={(e) => e.target === e.currentTarget && setMenuOpen(false)}>
          <div className="brand">
            <div className="brand-logo"><Ship size={20} /></div>
            <div>
              <div className="brand-name">ComEx Analytics</div>
              <div className="brand-sub">Tablero directivo</div>
            </div>
          </div>
          <nav className="nav">
            <div className="nav-label">Análisis</div>
            <NavLink to={{ pathname: "/", search: loc.search }} end><BarChart3 size={18} /> Resumen ejecutivo</NavLink>
            <NavLink to={{ pathname: "/operaciones", search: loc.search }}><Table2 size={18} /> Operaciones</NavLink>
            <a aria-disabled="true"><Building2 size={18} /> Clientes <span className="soon">Pronto</span></a>
            <a aria-disabled="true"><Warehouse size={18} /> Aduanas <span className="soon">Pronto</span></a>
            <a aria-disabled="true"><FileText size={18} /> Reportes <span className="soon">Pronto</span></a>
            <div className="nav-label">Sistema</div>
            <NavLink to="/fuente"><Database size={18} /> Fuente de datos</NavLink>
          </nav>
          <div className="sidebar-foot">
            <span className={`sync-dot ${fuente?.error ? "off" : ""}`} />
            {fuente?.tipo === "graph" ? "SharePoint conectado" : fuente?.tipo === "file" ? "Archivo local" : "Datos simulados"}
            <div style={{ marginTop: 4 }}>{fuente ? `${fuente.filas.toLocaleString("es-CO")} registros` : "…"}</div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}><Menu size={18} /></button>
            <div>
              <h1>{page.title}</h1>
              <div className="subtitle">{page.subtitle}</div>
            </div>
            <div className="spacer" />
            <div className="freshness" title="Los datos se actualizan automáticamente cada 2 minutos">
              <span className={`sync-dot ${fuente?.error ? "off" : ""}`} />
              Actualizado {horaRelativa(fuente?.ultima_actualizacion)}
            </div>
            <button className={`icon-btn ${refreshing ? "spin" : ""}`} aria-label="Actualizar datos" title="Actualizar datos ahora" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={16} />
            </button>
            <button className="icon-btn" aria-label="Cambiar tema" title={resolved === "dark" ? "Tema claro" : "Tema oscuro"}
              onClick={() => setPref(resolved === "dark" ? "light" : "dark")}>
              {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="user-chip">
              <div className="who">
                <b>{user?.name}</b>
                <span>{mode === "demo" ? "Modo demo" : user?.email}</span>
              </div>
              <div className="avatar">{initials}</div>
            </div>
            <button className="icon-btn" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={logout}><LogOut size={16} /></button>
          </header>
          <main className="content">
            <Outlet />
          </main>
        </div>
      </div>
    </Sync.Provider>
  );
}

export function Card({ title, subtitle, actions, children, className = "" }: {
  title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}
