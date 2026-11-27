import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useApi } from "../api/client";
import type { EmbarqueDetalle, EmbarqueFila, EmbarquesPage, OpcionesFiltros } from "../api/types";
import { FilterBar } from "../components/FilterBar";
import { useSync } from "../components/Layout";
import { days, fecha, int } from "../lib/format";
import { useFilters } from "../lib/filters";

type Col = { key: keyof EmbarqueFila | "estado"; label: string; align?: "r"; render?: (o: EmbarqueFila) => React.ReactNode };

export function EstadoBadge({ estado }: { estado: string }) {
  const tone = estado === "Ingresado a SAP" ? "good" : "";
  return <span className={`badge ${tone}`}>{estado}</span>;
}

function Pdt({ v, meta }: { v: number | null; meta: number | null }) {
  if (v == null) return <span className="muted">—</span>;
  const over = meta != null && v > meta;
  return <span className={over ? "text-bad strong" : ""}>{v.toLocaleString("es-CO")}<span className="muted"> / {meta ?? "—"}</span></span>;
}

const COLS: Col[] = [
  { key: "embarque", label: "Embarque", render: (o) => <b>{o.embarque}</b> },
  { key: "estado", label: "Estado", render: (o) => <EstadoBadge estado={o.estado} /> },
  { key: "ruta", label: "Ruta" },
  { key: "modo", label: "Transporte" },
  { key: "naviera", label: "Naviera" },
  { key: "contenedores", label: "Cont.", align: "r" },
  { key: "lineas", label: "Líneas", align: "r" },
  { key: "atd", label: "Zarpe", render: (o) => fecha(o.atd) },
  { key: "eta", label: "ETA", render: (o) => fecha(o.eta) },
  { key: "ata", label: "Arribo", render: (o) => fecha(o.ata) },
  { key: "despacho", label: "Despacho", render: (o) => fecha(o.despacho) },
  { key: "sap", label: "SAP", render: (o) => fecha(o.sap) },
  { key: "pdt", label: "PDT / meta", align: "r", render: (o) => <Pdt v={o.pdt} meta={o.meta_pdt} /> },
];

export function Shipments() {
  const { filters } = useFilters();
  const { version } = useSync();
  const [sp, setSp] = useSearchParams();
  const selected = sp.get("id");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [estado, setEstado] = useState("");
  const [orden, setOrden] = useState<string>("fecha_ref");
  const [desc, setDesc] = useState(true);
  const [pagina, setPagina] = useState(1);
  const tamano = 25;
  const { data: opts } = useApi<OpcionesFiltros>("/api/filtros");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPagina(1), [debounced, estado, filters]);

  const { data, error, loading } = useApi<EmbarquesPage>("/api/embarques", {
    ...filters, q: debounced, estado, orden, desc, pagina, tamano, v: version,
  });
  const paginas = data ? Math.max(1, Math.ceil(data.total / tamano)) : 1;

  const open = (id: string | null) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (id) n.set("id", id); else n.delete("id");
      return n;
    }, { replace: true });
  };
  const sortBy = (k: string) => {
    if (orden === k) setDesc(!desc);
    else { setOrden(k); setDesc(true); }
  };

  return (
    <>
      <FilterBar />
      <section className="card">
        <div className="toolbar">
          <div className="search">
            <Search size={16} />
            <input className="input" placeholder="Buscar embarque, PO, contenedor, SKU, producto…" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Buscar embarques" />
          </div>
          <select className="select" value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            {opts?.estados.map((e) => <option key={e}>{e}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <span className="muted">{data ? `${int(data.total)} embarques` : "…"}</span>
        </div>
        {error ? <div className="error-box">{error}</div> : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="data clickable">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className={`sortable ${c.align ?? ""}`} onClick={() => sortBy(c.key)}
                      aria-sort={orden === c.key ? (desc ? "descending" : "ascending") : "none"}>
                      {c.label} {orden === c.key && (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.filas.map((o) => (
                  <tr key={o.embarque} onClick={() => open(o.embarque)} className={selected === o.embarque ? "selected" : ""}
                    tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(o.embarque)}>
                    {COLS.map((c) => (
                      <td key={c.key} className={`${c.align ?? ""} ${c.align ? "num" : ""}`}>
                        {c.render ? c.render(o) : String(o[c.key as keyof EmbarqueFila] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
                {data && !data.filas.length && <tr><td colSpan={COLS.length} className="empty">No se encontraron embarques.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="pager">
          <span>Página {pagina} de {paginas}</span>
          <button className="btn" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <button className="btn" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
        </div>
      </section>
      {selected && <Detalle id={selected} onClose={() => open(null)} />}
    </>
  );
}

function Detalle({ id, onClose }: { id: string; onClose: () => void }) {
  const { version } = useSync();
  const { data, error } = useApi<EmbarqueDetalle>(`/api/embarques/${encodeURIComponent(id)}`, { v: version });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const maxDias = data ? Math.max(1, ...data.etapas.map((e) => Math.max(e.real ?? 0, e.meta ?? 0))) : 1;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Detalle del embarque ${id}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <span className="muted">Embarque</span>
            <h2>{id}</h2>
            {data && <div className="drawer-sub"><EstadoBadge estado={data.estado} /> {data.ruta} · {data.modo}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </header>
        {error && <div className="error-box">{error}</div>}
        {data && (
          <div className="drawer-body">
            <div className="stat-row">
              <div><b className="num">{data.pdt != null ? days(data.pdt) : "En curso"}</b><span>PDT real</span></div>
              <div><b className="num">{days(data.meta_pdt)}</b><span>Meta PDT{!data.meta_oficial && " (ref.)"}</span></div>
            </div>

            <h4>Etapas del proceso</h4>
            <ol className="timeline">
              {data.etapas.map((e) => {
                const over = e.real != null && e.meta != null && e.real > e.meta;
                return (
                  <li key={e.key} className={e.fin ? "done" : e.en_curso ? "current" : ""}>
                    <div className="tl-head">
                      <b>{e.label}</b>
                      <span className={over ? "text-bad strong" : "muted"}>
                        {e.real != null ? `${e.real.toLocaleString("es-CO")} d` : "—"}{e.meta != null && ` / meta ${e.meta} d`}
                        {e.en_curso && " · en curso"}
                      </span>
                    </div>
                    <div className="tl-bar">
                      <div style={{ width: `${Math.min(100, ((e.real ?? 0) / maxDias) * 100)}%`, background: over ? "var(--serious)" : "var(--series-1)" }} />
                      {e.meta != null && <i style={{ left: `${Math.min(100, (e.meta / maxDias) * 100)}%` }} />}
                    </div>
                    <div className="tl-dates muted">{fecha(e.inicio)} → {e.fin ? fecha(e.fin) : "pendiente"}</div>
                  </li>
                );
              })}
            </ol>

            <h4>Datos logísticos</h4>
            <dl className="facts">
              <dt>Documento de transporte</dt><dd>{data.documento_transporte ?? "—"}</dd>
              <dt>Booking</dt><dd>{data.booking ?? "—"}</dd>
              <dt>Forwarder</dt><dd>{data.forwarder}</dd>
              <dt>Naviera</dt><dd>{data.naviera}</dd>
              <dt>Agente de aduana</dt><dd>{data.agente_aduana}</dd>
              <dt>Canal aduanero</dt><dd>{data.canal}</dd>
              <dt>ETA</dt><dd>{fecha(data.hitos.eta_actualizada ?? data.hitos.eta)}</dd>
              <dt>Contenedores</dt><dd>{data.contenedores.length ? data.contenedores.join(", ") : "—"}</dd>
            </dl>

            <h4>Productos ({int(data.lineas.length)} líneas)</h4>
            <div className="table-wrap">
              <table className="data compact">
                <thead><tr><th>PO</th><th>SKU</th><th>Producto</th><th className="r">Cantidad</th></tr></thead>
                <tbody>
                  {data.lineas.map((l, i) => (
                    <tr key={i}>
                      <td>{l.po ?? "—"}</td><td>{l.sku ?? "—"}</td>
                      <td title={l.franquicia} style={{ whiteSpace: "normal", minWidth: 180 }}>{l.material ?? "—"}</td>
                      <td className="r num">{int(l.cantidad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
