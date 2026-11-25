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

/** Filtros globales guardados en la URL (se pueden compartir como enlace). */
export function useFilters() {
  const [sp, setSp] = useSearchParams();
  const def = presetRange("12m");

  const filters: Filters = useMemo(() => ({
    desde: sp.get("desde") ?? def.desde,
    hasta: sp.get("hasta") ?? def.hasta,
    tipo: sp.get("tipo") ?? "",
    cliente: sp.get("cliente") ?? "",
    aduana: sp.get("aduana") ?? "",
    modalidad: sp.get("modalidad") ?? "",
  }), [sp, def.desde, def.hasta]);

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
  const active = !!(filters.tipo || filters.cliente || filters.aduana || filters.modalidad || preset !== "12m");

  return { filters, preset, update, reset, active };
}
