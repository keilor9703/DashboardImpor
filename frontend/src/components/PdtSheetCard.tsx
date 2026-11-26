/**
 * Réplica de la hoja «In Transit PDT»: 6 procesos + Total PDT.
 * Al hacer clic en un proceso se muestran sus columnas de detalle, tal cual están en el Excel.
 */
import { useMemo, useState } from "react";
import { useApi } from "../api/client";
import type { HojaPdt, PdtColumna, PdtProceso } from "../api/types";
import { fecha } from "../lib/format";
import { Card, useSync } from "./Layout";

const n1 = (v: number) => v.toLocaleString("es-CO", { maximumFractionDigits: 1 });
/** Texto legible sobre el color del proceso (el azul de la hoja lleva texto blanco). */
const inkOn = (hex: string) => {
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

function Tile({ p, on, onClick }: { p: PdtProceso; on: boolean; onClick: () => void }) {
  const r = p.resumen;
  const over = r.real_promedio != null && r.meta_promedio != null && r.real_promedio > r.meta_promedio;
  return (
    <button className={`pdt-tile ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}
      style={{ ["--pc" as string]: p.color, ["--pink" as string]: inkOn(p.color) }}>
      <span className="pdt-tile-head">{p.titulo}</span>
      <span className="pdt-tile-body">
        <span className="pdt-es">{p.titulo_es}</span>
        <b className={over ? "text-bad" : ""}>{r.real_promedio != null ? `${n1(r.real_promedio)} d` : "—"}</b>
        <span className="muted">meta prom. {r.meta_promedio != null ? `${n1(r.meta_promedio)} d` : "—"}</span>
        <span className="pdt-counts">
          <span className="pdt-out">{r.fuera_meta} fuera</span>
          <span className="pdt-in">{r.en_meta} en meta</span>
          {r.sin_registro > 0 && <span className="muted">{r.sin_registro} sin reg.</span>}
        </span>
      </span>
    </button>
  );
}

export function PdtSheetCard() {
  const { version } = useSync();
  const { data, error } = useApi<HojaPdt>("/api/pdt", { v: version });
  const [sel, setSel] = useState("p1");
  const [estado, setEstado] = useState("");
  const [soloFuera, setSoloFuera] = useState(false);

  const bloques = useMemo(() => (data ? [...data.procesos, data.total] : []), [data]);
  const proc = bloques.find((b) => b.key === sel) ?? bloques[0];
  const estados = useMemo(() => [...new Set((data?.filas ?? []).map((f) => String(f[0] ?? "")))].filter(Boolean), [data]);

  const filas = useMemo(() => {
    if (!data || !proc) return [];
    const desv = proc.columnas.find((c) => c.tipo === "desviacion");
    return data.filas.filter((f) => {
      if (estado && f[0] !== estado) return false;
      if (!soloFuera) return true;
      if (desv) return typeof f[desv.idx] === "number" && (f[desv.idx] as number) > 0;
      const [t, m] = [f[proc.columnas[0].idx], f[proc.columnas[1]?.idx ?? -1]];
      return typeof t === "number" && typeof m === "number" && t > m;
    });
  }, [data, proc, estado, soloFuera]);

  return (
    <Card className="span-12" title="In Transit PDT"
      subtitle="Hoja del Excel tal cual: tiempo real de cada proceso vs. su meta · haga clic en un proceso para ver su detalle"
      actions={data && (
        <>
          <select className="select" value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por status">
            <option value="">Todos los status</option>
            {estados.map((e) => <option key={e}>{e}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={soloFuera} onChange={(e) => setSoloFuera(e.target.checked)} /> Solo fuera de meta</label>
        </>
      )}>
      {error && <div className="error-box">{error}</div>}
      {data && proc && (
        <>
          <div className="pdt-tiles" role="tablist" aria-label="Procesos del PDT">
            {bloques.map((b) => <Tile key={b.key} p={b} on={b.key === proc.key} onClick={() => setSel(b.key)} />)}
          </div>
          <div className="pdt-caption">
            <span className="pdt-dot" style={{ background: proc.color }} />
            <b>{proc.titulo}</b> <span className="muted">· {proc.titulo_es} · {filas.length} de {data.registros} registros</span>
          </div>
          <div className="table-wrap pdt-table">
            <table className="data compact">
              <thead>
                <tr>
                  {data.identidad.map((c) => <th key={c.idx}>{c.label}</th>)}
                  {proc.columnas.map((c) => (
                    <th key={c.idx} className={c.tipo === "texto" ? "" : "r"}
                      style={{ background: proc.color, color: inkOn(proc.color) }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i}>
                    {data.identidad.map((c) => <td key={c.idx} className={c.idx === 1 ? "strong" : ""}>{f[c.idx] ?? "—"}</td>)}
                    {proc.columnas.map((c) => (
                      <td key={c.idx} className={c.tipo === "texto" ? "pdt-text" : "r num"}><Celda v={f[c.idx]} col={c} /></td>
                    ))}
                  </tr>
                ))}
                {!filas.length && <tr><td colSpan={99} className="empty">Sin registros con estos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
