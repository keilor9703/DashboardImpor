import { useApi } from "../api/client";
import type { OpcionesFiltros } from "../api/types";
import { fecha } from "../lib/format";
import { PRESETS, presetRange, useFilters } from "../lib/filters";

export function FilterBar() {
  const { filters, preset, update, reset, active } = useFilters();
  const { data: opts } = useApi<OpcionesFiltros>("/api/filtros");

  const select = (key: "cliente" | "aduana" | "modalidad", label: string, items: string[] = [], all: string) => (
    <label className="field">
      <span>{label}</span>
      <select className="select" value={filters[key]} onChange={(e) => update({ [key]: e.target.value })}>
        <option value="">{all}</option>
        {items.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  return (
    <div className="filters" role="search" aria-label="Filtros del tablero">
      <div className="field">
        <span>Período</span>
        <div className="segmented">
          {PRESETS.map((p) => (
            <button key={p.id} className={preset === p.id ? "on" : ""} onClick={() => update(presetRange(p.id))}>{p.label}</button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Desde</span>
        <input className="input" type="date" value={filters.desde} min={opts?.fecha_min ?? undefined} max={filters.hasta}
          onChange={(e) => e.target.value && update({ desde: e.target.value })} />
      </label>
      <label className="field">
        <span>Hasta</span>
        <input className="input" type="date" value={filters.hasta} min={filters.desde}
          onChange={(e) => e.target.value && update({ hasta: e.target.value })} />
      </label>
      <div className="field">
        <span>Tipo de operación</span>
        <div className="segmented">
          {[["", "Todas"], ["Importación", "Importación"], ["Exportación", "Exportación"]].map(([v, l]) => (
            <button key={l} className={filters.tipo === v ? "on" : ""} onClick={() => update({ tipo: v })}>{l}</button>
          ))}
        </div>
      </div>
      {select("cliente", "Cliente", opts?.clientes, "Todos los clientes")}
      {select("aduana", "Aduana", opts?.aduanas, "Todas las aduanas")}
      {select("modalidad", "Transporte", opts?.modalidades, "Todos")}
      <div className="grow" />
      {active ? <button className="link-btn" onClick={reset}>Limpiar filtros</button>
        : <span className="period-note">{fecha(filters.desde)} – {fecha(filters.hasta)}</span>}
    </div>
  );
}
