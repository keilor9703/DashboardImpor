import { AlertTriangle, CheckCircle2, CircleAlert, Info, RefreshCw } from "lucide-react";
import { useApi } from "../api/client";
import type { FuenteEstado, Hallazgo } from "../api/types";
import { Card, useSync } from "../components/Layout";
import { horaRelativa, int } from "../lib/format";

const TIPO: Record<FuenteEstado["tipo"], string> = {
  mock: "Datos simulados",
  file: "Archivo Excel",
  graph: "Excel en SharePoint (Microsoft Graph)",
};

const NIVEL = {
  serious: { cls: "critical", icon: CircleAlert, label: "Importante" },
  warning: { cls: "serious", icon: AlertTriangle, label: "Revisar" },
  info: { cls: "", icon: Info, label: "Informativo" },
} as const;

export function DataSource() {
  const { version, refresh, refreshing } = useSync();
  const { data, error } = useApi<{ hallazgos: Hallazgo[]; fuente: FuenteEstado }>("/api/datos/calidad", { v: version });
  const f = data?.fuente;

  return (
    <div className="grid">
      <Card className="span-7" title="Estado de la conexión"
        actions={<button className="btn" onClick={refresh} disabled={refreshing}><RefreshCw size={14} /> Sincronizar ahora</button>}>
        {error && <div className="error-box">{error}</div>}
        {f && (
          <table className="data kv">
            <tbody>
              <tr><td className="muted">Fuente</td><td className="strong">{TIPO[f.tipo]}</td></tr>
              <tr><td className="muted">Ubicación</td><td style={{ whiteSpace: "normal" }}>{f.detalle}</td></tr>
              {f.archivo && (
                <tr>
                  <td className="muted">Archivo en SharePoint</td>
                  <td style={{ whiteSpace: "normal" }}>
                    <b>{f.archivo.nombre}</b> · modificado {horaRelativa(f.archivo.modificado)}
                    {f.archivo.modificado_por && <> por <b>{f.archivo.modificado_por}</b></>}
                    {f.archivo.url && <> · <a href={f.archivo.url} target="_blank" rel="noreferrer">Abrir en SharePoint ↗</a></>}
                  </td>
                </tr>
              )}
              <tr><td className="muted">Líneas con datos</td><td className="num">{int(f.filas)} de {int(f.filas_archivo)} filas del archivo</td></tr>
              <tr><td className="muted">Embarques</td><td className="num">{int(f.embarques)}</td></tr>
              <tr><td className="muted">Tiempo de lectura</td><td className="num">{f.segundos_carga.toLocaleString("es-CO")} s</td></tr>
              <tr><td className="muted">Última sincronización</td><td>{horaRelativa(f.ultima_actualizacion)}</td></tr>
              <tr><td className="muted">Frecuencia</td><td>Cada {Math.round(f.ttl_segundos / 60)} min o al pulsar «Sincronizar»</td></tr>
              <tr>
                <td className="muted">Estado</td>
                <td>{f.error
                  ? <span className="badge critical"><CircleAlert size={13} />Error: {f.error}</span>
                  : <span className="badge good"><CheckCircle2 size={13} />Operando correctamente</span>}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
      <Card className="span-5" title="Cómo se calcula" subtitle="Reglas aplicadas al Excel">
        <ul className="rules">
          <li><b>Embarque:</b> número de exportación; si no existe, documento de transporte; si no, la PO.</li>
          <li><b>Valor USD:</b> factura de importación → valor de la PO → factura de exportación (COP convertido con la TRM configurada).</li>
          <li><b>Fecha del período:</b> zarpe (ATD); si no ha zarpado, recogida, ETD o mes de exportación.</li>
          <li><b>PDT:</b> días entre la creación de la PO y el ingreso a SAP, medido por embarque y PO, como en la hoja «In Transit PDT».</li>
          <li><b>Metas:</b> las de la hoja «In Transit PDT». Las rutas sin meta oficial usan una meta referencial (marcada «ref.»).</li>
        </ul>
      </Card>
      <Card className="span-12" title="Calidad de los datos"
        subtitle="Hallazgos en el Excel que afectan los indicadores · compártalos con los responsables del archivo">
        {data && !data.hallazgos.length && <div className="empty">✓ No se encontraron problemas de calidad.</div>}
        {data && data.hallazgos.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Nivel</th><th>Hallazgo</th><th className="r">Registros</th><th className="r">% líneas</th><th>Detalle</th></tr></thead>
              <tbody>
                {data.hallazgos.map((h) => {
                  const n = NIVEL[h.nivel];
                  return (
                    <tr key={h.clave}>
                      <td><span className={`badge ${n.cls}`}><n.icon size={13} />{n.label}</span></td>
                      <td className="strong">{h.titulo}</td>
                      <td className="r num">{int(h.cantidad)}</td>
                      <td className="r num">{h.porcentaje != null ? `${h.porcentaje.toLocaleString("es-CO")} %` : "—"}</td>
                      <td style={{ whiteSpace: "normal", minWidth: 320 }} className="muted">{h.detalle}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
