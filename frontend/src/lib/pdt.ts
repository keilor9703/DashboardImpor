/**
 * Filtros e indicadores de cumplimiento sobre la hoja «In Transit PDT».
 * Todo se calcula en el navegador a partir de /api/pdt, así los filtros responden al instante.
 *
 * Reglas de negocio:
 *  - La hoja «In Transit PDT» muestra por defecto solo embarques NO cerrados
 *    (todo excepto «Sap Entry Completed»); los cerrados se ven si el usuario los marca.
 *  - Indicadores del PDT total: solo embarques cerrados («Sap Entry Completed»).
 *  - Indicadores por etapa: cerrados + etapas ya completadas de los embarques en tránsito.
 */
import type { HojaPdt, RutaEtapas } from "../api/types";

/** Objetivo de cumplimiento (% de registros dentro de meta). Ajustable. */
export const OBJETIVO_CUMPLIMIENTO = 90;
export const STATUS_CERRADO = "Sap Entry Completed";

/** Orden natural del flujo (los status desconocidos van al final, en orden alfabético). */
const ORDEN_STATUS = [
  "Waiting for Pick up", "Waiting for Departure", "International Transit",
  "Waiting for Customs Clearance", "Waiting for Delivery", STATUS_CERRADO,
];

export const PAISES: Record<string, string> = {
  CO: "Colombia", EC: "Ecuador", BE: "Bélgica", BR: "Brasil", US: "Estados Unidos", VZ: "Venezuela",
  PE: "Perú", ZA: "Sudáfrica", MX: "México", DE: "Alemania", IT: "Italia",
};
export const pais = (c: unknown) => PAISES[String(c ?? "").toUpperCase()] ?? String(c ?? "—");

export interface PdtFiltros {
  q: string;
  /** null = selección por defecto (todos excepto cerrados) */
  status: string[] | null;
  origen: string;
  destino: string;
  soloFuera: boolean;
}

const v = (h: HojaPdt, fila: number, idx: number | null) => (idx == null ? null : h.filas[fila][idx]);
export const statusDe = (h: HojaPdt, fila: number) => String(v(h, fila, h.roles.status) ?? "");
export const esCerrado = (h: HojaPdt, fila: number) => statusDe(h, fila) === STATUS_CERRADO;

export function opciones(h: HojaPdt) {
  const uniq = (idx: number | null) =>
    [...new Set(h.filas.map((f) => (idx == null ? null : f[idx])).filter((x) => x != null && x !== "").map(String))].sort();
  const rank = (s: string) => {
    const i = ORDEN_STATUS.indexOf(s);
    return i === -1 ? ORDEN_STATUS.length : i;
  };
  const status = uniq(h.roles.status).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { status, origen: uniq(h.roles.origen), destino: uniq(h.roles.destino) };
}

/** Status seleccionados: la selección del usuario o, por defecto, todos los no cerrados. */
export const statusPorDefecto = (todos: string[]) => todos.filter((s) => s !== STATUS_CERRADO);
export const statusActivos = (f: PdtFiltros, todos: string[]) => f.status ?? statusPorDefecto(todos);

/**
 * Índices de filas que cumplen los filtros.
 * @param conStatus aplica el filtro de status (la hoja In Transit lo usa; Indicadores no).
 */
export function filtrar(h: HojaPdt, f: PdtFiltros, conStatus = true): number[] {
  const q = f.q.trim().toLowerCase();
  const permitidos = conStatus ? new Set(statusActivos(f, opciones(h).status)) : null;
  return h.filas.map((_, i) => i).filter((i) => {
    if (permitidos && !permitidos.has(statusDe(h, i))) return false;
    if (f.origen && String(v(h, i, h.roles.origen)) !== f.origen) return false;
    if (f.destino && String(v(h, i, h.roles.destino)) !== f.destino) return false;
    if (q) {
      const txt = [h.roles.embarque, h.roles.po].map((k) => String(v(h, i, k) ?? "")).join(" ").toLowerCase();
      if (!txt.includes(q)) return false;
    }
    if (conStatus && f.soloFuera && !fueraDeMeta(h, i)) return false;
    return true;
  });
}

/**
 * «Fuera de meta» según el estado del embarque:
 *  - cerrado: PDT total por encima de la meta;
 *  - en tránsito: alguna etapa ya completada por encima de su meta.
 */
export function fueraDeMeta(h: HojaPdt, i: number) {
  const m = h.medidas[i];
  if (esCerrado(h, i)) {
    const [t, meta] = m.total;
    return t != null && meta != null && t > meta;
  }
  return m.procesos.some(([, , d]) => d != null && d > 0);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (a: number, n: number) => (n ? (a / n) * 100 : null);
const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

export interface ProcesoKpi {
  key: string; titulo: string; titulo_es: string; color: string;
  medidos: number; enMeta: number; fuera: number; sinRegistro: number;
  cumplimiento: number | null; realProm: number | null; metaProm: number | null; diasPerdidos: number;
}

/** Pares [PDT total, meta] de las filas cerradas. */
function paresTotal(h: HojaPdt, filas: number[]) {
  return filas.filter((i) => esCerrado(h, i)).map((i) => h.medidas[i].total)
    .filter(([t, m]) => t != null && m != null) as [number, number][];
}

/**
 * @param filas filas que cumplen búsqueda/origen/destino (sin filtro de status).
 */
export function indicadores(h: HojaPdt, filas: number[]) {
  const cerradas = filas.filter((i) => esCerrado(h, i));
  const enTransito = filas.filter((i) => !esCerrado(h, i));

  // --- PDT total: solo cerrados ---
  const pares = paresTotal(h, filas);
  const enMetaT = pares.filter(([t, m]) => t <= m).length;
  const total = {
    registros: cerradas.length,
    medidos: pares.length,
    enMeta: enMetaT,
    fuera: pares.length - enMetaT,
    cumplimiento: pct(enMetaT, pares.length),
    realProm: avg(pares.map(([t]) => t)),
    metaProm: avg(pares.map(([, m]) => m)),
    desvProm: avg(pares.map(([t, m]) => t - m)),
  };

  // --- Por etapa: cerrados + etapas completadas de los embarques en tránsito ---
  const med = filas.map((i) => h.medidas[i]);
  const procesos: ProcesoKpi[] = h.procesos.map((p, k) => {
    const vals = med.map((m) => m.procesos[k]);
    const conDesv = vals.filter(([, , d]) => d != null) as [number | null, number | null, number][];
    const enMeta = conDesv.filter(([, , d]) => d <= 0).length;
    return {
      key: p.key, titulo: p.titulo, titulo_es: p.titulo_es, color: p.color,
      medidos: conDesv.length, enMeta, fuera: conDesv.length - enMeta,
      sinRegistro: vals.filter(([r]) => r == null).length,
      cumplimiento: pct(enMeta, conDesv.length),
      realProm: avg(conDesv.map(([r]) => r).filter((x): x is number => x != null)),
      metaProm: avg(conDesv.map(([, m]) => m).filter((x): x is number => x != null)),
      diasPerdidos: conDesv.reduce((a, [, , d]) => a + Math.max(d, 0), 0),
    };
  });
  const conMedida = procesos.filter((p) => p.cumplimiento != null);
  const critico = conMedida.length ? conMedida.reduce((a, b) => ((b.cumplimiento ?? 101) < (a.cumplimiento ?? 101) ? b : a)) : null;
  const totalPerdidos = procesos.reduce((a, p) => a + p.diasPerdidos, 0);

  // --- Embarques en tránsito con alguna etapa completada fuera de meta ---
  const transitoConAtraso = enTransito.filter((i) => fueraDeMeta(h, i)).length;

  // --- Por ruta: PDT total con cerrados; proceso crítico con todas las etapas medidas ---
  const grupos = new Map<string, number[]>();
  filas.forEach((i) => {
    const r = `${pais(v(h, i, h.roles.origen))} → ${pais(v(h, i, h.roles.destino))}`;
    grupos.set(r, [...(grupos.get(r) ?? []), i]);
  });
  const rutas = [...grupos.entries()].map(([ruta, idx]) => {
    const pr = paresTotal(h, idx);
    const en = pr.filter(([t, m]) => t <= m).length;
    let peor: { titulo: string; dias: number } | null = null;
    h.procesos.forEach((p, k) => {
      const dias = idx.reduce((a, i) => a + Math.max(h.medidas[i].procesos[k][2] ?? 0, 0), 0);
      if (dias > 0 && (!peor || dias > peor.dias)) peor = { titulo: p.titulo_es, dias };
    });
    return {
      ruta, cerrados: pr.length, enTransito: idx.filter((i) => !esCerrado(h, i)).length, enMeta: en,
      cumplimiento: pct(en, pr.length), realProm: avg(pr.map(([t]) => t)), metaProm: avg(pr.map(([, m]) => m)),
      procesoCritico: peor as { titulo: string; dias: number } | null,
    };
  }).sort((a, b) => b.cerrados + b.enTransito - (a.cerrados + a.enTransito));

  // --- Lead time por etapa vs meta, por ruta (etapas medidas de todos; PDT total de cerrados) ---
  const etapas: RutaEtapas[] = [...grupos.entries()].map(([ruta, idx]) => {
    const m = idx.map((i) => h.medidas[i]);
    const pr = paresTotal(h, idx);
    return {
      id: ruta, ruta, modo: "", unidades: idx.length,
      pdt_real: round1(avg(pr.map(([t]) => t))),
      pdt_meta: round1(avg(pr.map(([, mm]) => mm))),
      etapas: h.procesos.map((p, k) => {
        const medidas = m.map((x) => x.procesos[k]).filter(([r, , d]) => r != null && d != null);
        return {
          key: p.key, label: p.titulo_es, n: medidas.length,
          real: round1(avg(medidas.map(([r]) => r as number))),
          meta: round1(avg(m.map((x) => x.procesos[k][1]).filter((x): x is number => x != null))),
        };
      }),
    };
  }).sort((a, b) => b.unidades - a.unidades);

  // --- Distribución de la desviación del PDT total (cerrados) ---
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

  // --- Tendencia mensual por mes de ingreso a SAP (cerrados) ---
  const fechaSap = h.procesos[h.procesos.length - 1]?.roles.fecha_fin ?? null;
  const porMes = new Map<string, { n: number; en: number }>();
  cerradas.forEach((i) => {
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
    cerrados: cerradas.length, enTransito: enTransito.length, transitoConAtraso,
    rutas, etapas, distribucion, mensual,
  };
}

/** CSV para Excel (separador «;», BOM UTF-8). */
export function exportarCsv(h: HojaPdt, filas: number[], nombre = "In_Transit_PDT.csv") {
  const cols = [...h.identidad, ...h.procesos.flatMap((p) => p.columnas), ...h.total.columnas];
  const esc = (x: unknown) => {
    if (x == null) return "";
    let s = typeof x === "number" ? String(x).replace(".", ",") : String(x);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) s = s.slice(0, 16).replace("T", " ").replace(" 00:00", "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [cols.map((c) => esc(c.label)).join(";"), ...filas.map((i) => cols.map((c) => esc(h.filas[i][c.idx])).join(";"))];
  const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
