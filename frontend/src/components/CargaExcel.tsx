/**
 * Carga manual del Excel: elegir archivo → validación y vista previa → confirmar.
 * Solo se muestra a usuarios con permiso y cuando la fuente de datos es un archivo.
 */
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, FileSpreadsheet, Upload, X } from "lucide-react";
import { apiUpload } from "../api/client";
import type { ResultadoCarga, VistaCarga } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { Card, useSync } from "./Layout";
import { int } from "../lib/format";

const mb = (b: number) => `${(b / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;

type Estado =
  | { fase: "inicio" }
  | { fase: "validando"; archivo: File }
  | { fase: "vista"; archivo: File; vista: VistaCarga }
  | { fase: "aplicando"; archivo: File; vista: VistaCarga }
  | { fase: "listo"; resultado: ResultadoCarga }
  | { fase: "error"; mensaje: string; archivo?: File };

export function CargaExcel() {
  const { getToken } = useAuth();
  const { refresh } = useSync();
  const [estado, setEstado] = useState<Estado>({ fase: "inicio" });
  const [arrastrando, setArrastrando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const elegir = async (archivo: File | undefined) => {
    if (!archivo) return;
    setEstado({ fase: "validando", archivo });
    try {
      const r = await apiUpload<{ vista: VistaCarga }>("/api/datos/excel", archivo, { confirmar: false }, getToken);
      setEstado({ fase: "vista", archivo, vista: r.vista });
    } catch (e) {
      setEstado({ fase: "error", mensaje: (e as Error).message, archivo });
    }
  };

  const confirmar = async (archivo: File, vista: VistaCarga) => {
    setEstado({ fase: "aplicando", archivo, vista });
    try {
      const r = await apiUpload<ResultadoCarga>("/api/datos/excel", archivo, { confirmar: true }, getToken);
      setEstado({ fase: "listo", resultado: r });
      void refresh();
    } catch (e) {
      setEstado({ fase: "error", mensaje: (e as Error).message, archivo });
    }
  };

  const reiniciar = () => {
    if (input.current) input.current.value = "";
    setEstado({ fase: "inicio" });
  };

  const ocupado = estado.fase === "validando" || estado.fase === "aplicando";

  return (
    <Card className="span-12" title="Actualizar el Excel"
      subtitle="Cargue una nueva versión del archivo de seguimiento. Se valida antes de reemplazar el actual.">
      {(estado.fase === "inicio" || estado.fase === "error" || estado.fase === "validando") && (
        <div
          className={`dropzone ${arrastrando ? "over" : ""} ${ocupado ? "busy" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); void elegir(e.dataTransfer.files[0]); }}
        >
          <Upload size={26} />
          <div>
            <b>{estado.fase === "validando" ? `Validando «${estado.archivo.name}»…` : "Arrastre aquí el archivo .xlsx"}</b>
            <span>o <button type="button" className="link-btn" disabled={ocupado} onClick={() => input.current?.click()}>elíjalo desde su equipo</button></span>
          </div>
          <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => void elegir(e.target.files?.[0])} />
        </div>
      )}

      {estado.fase === "error" && (
        <div className="carga-error" role="alert"><CircleAlert size={18} /><div><b>No se pudo cargar el archivo</b><p>{estado.mensaje}</p></div></div>
      )}

      {(estado.fase === "vista" || estado.fase === "aplicando") && (
        <div className="carga-vista">
          <div className="carga-file"><FileSpreadsheet size={22} /><div><b>{estado.vista.nombre}</b><span>{mb(estado.vista.tamano)}</span></div>
            <button className="icon-btn" aria-label="Descartar archivo" onClick={reiniciar} disabled={estado.fase === "aplicando"}><X size={16} /></button></div>
          <table className="data kv">
            <thead><tr><th></th><th className="r">Actual</th><th className="r">Archivo nuevo</th></tr></thead>
            <tbody>
              <Fila label="Embarques" antes={estado.vista.actual?.embarques} ahora={estado.vista.embarques} />
              <Fila label="Líneas (SKU / PO)" antes={estado.vista.actual?.lineas} ahora={estado.vista.lineas} />
              <tr><td>Registros en «In Transit PDT»</td><td className="r muted">—</td><td className="r num strong">{int(estado.vista.registros_pdt)}</td></tr>
            </tbody>
          </table>
          {estado.vista.hallazgos.length > 0 && (
            <details className="carga-hallazgos">
              <summary><AlertTriangle size={14} /> {estado.vista.hallazgos.length} observaciones de calidad en el archivo nuevo</summary>
              <ul>{estado.vista.hallazgos.map((h) => <li key={h.clave}><b>{h.titulo}</b> ({int(h.cantidad)}) — <span className="muted">{h.detalle}</span></li>)}</ul>
            </details>
          )}
          <p className="muted carga-nota">Al confirmar, el tablero usa de inmediato el archivo nuevo y el anterior queda como respaldo.</p>
          <div className="carga-acciones">
            <button className="btn primary" disabled={estado.fase === "aplicando"} onClick={() => void confirmar(estado.archivo, estado.vista)}>
              {estado.fase === "aplicando" ? "Actualizando…" : "Confirmar y actualizar"}
            </button>
            <button className="btn" disabled={estado.fase === "aplicando"} onClick={reiniciar}>Cancelar</button>
          </div>
        </div>
      )}

      {estado.fase === "listo" && (
        <div className="carga-listo">
          <div className="carga-ok"><CheckCircle2 size={20} /><div>
            <b>Excel actualizado</b>
            <p>{int(estado.resultado.vista.embarques)} embarques y {int(estado.resultado.vista.lineas)} líneas cargados desde «{estado.resultado.vista.nombre}».</p>
          </div></div>
          {estado.resultado.persistido ? (
            <p className="muted carga-nota">
              Guardado de forma permanente{estado.resultado.commit_url && <> (<a href={estado.resultado.commit_url} target="_blank" rel="noreferrer">ver versión ↗</a>)</>}.
              El servidor se reiniciará en 1 o 2 minutos para publicar la versión; durante ese tiempo el tablero puede tardar en responder.
            </p>
          ) : (
            <div className="carga-aviso" role="alert"><AlertTriangle size={18} /><p>{estado.resultado.aviso}</p></div>
          )}
          <button className="btn" onClick={reiniciar}>Cargar otro archivo</button>
        </div>
      )}
    </Card>
  );
}

function Fila({ label, antes, ahora }: { label: string; antes?: number; ahora: number }) {
  const d = antes == null ? null : ahora - antes;
  return (
    <tr>
      <td>{label}</td>
      <td className="r num muted">{antes == null ? "—" : int(antes)}</td>
      <td className="r num strong">{int(ahora)} {d != null && d !== 0 && <span className={d > 0 ? "pdt-in" : "pdt-out"}> ({d > 0 ? "+" : ""}{int(d)})</span>}</td>
    </tr>
  );
}
