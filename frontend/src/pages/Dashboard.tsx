import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useApi } from "../api/client";
import type { DashboardData } from "../api/types";
import { EChart } from "../charts/EChart";
import { countries, customsTimes, monthlyTrade, pipeline, topClients } from "../charts/options";
import { Card, useSync } from "../components/Layout";
import { FilterBar } from "../components/FilterBar";
import { KpiCard } from "../components/KpiCard";
import { fecha, int, pct, usd } from "../lib/format";
import { useFilters } from "../lib/filters";

const KPI_COLOR: Record<string, "s1" | "s2" | "text2"> = { importaciones_usd: "s1", exportaciones_usd: "s2" };

export function Dashboard() {
  const { filters } = useFilters();
  const { version } = useSync();
  const { data, error, loading } = useApi<DashboardData>("/api/dashboard", { ...filters, v: version });

  return (
    <>
      <FilterBar />
      {data?.fuente.tipo === "mock" && (
        <div className="banner"><Info size={16} /><span>Está viendo <b>datos simulados</b>. Al conectar el Excel de SharePoint, este tablero mostrará la información real.</span></div>
      )}
      {error && <div className="card error-box">No fue posible cargar el tablero: {error}</div>}
      {!data && loading && <Skeleton />}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, opacity: loading ? 0.65 : 1, transition: "opacity .2s" }}>
          <div className="kpis">
            {data.kpis.map((k) => <KpiCard key={k.id} kpi={k} color={KPI_COLOR[k.id] ?? "text2"} />)}
          </div>

          <div className="grid">
            <Card className="span-8" title="Valor de comercio exterior por mes"
              subtitle={`USD · Importación a valor CIF, exportación a valor FOB · ${fecha(data.periodo.desde)} – ${fecha(data.periodo.hasta)}`}
              actions={<div className="legend"><span><i style={{ background: "var(--series-1)" }} />Importación</span><span><i style={{ background: "var(--series-2)" }} />Exportación</span></div>}>
              {data.mensual.length ? (
                <EChart ariaLabel="Valor mensual de importaciones y exportaciones" height={300}
                  build={(t) => monthlyTrade(data.mensual, t)} deps={[data.mensual]} />
              ) : <Empty />}
            </Card>

            <Card className="span-4" title="Operaciones en curso" subtitle="Estado actual del flujo operativo">
              <div className="stat-row">
                <div><b className="num">{int(data.resumen.en_curso)}</b><span>DO abiertos</span></div>
                <div><b className="num">{usd(data.resumen.valor_en_curso_usd)}</b><span>Valor en curso</span></div>
                <div className={data.resumen.retrasadas ? "alert" : ""}><b className="num">{int(data.resumen.retrasadas)}</b><span>Con retraso</span></div>
              </div>
              <EChart ariaLabel="Operaciones abiertas por etapa" height={196}
                build={(t) => pipeline(data.estados, t)} deps={[data.estados]} />
            </Card>

            <Card className="span-6" title="Clientes con mayor valor operado" subtitle="Top 10 · USD y participación sobre el total del período">
              {data.top_clientes.length ? (
                <EChart ariaLabel="Clientes con mayor valor operado" height={320}
                  build={(t) => topClients(data.top_clientes, t)} deps={[data.top_clientes]} />
              ) : <Empty />}
            </Card>

            <Card className="span-6" title="Tiempo promedio de trámite por aduana"
              subtitle="Días entre llegada y levante · operaciones cerradas del período"
              actions={<div className="legend"><span><i style={{ background: "var(--serious)" }} />Sobre la meta</span><span><i style={{ background: "var(--series-muted)" }} />En meta</span><span><i className="line" />Meta {data.sla_dias} d</span></div>}>
              {data.aduanas.length ? (
                <EChart ariaLabel="Tiempo promedio de trámite por aduana frente a la meta" height={320}
                  build={(t) => customsTimes(data.aduanas, data.sla_dias, t)} deps={[data.aduanas, data.sla_dias]} />
              ) : <Empty />}
            </Card>

            <Card className="span-8" title="Principales países de origen y destino" subtitle="Top 8 por valor USD"
              actions={<div className="legend"><span><i style={{ background: "var(--series-1)" }} />Importación</span><span><i style={{ background: "var(--series-2)" }} />Exportación</span></div>}>
              {data.paises.length ? (
                <EChart ariaLabel="Principales países por valor" height={280}
                  build={(t) => countries(data.paises, t)} deps={[data.paises]} />
              ) : <Empty />}
            </Card>

            <Card className="span-4" title="Modalidad de transporte" subtitle="Participación por número de operaciones">
              <Modalidades data={data.modalidades} />
            </Card>

            <Card className="span-12" title="Operaciones que requieren atención"
              subtitle={`DO en aduana o inspección que superan la meta de ${data.sla_dias} días desde la llegada`}
              actions={<Link className="link-btn" to={{ pathname: "/operaciones" }}>Ver todas las operaciones →</Link>}>
              <Alertas data={data} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

const MOD_COLORS = ["var(--series-1)", "var(--series-3)", "var(--series-2)", "var(--series-muted)"];

function Modalidades({ data }: { data: DashboardData["modalidades"] }) {
  const total = data.reduce((a, m) => a + m.operaciones, 0) || 1;
  if (!data.length) return <Empty />;
  return (
    <>
      <div className="share-bar" role="img" aria-label="Participación por modalidad de transporte">
        {data.map((m, i) => <div key={m.modalidad} style={{ flex: m.operaciones, background: MOD_COLORS[i] ?? MOD_COLORS[3] }} />)}
      </div>
      <ul className="share-list">
        {data.map((m, i) => (
          <li key={m.modalidad}>
            <i style={{ background: MOD_COLORS[i] ?? MOD_COLORS[3] }} />
            <span>{m.modalidad}<br /><small className="muted">{usd(m.valor_usd)}</small></span>
            <span className="v num">{int(m.operaciones)}</span>
            <span className="p num">{pct((m.operaciones / total) * 100, 0)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Alertas({ data }: { data: DashboardData }) {
  if (!data.alertas.length) {
    return <div className="empty">✓ No hay operaciones retrasadas con los filtros actuales.</div>;
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Prioridad</th><th>DO</th><th>Cliente</th><th>Tipo</th><th>Aduana</th><th>Estado</th>
            <th className="r">Días desde llegada</th><th className="r">Valor</th><th>Ejecutivo</th>
          </tr>
        </thead>
        <tbody>
          {data.alertas.map((a) => (
            <tr key={a.do}>
              <td>
                {a.severidad === "critical"
                  ? <span className="badge critical"><CircleAlert size={13} />Crítica</span>
                  : <span className="badge serious"><AlertTriangle size={13} />Alta</span>}
              </td>
              <td className="strong">{a.do}</td>
              <td>{a.cliente}</td>
              <td><TipoTag tipo={a.tipo} /></td>
              <td>{a.aduana}</td>
              <td>{a.estado}</td>
              <td className="r num strong">{a.dias}</td>
              <td className="r num">{usd(a.valor_usd)}</td>
              <td className="muted">{a.ejecutivo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TipoTag({ tipo }: { tipo: string }) {
  return (
    <span className="tipo-tag">
      <i style={{ background: tipo === "Importación" ? "var(--series-1)" : "var(--series-2)" }} />{tipo}
    </span>
  );
}

function Empty() {
  return <div className="empty">Sin datos para los filtros seleccionados.</div>;
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
