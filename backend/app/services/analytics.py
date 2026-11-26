"""Indicadores de la torre de control logística.

Niveles de agregación:
  - línea:   una fila del Excel (SKU / línea de PO)
  - unidad:  embarque + PO → unidad con la que el cliente mide el PDT (hoja «In Transit PDT»)
  - embarque: número de exportación / documento de transporte
"""
from dataclasses import dataclass
from datetime import date, timedelta
from math import isfinite

import pandas as pd

from ..data.schema import ESTADO_ETAPA, ESTADO_FINAL, ESTADO_ORDEN, ESTADOS
from ..data.targets import ETAPAS

DIMENSIONES = [
    ("modo", "modo_txt", "Transporte"),
    ("origen", "origen_pais", "Origen"),
    ("destino", "destino_pais", "Destino"),
    ("franquicia", "franquicia", "Franquicia"),
    ("forwarder", "forwarder", "Forwarder"),
]
HITOS = ["po_fecha", "pickup", "etd", "atd", "eta", "eta_actualizada", "ata", "despacho", "entrega_wh", "sap"]
# Si falta el hito que inicia la etapa actual, se usa el anterior conocido
INICIO_ETAPA = {
    "orden": ["po_fecha"],
    "inland": ["pickup", "po_fecha"],
    "transito": ["atd", "etd", "pickup"],
    "nacionalizacion": ["ata", "eta_actualizada", "eta", "atd"],
    "local": ["despacho", "ata"],
    "sap": ["entrega_wh", "despacho"],
}


@dataclass
class Filtros:
    desde: date
    hasta: date
    modo: str | None = None
    origen: str | None = None
    destino: str | None = None
    franquicia: str | None = None
    forwarder: str | None = None


def _num(x, nd: int = 2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, nd) if isfinite(x) else None


def _iso(x):
    return None if x is None or pd.isna(x) else pd.Timestamp(x).isoformat()


def _dims(df: pd.DataFrame, f: Filtros) -> pd.DataFrame:
    m = pd.Series(True, index=df.index)
    for key, col, _ in DIMENSIONES:
        val = getattr(f, key)
        if val:
            m &= df[col] == val
    return df[m]


def _periodo(df: pd.DataFrame, desde: date, hasta: date) -> pd.DataFrame:
    fin = pd.Timestamp(hasta) + pd.Timedelta(days=1)
    return df[(df["fecha_ref"] >= pd.Timestamp(desde)) & (df["fecha_ref"] < fin)]


def unidades(d: pd.DataFrame) -> pd.DataFrame:
    """Embarque + PO: duraciones, PDT y metas (iguales en todas las líneas de la unidad)."""
    if d.empty:
        return d
    cols = ["embarque", "ruta", "modo_cod", "modo_txt", "estado", "naviera", "forwarder", "pdt", "meta_pdt", "meta_oficial",
            *[f"d_{k}" for k, *_ in ETAPAS], *[f"m_{k}" for k, *_ in ETAPAS]]
    u = d.groupby("unidad", sort=False)[cols].first()
    u["valor_usd"] = d.groupby("unidad", sort=False)["valor_usd"].sum()
    u["a_tiempo"] = (u["pdt"] <= u["meta_pdt"]).where(u["pdt"].notna() & u["meta_pdt"].notna())
    return u


def embarques(d: pd.DataFrame) -> pd.DataFrame:
    if d.empty:
        return pd.DataFrame()
    g = d.groupby("embarque", sort=False)
    e = g[["estado", "ruta", "origen_pais", "destino_pais", "modo_cod", "modo_txt", "forwarder", "naviera", "agente_aduana",
           "canal", "tipo_carga", "shipment_ref", "booking", "meta_pdt", "meta_oficial",
           *[f"m_{k}" for k, *_ in ETAPAS]]].first()
    for h in HITOS:
        e[h] = g[h].min() if h in ("po_fecha", "pickup", "etd", "atd", "eta") else g[h].max()
    e["fecha_ref"] = g["fecha_ref"].min()
    e["valor_usd"] = g["valor_usd"].sum()
    e["lineas"] = g.size()
    e["contenedores"] = g["contenedor"].nunique()
    e["pos"] = g["po"].nunique()
    e["pdt"] = g["pdt"].mean()
    e["orden_estado"] = e["estado"].map(ESTADO_ORDEN).fillna(99)
    return e


def _metricas(d: pd.DataFrame) -> dict:
    u = unidades(d)
    cerradas = u[u["pdt"].notna()] if len(u) else u
    con_meta = cerradas[cerradas["a_tiempo"].notna()] if len(u) else u
    return {
        "embarques": d["embarque"].nunique(),
        "valor_usd": d["valor_usd"].sum(),
        "contenedores": d["contenedor"].nunique(),
        "pdt_promedio": cerradas["pdt"].mean() if len(cerradas) else None,
        "cumplimiento_pdt": con_meta["a_tiempo"].astype(float).mean() * 100 if len(con_meta) else None,
        "nacionalizacion": u["d_nacionalizacion"].mean() if len(u) and u["d_nacionalizacion"].notna().any() else None,
    }


def _delta(cur, prev):
    if cur is None or prev in (None, 0) or pd.isna(prev):
        return None
    return _num((cur - prev) / abs(prev) * 100, 1)


KPI_DEFS = [
    ("embarques", "Embarques", "int", "up"),
    ("valor_usd", "Valor movilizado", "usd", "up"),
    ("contenedores", "Contenedores", "int", "up"),
    ("pdt_promedio", "Lead time total (PDT)", "days", "down"),
    ("cumplimiento_pdt", "Cumplimiento de PDT", "pct", "up"),
    ("nacionalizacion", "Tiempo de nacionalización", "days", "down"),
]


def _alertas(abiertos: pd.DataFrame, hoy: pd.Timestamp) -> list[dict]:
    out = []
    for emb, r in abiertos.iterrows():
        etapa = ESTADO_ETAPA.get(r["estado"])
        if not etapa:
            continue
        inicio = next((r[c] for c in INICIO_ETAPA[etapa] if pd.notna(r[c])), None)
        meta = r[f"m_{etapa}"]
        if inicio is None or pd.isna(meta):
            continue
        dias = (hoy - inicio).total_seconds() / 86400
        exceso = dias - max(meta, 0.5)
        if exceso <= 0.5:
            continue
        out.append({
            "embarque": emb, "estado": r["estado"], "ruta": r["ruta"], "modo": r["modo_txt"],
            "etapa": next(e[1] for e in ETAPAS if e[0] == etapa),
            "dias": _num(dias, 1), "meta": _num(meta, 1), "exceso": _num(exceso, 1),
            "valor_usd": _num(r["valor_usd"]), "contenedores": int(r["contenedores"]),
            "forwarder": r["forwarder"], "meta_oficial": bool(r["meta_oficial"]),
            "severidad": "critical" if dias > 2 * max(meta, 1) else "serious",
        })
    return sorted(out, key=lambda a: -a["exceso"])


def dashboard(df: pd.DataFrame, f: Filtros, hoy: date | None = None) -> dict:
    hoy_ts = pd.Timestamp(hoy or date.today())
    base = _dims(df, f)
    act = _periodo(base, f.desde, f.hasta)
    dias = (f.hasta - f.desde).days + 1
    prev_hasta = f.desde - timedelta(days=1)
    prev_desde = prev_hasta - timedelta(days=dias - 1)
    ant = _periodo(base, prev_desde, prev_hasta)
    m_act, m_ant = _metricas(act), _metricas(ant)

    # --- Serie mensual (desde el primer mes con datos) ---
    mensual, rutas_top = [], []
    if len(act):
        # Rutas principales calculadas sobre TODO el archivo: el color de cada ruta no cambia al filtrar
        rutas_top = df.groupby("ruta")["valor_usd"].sum().sort_values(ascending=False).head(3).index.tolist()
        a = act.assign(mes=act["fecha_ref"].dt.to_period("M"))
        inicio = max(pd.Timestamp(f.desde).to_period("M"), a["mes"].min())
        for mes in pd.period_range(inicio, pd.Timestamp(f.hasta).to_period("M"), freq="M"):
            g = a[a["mes"] == mes]
            mm = _metricas(g)
            por_ruta = g.groupby("ruta")["valor_usd"].sum()
            mensual.append({
                "mes": str(mes),
                **{k: _num(v, 2) for k, v in mm.items()},
                "rutas": {r: _num(por_ruta.get(r, 0)) for r in rutas_top} | {"Otras": _num(por_ruta.drop(rutas_top, errors="ignore").sum())},
            })

    kpis = [{
        "id": k, "label": label, "format": fmt, "better": better,
        "value": _num(m_act[k]), "previous": _num(m_ant[k]), "delta_pct": _delta(m_act[k], m_ant[k]),
        "sparkline": [p[k] for p in mensual],
    } for k, label, fmt, better in KPI_DEFS]

    # --- Torre de control: embarques abiertos (sin filtro de fecha) ---
    e_base = embarques(base)
    abiertos = e_base[e_base["estado"] != ESTADO_FINAL] if len(e_base) else e_base
    pipeline = []
    for _, label, _ in ESTADOS[:-1]:
        g = abiertos[abiertos["estado"] == label] if len(abiertos) else abiertos
        pipeline.append({"estado": label, "embarques": int(len(g)),
                         "valor_usd": _num(g["valor_usd"].sum()) if len(g) else 0,
                         "contenedores": int(g["contenedores"].sum()) if len(g) else 0})

    alertas = _alertas(abiertos, hoy_ts) if len(abiertos) else []

    proximos = []
    if len(abiertos):
        transito = abiertos[abiertos["estado"].isin(["Pendiente de zarpe", "Tránsito internacional"])].copy()
        transito["eta_vigente"] = transito["eta_actualizada"].fillna(transito["eta"])
        # Solo arribos futuros (o de ayer) y coherentes: ETA posterior al zarpe
        coherente = transito["atd"].isna() | (transito["eta_vigente"] >= transito["atd"])
        transito = transito[(transito["eta_vigente"] >= hoy_ts - pd.Timedelta(days=1)) & coherente].sort_values("eta_vigente")
        proximos = [{
            "embarque": emb, "estado": r["estado"], "ruta": r["ruta"], "modo": r["modo_txt"], "eta": _iso(r["eta_vigente"]),
            "dias": _num((r["eta_vigente"] - hoy_ts).total_seconds() / 86400, 0), "naviera": r["naviera"],
            "contenedores": int(r["contenedores"]), "valor_usd": _num(r["valor_usd"]),
        } for emb, r in transito.head(8).iterrows()]

    # --- Lead time por etapa vs meta, por ruta ---
    u_act = unidades(act)
    etapas, rutas = [], []
    if len(u_act):
        e_act = embarques(act)
        for (ruta, modo), g in u_act.groupby(["ruta", "modo_txt"], sort=False):
            cerr = g[g["pdt"].notna()]
            con_meta = cerr[cerr["a_tiempo"].notna()]
            ge = e_act[(e_act["ruta"] == ruta) & (e_act["modo_txt"] == modo)]
            rutas.append({
                "ruta": ruta, "modo": modo, "embarques": int(len(ge)), "en_curso": int((ge["estado"] != ESTADO_FINAL).sum()),
                "valor_usd": _num(g["valor_usd"].sum()), "contenedores": int(ge["contenedores"].sum()),
                "pdt_promedio": _num(cerr["pdt"].mean(), 1) if len(cerr) else None,
                "meta_pdt": _num(g["meta_pdt"].iloc[0], 1), "meta_oficial": bool(g["meta_oficial"].iloc[0]),
                "cumplimiento": _num(con_meta["a_tiempo"].astype(float).mean() * 100, 1) if len(con_meta) else None,
                "transito_promedio": _num(g["d_transito"].mean(), 1),
            })
            if g["meta_oficial"].iloc[0] and g["d_orden"].notna().any():
                etapas.append({
                    "id": f"{ruta} · {modo}", "ruta": ruta, "modo": modo, "unidades": int(len(g)),
                    "pdt_real": _num(cerr["pdt"].mean(), 1) if len(cerr) else None,
                    "pdt_meta": _num(g["meta_pdt"].iloc[0], 1),
                    "etapas": [{"key": k, "label": lbl, "real": _num(g[f"d_{k}"].mean(), 1),
                                "meta": _num(g[f"m_{k}"].iloc[0], 1), "n": int(g[f"d_{k}"].notna().sum())}
                               for k, lbl, *_ in ETAPAS],
                })
        rutas.sort(key=lambda r: -(r["valor_usd"] or 0))
        etapas.sort(key=lambda r: -r["unidades"])

    navieras = []
    sea = u_act[(u_act["modo_cod"] == "SEA") & (u_act["naviera"] != "Sin dato")] if len(u_act) else u_act
    if len(sea):
        for nav, g in sea.groupby("naviera"):
            navieras.append({"naviera": nav, "embarques": int(g["embarque"].nunique()),
                             "transito_promedio": _num(g["d_transito"].mean(), 1),
                             "valor_usd": _num(g["valor_usd"].sum())})
        navieras.sort(key=lambda n: -n["embarques"])

    franquicias = []
    if len(act):
        fr = act.groupby("franquicia")["valor_usd"].sum().sort_values(ascending=False)
        total = fr.sum() or 1
        orden = [x for x in fr.index if x != "Sin franquicia"] + (["Sin franquicia"] if "Sin franquicia" in fr.index else [])
        franquicias = [{"franquicia": k, "valor_usd": _num(fr[k]), "participacion": _num(fr[k] / total * 100, 1)} for k in orden]

    canales = []
    if len(act):
        ea = embarques(act)
        c = ea[ea["canal"] != "Sin dato"]["canal"].value_counts()
        canales = [{"canal": k, "embarques": int(v)} for k, v in c.items()]

    return {
        "periodo": {"desde": f.desde.isoformat(), "hasta": f.hasta.isoformat(),
                    "anterior_desde": prev_desde.isoformat(), "anterior_hasta": prev_hasta.isoformat()},
        "resumen": {
            "en_curso": int(len(abiertos)),
            "valor_en_curso_usd": _num(abiertos["valor_usd"].sum()) if len(abiertos) else 0,
            "contenedores_en_curso": int(abiertos["contenedores"].sum()) if len(abiertos) else 0,
            "con_alerta": len(alertas),
        },
        "kpis": kpis,
        "mensual": mensual,
        "rutas_top": rutas_top,
        "pipeline": pipeline,
        "etapas": etapas,
        "rutas": rutas,
        "navieras": navieras,
        "franquicias": franquicias,
        "canales": canales,
        "alertas": alertas[:15],
        "proximos": proximos,
    }


def opciones_filtros(df: pd.DataFrame) -> dict:
    dims = []
    for key, col, label in DIMENSIONES:
        vals = sorted(v for v in df[col].dropna().unique().tolist() if v not in ("Sin dato",))
        dims.append({"key": key, "label": label, "opciones": vals})
    return {
        "dimensiones": dims,
        "estados": [e[1] for e in ESTADOS],
        "fecha_min": df["fecha_ref"].min().date().isoformat() if len(df) else None,
        "fecha_max": df["fecha_ref"].max().date().isoformat() if len(df) else None,
    }


TABLA_COLS = ["embarque", "estado", "ruta", "modo_txt", "forwarder", "naviera", "contenedores", "lineas", "valor_usd",
              "pickup", "atd", "eta", "ata", "despacho", "sap", "pdt", "meta_pdt"]


def lista_embarques(df: pd.DataFrame, f: Filtros, q: str = "", estado: str | None = None,
                    orden: str = "fecha_ref", desc: bool = True, pagina: int = 1, tamano: int = 25) -> dict:
    d = _periodo(_dims(df, f), f.desde, f.hasta)
    if q:
        ql = q.lower()
        m = pd.Series(False, index=d.index)
        for c in ("embarque", "shipment_ref", "booking", "po", "contenedor", "sku", "material", "ruta", "naviera"):
            m |= d[c].astype("string").str.lower().str.contains(ql, regex=False).fillna(False)
        d = d[d["embarque"].isin(d.loc[m, "embarque"])]
    e = embarques(d)
    if len(e) and estado:
        e = e[e["estado"] == estado]
    total = len(e)
    if not total:
        return {"total": 0, "pagina": pagina, "tamano": tamano, "filas": []}
    clave = "orden_estado" if orden == "estado" else orden
    if clave in e.columns:
        e = e.sort_values(clave, ascending=not desc, na_position="last")
    page = e.iloc[(pagina - 1) * tamano: pagina * tamano].reset_index()
    filas = []
    for r in page.itertuples(index=False):
        row = r._asdict()
        filas.append({
            "embarque": row["embarque"], "estado": row["estado"], "ruta": row["ruta"], "modo": row["modo_txt"],
            "forwarder": row["forwarder"], "naviera": row["naviera"], "contenedores": int(row["contenedores"]),
            "lineas": int(row["lineas"]), "valor_usd": _num(row["valor_usd"]),
            **{h: _iso(row[h]) for h in ("pickup", "atd", "eta", "ata", "despacho", "sap")},
            "pdt": _num(row["pdt"], 1), "meta_pdt": _num(row["meta_pdt"], 1),
        })
    return {"total": total, "pagina": pagina, "tamano": tamano, "filas": filas}


def detalle_embarque(df: pd.DataFrame, embarque: str, hoy: date | None = None) -> dict | None:
    d = df[df["embarque"] == embarque]
    if d.empty:
        return None
    e = embarques(d).iloc[0]
    u = unidades(d)
    hoy_ts = pd.Timestamp(hoy or date.today())
    etapas = []
    for k, label, ini, fin in ETAPAS:
        real = u[f"d_{k}"].mean()
        inicio, cierre = e[ini], e[fin]
        en_curso = pd.notna(inicio) and pd.isna(cierre) and ESTADO_ETAPA.get(e["estado"]) == k
        if en_curso:
            real = (hoy_ts - inicio).total_seconds() / 86400
        etapas.append({"key": k, "label": label, "inicio": _iso(inicio), "fin": _iso(cierre),
                       "real": _num(real, 1), "meta": _num(e[f"m_{k}"], 1), "en_curso": bool(en_curso)})
    lineas = d.sort_values(["po", "sku"])[["po", "sku", "material", "franquicia", "cantidad", "valor_usd", "contenedor"]]
    lineas = lineas.astype(object).where(lineas.notna(), None).to_dict(orient="records")
    for li in lineas:
        li["valor_usd"] = _num(li["valor_usd"])
        li["cantidad"] = _num(li["cantidad"], 0)
    return {
        "embarque": embarque, "estado": e["estado"], "ruta": e["ruta"], "modo": e["modo_txt"],
        "forwarder": e["forwarder"], "naviera": e["naviera"], "agente_aduana": e["agente_aduana"], "canal": e["canal"],
        "documento_transporte": e["shipment_ref"], "booking": e["booking"],
        "contenedores": sorted(d["contenedor"].dropna().unique().tolist()),
        "valor_usd": _num(e["valor_usd"]), "pdt": _num(e["pdt"], 1), "meta_pdt": _num(e["meta_pdt"], 1),
        "meta_oficial": bool(e["meta_oficial"]),
        "hitos": {h: _iso(e[h]) for h in HITOS},
        "etapas": etapas,
        "lineas": lineas,
    }
