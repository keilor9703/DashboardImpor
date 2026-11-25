"""Fuentes de datos. Todas devuelven un DataFrame "crudo" con los encabezados del
Excel; luego ``schema.normalize`` lo convierte al modelo interno.

- MockSource:  datos simulados (desarrollo / demo).
- FileSource:  un .xlsx local (probar con una copia del archivo real).
- GraphExcelSource: el Excel en SharePoint vía Microsoft Graph (producción).
"""
import io
import time
from abc import ABC, abstractmethod
from urllib.parse import quote

import httpx
import pandas as pd

from ..config import Settings
from . import mock

GRAPH = "https://graph.microsoft.com/v1.0"


class DataSource(ABC):
    name: str

    @abstractmethod
    def fetch(self) -> pd.DataFrame: ...

    def describe(self) -> dict:
        return {"tipo": self.name}


class MockSource(DataSource):
    name = "mock"

    def fetch(self) -> pd.DataFrame:
        return mock.generate()

    def describe(self) -> dict:
        return {"tipo": self.name, "detalle": "Datos simulados (sin conexión a SharePoint)"}


class FileSource(DataSource):
    name = "file"

    def __init__(self, path: str, sheet: str):
        self.path, self.sheet = path, sheet

    def fetch(self) -> pd.DataFrame:
        return pd.read_excel(self.path, sheet_name=self.sheet)

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
                return pd.read_excel(io.BytesIO(content), sheet_name=self.s.excel_sheet_name)

            if self.s.excel_table_name:
                url = f"{base}/workbook/tables/{quote(self.s.excel_table_name)}/range?$select=values"
            else:
                url = f"{base}/workbook/worksheets/{quote(self.s.excel_sheet_name)}/usedRange(valuesOnly=true)?$select=values"
            values = self._get(client, url).json()["values"]
        header, *rows = values
        return pd.DataFrame(rows, columns=header)

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
