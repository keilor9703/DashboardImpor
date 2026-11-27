"""Contrato de datos del Excel de seguimiento logístico (hoja «Sheet1»).

Cada fila del Excel es una línea de PO / SKU dentro de un embarque. Aquí se:
  1. mapean los encabezados del Excel a nombres internos (``COLUMN_MAP``),
  2. limpian valores ("N/A", "-", 0 usados como vacío, fechas, números),
  3. calculan campos derivados: embarque, ruta, valor en USD, fecha de referencia,
     duración de cada etapa y metas de lead time (PDT).

Si cambian los encabezados del Excel, solo se ajusta ``COLUMN_MAP``.
"""
import unicodedata
from datetime import date, datetime, time

import numpy as np
import pandas as pd

from .targets import ETAPAS, ETAPA_KEYS, metas_para

COLUMN_MAP: dict[str, str] = {
    "Status": "status",
    "Shipment Reference": "shipment_ref",
    "Export Number": "export_number",
    "Month": "mes_plan",
    "Franchise": "franquicia",
    "Product Type": "tipo_producto",
    "Country of departure": "origen",
    "Departure City": "ciudad_origen",
    "Departure Port Name": "puerto_origen",
    "Exporter Name": "exportador",
    "Country of arrival": "pais_llegada",
    "Final Country Destination": "destino",
    "Final Arrival City": "ciudad_destino",
    "Arrival Port Name": "puerto_destino",
    "Importer name": "importador",
    "Import Type": "tipo_importacion",
    "PO Number": "po",
    "PO Generation Date": "po_fecha",
    "PO Total Value Impo": "po_valor",
    "Currency Impo": "po_moneda",
    "SKU Code Impo": "sku",
    "Material Description Impo": "material",
    "Invoice Total Value Expo": "fact_expo_valor",
    "Invoice Currency Expo": "fact_expo_moneda",
    "Invoice Quantity Expo": "cantidad",
    "Invoice Total Value Impo": "fact_impo_valor",
    "Invoice Currency Impo": "fact_impo_moneda",
    "Booking Reference": "booking",
    "Expo Month": "mes_expo",
    "Pick Up Date & Time": "pickup",
    "First ETD": "etd",
    "ATD": "atd",
    "First ETA Port Arrival Date": "eta",
    "Last ETA Port Arrival Date": "eta_actualizada",
    "ATA Port arrival date": "ata",
    "MOT": "modo",
    "Transport type": "tipo_carga",
    "SPOT/BID": "spot_bid",
    "Freight Forwarder": "forwarder",
    "Shipping Line": "naviera",
    "Container #": "contenedor",
    "Container Type": "tipo_contenedor",
    "Broker Name": "agente_aduana",
    "Import Declaration Number": "declaracion",
    "Channel": "canal",
    "Detention Start Date and Time": "detencion_inicio",
    "Detention End Date and Time": "detencion_fin",
    "Customs Clearance Date & Time": "despacho",
    "Import Mode": "modalidad_importacion",
    "Local Carrier": "transportador_local",
    "Deliver to WH Date": "entrega_wh",
    "SAP Entry Date": "sap",
}

DATE_COLUMNS = ["mes_plan", "po_fecha", "mes_expo", "pickup", "etd", "atd", "eta", "eta_actualizada", "ata",
                "detencion_inicio", "detencion_fin", "despacho", "entrega_wh", "sap"]
NUMERIC_COLUMNS = ["po_valor", "fact_expo_valor", "fact_impo_valor", "cantidad"]
TEXT_COLUMNS = [c for c in COLUMN_MAP.values() if c not in DATE_COLUMNS + NUMERIC_COLUMNS]
REQUIRED_COLUMNS = ["status", "origen", "destino", "modo"]

# Flujo del embarque, en orden. (valor en el Excel, etiqueta en español, etapa en curso)
ESTADOS = [
    ("Waiting for Pick up", "Pendiente de recogida", "orden"),
    ("Waiting for Departure", "Pendiente de zarpe", "inland"),
    ("International Transit", "Tránsito internacional", "transito"),
    ("Waiting for Customs Clearance", "En nacionalización", "nacionalizacion"),
    ("Waiting for Delivery", "Pendiente de entrega", "local"),
    ("Sap Entry Completed", "Ingresado a SAP", None),
]
ESTADO_LABEL = {e[0]: e[1] for e in ESTADOS}
ESTADO_ETAPA = {e[1]: e[2] for e in ESTADOS}
ESTADO_ORDEN = {e[1]: i for i, e in enumerate(ESTADOS)}
ESTADO_FINAL = "Ingresado a SAP"

PAISES = {
    "CO": "Colombia", "COLOMBIA": "Colombia", "EC": "Ecuador", "VZ": "Venezuela", "VE": "Venezuela",
    "BR": "Brasil", "BE": "Bélgica", "US": "Estados Unidos", "PE": "Perú", "ZA": "Sudáfrica",
    "GERMANY": "Alemania", "DE": "Alemania", "ITALY": "Italia", "IT": "Italia", "MX": "México",
}
PAIS_CODIGO = {"COLOMBIA": "CO", "GERMANY": "DE", "ITALY": "IT", "VE": "VZ"}
MODOS = {"SEA": "Marítimo", "ROAD": "Terrestre", "AIR": "Aéreo"}
VACIOS = {"", "n/a", "na", "-", "0", "0.0", "nan", "none", "pdte", "sin registro"}


def _key(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode()
    return " ".join(text.lower().split())


_NORMALIZED_MAP = {_key(k): v for k, v in COLUMN_MAP.items()}


def _texto(s: pd.Series) -> pd.Series:
    s = s.astype("string").str.strip()
    s = s.str.replace(r"\.0$", "", regex=True)  # números leídos como 123.0
    return s.mask(s.str.lower().isin(VACIOS))


def _fecha_valor(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return pd.NaT
    if isinstance(v, (datetime, date)):  # datetime y date (openpyxl)
        return pd.Timestamp(v)
    if isinstance(v, time):  # horas sueltas "00:00" = celda sin fecha
        return pd.NaT
    if isinstance(v, (int, float)):  # número serial de Excel (Microsoft Graph)
        return pd.Timestamp("1899-12-30") + pd.Timedelta(days=float(v)) if v > 20000 else pd.NaT
    try:
        return pd.Timestamp(str(v).strip())
    except (ValueError, TypeError):
        return pd.NaT


def _fecha(s: pd.Series) -> pd.Series:
    out = s if pd.api.types.is_datetime64_any_dtype(s) else pd.to_datetime(s.map(_fecha_valor), errors="coerce")
    return out.where(out.dt.year > 2000)


def _pais(codigo: pd.Series) -> tuple[pd.Series, pd.Series]:
    up = codigo.fillna("").str.upper().str.strip()
    cod = up.map(lambda c: PAIS_CODIGO.get(c, c)).replace("", "ND")
    nombre = up.map(lambda c: PAISES.get(c, c.title() if c else "Sin dato"))
    return cod, nombre


def _unificar_mayusculas(s: pd.Series) -> pd.Series:
    """«BABY CARE» y «Baby Care» son la misma categoría: se usa la forma más frecuente."""
    llave = s.str.casefold().str.strip()
    canon = s.groupby(llave).agg(lambda x: x.value_counts().index[0])
    return llave.map(canon)


def normalize(raw: pd.DataFrame, trm: float = 4000.0, eur_usd: float = 1.08) -> pd.DataFrame:
    df = raw.rename(columns={c: _NORMALIZED_MAP.get(_key(c), c) for c in raw.columns})
    df = df.loc[:, ~df.columns.duplicated()]
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Faltan columnas obligatorias en el Excel: {missing}")
    for c in COLUMN_MAP.values():
        if c not in df.columns:
            df[c] = np.nan
    df = df[list(COLUMN_MAP.values())].copy()

    for c in TEXT_COLUMNS:
        df[c] = _texto(df[c])
    df = df[df["status"].notna()].reset_index(drop=True)
    for c in DATE_COLUMNS:
        df[c] = _fecha(df[c])
    for c in NUMERIC_COLUMNS:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    # --- Dimensiones legibles ---
    df["estado"] = df["status"].map(ESTADO_LABEL).fillna(df["status"])
    df["origen_cod"], df["origen_pais"] = _pais(df["origen"])
    df["destino_cod"], df["destino_pais"] = _pais(df["destino"])
    df["modo_cod"] = df["modo"].fillna("ND").str.upper()
    df["modo_txt"] = df["modo_cod"].map(MODOS).fillna("Sin dato")
    df["ruta"] = df["origen_pais"] + " → " + df["destino_pais"]
    df["franquicia_original"] = df["franquicia"]
    df["franquicia"] = _unificar_mayusculas(df["franquicia"]).fillna("Sin franquicia")
    for c in ("forwarder", "naviera", "agente_aduana", "canal", "exportador", "importador", "tipo_carga"):
        df[c] = df[c].fillna("Sin dato")

    # Embarque: número de exportación; si no hay, documento de transporte; si no, la PO
    df["embarque"] = (df["export_number"]
                      .fillna(df["shipment_ref"])
                      .fillna("PO " + df["po"].fillna("s/n")))
    df["unidad"] = df["embarque"] + " | " + df["po"].fillna("-")  # unidad de medición del PDT

    # --- Valor en USD (prioridad: factura impo USD > PO > factura expo) ---
    def a_usd(valor, moneda):
        m = moneda.fillna("USD").str.upper()
        return np.select([m == "USD", m == "EUR", m == "COP"], [valor, valor * eur_usd, valor / trm], np.nan)

    v_impo = pd.Series(a_usd(df["fact_impo_valor"], df["fact_impo_moneda"]), index=df.index)
    v_po = pd.Series(a_usd(df["po_valor"], df["po_moneda"]), index=df.index)
    v_expo = pd.Series(a_usd(df["fact_expo_valor"], df["fact_expo_moneda"]), index=df.index)
    df["valor_usd"] = v_impo.where(v_impo > 0).fillna(v_po.where(v_po > 0)).fillna(v_expo.where(v_expo > 0)).fillna(0.0)
    df["valor_fuente"] = np.select(
        [v_impo > 0, v_po > 0, v_expo > 0], ["Factura importación", "Orden de compra", "Factura exportación"], "Sin valor")

    # Fecha de referencia para filtrar por período
    df["fecha_ref"] = df["atd"].fillna(df["pickup"]).fillna(df["etd"]).fillna(df["mes_expo"]).fillna(df["po_fecha"])

    # --- Duración de etapas (días) y metas ---
    for key, _, ini, fin in ETAPAS:
        dur = (df[fin] - df[ini]).dt.total_seconds() / 86400
        df[f"d_{key}"] = dur.where(dur >= 0)
    df["pdt"] = ((df["sap"] - df["po_fecha"]).dt.total_seconds() / 86400).where(lambda s: s >= 0)

    metas = [metas_para(o, d, m) for o, d, m in zip(df["origen_cod"], df["destino_cod"], df["modo_cod"])]
    for key in ETAPA_KEYS:
        df[f"m_{key}"] = [m[key] if m else np.nan for m, _ in metas]
    df["meta_pdt"] = df[[f"m_{k}" for k in ETAPA_KEYS]].sum(axis=1, min_count=1)
    df["meta_oficial"] = [ok for _, ok in metas]
    df["en_curso"] = df["estado"] != ESTADO_FINAL
    return df


def diagnostico(raw_rows: int, df: pd.DataFrame) -> list[dict]:
    """Hallazgos de calidad de datos para mostrar a la gerencia / dueños del Excel."""
    n = len(df) or 1

    def item(clave, titulo, cantidad, detalle, nivel="warning"):
        return {"clave": clave, "titulo": titulo, "cantidad": int(cantidad), "porcentaje": round(cantidad / n * 100, 1),
                "detalle": detalle, "nivel": nivel}

    out = []
    vacias = raw_rows - len(df)
    if vacias > 1000:
        out.append({"clave": "filas_vacias", "titulo": "Filas vacías con formato", "cantidad": int(vacias), "porcentaje": None,
                    "detalle": f"El archivo declara {raw_rows:,} filas pero solo {len(df):,} tienen datos. "
                               "Eliminar las filas sobrantes reduce el peso del archivo y acelera la sincronización.",
                    "nivel": "serious"})
    out.append(item("sin_franquicia", "Líneas sin franquicia", (df["franquicia"] == "Sin franquicia").sum(),
                    "La columna «Franchise» está vacía o en 0 (posible fórmula de búsqueda sin resultado)."))
    out.append(item("sin_po_fecha", "Líneas sin fecha de PO", df["po_fecha"].isna().sum(),
                    "Sin fecha de creación de la PO no se puede medir el lead time total (PDT)."))
    cerrados_sin_hitos = df[(df["estado"] == ESTADO_FINAL) & df[["atd", "ata", "despacho", "sap"]].isna().any(axis=1)]
    out.append(item("hitos_incompletos", "Embarques cerrados con hitos faltantes", len(cerrados_sin_hitos),
                    "Estado «Ingresado a SAP» pero falta ATD, ATA, fecha de despacho o fecha SAP."))
    variantes = df.groupby(df["franquicia_original"].str.casefold())["franquicia_original"].nunique()
    if (variantes > 1).any():
        out.append(item("franquicia_escritura", "Franquicias escritas de varias formas",
                        df["franquicia_original"].str.casefold().isin(variantes[variantes > 1].index).sum(),
                        "Ej.: «Baby Care» y «BABY CARE». El tablero las unifica, pero conviene estandarizarlas.", "info"))
    eta_vigente = df["eta_actualizada"].fillna(df["eta"])
    eta_antes = df[eta_vigente.notna() & df["atd"].notna() & (eta_vigente < df["atd"])]
    if len(eta_antes):
        out.append(item("eta_incoherente", "ETA vigente anterior a la fecha de zarpe", len(eta_antes),
                        "Embarques: " + ", ".join(sorted(eta_antes["embarque"].unique())[:5]) + ". Revisar la fecha ETA."))
    raros = df["embarque"].str.contains(r"\.0 ", regex=True, na=False).sum()
    if raros:
        out.append(item("embarque_formato", "Números de exportación con formato irregular", raros,
                        "Ejemplo: «217E.0 2026». Puede generar embarques duplicados."))
    return [o for o in out if o["cantidad"]]
