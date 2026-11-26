/**
 * Filtros e indicadores de cumplimiento sobre la hoja «In Transit PDT».
 * Todo se calcula en el navegador a partir de /api/pdt, así los filtros responden al instante.
 */
import type { HojaPdt, RutaEtapas } from "../api/types";

/** Objetivo de cumplimiento (% de registros dentro de meta). Ajustable. */
export const OBJETIVO_CUMPLIMIENTO = 90;
export const STATUS_CERRADO = "Sap Entry Completed";

export const PAISES: Record<string, string> = {
  CO: "Colombia", EC: "Ecuador", BE: "Bélgica", BR: "Brasil", US: "Estados Unidos", VZ: "Venezuela",
  PE: "Perú", ZA: "Sudáfrica", MX: "México", DE: "Alemania", IT: "Italia",
};
export const pais = (c: unknown) => PAISES[String(c ?? "").toUpperCase()] ?? String(c ?? "—");

export interface PdtFiltros {
  q: string;
  status: string;
  origen: string;
  destino: string;
  soloFuera: boolean;
}
export const FILTROS_VACIOS: PdtFiltros = { q: "", status: "", origen: "", destino: "", soloFuera: false };

const v = (h: HojaPdt, fila: number, idx: number | null) => (idx == null ? null : h.filas[fila][idx]);

export function opciones(h: HojaPdt) {
  const uniq = (idx: number | null) =>
    [...new Set(h.filas.map((f) => (idx == null ? null : f[idx])).filter((x) => x != null && x !== "").map(String))].sort();
  return { status: uniq(h.roles.status), origen: uniq(h.roles.origen), destino: uniq(h.roles.destino) };
}

/** Índices de filas que cumplen los filtros. «soloFuera» usa el Total PDT. */
export function filtrar(h: HojaPdt, f: PdtFiltros): number[] {
  const q = f.q.trim().toLowerCase();
  return h.filas.map((_, i) => i).filter((i) => {
    if (f.status && String(v(h, i, h.roles.status)) !== f.status) return false;
    if (f.origen && String(v(h, i, h.roles.origen)) !== f.origen) return false;
    if (f.destino && String(v(h, i, h.roles.destino)) !== f.destino) return false;
    if (q) {
      const txt = [h.roles.embarque, h.roles.po].map((k) => String(v(h, i, k) ?? "")).join(" ").toLowerCase();
      if (!txt.includes(q)) return false;
    }
    if (f.soloFuera) {
      const [t, m] = h.medidas[i].total;
      if (!(t != null && m != null && t > m)) return false;
    }
    return true;
  });
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (a: number, n: number) => (n ? (a / n) * 100 : null);

export interface ProcesoKpi {
  key: string; titulo: string; titulo_es: string; color: string;
  medidos: number; enMeta: number; fuera: number; sinRegistro: number;
  cumplimiento: number | null; realProm: number | null; metaProm: number | null; diasPerdidos: number;
}

export function indicadores(h: HojaPdt, filas: number[]) {
  const med = filas.map((i) => h.medidas[i]);

  // --- Total PDT ---
  const pares = med.map((m) => m.total).filter(([t, m]) => t != null && m != null) as [number, number][];
  const enMetaT = pares.filter(([t, m]) => t <= m).length;
  const total = {
    registros: filas.length,
    medidos: pares.length,
    enMeta: enMetaT,
    fuera: pares.length - enMetaT,
    cumplimiento: pct(enMetaT, pares.length),
    realProm: avg(pares.map(([t]) => t)),
    metaProm: avg(pares.map(([, m]) => m)),
    desvProm: avg(pares.map(([t, m]) => t - m)),
  };

  // --- Por proceso ---
  const procesos: ProcesoKpi[] = h.procesos.map((p, k) => {
    const vals = med.map((m) => m.procesos[k]);
    const conDesv = vals.filter(([, , d]) => d != null) as [number | null, number | null, number][];
    const enMeta = conDesv.filter(([, , d]) => d <= 0).length;
    return {
      key: p.key, titulo: p.titulo, titulo_es: p.titulo_es, color: p.color,
      medidos: conDesv.length, enMeta, fuera: conDesv.length - enMeta,
      sinRegistro: vals.filter(([r]) => r == null).length,
      cumplimiento: pct(enMeta, conDesv.length),
      realProm: avg(vals.map(([r]) => r).filter((x): x is number => x != null)),
      metaProm: avg(vals.map(([, m]) => m).filter((x): x is number => x != null)),
      diasPerdidos: conDesv.reduce((a, [, , d]) => a + Math.max(d, 0), 0),
    };
  });
  const conMedida = procesos.filter((p) => p.cumplimiento != null);
  const critico = conMedida.length ? conMedida.reduce((a, b) => ((b.cumplimiento ?? 101) < (a.cumplimiento ?? 101) ? b : a)) : null;
  const totalPerdidos = procesos.reduce((a, p) => a + p.diasPerdidos, 0);

  // --- En curso que ya superan la meta total ---
  const abiertos = filas.filter((i) => String(v(h, i, h.roles.status)) !== STATUS_CERRADO);
  const enRiesgo = abiertos.filter((i) => {
    const [t, m] = h.medidas[i].total;
    return t != null && m != null && t > m;
  }).length;

  // --- Por ruta ---
  const grupos = new Map<string, number[]>();
  filas.forEach((i) => {
    const r = `${pais(v(h, i, h.roles.origen))} → ${pais(v(h, i, h.roles.destino))}`;
    grupos.set(r, [...(grupos.get(r) ?? []), i]);
  });
  const rutas = [...grupos.entries()].map(([ruta, idx]) => {
    const sub = indicadoresBasicos(h, idx);
    return { ruta, registros: idx.length, ...sub };
  }).sort((a, b) => b.registros - a.registros);

  // --- Lead time por proceso vs meta, por ruta (para el gráfico de barras con marca) ---
  const etapas: RutaEtapas[] = [...grupos.entries()].map(([ruta, idx]) => {
    const m = idx.map((i) => h.medidas[i]);
    const tot = m.map((x) => x.total).filter(([t]) => t != null) as [number, number | null][];
    return {
      id: ruta, ruta, modo: "", unidades: idx.length,
      pdt_real: round1(avg(tot.map(([t]) => t))),
      pdt_meta: round1(avg(tot.map(([, mm]) => mm).filter((x): x is number => x != null))),
      etapas: h.procesos.map((p, k) => {
        const reales = m.map((x) => x.procesos[k][0]).filter((x): x is number => x != null);
        const metas = m.map((x) => x.procesos[k][1]).filter((x): x is number => x != null);
        return { key: p.key, label: p.titulo_es, real: round1(avg(reales)), meta: round1(avg(metas)), n: reales.length };
      }),
    };
  }).sort((a, b) => b.unidades - a.unidades);

  // --- Distribución de la desviación total ---
  const tramos = [
    { label: "En meta o antes", min: -Infinity, max: 0, tono: "good" },
    { label: "1 a 3 días", min: 0, max: 3, tono: "warning" },
    { label: "4 a 7 días", min: 3, max: 7, tono: "serious" },
    { label: "8 a 15 días", min: 7, max: 15, tono: "critical" },
    { label: "Más de 15 días", min: 15, max: Infinity, tono: "critical" },
  ] as const;
  const distribucion = tramos.map((t) => ({
    label: t.label, tono: t.tono,
    registros: pares.filter(([r, m]) => r - m > t.min && r - m <= t.max).length,
  }));

  // --- Tendencia mensual (por mes de ingreso a SAP, registros cerrados) ---
  const fechaSap = h.procesos[h.procesos.length - 1]?.roles.fecha_fin ?? null;
  const porMes = new Map<string, { n: number; en: number }>();
  filas.forEach((i) => {
    const f = v(h, i, fechaSap);
    const [t, m] = h.medidas[i].total;
    if (typeof f !== "string" || t == null || m == null) return;
    const mes = f.slice(0, 7);
    const e = porMes.get(mes) ?? { n: 0, en: 0 };
    e.n += 1;
    if (t <= m) e.en += 1;
    porMes.set(mes, e);
  });
  const mensual = [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, e]) => ({ mes, registros: e.n, enMeta: e.en, cumplimiento: pct(e.en, e.n) }));

  return {
    total, procesos, critico, totalPerdidos,
    enCurso: abiertos.length, enRiesgo,
    rutas, etapas, distribucion, mensual,
  };
}

function indicadoresBasicos(h: HojaPdt, idx: number[]) {
  const pares = idx.map((i) => h.medidas[i].total).filter(([t, m]) => t != null && m != null) as [number, number][];
  const en = pares.filter(([t, m]) => t <= m).length;
  // proceso con más días perdidos en esta ruta
  let peor: { titulo: string; dias: number } | null = null;
  h.procesos.forEach((p, k) => {
    const dias = idx.reduce((a, i) => a + Math.max(h.medidas[i].procesos[k][2] ?? 0, 0), 0);
    if (dias > 0 && (!peor || dias > peor.dias)) peor = { titulo: p.titulo_es, dias };
  });
  return {
    medidos: pares.length, enMeta: en,
    cumplimiento: pct(en, pares.length),
    realProm: avg(pares.map(([t]) => t)),
    metaProm: avg(pares.map(([, m]) => m)),
    procesoCritico: peor as { titulo: string; dias: number } | null,
  };
}

const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

/** CSV para Excel (separador «;», BOM UTF-8). */
export function exportarCsv(h: HojaPdt, filas: number[], nombre = "In_Transit_PDT.csv") {
  const header = [...h.identidad, ...h.procesos.flatMap((p) => p.columnas), ...h.total.columnas].map((c) => c.label);
  const idxs = [...h.identidad, ...h.procesos.flatMap((p) => p.columnas), ...h.total.columnas].map((c) => c.idx);
  const esc = (x: unknown) => {
    if (x == null) return "";
    let s = typeof x === "number" ? String(x).replace(".", ",") : String(x);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) s = s.slice(0, 16).replace("T", " ").replace(" 00:00", "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [header.map(esc).join(";"), ...filas.map((i) => idxs.map((k) => esc(h.filas[i][k])).join(";"))];
  const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
