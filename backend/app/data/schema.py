"""Contrato de datos: cómo se mapean las columnas de la hoja consolidada del Excel
a los nombres internos que usa el backend.

Cuando tengamos el Excel real, solo hay que ajustar ``COLUMN_MAP`` (encabezado en
el Excel -> nombre interno). El resto del sistema no cambia.
"""
import unicodedata

import pandas as pd

# Encabezado en Excel  ->  nombre interno
COLUMN_MAP: dict[str, str] = {
    "DO": "do",
    "Fecha apertura": "fecha_apertura",
    "Tipo operación": "tipo",
    "Cliente": "cliente",
    "NIT": "nit",
    "País origen/destino": "pais",
    "Aduana": "aduana",
    "Modalidad transporte": "modalidad",
    "Categoría": "categoria",
    "Subpartida": "subpartida",
    "Valor FOB USD": "fob_usd",
    "Flete USD": "flete_usd",
    "Seguro USD": "seguro_usd",
    "Valor CIF USD": "cif_usd",
    "TRM": "trm",
    "Arancel COP": "arancel_cop",
    "IVA COP": "iva_cop",
    "Estado": "estado",
    "Fecha llegada": "fecha_llegada",
    "Fecha levante": "fecha_levante",
    "Fecha entrega": "fecha_entrega",
    "Ejecutivo": "ejecutivo",
}

DATE_COLUMNS = ["fecha_apertura", "fecha_llegada", "fecha_levante", "fecha_entrega"]
NUMERIC_COLUMNS = ["fob_usd", "flete_usd", "seguro_usd", "cif_usd", "trm", "arancel_cop", "iva_cop"]
REQUIRED_COLUMNS = ["do", "fecha_apertura", "tipo", "cliente", "estado", "fob_usd"]

# Orden del flujo operativo (pipeline)
ESTADOS = ["Documentación", "En tránsito", "En aduana", "Inspección", "Liberado", "Entregado"]
ESTADO_FINAL = "Entregado"


def _key(text: str) -> str:
    """Normaliza encabezados: minúsculas, sin tildes ni espacios extra."""
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode()
    return " ".join(text.lower().split())


_NORMALIZED_MAP = {_key(k): v for k, v in COLUMN_MAP.items()}


def _excel_serial_to_datetime(s: pd.Series) -> pd.Series:
    """Graph devuelve las fechas como número serial de Excel; los convierte."""
    numeric = pd.to_numeric(s, errors="coerce")
    as_serial = pd.to_datetime(numeric, unit="D", origin="1899-12-30", errors="coerce")
    as_text = pd.to_datetime(s.where(numeric.isna()), errors="coerce", dayfirst=True)
    return as_serial.fillna(as_text)


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """Renombra columnas, tipa fechas/números y calcula campos derivados."""
    df = df.rename(columns={c: _NORMALIZED_MAP.get(_key(c), c) for c in df.columns})
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Faltan columnas obligatorias en el Excel: {missing}")

    df = df.dropna(subset=["do"]).copy()
    for col in DATE_COLUMNS:
        if col in df.columns:
            if not pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = _excel_serial_to_datetime(df[col])
        else:
            df[col] = pd.NaT
    for col in NUMERIC_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0) if col in df.columns else 0.0

    for col in ("tipo", "cliente", "estado", "aduana", "modalidad", "pais", "categoria", "ejecutivo"):
        if col not in df.columns:
            df[col] = "Sin dato"
        df[col] = df[col].fillna("Sin dato").astype(str).str.strip()

    # Derivados
    df["valor_usd"] = df["cif_usd"].where((df["tipo"] == "Importación") & (df["cif_usd"] > 0), df["fob_usd"])
    df["tributos_cop"] = df["arancel_cop"] + df["iva_cop"]
    df["dias_tramite"] = (df["fecha_levante"] - df["fecha_llegada"]).dt.total_seconds() / 86400
    df["en_curso"] = df["estado"] != ESTADO_FINAL
    return df.reset_index(drop=True)
