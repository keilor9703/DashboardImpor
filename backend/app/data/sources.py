"""Fuentes de datos. Todas devuelven un DataFrame "crudo" con los encabezados del
Excel; luego ``schema.normalize`` lo convierte al modelo interno.

- MockSource:  datos simulados (desarrollo / demo).
- FileSource:  un .xlsx local (probar con una copia del archivo real).
- GraphExcelSource: el Excel en SharePoint vía Microsoft Graph (producción).
"""
import io
import logging
import time
from abc import ABC, abstractmethod
from urllib.parse import quote

import httpx
import pandas as pd
import warnings

import openpyxl

from ..config import Settings
from . import mock, pdt

GRAPH = "https://graph.microsoft.com/v1.0"
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


class GraphExcelSource(DataSource):
    """Lee la hoja consolidada desde SharePoint con permisos de aplicación
    (client credentials). Permiso recomendado: ``Sites.Selected`` sobre el sitio."""

    name = "graph"

    def __init__(self, s: Settings):
        self.s = s
        self._token: tuple[str, float] | None = None
        self._ids: tuple[str, str] | None = None  # (site_id, item_id)
        self._content: bytes | None = None  # último .xlsx descargado (modo download)

    # --- autenticación de la app (no del usuario) ---
    def _access_token(self) -> str:
        if self._token and self._token[1] > time.time() + 60:
            return self._token[0]
        r = httpx.post(
            f"https://login.microsoftonline.com/{self.s.azure_tenant_id}/oauth2/v2.0/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self.s.graph_client_id,
                "client_secret": self.s.graph_client_secret,
                "scope": "https://graph.microsoft.com/.default",
            },
            timeout=30,
        )
        r.raise_for_status()
        body = r.json()
        self._token = (body["access_token"], time.time() + body["expires_in"])
        return self._token[0]

    def _get(self, client: httpx.Client, url: str) -> httpx.Response:
        r = client.get(url, headers={"Authorization": f"Bearer {self._access_token()}"})
        r.raise_for_status()
        return r

    def _resolve_ids(self, client: httpx.Client) -> tuple[str, str]:
        if self._ids is None:
            site = self._get(client, f"{GRAPH}/sites/{self.s.sharepoint_hostname}:{self.s.sharepoint_site_path}").json()
            path = quote(self.s.sharepoint_file_path)
            item = self._get(client, f"{GRAPH}/sites/{site['id']}/drive/root:{path}").json()
            self._ids = (site["id"], item["id"])
        return self._ids

    def fetch(self) -> pd.DataFrame:
        with httpx.Client(timeout=120) as client:
            site_id, item_id = self._resolve_ids(client)
            base = f"{GRAPH}/sites/{site_id}/drive/items/{item_id}"

            if self.s.graph_read_mode == "download":
                content = self._get(client, f"{base}/content").content
                self._content = content
                df, self.raw_rows = read_sheet(io.BytesIO(content), self.s.excel_sheet_name)
                return df

            if self.s.excel_table_name:
                url = f"{base}/workbook/tables/{quote(self.s.excel_table_name)}/range?$select=values"
            else:
                url = f"{base}/workbook/worksheets/{quote(self.s.excel_sheet_name)}/usedRange(valuesOnly=true)?$select=values"
            values = self._get(client, url).json()["values"]
        header, *rows = values
        self.raw_rows = len(rows)
        return pd.DataFrame(rows, columns=header)

    def fetch_pdt(self, modelo: pd.DataFrame) -> tuple[list, list]:
        if self.s.graph_read_mode == "download" and self._content:
            header, rows, _ = read_rows(io.BytesIO(self._content), PDT_SHEET, max_empty=20)
            return header, rows
        with httpx.Client(timeout=120) as client:
            site_id, item_id = self._resolve_ids(client)
            url = (f"{GRAPH}/sites/{site_id}/drive/items/{item_id}/workbook/worksheets/"
                   f"{quote(PDT_SHEET)}/usedRange(valuesOnly=true)?$select=values")
            values = self._get(client, url).json()["values"]
        return split_header(values)

    def describe(self) -> dict:
        origen = f"tabla «{self.s.excel_table_name}»" if self.s.excel_table_name else f"hoja «{self.s.excel_sheet_name}»"
        return {
            "tipo": self.name,
            "detalle": f"{self.s.sharepoint_hostname}{self.s.sharepoint_site_path} · {self.s.sharepoint_file_path} · {origen}",
        }


def build_source(s: Settings) -> DataSource:
    if s.data_source == "graph":
        return GraphExcelSource(s)
    if s.data_source == "file":
        return FileSource(s.local_file_path, s.excel_sheet_name)
    return MockSource()
