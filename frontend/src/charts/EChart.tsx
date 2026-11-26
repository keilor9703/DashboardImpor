import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent, DatasetComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { readTokens, useTheme, type Tokens } from "../lib/theme";

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, MarkLineComponent, DatasetComponent, CanvasRenderer]);

interface Props {
  build: (t: Tokens) => EChartsCoreOption;
  height?: number | string;
  ariaLabel: string;
  deps: unknown[];
}

/** Envoltorio liviano de ECharts: tema desde tokens CSS, redimensiona solo y se limpia al desmontar. */
export function EChart({ build, height = 300, ariaLabel, deps }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { resolved } = useTheme();

  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current, undefined, { renderer: "canvas" });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => build(readTokens()), [resolved, ...deps]);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} role="img" aria-label={ariaLabel} style={{ width: "100%", height }} />;
}
