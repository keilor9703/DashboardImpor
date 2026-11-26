"""Fuentes de datos. Todas devuelven un DataFrame "crudo" con los encabezados del
Excel; luego ``schema.normalize`` lo convierte al modelo interno.

- MockSource:  datos simulados (desarrollo / demo).
- FileSource:  un .xlsx local (probar con una copia del archivo real).
- GraphExcelSource (graph.py): el Excel en SharePoint vía Microsoft Graph (producción).
"""
import io
import logging
from abc import ABC, abstractmethod

import pandas as pd
import warnings

import openpyxl

from ..config import Settings
from . import mock, pdt

log = logging.getLogger(__name__)
# openpyxl avisa que ignora formatos condicionales extendidos; no afecta la lectura de datos
warnings.filterwarnings("ignore", message=".*extension is not supported.*", module=r"openpyxl\..*")


def _open(src):
    if hasattr(src, "seek"):
        src.seek(0)
    # read_only = lectura en streaming (memoria constante); keep_links=False evita cargar
    # la caché de libros externos (en el Excel real pesa ~60 MB y no se necesita).
    return openpyxl.load_workbook(src, read_only=True, data_only=True, keep_links=False)


def _rows_until_end(it, max_empty: int) -> list:
    rows, empty = [], 0
    for r in it:
        if not r or r[0] in ("", None):
            empty += 1
            if empty > max_empty:
                break
            continue
        empty = 0
        rows.append(list(r))
    return rows


def split_header(values: list, max_scan: int = 10) -> tuple[list, list]:
    """Separa encabezado y datos. El encabezado es la primera fila que empieza por «Status»
    (en «In Transit PDT» hay una fila previa con letras de columna)."""
    for i, r in enumerate(values[:max_scan]):
        if r and str(r[0]).strip().lower() == "status":
            return [str(h).strip() for h in r], [x for x in values[i + 1:] if x and x[0] not in ("", None)]
    return [str(h).strip() for h in values[0]], values[1:]


def read_rows(src, sheet: str, max_empty: int = 500) -> tuple[list, list, int]:
    """Lee una hoja en streaming y se detiene al terminar los datos reales.

    Los Excel con miles de filas "vacías" pero con formato (o fórmulas arrastradas) son
    comunes: cargarlas completas consume gigabytes de RAM. Aquí se recorren fila a fila
    y se corta tras ``max_empty`` filas vacías seguidas. Devuelve (encabezado, filas, filas declaradas).
    """
    wb = _open(src)
    try:
        names = wb.sheetnames
        if sheet not in names:
            # Tolera una configuración vieja: usa la primera hoja cuyo encabezado empiece por "Status"
            def empieza_status(n):
                fila = next(wb[n].iter_rows(max_row=1, values_only=True), ("",))
                return str(fila[0] or "").strip().lower() == "status"
            candidata = next((n for n in names if empieza_status(n)), None)
            if candidata is None:
                raise ValueError(f"No existe la hoja «{sheet}». Hojas disponibles: {names}. Revise EXCEL_SHEET_NAME en el .env")
            log.warning("La hoja «%s» no existe; se usa «%s». Ajuste EXCEL_SHEET_NAME en el .env", sheet, candidata)
            sheet = candidata
        ws = wb[sheet]
        it = ws.iter_rows(values_only=True)
        primeras = [list(next(it, ()) or ()) for _ in range(3)]
        header, rows = split_header(primeras + _rows_until_end(it, max_empty))
        return header, rows, (ws.max_row or 1) - 1
    finally:
        wb.close()


def read_sheet(src, sheet: str, max_empty: int = 500) -> tuple[pd.DataFrame, int]:
    header, rows, height = read_rows(src, sheet, max_empty)
    width = len(header)
    rows = [(r + [None] * width)[:width] for r in rows]
    return pd.DataFrame(rows, columns=header).replace("", None), height


PDT_SHEET = "In Transit PDT"


class DataSource(ABC):
    name: str
    raw_rows: int = 0

    @abstractmethod
    def fetch(self) -> pd.DataFrame: ...

    def fetch_pdt(self, modelo: pd.DataFrame) -> tuple[list, list]:
        """Encabezado y filas de la hoja «In Transit PDT». Se llama después de fetch()."""
        raise NotImplementedError

    def describe(self) -> dict:
        return {"tipo": self.name}


class MockSource(DataSource):
    name = "mock"

    def fetch(self) -> pd.DataFrame:
        df = mock.generate()
        self.raw_rows = len(df)
        return df

    def fetch_pdt(self, modelo: pd.DataFrame) -> tuple[list, list]:
        return pdt.desde_modelo(modelo)

    def describe(self) -> dict:
        return {"tipo": self.name, "detalle": "Datos simulados (sin conexión a SharePoint)"}


class FileSource(DataSource):
    name = "file"

    def __init__(self, path: str, sheet: str):
        self.path, self.sheet = path, sheet

    def fetch(self) -> pd.DataFrame:
        df, self.raw_rows = read_sheet(self.path, self.sheet)
        return df

    def fetch_pdt(self, modelo: pd.DataFrame) -> tuple[list, list]:
        header, rows, _ = read_rows(self.path, PDT_SHEET, max_empty=20)
        return header, rows

    def describe(self) -> dict:
        return {"tipo": self.name, "detalle": f"{self.path} · hoja «{self.sheet}»"}


def build_source(s: Settings) -> DataSource:
    if s.data_source == "graph":
        from .graph import GraphExcelSource  # import diferido: graph.py usa este módulo
        return GraphExcelSource(s)
    if s.data_source == "file":
        return FileSource(s.local_file_path, s.excel_sheet_name)
    return MockSource()
