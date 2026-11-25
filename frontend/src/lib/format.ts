import type { KpiFormat } from "../api/types";

const nf = (d = 0) => new Intl.NumberFormat("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });

/** US$ 79,1 M  ·  US$ 845 mil */
export function usd(v: number | null | undefined, compact = true) {
  if (v == null) return "—";
  if (!compact) return `US$ ${nf(0).format(v)}`;
  const a = Math.abs(v);
  if (a >= 1e9) return `US$ ${nf(1).format(v / 1e9)} mil M`;
  if (a >= 1e6) return `US$ ${nf(1).format(v / 1e6)} M`;
  if (a >= 1e3) return `US$ ${nf(0).format(v / 1e3)} mil`;
  return `US$ ${nf(0).format(v)}`;
}

/** Pesos colombianos en millones: $ 87.305 M */
export function cop(v: number | null | undefined) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `$ ${nf(0).format(v / 1e6)} M`;
  return `$ ${nf(0).format(v)}`;
}

export const int = (v: number | null | undefined) => (v == null ? "—" : nf(0).format(v));
export const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${nf(d).format(v)} %`);
export const days = (v: number | null | undefined) => (v == null ? "—" : `${nf(1).format(v)} días`);

export function formatValue(v: number | null | undefined, f: KpiFormat) {
  switch (f) {
    case "usd": return usd(v);
    case "cop": return cop(v);
    case "days": return days(v);
    case "pct": return pct(v);
    default: return int(v);
  }
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-03" -> "mar 26" */
export function mesCorto(m: string) {
  const [y, mm] = m.split("-");
  return `${MESES[Number(mm) - 1]} ${y.slice(2)}`;
}

export function fecha(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

export function horaRelativa(iso: string | null | undefined) {
  if (!iso) return "sin sincronizar";
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  const hora = d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  if (min < 1) return `hace instantes · ${hora}`;
  if (min < 60) return `hace ${min} min · ${hora}`;
  return `${fecha(iso)} · ${hora}`;
}

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
