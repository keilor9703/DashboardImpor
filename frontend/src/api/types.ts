export type KpiFormat = "int" | "usd" | "cop" | "days" | "pct";

export interface Kpi {
  id: string;
  label: string;
  format: KpiFormat;
  better: "up" | "down" | "neutral";
  value: number | null;
  previous: number | null;
  delta_pct: number | null;
  sparkline: (number | null)[];
}

export interface MesPunto {
  mes: string;
  embarques: number;
  valor_usd: number;
  rutas: Record<string, number>;
}

export interface Alerta {
  embarque: string;
  estado: string;
  ruta: string;
  modo: string;
  etapa: string;
  dias: number;
  meta: number;
  exceso: number;
  valor_usd: number;
  contenedores: number;
  forwarder: string;
  meta_oficial: boolean;
  severidad: "critical" | "serious";
}

export interface Arribo {
  embarque: string;
  estado: string;
  ruta: string;
  modo: string;
  eta: string;
  dias: number;
  naviera: string;
  contenedores: number;
  valor_usd: number;
}

export interface EtapaValor {
  key: string;
  label: string;
  real: number | null;
  meta: number | null;
  n: number;
}

export interface RutaEtapas {
  id: string;
  ruta: string;
  modo: string;
  unidades: number;
  pdt_real: number | null;
  pdt_meta: number | null;
  etapas: EtapaValor[];
}

export interface RutaResumen {
  ruta: string;
  modo: string;
  embarques: number;
  en_curso: number;
  valor_usd: number;
  contenedores: number;
  pdt_promedio: number | null;
  meta_pdt: number | null;
  meta_oficial: boolean;
  cumplimiento: number | null;
  transito_promedio: number | null;
}

export interface FuenteEstado {
  tipo: "mock" | "graph" | "file";
  detalle: string;
  filas: number;
  filas_archivo: number;
  embarques: number;
  segundos_carga: number;
  ultima_actualizacion: string | null;
  ttl_segundos: number;
  error: string | null;
}

export interface DashboardData {
  periodo: { desde: string; hasta: string; anterior_desde: string; anterior_hasta: string };
  resumen: { en_curso: number; valor_en_curso_usd: number; contenedores_en_curso: number; con_alerta: number };
  kpis: Kpi[];
  mensual: MesPunto[];
  rutas_top: string[];
  pipeline: { estado: string; embarques: number; valor_usd: number; contenedores: number }[];
  etapas: RutaEtapas[];
  rutas: RutaResumen[];
  navieras: { naviera: string; embarques: number; transito_promedio: number | null; valor_usd: number }[];
  franquicias: { franquicia: string; valor_usd: number; participacion: number }[];
  canales: { canal: string; embarques: number }[];
  alertas: Alerta[];
  proximos: Arribo[];
  fuente: FuenteEstado;
}

export interface Dimension {
  key: string;
  label: string;
  opciones: string[];
}

export interface OpcionesFiltros {
  dimensiones: Dimension[];
  estados: string[];
  fecha_min: string | null;
  fecha_max: string | null;
}

export interface EmbarqueFila {
  embarque: string;
  estado: string;
  ruta: string;
  modo: string;
  forwarder: string;
  naviera: string;
  contenedores: number;
  lineas: number;
  valor_usd: number;
  pickup: string | null;
  atd: string | null;
  eta: string | null;
  ata: string | null;
  despacho: string | null;
  sap: string | null;
  pdt: number | null;
  meta_pdt: number | null;
}

export interface EmbarquesPage {
  total: number;
  pagina: number;
  tamano: number;
  filas: EmbarqueFila[];
}

export interface EmbarqueDetalle {
  embarque: string;
  estado: string;
  ruta: string;
  modo: string;
  forwarder: string;
  naviera: string;
  agente_aduana: string;
  canal: string;
  documento_transporte: string | null;
  booking: string | null;
  contenedores: string[];
  valor_usd: number;
  pdt: number | null;
  meta_pdt: number | null;
  meta_oficial: boolean;
  hitos: Record<string, string | null>;
  etapas: { key: string; label: string; inicio: string | null; fin: string | null; real: number | null; meta: number | null; en_curso: boolean }[];
  lineas: { po: string | null; sku: string | null; material: string | null; franquicia: string; cantidad: number | null; valor_usd: number; contenedor: string | null }[];
}

export interface Hallazgo {
  clave: string;
  titulo: string;
  cantidad: number;
  porcentaje: number | null;
  detalle: string;
  nivel: "info" | "warning" | "serious";
}

/** Filtros globales: fechas + dimensiones dinámicas (modo, origen, destino, franquicia, forwarder). */
export type Filters = { desde: string; hasta: string } & Record<string, string>;

export interface PdtColumna {
  idx: number;
  label: string;
  tipo: "dias" | "fecha" | "desviacion" | "texto";
}

export interface PdtRoles {
  real: number | null;
  meta: number | null;
  desviacion: number | null;
  comentario: number | null;
  fecha_fin: number | null;
}

export interface PdtProceso {
  key: string;
  titulo: string;
  titulo_es: string;
  color: string;
  columnas: PdtColumna[];
  roles: PdtRoles;
  resumen: { real_promedio: number | null; meta_promedio: number | null; fuera_meta: number; en_meta: number; sin_registro: number };
}

export interface PdtMedida {
  /** por proceso: [real, meta, desviación] ya convertidos a número */
  procesos: [number | null, number | null, number | null][];
  total: [number | null, number | null];
}

export interface HojaPdt {
  identidad: PdtColumna[];
  roles: { status: number | null; embarque: number | null; origen: number | null; destino: number | null; po: number | null };
  procesos: PdtProceso[];
  total: PdtProceso;
  filas: (string | number | null)[][];
  medidas: PdtMedida[];
  registros: number;
}
