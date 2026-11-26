"""Lectura del Excel desde SharePoint con Microsoft Graph (permisos de aplicación).

Flujo:
  1. Token de la aplicación (client credentials) con el secreto guardado en el servidor.
  2. A partir de la URL del archivo se resuelven el sitio, la biblioteca y el archivo.
  3. Se consulta la versión del archivo (cTag): si no cambió, se reutiliza la última lectura;
     si cambió, se descarga el .xlsx y se lee en streaming.

Permiso recomendado: ``Sites.Selected`` (solo lectura sobre el sitio del archivo).
"""
from __future__ import annotations

import io
import logging
import time
from dataclasses import dataclass
from urllib.parse import quote, unquote, urlparse

import httpx
import pandas as pd

from ..config import Settings
from .sources import PDT_SHEET, DataSource, read_rows, read_sheet

log = logging.getLogger(__name__)
GRAPH = "https://graph.microsoft.com/v1.0"
LOGIN = "https://login.microsoftonline.com"


class GraphError(RuntimeError):
    """Error de conexión con Microsoft, con un mensaje entendible para el usuario."""


# ----------------------------------------------------------------------------- URL del archivo
@dataclass(frozen=True)
class SharePointRef:
    hostname: str      # siacomex.sharepoint.com
    site_path: str     # /sites/Operaciones  (vacío = sitio raíz)
    file_path: str     # /sites/Operaciones/Shared Documents/Carpeta/Archivo.xlsx (ruta completa del servidor)


def parse_sharepoint_url(url: str) -> SharePointRef:
    """Acepta la URL del archivo tal como la copia el usuario:
    - https://x.sharepoint.com/sites/Ops/Shared Documents/Archivo.xlsx  («Copiar ruta de acceso» en Excel)
    - https://x.sharepoint.com/:x:/r/sites/Ops/Shared%20Documents/Archivo.xlsx?d=w...&csf=1&web=1  (navegador)
    - https://x-my.sharepoint.com/personal/usuario_empresa_com/Documents/Archivo.xlsx  (OneDrive)
    """
    u = urlparse(url.strip())
    if not u.netloc.endswith(".sharepoint.com"):
        raise GraphError("La URL del archivo debe ser de SharePoint (…sharepoint.com).")
    path = unquote(u.path)
    if "/_layouts/" in path.lower():
        raise GraphError(
            "Esa URL es de vista previa (Doc.aspx) y no incluye la ruta del archivo. "
            "Abra el archivo en Excel de escritorio → Archivo → Información → «Copiar ruta de acceso» y use esa URL.")
    # Quita el prefijo de enlace del navegador: /:x:/r/
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2 and parts[0].startswith(":") and parts[0].endswith(":") and parts[1] in ("r", "s", "g"):
        parts = parts[2:]
    if not parts or not parts[-1].lower().endswith((".xlsx", ".xlsm")):
        raise GraphError("La URL debe apuntar a un archivo .xlsx (no a una carpeta).")
    site = ""
    if parts[0].lower() in ("sites", "teams", "personal") and len(parts) > 2:
        site = f"/{parts[0]}/{parts[1]}"
    return SharePointRef(u.netloc, site, "/" + "/".join(parts))


# ----------------------------------------------------------------------------- cliente
_MENSAJES_AAD = {
    "AADSTS7000215": "El secreto de la aplicación (GRAPH_CLIENT_SECRET) es incorrecto. Copie el «Valor» del secreto, no su «Id».",
    "AADSTS7000222": "El secreto de la aplicación venció. Cree uno nuevo en Entra ID → la app → Certificados y secretos.",
    "AADSTS700016": "No existe una aplicación con ese ID en el tenant. Revise GRAPH_CLIENT_ID y AZURE_TENANT_ID.",
    "AADSTS90002": "No se encontró el tenant. Revise AZURE_TENANT_ID.",
    "AADSTS900023": "AZURE_TENANT_ID no tiene un formato válido.",
}


class GraphClient:
    def __init__(self, tenant_id: str, client_id: str, client_secret: str, transport: httpx.BaseTransport | None = None):
        if not (tenant_id and client_id and client_secret):
            raise GraphError("Faltan AZURE_TENANT_ID, GRAPH_CLIENT_ID o GRAPH_CLIENT_SECRET en la configuración del backend.")
        self.tenant_id, self.client_id, self.client_secret = tenant_id, client_id, client_secret
        self._http = httpx.Client(timeout=120, transport=transport, follow_redirects=True)
        self._token: tuple[str, float] | None = None

    def token(self) -> str:
        if self._token and self._token[1] > time.time() + 60:
            return self._token[0]
        r = self._http.post(f"{LOGIN}/{self.tenant_id}/oauth2/v2.0/token", data={
            "grant_type": "client_credentials", "client_id": self.client_id,
            "client_secret": self.client_secret, "scope": "https://graph.microsoft.com/.default",
        })
        if r.status_code != 200:
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            desc = body.get("error_description", r.text)
            codigo = next((c for c in _MENSAJES_AAD if c in desc), None)
            raise GraphError(_MENSAJES_AAD.get(codigo, f"Microsoft rechazó las credenciales de la aplicación: {desc[:200]}"))
        body = r.json()
        self._token = (body["access_token"], time.time() + int(body.get("expires_in", 3600)))
        return self._token[0]

    def get(self, url: str, que: str) -> httpx.Response:
        r = self._http.get(url if url.startswith("http") else GRAPH + url, headers={"Authorization": f"Bearer {self.token()}"})
        if r.status_code in (401, 403):
            raise GraphError(
                f"Sin permiso para {que}. La aplicación necesita el permiso «Sites.Selected» con consentimiento de "
                "administrador y acceso de lectura otorgado sobre el sitio de SharePoint del archivo.")
        if r.status_code == 404:
            raise GraphError(f"No se encontró {que}. Revise la URL del archivo (SHAREPOINT_FILE_URL).")
        if r.status_code == 429 or r.status_code >= 500:
            raise GraphError(f"Microsoft no respondió al consultar {que} (código {r.status_code}). Se reintentará automáticamente.")
        r.raise_for_status()
        return r

    def close(self):
        self._http.close()


# ----------------------------------------------------------------------------- archivo
@dataclass
class ArchivoInfo:
    drive_id: str
    item_id: str
    nombre: str
    ctag: str
    modificado: str | None
    modificado_por: str | None
    tamano: int
    web_url: str


class SharePointExcel:
    """Resuelve el archivo una vez y luego solo consulta su versión antes de descargarlo."""

    def __init__(self, ref: SharePointRef, client: GraphClient):
        self.ref, self.client = ref, client
        self._drive_item: tuple[str, str] | None = None

    def _resolver(self) -> tuple[str, str]:
        if self._drive_item:
            return self._drive_item
        site = self.client.get(f"/sites/{self.ref.hostname}:{self.ref.site_path or '/'}", "el sitio de SharePoint").json()
        drives = self.client.get(f"/sites/{site['id']}/drives?$select=id,name,webUrl", "las bibliotecas del sitio").json()["value"]
        # La biblioteca es la de webUrl más largo que sea prefijo de la ruta del archivo
        candidatos = []
        for d in drives:
            ruta = unquote(urlparse(d["webUrl"]).path).rstrip("/")
            if self.ref.file_path.lower().startswith(ruta.lower() + "/"):
                candidatos.append((len(ruta), d["id"], self.ref.file_path[len(ruta):]))
        if not candidatos:
            nombres = ", ".join(d["name"] for d in drives) or "ninguna"
            raise GraphError(f"El archivo no está en una biblioteca de ese sitio. Bibliotecas disponibles: {nombres}.")
        _, drive_id, relativa = max(candidatos)
        item = self.client.get(f"/drives/{drive_id}/root:{quote(relativa)}?$select=id", "el archivo en SharePoint").json()
        self._drive_item = (drive_id, item["id"])
        return self._drive_item

    def info(self) -> ArchivoInfo:
        drive_id, item_id = self._resolver()
        m = self.client.get(f"/drives/{drive_id}/items/{item_id}"
                            "?$select=id,name,cTag,eTag,lastModifiedDateTime,lastModifiedBy,size,webUrl", "el archivo").json()
        por = (m.get("lastModifiedBy") or {}).get("user", {}).get("displayName")
        return ArchivoInfo(drive_id, item_id, m["name"], m.get("cTag") or m.get("eTag", ""),
                           m.get("lastModifiedDateTime"), por, int(m.get("size", 0)), m.get("webUrl", ""))

    def descargar(self, info: ArchivoInfo) -> bytes:
        return self.client.get(f"/drives/{info.drive_id}/items/{info.item_id}/content", "el contenido del archivo").content


# ----------------------------------------------------------------------------- fuente de datos
def referencia(s: Settings) -> SharePointRef:
    if s.sharepoint_file_url:
        return parse_sharepoint_url(s.sharepoint_file_url)
    if s.sharepoint_hostname and s.sharepoint_file_path:  # configuración anterior por partes
        site = s.sharepoint_site_path.rstrip("/")
        ruta = s.sharepoint_file_path if s.sharepoint_file_path.startswith(site + "/") else f"{site}/Shared Documents{s.sharepoint_file_path}"
        return SharePointRef(s.sharepoint_hostname, site, ruta)
    raise GraphError("Falta SHAREPOINT_FILE_URL (la URL del archivo de Excel en SharePoint).")


class GraphExcelSource(DataSource):
    """Fuente de datos «graph». Reutiliza la última lectura si el archivo no cambió."""

    name = "graph"

    def __init__(self, s: Settings, transport: httpx.BaseTransport | None = None):
        self.s = s
        self.raw_rows = 0
        self._transport = transport
        self._excel: SharePointExcel | None = None
        self._info: ArchivoInfo | None = None
        self._content: bytes | None = None
        self._raw: pd.DataFrame | None = None
        self.descargas = 0

    def _archivo(self) -> SharePointExcel:
        if self._excel is None:
            client = GraphClient(self.s.azure_tenant_id, self.s.graph_client_id or self.s.azure_api_client_id,
                                 self.s.graph_client_secret, self._transport)
            self._excel = SharePointExcel(referencia(self.s), client)
        return self._excel

    def fetch(self) -> pd.DataFrame:
        excel = self._archivo()
        info = excel.info()
        if self._raw is not None and self._info and info.ctag == self._info.ctag:
            self._info = info
            return self._raw  # sin cambios: no se descarga de nuevo
        content = excel.descargar(info)
        self.descargas += 1
        df, self.raw_rows = read_sheet(io.BytesIO(content), self.s.excel_sheet_name)
        self._info, self._content, self._raw = info, content, df
        log.info("Excel descargado de SharePoint: %s (%.1f MB, modificado %s por %s)",
                 info.nombre, info.tamano / 1e6, info.modificado, info.modificado_por)
        return df

    def fetch_pdt(self, modelo: pd.DataFrame) -> tuple[list, list]:
        if self._content is None:
            self.fetch()
        header, rows, _ = read_rows(io.BytesIO(self._content), PDT_SHEET, max_empty=20)
        return header, rows

    def describe(self) -> dict:
        try:
            ref = referencia(self.s)
            ubicacion = f"{ref.hostname}{ref.file_path}"
        except GraphError as exc:
            ubicacion = str(exc)
        out = {"tipo": self.name, "detalle": f"{ubicacion} · hoja «{self.s.excel_sheet_name}»"}
        if self._info:
            out["archivo"] = {
                "nombre": self._info.nombre, "modificado": self._info.modificado,
                "modificado_por": self._info.modificado_por, "url": self._info.web_url, "tamano": self._info.tamano,
            }
        return out
