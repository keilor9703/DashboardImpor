"""Lectura «tal cual» de la hoja «In Transit PDT».

La hoja tiene: columnas de identificación (Status, Shipment Reference, países, PO),
seis bloques de proceso que empiezan con «Real Operation to …» y un bloque final
«Total PDT». Los bloques se detectan por sus encabezados, de modo que si se
agregan o quitan columnas dentro de un bloque, el tablero se adapta solo.
"""
import re
from datetime import date, datetime, time
from math import isfinite

import pandas as pd

# Colores de la hoja original (encabezados de cada proceso)
COLORES = ["#5b9bd5", "#ffc000", "#a6e3e9", "#e3b4d8", "#93d08e", "#ecebbd"]
COLOR_TOTAL = "#bfbfbf"

TITULOS_ES = {
    "Real Operation to PO Creation": "Creación de PO",
    "Real Operation to inland": "Transporte interno",
    "Real Operation to international transit": "Tránsito internacional",
    "Real Operation to nacionalization": "Nacionalización",
    "Real Operation to local Transport": "Transporte local",
    "Real Operation to Register Entry to SAP": "Registro en SAP",
}


def _norm(h) -> str:
    return " ".join(str(h or "").split())


def _valor(v):
    """Convierte cada celda a algo serializable, conservando el texto original."""
    if v is None or v == "":
        return None
    if isinstance(v, time):  # «00:00» = celda de fecha vacía
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day).isoformat()
    if isinstance(v, float):
        if not isfinite(v):
            return None
        return int(v) if v.is_integer() and abs(v) > 1e6 else round(v, 2)  # PO / referencias numéricas
    return str(v).strip() if isinstance(v, str) else v


def _num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, str):
        m = re.findall(r"-?\d+(?:[.,]\d+)?", v)
        return float(m[-1].replace(",", ".")) if m else None
    return None


def _tipo(header: str, valores: list) -> str:
    h = header.lower()
    if h.startswith("comentario"):
        return "texto"
    if h.startswith("days out of target"):
        return "desviacion"
    if any(isinstance(v, str) and re.match(r"\d{4}-\d{2}-\d{2}T", v) for v in valores):
        return "fecha"
    no_nulos = [v for v in valores if v is not None]
    if no_nulos and all(isinstance(v, str) for v in no_nulos):
        return "texto"
    if h.startswith("real operation") or "target" in h or h == "total pdt":
        return "dias"
    return "texto"


def parse(header: list, rows: list) -> dict:
    header = [_norm(h) for h in header]
    inicios = [i for i, h in enumerate(header) if h.lower().startswith("real operation to")]
    i_total = next((i for i, h in enumerate(header) if h.lower() == "total pdt"), len(header))
    if not inicios:
        raise ValueError("La hoja «In Transit PDT» no tiene columnas «Real Operation to …»")

    filas = [[_valor(v) for v in r] + [None] * (len(header) - len(r)) for r in rows]

    def columnas(desde, hasta):
        return [{"idx": i, "label": header[i], "tipo": _tipo(header[i], [f[i] for f in filas])} for i in range(desde, hasta)]

    identidad = columnas(0, inicios[0])
    limites = inicios + [i_total]
    procesos = []
    for n, (a, b) in enumerate(zip(limites, limites[1:])):
        cols = columnas(a, b)
        real = [_num(f[a]) for f in filas]
        meta = [_num(f[a + 1]) for f in filas] if b - a > 1 else [None] * len(filas)
        desv_idx = next((c["idx"] for c in cols if c["tipo"] == "desviacion"), None)
        desv = [_num(f[desv_idx]) for f in filas] if desv_idx is not None else [None] * len(filas)
        medidas = [d for d in desv if d is not None]
        reales = [r for r in real if r is not None]
        metas = [m for m in meta if m is not None]
        procesos.append({
            "key": f"p{n + 1}", "titulo": header[a], "titulo_es": TITULOS_ES.get(header[a], header[a]),
            "color": COLORES[n % len(COLORES)], "columnas": cols,
            "resumen": {
                "real_promedio": round(sum(reales) / len(reales), 1) if reales else None,
                "meta_promedio": round(sum(metas) / len(metas), 1) if metas else None,
                "fuera_meta": sum(1 for d in medidas if d > 0),
                "en_meta": sum(1 for d in medidas if d <= 0),
                "sin_registro": sum(1 for r in real if r is None),
            },
        })

    total_cols = columnas(i_total, len(header))
    totales = [_num(f[i_total]) if i_total < len(header) else None for f in filas]
    metas_t = [_num(f[i_total + 1]) if i_total + 1 < len(header) else None for f in filas]
    pares = [(t, m) for t, m in zip(totales, metas_t) if t is not None and m is not None]
    validos = [t for t in totales if t is not None]
    total = {
        "key": "total", "titulo": "Total PDT", "titulo_es": "Total PDT", "color": COLOR_TOTAL, "columnas": total_cols,
        "resumen": {
            "real_promedio": round(sum(validos) / len(validos), 1) if validos else None,
            "meta_promedio": round(sum(m for _, m in pares) / len(pares), 1) if pares else None,
            "fuera_meta": sum(1 for t, m in pares if t > m),
            "en_meta": sum(1 for t, m in pares if t <= m),
            "sin_registro": sum(1 for t in totales if t is None),
        },
    }
    return {"identidad": identidad, "procesos": procesos, "total": total, "filas": filas, "registros": len(filas)}


def desde_modelo(df: pd.DataFrame) -> tuple[list, list]:
    """Construye una hoja «In Transit PDT» equivalente a partir del modelo (para el modo demo)."""
    from .targets import ETAPAS

    nombres = [
        ("Real Operation to PO Creation", "Target PO Creation", "Days Out of Target PO Creation"),
        ("Real Operation to inland", "Inland target", "Days Out of Target Total Inland"),
        ("Real Operation to international transit", "In Transit Target", "Days Out of Target international transit"),
        ("Real Operation to nacionalization", "Nacionalization Target", "Days Out of Target Nacionalizacion"),
        ("Real Operation to local Transport", "Local Transportation Target", "Days Out of Target Internal Transit"),
        ("Real Operation to Register Entry to SAP", "SAP Entry Target", "Days Out of Target Register Entry to SAP"),
    ]
    hitos_excel = {"pickup": "Pick Up Date & Time", "atd": "ATD", "ata": "ATA", "despacho": "Customs Clearance Date & Time",
                   "entrega_wh": "Deliver to WH Date", "sap": "SAP Entry Date"}
    header = ["Status", "Shipment Reference", "Country of departure", "Country of arrival", "PO Number"]
    for (real, meta, desv), (_, _, ini, fin) in zip(nombres, ETAPAS):
        header += [real, meta] + (["PO Generation Date"] if ini == "po_fecha" else []) + [hitos_excel[fin], desv, "Comentarios"]
    header += ["Total PDT", "Indicator Target PDT", "Indicator Target PDT"]

    u = df[df["po"].notna() & df["meta_oficial"]].groupby("unidad").first()
    rows = []
    for _, r in u.iterrows():
        row = [r["status"], r["shipment_ref"], r["origen_cod"], r["destino_cod"], r["po"]]
        for (key, _, ini, fin) in ETAPAS:
            d, m = r[f"d_{key}"], r[f"m_{key}"]
            fecha = r[fin].to_pydatetime() if pd.notna(r[fin]) else None
            row += [round(d, 2) if pd.notna(d) else "Sin Registro", m]
            if ini == "po_fecha":
                row.append(r["po_fecha"].to_pydatetime() if pd.notna(r["po_fecha"]) else None)
            row += [fecha, round(d - m, 2) if pd.notna(d) else None, None]
        total = r["pdt"] if pd.notna(r["pdt"]) else None
        row += [total, r["meta_pdt"], f"{r['origen_cod']} = {int(r['meta_pdt'])}"]
        rows.append(row)
    return header, rows
