import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Filters } from "../api/types";
import { isoDate } from "./format";

export type Preset = "mes" | "trimestre" | "ytd" | "12m" | "custom";

export function presetRange(p: Exclude<Preset, "custom">, today = new Date()): { desde: string; hasta: string } {
  const hasta = isoDate(today);
  const y = today.getFullYear(), m = today.getMonth();
  switch (p) {
    case "mes": return { desde: isoDate(new Date(y, m, 1)), hasta };
    case "trimestre": return { desde: isoDate(new Date(y, Math.floor(m / 3) * 3, 1)), hasta };
    case "ytd": return { desde: isoDate(new Date(y, 0, 1)), hasta };
    case "12m": {
      const d = new Date(y, m - 11, 1);
      return { desde: isoDate(d), hasta };
    }
  }
}

export const PRESETS: { id: Exclude<Preset, "custom">; label: string }[] = [
  { id: "mes", label: "Mes actual" },
  { id: "trimestre", label: "Trimestre" },
  { id: "ytd", label: "Año en curso" },
  { id: "12m", label: "12 meses" },
];

export const DIM_KEYS = ["modo", "origen", "destino", "franquicia", "forwarder"] as const;
export const DEFAULT_PRESET: Exclude<Preset, "custom"> = "ytd";

/** Filtros globales guardados en la URL (se pueden compartir como enlace). */
export function useFilters() {
  const [sp, setSp] = useSearchParams();
  const def = presetRange(DEFAULT_PRESET);

  const filters: Filters = useMemo(() => {
    const f: Filters = { desde: sp.get("desde") ?? def.desde, hasta: sp.get("hasta") ?? def.hasta };
    DIM_KEYS.forEach((k) => (f[k] = sp.get(k) ?? ""));
    return f;
  }, [sp, def.desde, def.hasta]);

  const preset: Preset = useMemo(() => {
    const hit = PRESETS.find((p) => {
      const r = presetRange(p.id);
      return r.desde === filters.desde && r.hasta === filters.hasta;
    });
    return hit?.id ?? "custom";
  }, [filters.desde, filters.hasta]);

  const update = useCallback((patch: Partial<Filters>) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      return next;
    }, { replace: true });
  }, [setSp]);

  const reset = useCallback(() => setSp(new URLSearchParams(), { replace: true }), [setSp]);
  const active = DIM_KEYS.some((k) => filters[k]) || preset !== DEFAULT_PRESET;

  return { filters, preset, update, reset, active };
}
