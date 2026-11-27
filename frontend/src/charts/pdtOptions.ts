/** Gráficos de la hoja «Indicadores» del reporte PDT. */
import type { EChartsCoreOption } from "echarts/core";
import type { ProcesoKpi } from "../lib/pdt";
import type { Tokens } from "../lib/theme";
import { int, mesCorto } from "../lib/format";

const tip = (t: Tokens) => ({
  backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, padding: [8, 12],
  textStyle: { color: t.text, fontFamily: t.font, fontSize: 12.5 },
  extraCssText: "border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12);",
});
const ax = (t: Tokens) => ({ color: t.text, fontFamily: t.font, fontSize: 11.5 });
const n1 = (x: number) => x.toLocaleString("es-CO", { maximumFractionDigits: 1 });
const line = (l: string, val: string) => `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7"><span>${l}</span><b>${val}</b></div>`;

/** % de registros en meta por proceso (y total), con la línea del objetivo. */
export function complianceByProcess(items: (ProcesoKpi & { esTotal?: boolean })[], objetivo: number, t: Tokens): EChartsCoreOption {
  return {
    grid: { left: 4, right: 76, top: 22, bottom: 4, containLabel: true },
    tooltip: {
      ...tip(t), trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const x = items[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${x.titulo}</div>` +
          line("En meta", `${int(x.enMeta)} de ${int(x.medidos)}`) + line("Fuera de meta", int(x.fuera));
      },
    },
    xAxis: { type: "value", min: 0, max: 100, show: false },
    yAxis: {
      type: "category", inverse: true, data: items.map((x) => x.titulo_es),
      axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { ...ax(t), fontWeight: (v: string) => (v === "Total PDT" ? 700 : 400) },
    },
    series: [{
      type: "bar", barWidth: 14,
      data: items.map((x) => ({
        value: x.cumplimiento ?? 0,
        itemStyle: { color: x.esTotal ? t.text2 : x.color, borderColor: x.esTotal ? "transparent" : t.border, borderWidth: x.esTotal ? 0 : 0.5 },
      })),
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      showBackground: true, backgroundStyle: { color: t.grid, borderRadius: 4 },
      label: {
        show: true, position: "right", fontFamily: t.font, fontSize: 12,
        formatter: (p: { dataIndex: number }) => {
          const x = items[p.dataIndex];
          return x.cumplimiento == null ? "{m|sin dato}" : `{v|${n1(x.cumplimiento)} %}  {m|${x.enMeta}/${x.medidos}}`;
        },
        rich: { v: { color: t.text, fontWeight: 600 }, m: { color: t.text3 } },
      },
      markLine: {
        symbol: "none", silent: true, lineStyle: { color: t.text2, type: [4, 4], width: 1.5 },
        label: { formatter: `Objetivo ${objetivo} %`, color: t.text2, fontFamily: t.font, fontSize: 11, position: "start", distance: [0, 6] },
        data: [{ xAxis: objetivo }],
      },
    }],
  };
}

/** Días acumulados por encima de la meta en cada proceso: dónde se pierde el tiempo. */
export function lostDays(items: ProcesoKpi[], total: number, t: Tokens): EChartsCoreOption {
  const rows = [...items].sort((a, b) => b.diasPerdidos - a.diasPerdidos);
  return {
    grid: { left: 4, right: 96, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tip(t), trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const x = rows[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${x.titulo}</div>` +
          line("Días sobre la meta", `${n1(x.diasPerdidos)} d`) + line("Registros fuera de meta", int(x.fuera));
      },
    },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", inverse: true, data: rows.map((x) => x.titulo_es), axisTick: { show: false }, axisLine: { show: false }, axisLabel: ax(t) },
    series: [{
      type: "bar", barWidth: 14, data: rows.map((x) => x.diasPerdidos),
      itemStyle: { color: t.serious, borderRadius: [0, 4, 4, 0] },
      label: {
        show: true, position: "right", fontFamily: t.font, fontSize: 12,
        formatter: (p: { dataIndex: number }) => {
          const d = rows[p.dataIndex].diasPerdidos;
          return `{v|${n1(d)} d}  {m|${total ? Math.round((d / total) * 100) : 0} %}`;
        },
        rich: { v: { color: t.text, fontWeight: 600 }, m: { color: t.text3 } },
      },
    }],
  };
}

/** Cuántos registros quedan en cada tramo de desviación del PDT total. */
export function deviationBuckets(items: { label: string; tono: string; registros: number }[], t: Tokens): EChartsCoreOption {
  const color = (tono: string) => ({ good: t.good, warning: t.serious, serious: t.serious, critical: t.critical } as Record<string, string>)[tono] ?? t.muted;
  const total = items.reduce((a, b) => a + b.registros, 0) || 1;
  return {
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    tooltip: {
      ...tip(t), trigger: "item",
      formatter: (p: { dataIndex: number }) => `${items[p.dataIndex].label}: <b>${int(items[p.dataIndex].registros)}</b> registros`,
    },
    xAxis: { type: "category", data: items.map((x) => x.label), axisTick: { show: false }, axisLine: { lineStyle: { color: t.border } }, axisLabel: { ...ax(t), color: t.text2, interval: 0, width: 70, overflow: "break" } },
    yAxis: { type: "value", show: false },
    series: [{
      type: "bar", barMaxWidth: 48,
      data: items.map((x, i) => ({ value: x.registros, itemStyle: { color: color(x.tono), opacity: i === 1 ? 0.7 : 1 } })),
      itemStyle: { borderRadius: [4, 4, 0, 0] },
      label: {
        show: true, position: "top", fontFamily: t.font, fontSize: 12,
        formatter: (p: { value: number }) => `{v|${p.value}}  {m|${Math.round((p.value / total) * 100)} %}`,
        rich: { v: { color: t.text, fontWeight: 600 }, m: { color: t.text3 } },
      },
    }],
  };
}

/** % de cumplimiento del PDT por mes de ingreso a SAP. */
export function monthlyCompliance(items: { mes: string; registros: number; enMeta: number; cumplimiento: number | null }[], objetivo: number, t: Tokens): EChartsCoreOption {
  return {
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    tooltip: {
      ...tip(t), trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const x = items[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${mesCorto(x.mes)}</div>` +
          line("Cumplimiento", `${n1(x.cumplimiento ?? 0)} %`) + line("En meta", `${x.enMeta} de ${x.registros}`);
      },
    },
    xAxis: { type: "category", data: items.map((x) => mesCorto(x.mes)), axisTick: { show: false }, axisLine: { lineStyle: { color: t.border } }, axisLabel: { ...ax(t), color: t.text2 } },
    yAxis: { type: "value", min: 0, max: 100, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { ...ax(t), color: t.text2, formatter: "{value} %" } },
    series: [{
      type: "bar", barMaxWidth: 44,
      data: items.map((x) => ({ value: x.cumplimiento ?? 0, itemStyle: { color: (x.cumplimiento ?? 0) >= objetivo ? t.s1 : t.serious } })),
      itemStyle: { borderRadius: [4, 4, 0, 0] },
      label: {
        show: true, position: "top", fontFamily: t.font, fontSize: 12,
        formatter: (p: { dataIndex: number }) => `{v|${n1(items[p.dataIndex].cumplimiento ?? 0)} %}  {m|n=${items[p.dataIndex].registros}}`,
        rich: { v: { color: t.text, fontWeight: 600 }, m: { color: t.text3 } },
      },
      markLine: {
        symbol: "none", silent: true, lineStyle: { color: t.text2, type: [4, 4], width: 1.5 },
        label: { formatter: `Objetivo ${objetivo} %`, color: t.text2, fontFamily: t.font, fontSize: 11, position: "insideEndTop" },
        data: [{ yAxis: objetivo }],
      },
    }],
  };
}
