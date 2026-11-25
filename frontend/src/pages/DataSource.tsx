import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import { useApi } from "../api/client";
import type { FuenteEstado } from "../api/types";
import { Card, useSync } from "../components/Layout";
import { horaRelativa, int } from "../lib/format";

const TIPO: Record<FuenteEstado["tipo"], string> = {
  mock: "Datos simulados",
  file: "Archivo Excel local",
  graph: "Excel en SharePoint (Microsoft Graph)",
};

export function DataSource() {
  const { version, refresh, refreshing } = useSync();
  const { data, error } = useApi<FuenteEstado>("/api/datos/estado", { v: version });

  return (
    <div className="grid">
      <Card className="span-7" title="Estado de la conexión"
        actions={<button className="btn" onClick={refresh} disabled={refreshing}><RefreshCw size={14} /> Sincronizar ahora</button>}>
        {error && <div className="error-box">{error}</div>}
        {data && (
          <table className="data">
            <tbody>
              <tr><td className="muted">Fuente</td><td className="strong">{TIPO[data.tipo]}</td></tr>
              <tr><td className="muted">Ubicación</td><td style={{ whiteSpace: "normal" }}>{data.detalle}</td></tr>
              <tr><td className="muted">Registros cargados</td><td className="num">{int(data.filas)}</td></tr>
              <tr><td className="muted">Última sincronización</td><td>{horaRelativa(data.ultima_actualizacion)}</td></tr>
              <tr><td className="muted">Frecuencia</td><td>Cada {Math.round(data.ttl_segundos / 60)} min o al pulsar «Sincronizar»</td></tr>
              <tr>
                <td className="muted">Estado</td>
                <td>{data.error
                  ? <span className="badge critical"><CircleAlert size={13} />Error: {data.error}</span>
                  : <span className="badge good"><CheckCircle2 size={13} />Operando correctamente</span>}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
      <Card className="span-5" title="Cómo se conecta el Excel" subtitle="Flujo de la información">
        <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10, color: "var(--text-2)" }}>
          <li>El equipo sigue trabajando en el Excel de SharePoint como siempre.</li>
          <li>El servidor lee la hoja consolidada mediante <b>Microsoft Graph</b>, con permiso de solo lectura sobre ese sitio.</li>
          <li>Los datos se validan, se normalizan y se guardan en caché.</li>
          <li>El tablero calcula los indicadores y se actualiza automáticamente.</li>
        </ol>
      </Card>
    </div>
  );
}
