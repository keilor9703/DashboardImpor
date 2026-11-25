/**
 * Opciones de ECharts para cada visual del tablero.
 * Reglas: un solo eje Y, marcas delgadas con extremos redondeados de 4px, rejilla
 * recesiva, colores fijos por entidad (Importación = serie 1, Exportación = serie 2)
 * y tooltip en todos los gráficos.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { DashboardData } from "../api/types";
import type { Tokens } from "../lib/theme";
import { days, int, mesCorto, pct, usd } from "../lib/format";

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

const usdAxis = (v: number) => (v === 0 ? "0" : usd(v).replace("US$ ", ""));

/** Comercio exterior mensual: importación vs. exportación (USD). */
export function monthlyTrade(d: DashboardData["mensual"], t: Tokens): EChartsCoreOption {
  return {
    animationDuration: 500,
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.6 } },
      formatter: (ps: { dataIndex: number }[]) => {
        const p = d[ps[0].dataIndex];
        const total = p.importaciones_usd + p.exportaciones_usd;
        return `<div style="font-weight:600;margin-bottom:4px">${mesCorto(p.mes)}</div>` +
          row(t.s1, "Importación", usd(p.importaciones_usd)) +
          row(t.s2, "Exportación", usd(p.exportaciones_usd)) +
          `<div style="border-top:1px solid ${t.grid};margin-top:4px;padding-top:4px;color:${t.text2}">Total ${usd(total)} · ${int(p.operaciones)} DO</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: d.map((p) => mesCorto(p.mes)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: t.border } },
      axisLabel: axisLabel(t),
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: t.grid } },
      axisLabel: { ...axisLabel(t), formatter: usdAxis },
    },
    series: [
      { name: "Importación", key: "importaciones_usd", color: t.s1 },
      { name: "Exportación", key: "exportaciones_usd", color: t.s2 },
    ].map((s) => ({
      name: s.name,
      type: "bar",
      data: d.map((p) => p[s.key as "importaciones_usd"]),
      barMaxWidth: 16,
      barGap: "12%",
      itemStyle: { color: s.color, borderRadius: [4, 4, 0, 0] },
      emphasis: { focus: "series" },
    })),
  };
}

/** Flujo operativo: operaciones abiertas por etapa. */
export function pipeline(d: DashboardData["estados"], t: Tokens): EChartsCoreOption {
  return {
    grid: { left: 4, right: 44, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const e = d[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${e.estado}</div>` +
          row(t.s1, "Operaciones", int(e.operaciones)) + row(t.s1, "Valor", usd(e.valor_usd));
      },
    },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category", inverse: true, data: d.map((e) => e.estado),
      axisTick: { show: false }, axisLine: { show: false }, axisLabel: { ...axisLabel(t), color: t.text },
    },
    series: [{
      type: "bar",
      data: d.map((e) => e.operaciones),
      barWidth: 14,
      itemStyle: { color: t.s1, borderRadius: [0, 4, 4, 0] },
      showBackground: true,
      backgroundStyle: { color: t.grid, borderRadius: 4 },
      label: { show: true, position: "right", color: t.text, fontWeight: 600, fontFamily: t.font, formatter: (p: { value: number }) => int(p.value) },
    }],
  };
}

/** Clientes con mayor valor operado. */
export function topClients(d: DashboardData["top_clientes"], t: Tokens): EChartsCoreOption {
  const short = (s: string) => s.replace(/ (S\.A\.S\.|S\.A\.|Ltda\.|C\.I\.)$/, "");
  return {
    grid: { left: 4, right: 92, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const c = d[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${c.cliente}</div>` +
          row(t.s1, "Valor", usd(c.valor_usd)) + row(t.s1, "Operaciones", int(c.operaciones)) + row(t.s1, "Participación", pct(c.participacion));
      },
    },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category", inverse: true, data: d.map((c) => short(c.cliente)),
      axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { ...axisLabel(t), color: t.text, width: 170, overflow: "truncate" },
    },
    series: [{
      type: "bar",
      data: d.map((c) => c.valor_usd),
      barWidth: 12,
      itemStyle: { color: t.s1, borderRadius: [0, 4, 4, 0] },
      label: {
        show: true, position: "right", fontFamily: t.font, fontSize: 12,
        formatter: (p: { dataIndex: number }) => `{v|${usd(d[p.dataIndex].valor_usd)}}  {p|${pct(d[p.dataIndex].participacion, 0)}}`,
        rich: { v: { color: t.text, fontWeight: 600 }, p: { color: t.text3 } },
      },
    }],
  };
}

/** Tiempo promedio de trámite por aduana contra la meta (SLA). */
export function customsTimes(d: DashboardData["aduanas"], sla: number, t: Tokens): EChartsCoreOption {
  return {
    grid: { left: 4, right: 64, top: 22, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const a = d[p.dataIndex];
        const over = a.dias_promedio > sla;
        return `<div style="font-weight:600;margin-bottom:4px">${a.aduana}</div>` +
          row(over ? t.serious : t.muted, "Promedio", days(a.dias_promedio)) +
          row(over ? t.serious : t.muted, "En meta", pct(a.cumplimiento_sla)) +
          row(over ? t.serious : t.muted, "Operaciones", int(a.operaciones)) +
          `<div style="color:${t.text2};margin-top:4px">${over ? "▲ Sobre la meta" : "✓ Dentro de la meta"} (${sla} días)</div>`;
      },
    },
    xAxis: { type: "value", show: false, max: (v: { max: number }) => Math.max(v.max, sla) * 1.08 },
    yAxis: {
      type: "category", inverse: true, data: d.map((a) => a.aduana),
      axisTick: { show: false }, axisLine: { show: false }, axisLabel: { ...axisLabel(t), color: t.text },
    },
    series: [{
      type: "bar",
      data: d.map((a) => ({ value: a.dias_promedio, itemStyle: { color: a.dias_promedio > sla ? t.serious : t.muted } })),
      barWidth: 12,
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: {
        show: true, position: "right", fontFamily: t.font, fontSize: 12, color: t.text,
        formatter: (p: { value: number }) => `${p.value.toLocaleString("es-CO", { maximumFractionDigits: 1 })} d`,
      },
      markLine: {
        symbol: "none", silent: true,
        lineStyle: { color: t.text2, type: [4, 4], width: 1.5 },
        label: { formatter: `Meta ${sla} d`, color: t.text2, fontFamily: t.font, fontSize: 11, position: "start", distance: [0, 6] },
        data: [{ xAxis: sla }],
      },
    }],
  };
}

/** Principales países de origen / destino (barras apiladas con separación de 2px). */
export function countries(d: DashboardData["paises"], t: Tokens): EChartsCoreOption {
  const s = (name: string, key: "importaciones_usd" | "exportaciones_usd", color: string, last: boolean) => ({
    name, type: "bar", stack: "total", barWidth: 12,
    data: d.map((p) => p[key]),
    itemStyle: { color, borderColor: t.surface, borderWidth: 1, borderRadius: last ? [0, 4, 4, 0] : 0 },
    emphasis: { focus: "series" },
  });
  return {
    grid: { left: 4, right: 70, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.6 } },
      formatter: (ps: { dataIndex: number }[]) => {
        const p = d[ps[0].dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${p.pais}</div>` +
          row(t.s1, "Importación", usd(p.importaciones_usd)) + row(t.s2, "Exportación", usd(p.exportaciones_usd));
      },
    },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category", inverse: true, data: d.map((p) => p.pais),
      axisTick: { show: false }, axisLine: { show: false }, axisLabel: { ...axisLabel(t), color: t.text },
    },
    series: [
      s("Importación", "importaciones_usd", t.s1, false),
      {
        ...s("Exportación", "exportaciones_usd", t.s2, true),
        label: {
          show: true, position: "right", color: t.text, fontFamily: t.font, fontSize: 12, fontWeight: 600,
          formatter: (p: { dataIndex: number }) => usd(d[p.dataIndex].importaciones_usd + d[p.dataIndex].exportaciones_usd),
        },
      },
    ],
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
