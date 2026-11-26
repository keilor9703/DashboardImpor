/**
 * Reporte PDT (lead time de punta a punta) con dos hojas:
 *  - «In Transit PDT»: la hoja del Excel, filtrable y ordenable.
 *  - «Indicadores»: indicadores de cumplimiento calculados sobre esa misma hoja.
 * Los filtros son compartidos por ambas hojas y quedan en la URL.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Info, Search } from "lucide-react";
import { useApi } from "../api/client";
import type { HojaPdt } from "../api/types";
import { EChart } from "../charts/EChart";
import { stagesBullet } from "../charts/options";
import { complianceByProcess, deviationBuckets, lostDays, monthlyCompliance } from "../charts/pdtOptions";
import { Card, useSync } from "../components/Layout";
import { PdtSheet } from "../components/PdtSheet";
import { int } from "../lib/format";
import { MultiSelect } from "../components/MultiSelect";
import {
  exportarCsv, filtrar, indicadores, OBJETIVO_CUMPLIMIENTO, opciones, pais, STATUS_CERRADO,
  statusActivos, statusPorDefecto, type PdtFiltros,
} from "../lib/pdt";

const HOJAS = [
  { id: "in-transit", label: "In Transit PDT" },
  { id: "indicadores", label: "Indicadores" },
] as const;

const n1 = (x: number | null | undefined, suf = "") => (x == null ? "—" : `${x.toLocaleString("es-CO", { maximumFractionDigits: 1 })}${suf}`);

/** Status en la URL: ausente = por defecto (todos excepto cerrados); «-» = ninguno; si no, lista separada por «|». */
function usePdtFiltros() {
  const [sp, setSp] = useSearchParams();
  const st = sp.get("st");
  const f: PdtFiltros = {
    q: sp.get("q") ?? "", origen: sp.get("or") ?? "", destino: sp.get("de") ?? "",
    status: st == null ? null : st === "-" ? [] : st.split("|"),
    soloFuera: sp.get("fm") === "1",
  };
  const set = (patch: Partial<PdtFiltros> & { statusDefecto?: boolean }) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    const put = (k: string, val: string) => (val ? n.set(k, val) : n.delete(k));
    if ("q" in patch) put("q", patch.q ?? "");
    if ("origen" in patch) put("or", patch.origen ?? "");
    if ("destino" in patch) put("de", patch.destino ?? "");
    if ("soloFuera" in patch) put("fm", patch.soloFuera ? "1" : "");
    if ("status" in patch) {
      if (patch.status == null || patch.statusDefecto) n.delete("st");
      else n.set("st", patch.status.length ? patch.status.join("|") : "-");
    }
    return n;
  }, { replace: true });
  const hoja = sp.get("hoja") === "indicadores" ? "indicadores" : "in-transit";
  const setHoja = (h: string) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    if (h === "in-transit") n.delete("hoja"); else n.set("hoja", h);
    return n;
  }, { replace: true });
  const limpiar = () => setSp(hoja === "indicadores" ? new URLSearchParams({ hoja }) : new URLSearchParams(), { replace: true });
  const activo = !!(f.q || f.origen || f.destino || f.soloFuera || f.status != null);
  return { f, set, hoja, setHoja, limpiar, activo };
}

export function Pdt() {
  const { version } = useSync();
  const { data, error } = useApi<HojaPdt>("/api/pdt", { v: version });
  const { f, set, hoja, setHoja, limpiar, activo } = usePdtFiltros();
  const [q, setQ] = useState(f.q);
  useEffect(() => {
    const id = setTimeout(() => q !== f.q && set({ q }), 250);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const opts = useMemo(() => (data ? opciones(data) : null), [data]);
  const stKey = f.status?.join("|") ?? "*";
  // La hoja In Transit aplica el filtro de status; Indicadores no (sus reglas definen qué entra en cada cálculo).
  const filas = useMemo(() => (data ? filtrar(data, f, hoja === "in-transit") : []),
    [data, f.q, stKey, f.origen, f.destino, f.soloFuera, hoja]); // eslint-disable-line react-hooks/exhaustive-deps
  const seleccion = opts ? statusActivos(f, opts.status) : [];
  const enTransito = opts ? statusPorDefecto(opts.status) : [];

  return (
    <>
      <div className="sheet-tabs" role="tablist" aria-label="Hojas del reporte PDT">
        {HOJAS.map((h) => (
          <button key={h.id} role="tab" aria-selected={hoja === h.id} className={hoja === h.id ? "on" : ""} onClick={() => setHoja(h.id)}>
            {h.label}
          </button>
        ))}
      </div>

      <div className="filters" role="search" aria-label="Filtros del reporte PDT">
        <div className="search field">
          <span>Buscar</span>
          <div style={{ position: "relative" }}>
            <Search size={16} />
            <input className="input" placeholder="Embarque o PO…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar embarque o PO" />
          </div>
        </div>
        {hoja === "in-transit" && opts && (
          <MultiSelect label="Status" opciones={opts.status} seleccion={seleccion}
            atajos={[
              { label: "Solo en tránsito", valores: enTransito },
              { label: "Todos", valores: opts.status },
              { label: "Solo cerrados", valores: opts.status.filter((x) => x === STATUS_CERRADO) },
            ]}
            onChange={(sel) => {
              const esDefecto = sel.length === enTransito.length && sel.every((x) => enTransito.includes(x));
              set({ status: sel, statusDefecto: esDefecto });
            }} />
        )}
        <label className="field"><span>Origen</span>
          <select className="select" value={f.origen} onChange={(e) => set({ origen: e.target.value })}>
            <option value="">Todos</option>
            {opts?.origen.map((s) => <option key={s} value={s}>{pais(s)}</option>)}
          </select>
        </label>
        <label className="field"><span>Destino</span>
          <select className="select" value={f.destino} onChange={(e) => set({ destino: e.target.value })}>
            <option value="">Todos</option>
            {opts?.destino.map((s) => <option key={s} value={s}>{pais(s)}</option>)}
          </select>
        </label>
        {hoja === "in-transit" ? (
          <label className="check" style={{ alignSelf: "center", marginTop: 16 }}
            title="Cerrados: PDT total sobre la meta. En tránsito: alguna etapa completada sobre su meta.">
            <input type="checkbox" checked={f.soloFuera} onChange={(e) => set({ soloFuera: e.target.checked })} /> Solo fuera de meta
          </label>
        ) : (
          <div className="scope-note"><Info size={14} />
            <span>PDT total: solo <b>{STATUS_CERRADO}</b> · etapas: cerrados y en tránsito</span>
          </div>
        )}
        <div className="grow" />
        <span className="period-note">{data ? `${int(filas.length)} de ${int(data.registros)} registros` : "…"}</span>
        {activo && <button className="link-btn" onClick={() => { setQ(""); limpiar(); }}>Limpiar</button>}
        <button className="btn" disabled={!data || !filas.length} onClick={() => data && exportarCsv(data, filas)}>
          <Download size={14} /> Exportar a Excel
        </button>
      </div>

      {error && <div className="card error-box">No fue posible cargar la hoja In Transit PDT: {error}</div>}
      {!data && !error && <div className="card skeleton" style={{ height: 420 }} />}
      {data && hoja === "in-transit" && (
        <Card title="In Transit PDT" subtitle="Hoja del Excel tal cual · haga clic en un proceso para ver su detalle">
          <PdtSheet hoja={data} filas={filas} />
        </Card>
      )}
      {data && hoja === "indicadores" && <Indicadores hoja={data} filas={filas} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function Badge({ v }: { v: number | null }) {
  if (v == null) return <span className="muted">—</span>;
  const tone = v >= OBJETIVO_CUMPLIMIENTO ? "good" : v >= 70 ? "serious" : "critical";
  return <span className={`badge ${tone}`}>{n1(v, " %")}</span>;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: React.ReactNode; tone?: "bad" | "good" }) {
  return (
    <section className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value num ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""}`}>{value}</div>
      <div className="kpi-foot">{sub}</div>
    </section>
  );
}

function Indicadores({ hoja, filas }: { hoja: HojaPdt; filas: number[] }) {
  const ind = useMemo(() => indicadores(hoja, filas), [hoja, filas]);
  const [ruta, setRuta] = useState("");
  const rutaSel = ind.etapas.find((e) => e.id === ruta) ?? ind.etapas[0];
  const t = ind.total;
  const procesosConTotal = useMemo(() => [
    ...ind.procesos,
    { key: "total", titulo: "Total PDT", titulo_es: "Total PDT", color: "", medidos: t.medidos, enMeta: t.enMeta, fuera: t.fuera,
      sinRegistro: t.registros - t.medidos, cumplimiento: t.cumplimiento, realProm: t.realProm, metaProm: t.metaProm, diasPerdidos: 0, esTotal: true },
  ], [ind, t]);

  if (!filas.length) return <div className="card empty">Sin registros con los filtros actuales.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="banner">
        <Info size={16} />
        <span>Un registro (embarque + PO) <b>cumple</b> cuando su tiempo real es menor o igual a la meta · objetivo <b>{OBJETIVO_CUMPLIMIENTO} %</b>.
          El <b>PDT total</b> se evalúa solo con embarques cerrados ({int(ind.cerrados)}); las <b>etapas</b>, con los cerrados y las etapas
          ya completadas de los {int(ind.enTransito)} en tránsito.</span>
      </div>

      <div className="kpis kpis-5">
        <Stat label="Cumplimiento PDT total" value={n1(t.cumplimiento, " %")}
          tone={t.cumplimiento != null && t.cumplimiento < OBJETIVO_CUMPLIMIENTO ? "bad" : "good"}
          sub={<>{int(t.enMeta)} de {int(t.medidos)} cerrados en meta · objetivo {OBJETIVO_CUMPLIMIENTO} %</>} />
        <Stat label="PDT promedio real" value={n1(t.realProm, " d")}
          tone={t.realProm != null && t.metaProm != null && t.realProm > t.metaProm ? "bad" : undefined}
          sub={<>meta promedio {n1(t.metaProm, " d")}</>} />
        <Stat label="Desviación promedio" value={t.desvProm == null ? "—" : `${t.desvProm > 0 ? "+" : ""}${n1(t.desvProm, " d")}`}
          tone={t.desvProm != null && t.desvProm > 0 ? "bad" : "good"}
          sub={t.desvProm != null && t.desvProm <= 0 ? "por debajo de la meta, en promedio" : "por encima de la meta, en promedio"} />
        <Stat label="Etapa más crítica" value={ind.critico?.titulo_es ?? "—"}
          sub={ind.critico ? <>{n1(ind.critico.cumplimiento, " %")} en meta · {n1(ind.critico.diasPerdidos, " d")} sobre la meta</> : "—"} />
        <Stat label="En tránsito con etapas fuera de meta" value={int(ind.transitoConAtraso)} tone={ind.transitoConAtraso ? "bad" : "good"}
          sub={<>de {int(ind.enTransito)} registros en tránsito</>} />
      </div>

      <div className="grid">
        <Card className="span-6" title="Cumplimiento por etapa" subtitle="% de etapas completadas dentro de la meta · Total PDT: solo cerrados">
          <EChart ariaLabel="Cumplimiento por proceso" height={300}
            build={(tk) => complianceByProcess(procesosConTotal, OBJETIVO_CUMPLIMIENTO, tk)} deps={[procesosConTotal]} />
        </Card>
        <Card className="span-6" title="Días perdidos por etapa"
          subtitle={`Días acumulados por encima de la meta · total ${n1(ind.totalPerdidos, " d")}`}>
          <EChart ariaLabel="Días perdidos por proceso" height={300}
            build={(tk) => lostDays(ind.procesos, ind.totalPerdidos, tk)} deps={[ind.procesos, ind.totalPerdidos]} />
        </Card>

        <Card className="span-7" title="Lead time por etapa vs. meta"
          subtitle="Días promedio de las etapas completadas (barra) frente a la meta (marca) · PDT total: cerrados"
          actions={ind.etapas.length > 0 && (
            <select className="select" value={rutaSel?.id} onChange={(e) => setRuta(e.target.value)} aria-label="Ruta">
              {ind.etapas.map((e) => <option key={e.id} value={e.id}>{e.id} ({e.unidades})</option>)}
            </select>
          )}>
          {rutaSel && (
            <>
              <div className="pdt-summary">
                <div><span>PDT real</span><b className={rutaSel.pdt_real != null && rutaSel.pdt_meta != null && rutaSel.pdt_real > rutaSel.pdt_meta ? "bad" : ""}>{n1(rutaSel.pdt_real, " días")}</b></div>
                <div><span>Meta PDT</span><b>{n1(rutaSel.pdt_meta, " días")}</b></div>
                <div><span>Registros</span><b>{int(rutaSel.unidades)}</b></div>
                <div className="legend" style={{ marginLeft: "auto" }}>
                  <span><i style={{ background: "var(--serious)" }} />Sobre la meta</span>
                  <span><i style={{ background: "var(--series-muted)" }} />En meta</span>
                  <span><i style={{ background: "var(--text)", width: 3 }} />Meta</span>
                </div>
              </div>
              <EChart ariaLabel={`Lead time por proceso para ${rutaSel.id}`} height={280}
                build={(tk) => stagesBullet(rutaSel, tk)} deps={[rutaSel]} />
            </>
          )}
        </Card>
        <Card className="span-5" title="Distribución de la desviación" subtitle="Días del PDT total por encima de la meta · embarques cerrados">
          <EChart ariaLabel="Distribución de la desviación del PDT total" height={330}
            build={(tk) => deviationBuckets(ind.distribucion, tk)} deps={[ind.distribucion]} />
        </Card>

        <Card className="span-8" title="Cumplimiento por ruta" subtitle="PDT total de los embarques cerrados · etapa crítica con cerrados y en tránsito">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Ruta</th><th className="r">Cerrados</th><th className="r">En tránsito</th><th className="r">PDT real / meta</th>
                  <th className="r">Cumplimiento</th><th>Etapa crítica</th></tr>
              </thead>
              <tbody>
                {ind.rutas.map((r) => (
                  <tr key={r.ruta}>
                    <td className="strong">{r.ruta}</td>
                    <td className="r num">{int(r.cerrados)}</td>
                    <td className="r num">{int(r.enTransito)}</td>
                    <td className="r num">
                      <span className={r.realProm != null && r.metaProm != null && r.realProm > r.metaProm ? "text-bad strong" : "strong"}>{n1(r.realProm, " d")}</span>
                      <span className="muted"> / {n1(r.metaProm, " d")}</span>
                    </td>
                    <td className="r"><Badge v={r.cumplimiento} /></td>
                    <td style={{ whiteSpace: "normal", minWidth: 130 }}>{r.procesoCritico ? <>{r.procesoCritico.titulo} <span className="muted">· +{n1(r.procesoCritico.dias, " d")}</span></> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="span-4" title="Tendencia mensual" subtitle="% de cumplimiento del PDT por mes de ingreso a SAP">
          {ind.mensual.length
            ? <EChart ariaLabel="Cumplimiento mensual del PDT" height={260}
                build={(tk) => monthlyCompliance(ind.mensual, OBJETIVO_CUMPLIMIENTO, tk)} deps={[ind.mensual]} />
            : <div className="empty">Aún no hay registros ingresados a SAP con estos filtros.</div>}
        </Card>

      </div>
    </div>
  );
}
