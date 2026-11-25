"""Cálculo de KPIs y agregaciones para el dashboard ejecutivo."""
from dataclasses import dataclass
from datetime import date, timedelta
from math import isfinite

import pandas as pd

from ..data.schema import ESTADO_FINAL, ESTADOS


@dataclass
class Filtros:
    desde: date
    hasta: date
    tipo: str | None = None
    cliente: str | None = None
    aduana: str | None = None
    modalidad: str | None = None


def _num(x, nd: int = 2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, nd) if isfinite(x) else None


def _dims(df: pd.DataFrame, f: Filtros) -> pd.DataFrame:
    m = pd.Series(True, index=df.index)
    for col in ("tipo", "cliente", "aduana", "modalidad"):
        val = getattr(f, col)
        if val:
            m &= df[col] == val
    return df[m]


def _periodo(df: pd.DataFrame, desde: date, hasta: date) -> pd.DataFrame:
    fa = df["fecha_apertura"]
    fin = pd.Timestamp(hasta) + pd.Timedelta(days=1)
    return df[(fa >= pd.Timestamp(desde)) & (fa < fin)]


def _metricas(d: pd.DataFrame, sla: float) -> dict:
    cerradas = d.dropna(subset=["dias_tramite"])
    return {
        "operaciones": len(d),
        "valor_usd": d["valor_usd"].sum(),
        "importaciones_usd": d.loc[d["tipo"] == "Importación", "valor_usd"].sum(),
        "exportaciones_usd": d.loc[d["tipo"] == "Exportación", "valor_usd"].sum(),
        "tributos_cop": d["tributos_cop"].sum(),
        "dias_tramite": cerradas["dias_tramite"].mean() if len(cerradas) else None,
        "cumplimiento_sla": (cerradas["dias_tramite"] <= sla).mean() * 100 if len(cerradas) else None,
        "en_curso": int(d["en_curso"].sum()),
    }


def _delta(cur, prev):
    if cur is None or prev in (None, 0):
        return None
    return _num((cur - prev) / abs(prev) * 100, 1)


KPI_DEFS = [
    # id, etiqueta, formato, qué es "mejor"
    ("operaciones", "Operaciones (DO)", "int", "up"),
    ("importaciones_usd", "Valor importado (CIF)", "usd", "up"),
    ("exportaciones_usd", "Valor exportado (FOB)", "usd", "up"),
    ("tributos_cop", "Tributos aduaneros", "cop", "neutral"),
    ("dias_tramite", "Tiempo prom. de trámite", "days", "down"),
    ("cumplimiento_sla", "Cumplimiento de meta", "pct", "up"),
]


def dashboard(df: pd.DataFrame, f: Filtros, sla: float, hoy: date | None = None) -> dict:
    hoy = hoy or date.today()
    base = _dims(df, f)
    actual = _periodo(base, f.desde, f.hasta)
    dias = (f.hasta - f.desde).days + 1
    prev_hasta = f.desde - timedelta(days=1)
    prev_desde = prev_hasta - timedelta(days=dias - 1)
    anterior = _periodo(base, prev_desde, prev_hasta)

    m_act, m_ant = _metricas(actual, sla), _metricas(anterior, sla)

    # Serie mensual (también alimenta los sparklines de los KPIs)
    mensual = []
    if len(actual):
        a = actual.assign(mes=actual["fecha_apertura"].dt.to_period("M"))
        for mes in pd.period_range(pd.Timestamp(f.desde).to_period("M"), pd.Timestamp(f.hasta).to_period("M"), freq="M"):
            g = a[a["mes"] == mes]
            mm = _metricas(g, sla)
            mensual.append({
                "mes": str(mes),
                "operaciones": mm["operaciones"],
                "importaciones_usd": _num(mm["importaciones_usd"]),
                "exportaciones_usd": _num(mm["exportaciones_usd"]),
                "tributos_cop": _num(mm["tributos_cop"], 0),
                "dias_tramite": _num(mm["dias_tramite"], 2),
                "cumplimiento_sla": _num(mm["cumplimiento_sla"], 1),
            })

    kpis = [
        {
            "id": k, "label": label, "format": fmt, "better": better,
            "value": _num(m_act[k]), "previous": _num(m_ant[k]),
            "delta_pct": _delta(m_act[k], m_ant[k]),
            "sparkline": [p[k] for p in mensual],
        }
        for k, label, fmt, better in KPI_DEFS
    ]

    # Estado actual del flujo operativo (todas las operaciones abiertas, sin filtro de fecha)
    abiertas = base[base["en_curso"]]
    estados = [
        {"estado": e, "operaciones": int((abiertas["estado"] == e).sum()),
         "valor_usd": _num(abiertas.loc[abiertas["estado"] == e, "valor_usd"].sum())}
        for e in ESTADOS if e != ESTADO_FINAL
    ]

    total_valor = actual["valor_usd"].sum() or 1
    top = actual.groupby("cliente").agg(valor_usd=("valor_usd", "sum"), operaciones=("do", "count")).sort_values("valor_usd", ascending=False)
    top_clientes = [
        {"cliente": c, "valor_usd": _num(r.valor_usd), "operaciones": int(r.operaciones), "participacion": _num(r.valor_usd / total_valor * 100, 1)}
        for c, r in top.head(10).iterrows()
    ]

    cerradas = actual.dropna(subset=["dias_tramite"])
    adu = cerradas.groupby("aduana").agg(
        operaciones=("do", "count"), dias_promedio=("dias_tramite", "mean"),
        cumplimiento=("dias_tramite", lambda s: (s <= sla).mean() * 100),
    ).sort_values("operaciones", ascending=False)
    aduanas = [
        {"aduana": a, "operaciones": int(r.operaciones), "dias_promedio": _num(r.dias_promedio, 1), "cumplimiento_sla": _num(r.cumplimiento, 1)}
        for a, r in adu.iterrows()
    ]

    pai = actual.pivot_table(index="pais", columns="tipo", values="valor_usd", aggfunc="sum", fill_value=0)
    for col in ("Importación", "Exportación"):
        if col not in pai.columns:
            pai[col] = 0.0
    pai = pai.assign(total=pai["Importación"] + pai["Exportación"]).sort_values("total", ascending=False).head(8)
    paises = [{"pais": p, "importaciones_usd": _num(r["Importación"]), "exportaciones_usd": _num(r["Exportación"])} for p, r in pai.iterrows()]

    mod = actual.groupby("modalidad").agg(operaciones=("do", "count"), valor_usd=("valor_usd", "sum")).sort_values("operaciones", ascending=False)
    modalidades = [{"modalidad": k, "operaciones": int(r.operaciones), "valor_usd": _num(r.valor_usd)} for k, r in mod.iterrows()]

    # Alertas: operaciones abiertas que ya llegaron y superan la meta de días
    llegadas = abiertas[abiertas["fecha_llegada"].notna() & (abiertas["fecha_llegada"] <= pd.Timestamp(hoy))]
    llegadas = llegadas.assign(dias=(pd.Timestamp(hoy) - llegadas["fecha_llegada"]).dt.days)
    retrasadas = llegadas[(llegadas["dias"] > sla) & llegadas["estado"].isin(["En aduana", "Inspección"])].sort_values("dias", ascending=False)
    alertas = [
        {"do": r.do, "cliente": r.cliente, "tipo": r.tipo, "aduana": r.aduana, "estado": r.estado,
         "dias": int(r.dias), "valor_usd": _num(r.valor_usd), "ejecutivo": r.ejecutivo,
         "severidad": "critical" if r.dias > 2 * sla else "serious"}
        for r in retrasadas.head(12).itertuples()
    ]

    return {
        "periodo": {"desde": f.desde.isoformat(), "hasta": f.hasta.isoformat(),
                    "anterior_desde": prev_desde.isoformat(), "anterior_hasta": prev_hasta.isoformat()},
        "sla_dias": sla,
        "resumen": {"en_curso": int(len(abiertas)), "retrasadas": int(len(retrasadas)),
                    "valor_en_curso_usd": _num(abiertas["valor_usd"].sum())},
        "kpis": kpis,
        "mensual": mensual,
        "estados": estados,
        "top_clientes": top_clientes,
        "aduanas": aduanas,
        "paises": paises,
        "modalidades": modalidades,
        "alertas": alertas,
    }


def opciones_filtros(df: pd.DataFrame) -> dict:
    def uniq(c):
        return sorted(v for v in df[c].dropna().unique().tolist() if v and v != "Sin dato")

    return {
        "tipos": uniq("tipo"), "clientes": uniq("cliente"), "aduanas": uniq("aduana"), "modalidades": uniq("modalidad"),
        "fecha_min": df["fecha_apertura"].min().date().isoformat() if len(df) else None,
        "fecha_max": df["fecha_apertura"].max().date().isoformat() if len(df) else None,
    }


TABLA_COLS = ["do", "fecha_apertura", "tipo", "cliente", "pais", "aduana", "modalidad", "categoria",
              "valor_usd", "tributos_cop", "estado", "fecha_llegada", "fecha_levante", "dias_tramite", "ejecutivo"]


def operaciones(df: pd.DataFrame, f: Filtros, q: str = "", estado: str | None = None,
                orden: str = "fecha_apertura", desc: bool = True, pagina: int = 1, tamano: int = 25) -> dict:
    d = _periodo(_dims(df, f), f.desde, f.hasta)
    if estado:
        d = d[d["estado"] == estado]
    if q:
        ql = q.lower()
        m = pd.Series(False, index=d.index)
        for c in ("do", "cliente", "pais", "aduana", "ejecutivo", "categoria"):
            m |= d[c].astype(str).str.lower().str.contains(ql, regex=False)
        d = d[m]
    if orden in TABLA_COLS:
        d = d.sort_values(orden, ascending=not desc, na_position="last")
    total = len(d)
    page = d.iloc[(pagina - 1) * tamano: pagina * tamano][TABLA_COLS].copy()
    for c in ("fecha_apertura", "fecha_llegada", "fecha_levante"):
        page[c] = page[c].dt.strftime("%Y-%m-%d")
    page = page.astype(object).where(page.notna(), None)
    rows = page.to_dict(orient="records")
    for r in rows:
        r["valor_usd"] = _num(r["valor_usd"])
        r["tributos_cop"] = _num(r["tributos_cop"], 0)
        r["dias_tramite"] = _num(r["dias_tramite"], 1)
    return {"total": total, "pagina": pagina, "tamano": tamano, "filas": rows}
