"""Conexión con SharePoint (Microsoft Graph) simulada: mismo flujo y respuestas que Microsoft."""
import json
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.data.graph import GraphError, GraphExcelSource, parse_sharepoint_url
from app.data.schema import normalize

EXCEL = Path(__file__).resolve().parents[2] / "Insumos" / "Insumo1.xlsx"
URL_ARCHIVO = "https://siacomex.sharepoint.com/:x:/r/sites/Operaciones/Shared%20Documents/Kimberly/Seguimiento%20PDT.xlsx?d=w1&csf=1&web=1"


def test_parse_urls():
    r = parse_sharepoint_url(URL_ARCHIVO)
    assert (r.hostname, r.site_path, r.file_path) == (
        "siacomex.sharepoint.com", "/sites/Operaciones", "/sites/Operaciones/Shared Documents/Kimberly/Seguimiento PDT.xlsx")
    r = parse_sharepoint_url("https://siacomex.sharepoint.com/sites/Operaciones/Documentos compartidos/A.xlsx")
    assert r.site_path == "/sites/Operaciones" and r.file_path.endswith("/Documentos compartidos/A.xlsx")
    r = parse_sharepoint_url("https://siacomex-my.sharepoint.com/personal/ana_siacomex_com/Documents/A.xlsx")
    assert r.site_path == "/personal/ana_siacomex_com"
    with pytest.raises(GraphError, match="Copiar ruta de acceso"):
        parse_sharepoint_url("https://siacomex.sharepoint.com/sites/Ops/_layouts/15/Doc.aspx?sourcedoc={x}&file=A.xlsx")
    with pytest.raises(GraphError, match="sharepoint.com"):
        parse_sharepoint_url("https://example.com/A.xlsx")


class FakeMicrosoft:
    """Responde como Entra ID + Graph. Permite cambiar la versión del archivo o simular errores."""

    def __init__(self, contenido: bytes):
        self.contenido, self.ctag, self.descargas = contenido, "c:{1},1", 0
        self.secreto_ok, self.sitio_ok = True, True

    def __call__(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "login.microsoftonline.com" in url:
            if not self.secreto_ok:
                return httpx.Response(401, json={"error": "invalid_client", "error_description": "AADSTS7000215: Invalid client secret provided."})
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        assert req.headers["Authorization"] == "Bearer tok"
        path = req.url.path
        if path == "/v1.0/sites/siacomex.sharepoint.com:/sites/Operaciones":
            return httpx.Response(200 if self.sitio_ok else 403, json={"id": "site1"})
        if path == "/v1.0/sites/site1/drives":
            return httpx.Response(200, json={"value": [
                {"id": "d-otro", "name": "Plantillas", "webUrl": "https://siacomex.sharepoint.com/sites/Operaciones/Plantillas"},
                {"id": "d1", "name": "Documentos", "webUrl": "https://siacomex.sharepoint.com/sites/Operaciones/Shared%20Documents"},
            ]})
        if path == "/v1.0/drives/d1/root:/Kimberly/Seguimiento PDT.xlsx":
            return httpx.Response(200, json={"id": "item1"})
        if path == "/v1.0/drives/d1/items/item1":
            return httpx.Response(200, json={
                "id": "item1", "name": "Seguimiento PDT.xlsx", "cTag": self.ctag, "size": len(self.contenido),
                "lastModifiedDateTime": "2026-11-26T14:03:00Z", "webUrl": "https://siacomex.sharepoint.com/x",
                "lastModifiedBy": {"user": {"displayName": "Laura Gómez"}}})
        if path == "/v1.0/drives/d1/items/item1/content":
            self.descargas += 1
            return httpx.Response(200, content=self.contenido)
        return httpx.Response(404, json={"error": {"code": "itemNotFound"}})


@pytest.fixture
def ms():
    return FakeMicrosoft(EXCEL.read_bytes())


def fuente(ms, **extra):
    s = Settings(data_source="graph", azure_tenant_id="t1", azure_api_client_id="app1", graph_client_secret="secreto",
                 sharepoint_file_url=URL_ARCHIVO, excel_sheet_name="Sheet1", **extra)
    return GraphExcelSource(s, transport=httpx.MockTransport(ms))


@pytest.mark.skipif(not EXCEL.exists(), reason="Excel real no disponible")
def test_lee_excel_de_sharepoint_y_no_descarga_si_no_cambia(ms):
    src = fuente(ms)
    df = normalize(src.fetch())
    assert len(df) > 1000 and df["embarque"].nunique() == 38
    assert ms.descargas == 1
    src.fetch()                       # misma versión (cTag): no descarga
    assert ms.descargas == 1
    ms.ctag = "c:{1},2"               # alguien guardó el Excel
    src.fetch()
    assert ms.descargas == 2
    header, rows = src.fetch_pdt(df)
    assert header[0] == "Status" and len(rows) == 60
    info = src.describe()["archivo"]
    assert info["nombre"] == "Seguimiento PDT.xlsx" and info["modificado_por"] == "Laura Gómez"


def test_errores_entendibles(ms):
    ms.secreto_ok = False
    with pytest.raises(GraphError, match="secreto .* es incorrecto"):
        fuente(ms).fetch()
    ms.secreto_ok, ms.sitio_ok = True, False
    with pytest.raises(GraphError, match="Sites.Selected"):
        fuente(ms).fetch()


def test_faltan_credenciales():
    s = Settings(data_source="graph", sharepoint_file_url=URL_ARCHIVO)
    with pytest.raises(GraphError, match="Faltan AZURE_TENANT_ID"):
        GraphExcelSource(s).fetch()
