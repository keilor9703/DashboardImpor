import { useEffect, useState } from "react";
import { AlertTriangle, CircleAlert, Info, Ship } from "lucide-react";
import { Link } from "react-router-dom";
import { useApi } from "../api/client";
import type { DashboardData, RutaResumen } from "../api/types";
import { EChart } from "../charts/EChart";
import { carriers, franchises, monthlyByRoute, pipeline, stagesBullet } from "../charts/options";
import { Card, useSync } from "../components/Layout";
import { FilterBar } from "../components/FilterBar";
import { KpiCard } from "../components/KpiCard";
import { PdtSheetCard } from "../components/PdtSheetCard";
import { days, int, pct, usd } from "../lib/format";
import { useFilters } from "../lib/filters";

const ROUTE_VARS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-muted)"];

export function Dashboard() {
  const { filters } = useFilters();
  const { version } = useSync();
  const { data, error, loading } = useApi<DashboardData>("/api/dashboard", { ...filters, v: version });

  return (
    <>
      <FilterBar />
      {data?.fuente.tipo === "mock" && (
        <div className="banner"><Info size={16} /><span>Está viendo <b>datos simulados</b>. Configure la fuente de datos para ver el Excel real.</span></div>
      )}
      {error && <div className="card error-box">No fue posible cargar el tablero: {error}</div>}
      {!data && loading && <Skeleton />}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, opacity: loading ? 0.65 : 1, transition: "opacity .2s" }}>
          <div className="kpis">
            {data.kpis.map((k) => <KpiCard key={k.id} kpi={k} color="text2" />)}
          </div>

          <div className="grid">
            <Card className="span-8" title="Valor movilizado por mes"
              subtitle="USD por ruta · según fecha de zarpe (o recogida si aún no zarpa)"
              actions={<Legend items={[...data.rutas_top, "Otras"]} />}>
              {data.mensual.length ? (
                <EChart ariaLabel="Valor movilizado por mes y ruta" height={300}
                  build={(t) => monthlyByRoute(data.mensual, data.rutas_top, t)} deps={[data.mensual, data.rutas_top]} />
              ) : <Empty />}
            </Card>

            <Card className="span-4" title="Torre de control" subtitle="Embarques abiertos hoy, por estado">
              <div className="stat-row">
                <div><b className="num">{int(data.resumen.en_curso)}</b><span>Embarques abiertos</span></div>
                <div><b className="num">{usd(data.resumen.valor_en_curso_usd)}</b><span>Valor en curso</span></div>
                <div className={data.resumen.con_alerta ? "alert" : ""}><b className="num">{int(data.resumen.con_alerta)}</b><span>Fuera de meta</span></div>
              </div>
              <EChart ariaLabel="Embarques abiertos por estado" height={200}
                build={(t) => pipeline(data.pipeline, t)} deps={[data.pipeline]} />
            </Card>

            <PdtSheetCard />

            <StagesCard data={data} />

            <Card className="span-5" title="Próximos arribos" subtitle="Embarques por llegar, según ETA vigente">
              <Arribos data={data} />
            </Card>

            <Card className="span-12" title="Desempeño por ruta"
              subtitle="Lead time total (PDT): desde la creación de la PO hasta el ingreso a SAP · unidades cerradas del período">
              <Rutas rows={data.rutas} />
            </Card>

            <Card className="span-12" title="Embarques fuera de meta"
              subtitle="Embarques abiertos cuyo tiempo en la etapa actual supera la meta de esa etapa"
              actions={<Link className="link-btn" to="/embarques">Ver todos los embarques →</Link>}>
              <Alertas data={data} />
            </Card>

            <Card className="span-4" title="Tránsito por naviera" subtitle="Días promedio de zarpe a arribo · (n.º embarques)">
              {data.navieras.length ? (
                <EChart ariaLabel="Tránsito promedio por naviera" height={Math.max(160, data.navieras.length * 38)}
                  build={(t) => carriers(data.navieras, t)} deps={[data.navieras]} />
              ) : <Empty />}
            </Card>

            <Card className="span-5" title="Valor por franquicia" subtitle="USD · en gris, líneas sin franquicia en el Excel">
              {data.franquicias.length ? (
                <EChart ariaLabel="Valor por franquicia" height={Math.max(160, data.franquicias.length * 30)}
                  build={(t) => franchises(data.franquicias, t)} deps={[data.franquicias]} />
              ) : <Empty />}
            </Card>

            <Card className="span-3" title="Canal aduanero" subtitle="Embarques nacionalizados">
              <Canales data={data.canales} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function Legend({ items }: { items: string[] }) {
  return (
    <div className="legend">
      {items.map((r, i) => <span key={r}><i style={{ background: ROUTE_VARS[i] ?? ROUTE_VARS[3] }} />{r}</span>)}
    </div>
  );
}

function StagesCard({ data }: { data: DashboardData }) {
  const [sel, setSel] = useState(data.etapas[0]?.id ?? "");
  useEffect(() => {
    if (!data.etapas.some((e) => e.id === sel)) setSel(data.etapas[0]?.id ?? "");
  }, [data.etapas, sel]);
  const ruta = data.etapas.find((e) => e.id === sel) ?? data.etapas[0];
  const over = ruta?.pdt_real != null && ruta.pdt_meta != null && ruta.pdt_real > ruta.pdt_meta;

  return (
    <Card className="span-7" title="Lead time por etapa vs. meta"
      subtitle="Días promedio reales (barra) frente a la meta de cada etapa (marca)"
      actions={data.etapas.length > 0 && (
        <select className="select" value={ruta?.id} onChange={(e) => setSel(e.target.value)} aria-label="Ruta">
          {data.etapas.map((e) => <option key={e.id} value={e.id}>{e.id} ({e.unidades})</option>)}
        </select>
      )}>
      {ruta ? (
        <>
          <div className="pdt-summary">
            <div><span>PDT real</span><b className={over ? "bad" : ""}>{days(ruta.pdt_real)}</b></div>
            <div><span>Meta PDT</span><b>{days(ruta.pdt_meta)}</b></div>
            <div><span>Medición</span><b>{int(ruta.unidades)} embarque·PO</b></div>
            <div className="legend" style={{ marginLeft: "auto" }}>
              <span><i style={{ background: "var(--serious)" }} />Sobre la meta</span>
              <span><i style={{ background: "var(--series-muted)" }} />En meta</span>
              <span><i style={{ background: "var(--text)", width: 3 }} />Meta</span>
            </div>
          </div>
          <EChart ariaLabel={`Lead time por etapa para ${ruta.id}`} height={300}
            build={(t) => stagesBullet(ruta, t)} deps={[ruta]} />
        </>
      ) : <Empty text="No hay rutas con meta oficial en el período." />}
    </Card>
  );
}

function Arribos({ data }: { data: DashboardData }) {
  if (!data.proximos.length) return <Empty text="No hay arribos próximos registrados." />;
  return (
    <ul className="arrivals">
      {data.proximos.slice(0, 6).map((a) => (
        <li key={a.embarque}>
          <div className="when">
            <b>{a.dias <= 0 ? "Hoy" : a.dias === 1 ? "Mañana" : `${a.dias} d`}</b>
            <span>{new Date(a.eta).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}</span>
          </div>
          <div className="what">
            <b>{a.embarque}</b>
            <span>{a.ruta} · {a.naviera !== "Sin dato" ? a.naviera : a.modo}</span>
          </div>
          <div className="how">
            <b className="num">{usd(a.valor_usd)}</b>
            <span><Ship size={12} /> {a.contenedores} cont.</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Cumplimiento({ v }: { v: number | null }) {
  if (v == null) return <span className="muted">—</span>;
  const tone = v >= 90 ? "good" : v >= 70 ? "serious" : "critical";
  return <span className={`badge ${tone}`}>{pct(v, 0)}</span>;
}

function Rutas({ rows }: { rows: RutaResumen[] }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Ruta</th><th className="r">Embarques</th><th className="r">Abiertos</th>
            <th className="r">Contenedores</th><th className="r">Valor</th><th className="r">Tránsito prom.</th>
            <th className="r">PDT real</th><th className="r">Meta PDT</th><th className="r">Cumplimiento</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const over = r.pdt_promedio != null && r.meta_pdt != null && r.pdt_promedio > r.meta_pdt;
            return (
              <tr key={`${r.ruta}-${r.modo}`}>
                <td><b>{r.ruta}</b> <span className="muted">· {r.modo}</span></td>
                <td className="r num">{int(r.embarques)}</td>
                <td className="r num">{int(r.en_curso)}</td>
                <td className="r num">{int(r.contenedores)}</td>
                <td className="r num">{usd(r.valor_usd)}</td>
                <td className="r num">{days(r.transito_promedio)}</td>
                <td className={`r num ${over ? "text-bad strong" : ""}`}>{days(r.pdt_promedio)}</td>
                <td className="r num">
                  {days(r.meta_pdt)}
                  {!r.meta_oficial && <span className="ref-tag" title="Meta referencial: la ruta no tiene meta oficial en el Excel">ref.</span>}
                </td>
                <td className="r"><Cumplimiento v={r.cumplimiento} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Alertas({ data }: { data: DashboardData }) {
  if (!data.alertas.length) return <div className="empty">✓ No hay embarques fuera de meta con los filtros actuales.</div>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Prioridad</th><th>Embarque</th><th>Ruta</th><th>Etapa actual</th>
            <th className="r" title="Días en la etapa actual">Días</th><th className="r">Meta</th><th className="r">Exceso</th>
            <th className="r">Valor</th><th>Forwarder</th>
          </tr>
        </thead>
        <tbody>
          {data.alertas.map((a) => (
            <tr key={a.embarque}>
              <td>
                {a.severidad === "critical"
                  ? <span className="badge critical"><CircleAlert size={13} />Crítica</span>
                  : <span className="badge serious"><AlertTriangle size={13} />Alta</span>}
              </td>
              <td className="strong"><Link to={`/embarques?id=${encodeURIComponent(a.embarque)}`}>{a.embarque}</Link></td>
              <td>{a.ruta} <span className="muted">· {a.modo}</span></td>
              <td>{a.estado}</td>
              <td className="r num strong">{a.dias.toLocaleString("es-CO")}</td>
              <td className="r num">{a.meta}{!a.meta_oficial && <span className="ref-tag" title="Meta referencial">ref.</span>}</td>
              <td className="r num text-bad strong">+{a.exceso.toLocaleString("es-CO")} d</td>
              <td className="r num">{usd(a.valor_usd)}</td>
              <td className="muted ellipsis" title={a.forwarder}>{a.forwarder}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CANAL_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-muted)"];

function Canales({ data }: { data: DashboardData["canales"] }) {
  const total = data.reduce((a, c) => a + c.embarques, 0) || 1;
  if (!data.length) return <Empty />;
  return (
    <>
      <div className="share-bar" role="img" aria-label="Embarques por canal aduanero">
        {data.map((c, i) => <div key={c.canal} style={{ flex: c.embarques, background: CANAL_COLORS[i] ?? CANAL_COLORS[3] }} />)}
      </div>
      <ul className="share-list">
        {data.map((c, i) => (
          <li key={c.canal}>
            <i style={{ background: CANAL_COLORS[i] ?? CANAL_COLORS[3] }} />
            <span>{c.canal}</span>
            <span className="v num">{int(c.embarques)}</span>
            <span className="p num">{pct((c.embarques / total) * 100, 0)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Empty({ text = "Sin datos para los filtros seleccionados." }: { text?: string }) {
  return <div className="empty">{text}</div>;
}

function Skeleton() {
  return (
    <>
      <div className="kpis">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card skeleton" style={{ height: 132 }} />)}</div>
      <div className="grid">
        <div className="card skeleton span-8" style={{ height: 360 }} />
        <div className="card skeleton span-4" style={{ height: 360 }} />
      </div>
    </>
  );
}
