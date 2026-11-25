import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useApi } from "../api/client";
import type { Operacion, OperacionesPage } from "../api/types";
import { FilterBar } from "../components/FilterBar";
import { useSync } from "../components/Layout";
import { cop, fecha, int, usd } from "../lib/format";
import { useFilters } from "../lib/filters";
import { TipoTag } from "./Dashboard";

const ESTADOS = ["Documentación", "En tránsito", "En aduana", "Inspección", "Liberado", "Entregado"];
const COLS: { key: keyof Operacion; label: string; align?: "r"; render?: (o: Operacion) => React.ReactNode }[] = [
  { key: "do", label: "DO", render: (o) => <b>{o.do}</b> },
  { key: "fecha_apertura", label: "Apertura", render: (o) => fecha(o.fecha_apertura) },
  { key: "tipo", label: "Tipo", render: (o) => <TipoTag tipo={o.tipo} /> },
  { key: "cliente", label: "Cliente" },
  { key: "pais", label: "País" },
  { key: "aduana", label: "Aduana" },
  { key: "modalidad", label: "Transporte" },
  { key: "valor_usd", label: "Valor USD", align: "r", render: (o) => usd(o.valor_usd, false) },
  { key: "tributos_cop", label: "Tributos", align: "r", render: (o) => (o.tributos_cop ? cop(o.tributos_cop) : "—") },
  { key: "estado", label: "Estado", render: (o) => <span className={`badge ${o.estado === "Entregado" ? "good" : ""}`}>{o.estado}</span> },
  { key: "dias_tramite", label: "Días trámite", align: "r", render: (o) => o.dias_tramite?.toLocaleString("es-CO") ?? "—" },
  { key: "ejecutivo", label: "Ejecutivo" },
];

export function Operations() {
  const { filters } = useFilters();
  const { version } = useSync();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [estado, setEstado] = useState("");
  const [orden, setOrden] = useState<keyof Operacion>("fecha_apertura");
  const [desc, setDesc] = useState(true);
  const [pagina, setPagina] = useState(1);
  const tamano = 25;

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPagina(1), [debounced, estado, filters]);

  const { data, error, loading } = useApi<OperacionesPage>("/api/operaciones", {
    ...filters, q: debounced, estado, orden, desc, pagina, tamano, v: version,
  });
  const paginas = data ? Math.max(1, Math.ceil(data.total / tamano)) : 1;

  const sortBy = (k: keyof Operacion) => {
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
            <input className="input" placeholder="Buscar DO, cliente, país, ejecutivo…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar operaciones" />
          </div>
          <select className="select" value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            {ESTADOS.map((e) => <option key={e}>{e}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <span className="muted">{data ? `${int(data.total)} operaciones` : "…"}</span>
        </div>
        {error ? <div className="error-box">{error}</div> : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="data">
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
                  <tr key={o.do}>
                    {COLS.map((c) => <td key={c.key} className={`${c.align ?? ""} ${c.align ? "num" : ""}`}>{c.render ? c.render(o) : String(o[c.key] ?? "—")}</td>)}
                  </tr>
                ))}
                {data && !data.filas.length && <tr><td colSpan={COLS.length} className="empty">No se encontraron operaciones.</td></tr>}
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
    </>
  );
}
