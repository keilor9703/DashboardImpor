import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePref = "system" | "light" | "dark";
interface ThemeCtx {
  pref: ThemePref;
  resolved: "light" | "dark";
  setPref: (p: ThemePref) => void;
}

const KEY = "comex-theme";
const Ctx = createContext<ThemeCtx | null>(null);
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Se aplica de forma síncrona para que los gráficos lean los tokens ya actualizados. */
function applyTheme(p: ThemePref) {
  const root = document.documentElement;
  if (p === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", p);
  try { localStorage.setItem(KEY, p); } catch { /* sin storage */ }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => {
    let p: ThemePref = "system";
    try {
      p = (localStorage.getItem(KEY) as ThemePref) || "system";
    } catch { /* sin storage */ }
    applyTheme(p);
    return p;
  });
  const setPref = (p: ThemePref) => {
    applyTheme(p);
    setPrefState(p);
  };
  const [systemDark, setSystemDark] = useState(() => mq().matches);

  useEffect(() => {
    const m = mq();
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const resolved = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved]) as ThemeCtx;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme fuera de ThemeProvider");
  return c;
}

/** Lee los tokens CSS vigentes para pasarlos a ECharts (canvas no entiende var()). */
export function readTokens() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    surface: v("--surface"),
    text: v("--text"),
    text2: v("--text-2"),
    text3: v("--text-3"),
    grid: v("--grid"),
    border: v("--border-strong"),
    s1: v("--series-1"),
    s2: v("--series-2"),
    s3: v("--series-3"),
    muted: v("--series-muted"),
    serious: v("--serious"),
    critical: v("--critical"),
    good: v("--good"),
    font: v("--font"),
  };
}
export type Tokens = ReturnType<typeof readTokens>;
