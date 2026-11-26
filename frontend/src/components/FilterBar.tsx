import { useApi } from "../api/client";
import type { OpcionesFiltros } from "../api/types";
import { fecha } from "../lib/format";
import { PRESETS, presetRange, useFilters } from "../lib/filters";

const MODOS = ["Marítimo", "Terrestre", "Aéreo"];

export function FilterBar() {
  const { filters, preset, update, reset, active } = useFilters();
  const { data: opts } = useApi<OpcionesFiltros>("/api/filtros");
  const selects = opts?.dimensiones.filter((d) => d.key !== "modo") ?? [];

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
        <input className="input" type="date" value={filters.desde} max={filters.hasta}
          onChange={(e) => e.target.value && update({ desde: e.target.value })} />
      </label>
      <label className="field">
        <span>Hasta</span>
        <input className="input" type="date" value={filters.hasta} min={filters.desde}
          onChange={(e) => e.target.value && update({ hasta: e.target.value })} />
      </label>
      <div className="field">
        <span>Transporte</span>
        <div className="segmented">
          {[["", "Todos"], ...MODOS.map((m) => [m, m])].map(([v, l]) => (
            <button key={l} className={filters.modo === v ? "on" : ""} onClick={() => update({ modo: v })}>{l}</button>
          ))}
        </div>
      </div>
      {selects.map((d) => (
        <label className="field" key={d.key}>
          <span>{d.label}</span>
          <select className="select" value={filters[d.key] ?? ""} onChange={(e) => update({ [d.key]: e.target.value })}>
            <option value="">Todos</option>
            {d.opciones.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      ))}
      <div className="grow" />
      {active ? <button className="link-btn" onClick={reset}>Limpiar filtros</button>
        : <span className="period-note">{fecha(filters.desde)} – {fecha(filters.hasta)}</span>}
    </div>
  );
}
