/**
 * Hoja «In Transit PDT» tal cual: 6 procesos + Total PDT. Al hacer clic en un proceso se ven
 * sus columnas de detalle. Columnas ordenables; filtra según los filtros del reporte.
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { HojaPdt, PdtColumna, PdtProceso } from "../api/types";
import { fecha } from "../lib/format";

const n1 = (v: number) => v.toLocaleString("es-CO", { maximumFractionDigits: 1 });
/** Texto legible sobre el color del proceso (el azul de la hoja lleva texto blanco). */
export const inkOn = (hex: string) => {
  const c = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (c >> 16) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
  return lum < 0.62 ? "#ffffff" : "#1b2230";
};

function Celda({ v, col }: { v: string | number | null; col: PdtColumna }) {
  if (v == null || v === "") return <span className="muted">—</span>;
  if (typeof v === "string" && v.toLowerCase() === "sin registro") return <span className="muted">Sin registro</span>;
  if (col.tipo === "fecha" && typeof v === "string") {
    return <>{fecha(v)}{v.slice(11, 16) !== "00:00" && <span className="muted"> {v.slice(11, 16)}</span>}</>;
  }
  if (col.tipo === "desviacion" && typeof v === "number") {
    return <span className={v > 0 ? "pdt-out" : "pdt-in"}>{v > 0 ? "+" : ""}{n1(v)} d</span>;
  }
  if (col.tipo === "dias" && typeof v === "number") return <>{n1(v)} d</>;
  if (col.tipo === "texto") return <span className="clamp" title={String(v)}>{String(v)}</span>;
  return <>{String(v)}</>;
}

/** Resumen de un proceso calculado sobre las filas visibles. */
function resumen(h: HojaPdt, filas: number[], k: number | "total") {
  const vals = filas.map((i) => (k === "total" ? [...h.medidas[i].total, null] : h.medidas[i].procesos[k]));
  const reales = vals.map((x) => x[0]).filter((x): x is number => x != null);
  const metas = vals.map((x) => x[1]).filter((x): x is number => x != null);
  const desv = vals.map((x) => (k === "total" ? (x[0] != null && x[1] != null ? x[0] - x[1] : null) : x[2])).filter((x): x is number => x != null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    real: avg(reales), meta: avg(metas),
    fuera: desv.filter((d) => d > 0).length, en: desv.filter((d) => d <= 0).length,
    sin: vals.filter((x) => x[0] == null).length,
  };
}

function Tile({ p, r, on, onClick }: { p: PdtProceso; r: ReturnType<typeof resumen>; on: boolean; onClick: () => void }) {
  const over = r.real != null && r.meta != null && r.real > r.meta;
  return (
    <button className={`pdt-tile ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}
      style={{ ["--pc" as string]: p.color, ["--pink" as string]: inkOn(p.color) }}>
      <span className="pdt-tile-head">{p.titulo}</span>
      <span className="pdt-tile-body">
        <span className="pdt-es">{p.titulo_es}</span>
        <b className={over ? "text-bad" : ""}>{r.real != null ? `${n1(r.real)} d` : "—"}</b>
        <span className="muted">meta prom. {r.meta != null ? `${n1(r.meta)} d` : "—"}</span>
        <span className="pdt-counts">
          <span className="pdt-out">{r.fuera} fuera</span>
          <span className="pdt-in">{r.en} en meta</span>
          {r.sin > 0 && <span className="muted">{r.sin} sin reg.</span>}
        </span>
      </span>
    </button>
  );
}

const comparar = (a: unknown, b: unknown) => {
  const nulo = (x: unknown) => x == null || x === "" || (typeof x === "string" && x.toLowerCase() === "sin registro");
  if (nulo(a) && nulo(b)) return 0;
  if (nulo(a)) return 1;
  if (nulo(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es");
};

export function PdtSheet({ hoja, filas }: { hoja: HojaPdt; filas: number[] }) {
  const [sel, setSel] = useState("p1");
  const [orden, setOrden] = useState<{ idx: number; desc: boolean } | null>(null);
  const bloques = useMemo(() => [...hoja.procesos, hoja.total], [hoja]);
  const proc = bloques.find((b) => b.key === sel) ?? bloques[0];

  const visibles = useMemo(() => {
    if (!orden) return filas;
    const out = [...filas].sort((a, b) => comparar(hoja.filas[a][orden.idx], hoja.filas[b][orden.idx]));
    return orden.desc ? out.reverse() : out;
  }, [filas, orden, hoja]);

  const sortBy = (idx: number) =>
    setOrden((o) => (o?.idx === idx ? (o.desc ? null : { idx, desc: true }) : { idx, desc: false }));
  const flecha = (idx: number) => orden?.idx === idx && (orden.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />);

  return (
    <>
      <div className="pdt-tiles" role="tablist" aria-label="Procesos del PDT">
        {bloques.map((b, k) => (
          <Tile key={b.key} p={b} on={b.key === proc.key} onClick={() => setSel(b.key)}
            r={resumen(hoja, filas, b.key === "total" ? "total" : k)} />
        ))}
      </div>
      <div className="pdt-caption">
        <span className="pdt-dot" style={{ background: proc.color }} />
        <b>{proc.titulo}</b>
        <span className="muted">· {proc.titulo_es} · {visibles.length} de {hoja.registros} registros · clic en un encabezado para ordenar</span>
      </div>
      <div className="table-wrap pdt-table">
        <table className="data compact">
          <thead>
            <tr>
              {hoja.identidad.map((c) => (
                <th key={c.idx} className="sortable" onClick={() => sortBy(c.idx)}>{c.label} {flecha(c.idx)}</th>
              ))}
              {proc.columnas.map((c) => (
                <th key={c.idx} className={`sortable ${c.tipo === "texto" ? "" : "r"}`} onClick={() => sortBy(c.idx)}
                  style={{ background: proc.color, color: inkOn(proc.color) }}>{c.label} {flecha(c.idx)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((i) => {
              const f = hoja.filas[i];
              return (
                <tr key={i}>
                  {hoja.identidad.map((c) => <td key={c.idx} className={c.idx === hoja.roles.embarque ? "strong" : ""}>{f[c.idx] ?? "—"}</td>)}
                  {proc.columnas.map((c) => (
                    <td key={c.idx} className={c.tipo === "texto" ? "pdt-text" : "r num"}><Celda v={f[c.idx]} col={c} /></td>
                  ))}
                </tr>
              );
            })}
            {!visibles.length && <tr><td colSpan={99} className="empty">Sin registros con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
