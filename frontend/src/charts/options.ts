/**
 * Opciones de ECharts para cada visual del tablero.
 * Reglas: un solo eje Y, marcas delgadas con extremos redondeados de 4px, rejilla
 * recesiva, colores fijos por entidad (Importación = serie 1, Exportación = serie 2)
 * y tooltip en todos los gráficos.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { DashboardData, RutaEtapas } from "../api/types";
import type { Tokens } from "../lib/theme";
import { days, int, mesCorto, pct } from "../lib/format";

const tooltipBase = (t: Tokens) => ({
  backgroundColor: t.surface,
  borderColor: t.border,
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: t.text, fontFamily: t.font, fontSize: 12.5 },
  extraCssText: "border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12);",
});

const axisLabel = (t: Tokens) => ({ color: t.text2, fontFamily: t.font, fontSize: 11.5 });

const dot = (c: string) => `<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${c};margin-right:7px"></span>`;

const row = (color: string, label: string, value: string) =>
  `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7"><span>${dot(color)}${label}</span><b>${value}</b></div>`;

export const ROUTE_COLORS = (t: Tokens) => [t.s1, t.s2, t.s3, t.muted];

/** Embarques por mes, apilados por ruta (rutas principales + «Otras»). */
export function monthlyByRoute(d: DashboardData["mensual"], rutas: string[], t: Tokens): EChartsCoreOption {
  const series = [...rutas, "Otras"];
  const colors = ROUTE_COLORS(t);
  return {
    animationDuration: 500,
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.6 } },
      formatter: (ps: { dataIndex: number }[]) => {
        const p = d[ps[0].dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${mesCorto(p.mes)}</div>` +
          series.map((r, i) => row(colors[i], r, int(p.rutas[r] ?? 0))).join("") +
          `<div style="border-top:1px solid ${t.grid};margin-top:4px;padding-top:4px;color:${t.text2}">Total ${int(p.embarques)} embarques</div>`;
      },
    },
    xAxis: {
      type: "category", data: d.map((p) => mesCorto(p.mes)),
      axisTick: { show: false }, axisLine: { lineStyle: { color: t.border } }, axisLabel: axisLabel(t),
    },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: t.grid } }, axisLabel: axisLabel(t) },
    series: series.map((r, i) => ({
      name: r, type: "bar", stack: "embarques", barMaxWidth: 44,
      data: d.map((p) => p.rutas[r] ?? 0),
      itemStyle: { color: colors[i], borderColor: t.surface, borderWidth: 1, borderRadius: i === series.length - 1 ? [4, 4, 0, 0] : 0 },
      emphasis: { focus: "series" },
    })),
  };
}

/** Torre de control: embarques abiertos por estado. */
export function pipeline(d: DashboardData["pipeline"], t: Tokens): EChartsCoreOption {
  return {
    grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const e = d[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${e.estado}</div>` +
          row(t.s1, "Embarques", int(e.embarques)) + row(t.s1, "Contenedores", int(e.contenedores));
      },
    },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category", inverse: true, data: d.map((e) => e.estado),
      axisTick: { show: false }, axisLine: { show: false }, axisLabel: { ...axisLabel(t), color: t.text },
    },
    series: [{
      type: "bar", data: d.map((e) => e.embarques), barWidth: 14,
      itemStyle: { color: t.s1, borderRadius: [0, 4, 4, 0] },
      showBackground: true, backgroundStyle: { color: t.grid, borderRadius: 4 },
      label: { show: true, position: "right", color: t.text, fontWeight: 600, fontFamily: t.font, formatter: (p: { value: number }) => int(p.value) },
    }],
  };
}

/** Lead time por etapa: barra = promedio real, marca vertical = meta (bullet chart).
 *  Los valores van en una columna fija a la derecha para no chocar con la marca de la meta. */
export function stagesBullet(d: RutaEtapas, t: Tokens): EChartsCoreOption {
  const et = d.etapas;
  const over = (e: RutaEtapas["etapas"][number]) => e.real != null && e.meta != null && e.real > e.meta;
  const fmt = (x: number) => x.toLocaleString("es-CO", { maximumFractionDigits: 1 });
  return {
    // márgenes fijos: etiquetas a la izquierda (150 px) y columna de valores a la derecha (112 px)
    grid: { left: 158, right: 112, top: 8, bottom: 4, containLabel: false },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const e = et[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${e.label}</div>` +
          row(over(e) ? t.serious : t.muted, "Real promedio", days(e.real)) + row(t.text2, "Meta", days(e.meta)) +
          `<div style="color:${t.text2};margin-top:4px">${over(e) ? "▲ Sobre la meta" : "✓ Dentro de la meta"} · ${int(e.n)} mediciones</div>`;
      },
    },
    xAxis: { type: "value", show: false, max: (v: { max: number }) => v.max * 1.04 },
    yAxis: [
      {
        type: "category", inverse: true, data: et.map((e) => e.label),
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { ...axisLabel(t), color: t.text, width: 148, overflow: "truncate" },
      },
      {
        type: "category", inverse: true, position: "right", data: et.map((e) => e.key),
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: {
          fontFamily: t.font, fontSize: 12, margin: 10, align: "left",
          formatter: (_: string, i: number) => {
            const e = et[i];
            if (e.real == null) return "{m|sin dato}";
            return `{${over(e) ? "b" : "v"}|${fmt(e.real)} d}{m| / ${e.meta != null ? fmt(e.meta) : "—"} d}`;
          },
          rich: { v: { color: t.text, fontWeight: 600 }, b: { color: t.serious, fontWeight: 700 }, m: { color: t.text3 } },
        },
      },
    ],
    series: [
      {
        type: "bar", barWidth: 12, z: 2,
        data: et.map((e) => ({ value: e.real ?? 0, itemStyle: { color: over(e) ? t.serious : t.muted } })),
        itemStyle: { borderRadius: [0, 4, 4, 0] },
      },
      {
        type: "scatter", z: 3, silent: true, symbol: "rect", symbolSize: [3, 22],
        data: et.map((e) => e.meta), itemStyle: { color: t.text },
      },
    ],
  };
}

/** Tránsito internacional promedio por naviera. */
export function carriers(d: DashboardData["navieras"], t: Tokens): EChartsCoreOption {
  const rows = d.filter((n) => n.transito_promedio != null);
  return {
    grid: { left: 4, right: 56, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t), trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const n = rows[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${n.naviera}</div>` +
          row(t.s1, "Tránsito promedio", days(n.transito_promedio)) + row(t.s1, "Embarques", int(n.embarques));
      },
    },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category", inverse: true, data: rows.map((n) => `${n.naviera} (${n.embarques})`),
      axisTick: { show: false }, axisLine: { show: false }, axisLabel: { ...axisLabel(t), color: t.text },
    },
    series: [{
      type: "bar", barWidth: 12, data: rows.map((n) => n.transito_promedio),
      itemStyle: { color: t.s1, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: t.text, fontWeight: 600, fontFamily: t.font,
        formatter: (p: { value: number }) => `${p.value.toLocaleString("es-CO", { maximumFractionDigits: 1 })} d` },
    }],
  };
}

/** Embarques por franquicia; «Sin franquicia» en gris para evidenciar el vacío de datos. */
export function franchises(d: DashboardData["franquicias"], t: Tokens): EChartsCoreOption {
  return {
    grid: { left: 4, right: 92, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t), trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const f = d[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${f.franquicia}</div>` +
          row(t.s1, "Embarques", int(f.embarques)) + row(t.s1, "Participación", pct(f.participacion));
      },
    },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category", inverse: true, data: d.map((f) => f.franquicia),
      axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { ...axisLabel(t), color: t.text, width: 150, overflow: "truncate" },
    },
    series: [{
      type: "bar", barWidth: 12,
      data: d.map((f) => ({ value: f.embarques, itemStyle: { color: f.franquicia === "Sin franquicia" ? t.muted : t.s1 } })),
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: {
        show: true, position: "right", fontFamily: t.font, fontSize: 12,
        formatter: (p: { dataIndex: number }) => `{v|${int(d[p.dataIndex].embarques)}}  {p|${pct(d[p.dataIndex].participacion, 0)}}`,
        rich: { v: { color: t.text, fontWeight: 600 }, p: { color: t.text3 } },
      },
    }],
  };
}

/** Sparkline para las tarjetas KPI. */
export function sparkline(values: (number | null)[], color: string, t: Tokens): EChartsCoreOption {
  const last = values.length - 1;
  return {
    animation: false,
    grid: { left: 4, right: 6, top: 6, bottom: 4 },
    xAxis: { type: "category", show: false, boundaryGap: false, data: values.map((_, i) => i) },
    yAxis: { type: "value", show: false, scale: true },
    series: [{
      type: "line", data: values, smooth: 0.3, symbol: "circle",
      symbolSize: (_: unknown, p: { dataIndex: number }) => (p.dataIndex === last ? 6 : 0),
      showSymbol: true,
      lineStyle: { width: 2, color },
      itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
      areaStyle: { color, opacity: 0.08 },
      silent: true,
    }],
  };
}
