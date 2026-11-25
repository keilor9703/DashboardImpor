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
  operaciones: number;
  importaciones_usd: number;
  exportaciones_usd: number;
  tributos_cop: number;
  dias_tramite: number | null;
  cumplimiento_sla: number | null;
}

export interface Alerta {
  do: string;
  cliente: string;
  tipo: string;
  aduana: string;
  estado: string;
  dias: number;
  valor_usd: number;
  ejecutivo: string;
  severidad: "critical" | "serious";
}

export interface FuenteEstado {
  tipo: "mock" | "graph" | "file";
  detalle: string;
  filas: number;
  ultima_actualizacion: string | null;
  ttl_segundos: number;
  error: string | null;
}

export interface DashboardData {
  periodo: { desde: string; hasta: string; anterior_desde: string; anterior_hasta: string };
  sla_dias: number;
  resumen: { en_curso: number; retrasadas: number; valor_en_curso_usd: number };
  kpis: Kpi[];
  mensual: MesPunto[];
  estados: { estado: string; operaciones: number; valor_usd: number }[];
  top_clientes: { cliente: string; valor_usd: number; operaciones: number; participacion: number }[];
  aduanas: { aduana: string; operaciones: number; dias_promedio: number; cumplimiento_sla: number }[];
  paises: { pais: string; importaciones_usd: number; exportaciones_usd: number }[];
  modalidades: { modalidad: string; operaciones: number; valor_usd: number }[];
  alertas: Alerta[];
  fuente: FuenteEstado;
}

export interface OpcionesFiltros {
  tipos: string[];
  clientes: string[];
  aduanas: string[];
  modalidades: string[];
  fecha_min: string | null;
  fecha_max: string | null;
}

export interface Operacion {
  do: string;
  fecha_apertura: string;
  tipo: string;
  cliente: string;
  pais: string;
  aduana: string;
  modalidad: string;
  categoria: string;
  valor_usd: number;
  tributos_cop: number;
  estado: string;
  fecha_llegada: string | null;
  fecha_levante: string | null;
  dias_tramite: number | null;
  ejecutivo: string;
}

export interface OperacionesPage {
  total: number;
  pagina: number;
  tamano: number;
  filas: Operacion[];
}

export interface Filters {
  desde: string;
  hasta: string;
  tipo: string;
  cliente: string;
  aduana: string;
  modalidad: string;
}
