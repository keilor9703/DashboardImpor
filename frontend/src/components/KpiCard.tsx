import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Kpi } from "../api/types";
import { EChart } from "../charts/EChart";
import { sparkline } from "../charts/options";
import { formatValue } from "../lib/format";

/** Tarjeta KPI: valor del período, variación vs. período anterior y tendencia mensual. */
export function KpiCard({ kpi, color }: { kpi: Kpi; color: "s1" | "s2" | "text2" }) {
  const d = kpi.delta_pct;
  const isUp = d != null && d > 0.05;
  const isDown = d != null && d < -0.05;
  const tone = d == null || (!isUp && !isDown) || kpi.better === "neutral"
    ? "flat"
    : (isUp === (kpi.better === "up") ? "good" : "bad");
  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus;
  const toneLabel = tone === "good" ? "favorable" : tone === "bad" ? "desfavorable" : "sin cambio relevante";

  return (
    <section className="card kpi" aria-label={kpi.label}>
      <div className="kpi-label">{kpi.label}</div>
      <div className="kpi-value num">{formatValue(kpi.value, kpi.format)}</div>
      <div className="kpi-foot">
        {d != null && (
          <span className={`delta ${tone}`} title={`Variación ${toneLabel}`}>
            <Icon size={13} strokeWidth={2.5} />
            {Math.abs(d).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %
          </span>
        )}
        <span>vs. {formatValue(kpi.previous, kpi.format)} ant.</span>
      </div>
      <div className="spark">
        <EChart ariaLabel={`Tendencia mensual de ${kpi.label}`} height={36}
          build={(t) => sparkline(kpi.sparkline, t[color], t)} deps={[kpi.sparkline, color]} />
      </div>
    </section>
  );
}
