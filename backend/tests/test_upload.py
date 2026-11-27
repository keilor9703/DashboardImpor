"""Carga manual del Excel: validación, reemplazo seguro, commit en GitHub (simulado) y permisos."""
import base64
import io
import json
import shutil
from pathlib import Path

import httpx
import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.data.sources import FileSource
from app.main import app
from app.passwords import hash_password
from app.routers.dashboard import get_repository
from app.services import upload
from app.services.repository import Repository

EXCEL = Path(__file__).resolve().parents[2] / "Insumos" / "Insumo1.xlsx"
pytestmark = pytest.mark.skipif(not EXCEL.exists(), reason="Excel real no disponible")
client = TestClient(app)


@pytest.fixture
def entorno(tmp_path):
    """Un «servidor» aislado: archivo de datos temporal, repositorio propio y configuración propia."""
    destino = tmp_path / "Insumos" / "Insumo1.xlsx"
    destino.parent.mkdir()
    shutil.copy(EXCEL, destino)
    s = Settings(data_source="file", local_file_path=str(destino), excel_sheet_name="Sheet1", auth_mode="demo")
    repo = Repository(FileSource(str(destino), "Sheet1"), 60)
    repo.data()
    app.dependency_overrides[get_settings] = lambda: s
    app.dependency_overrides[get_repository] = lambda: repo
    yield s, repo, destino
    app.dependency_overrides.clear()


def libro(hojas: dict[str, list[list]]) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for nombre, filas in hojas.items():
        ws = wb.create_sheet(nombre)
        for f in filas:
            ws.append(f)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def subir(contenido: bytes, nombre="nuevo.xlsx", confirmar=False):
    return client.post("/api/datos/excel", params={"confirmar": confirmar}, files={"archivo": (nombre, contenido)})


def test_vista_previa_no_cambia_nada(entorno):
    s, repo, destino = entorno
    antes = destino.read_bytes()
    r = subir(EXCEL.read_bytes())
    assert r.status_code == 200
    v = r.json()["vista"]
    assert v["embarques"] == 38 and v["lineas"] == 1332 and v["registros_pdt"] == 60
    assert v["actual"]["embarques"] == 38
    assert destino.read_bytes() == antes


@pytest.mark.parametrize("contenido,nombre,mensaje", [
    (b"no es un excel", "datos.xlsx", "no es un Excel válido"),
    (b"x", "datos.csv", "Solo se aceptan archivos .xlsx"),
    (libro({"Otra": [["a"]]}), "a.xlsx", "No existe la hoja"),
    (libro({"Sheet1": [["Cliente"], ["x"]]}), "a.xlsx", "Faltan columnas obligatorias"),
    (libro({"Sheet1": [["Status", "Country of departure", "Final Country Destination", "MOT"]]}), "a.xlsx", "no tiene embarques"),
    (libro({"Sheet1": [["Status", "Country of departure", "Final Country Destination", "MOT"], ["Sap Entry Completed", "CO", "EC", "SEA"]]}),
     "a.xlsx", "In Transit PDT"),
])
def test_rechaza_archivos_invalidos_con_mensaje_claro(entorno, contenido, nombre, mensaje):
    r = subir(contenido, nombre)
    assert r.status_code == 422 and mensaje in r.json()["detail"], r.json()


def test_rechaza_archivo_demasiado_grande(entorno):
    s, *_ = entorno
    s.upload_max_mb = 1
    r = subir(EXCEL.read_bytes())
    assert r.status_code == 422 and "máximo permitido" in r.json()["detail"]


def test_aplicar_reemplaza_conserva_anterior_y_avisa_si_no_hay_github(entorno):
    s, repo, destino = entorno
    original = destino.read_bytes()
    nuevo = EXCEL.read_bytes() + b"\0"  # contenido distinto pero igualmente legible
    r = subir(nuevo, "FUP nuevo.xlsx", confirmar=True)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["persistido"] is False and "NO quedó guardado de forma permanente" in body["aviso"]
    assert destino.read_bytes() == nuevo
    assert destino.with_suffix(".anterior").read_bytes() == original
    assert body["fuente"]["embarques"] == 38


def test_si_falla_el_procesamiento_se_restaura_el_archivo_anterior(entorno, monkeypatch):
    s, repo, destino = entorno
    original = destino.read_bytes()
    llamadas = []
    real = repo.data

    def data(force=False):
        llamadas.append(force)
        if len(llamadas) == 1:
            raise RuntimeError("falla simulada")
        return real(force)

    monkeypatch.setattr(repo, "data", data)
    r = subir(EXCEL.read_bytes() + b"\0", confirmar=True)
    assert r.status_code == 422 and "se conservó el anterior" in r.json()["detail"]
    assert destino.read_bytes() == original
    assert not destino.with_suffix(".nuevo").exists()


def github(respuestas):
    visto = {}

    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["Authorization"] == "Bearer ghp_test"
        if req.method == "GET":
            return respuestas["get"]
        visto["put"] = json.loads(req.content)
        return respuestas["put"]
    return httpx.MockTransport(handler), visto


def config_github(s):
    s.github_token, s.github_repo = "ghp_test", "keilor9703/DashboardImpor"


def test_commit_en_github_con_sha_y_contenido(entorno):
    s, repo, destino = entorno
    config_github(s)
    nuevo = EXCEL.read_bytes() + b"\0"
    transporte, visto = github({
        "get": httpx.Response(200, json={"sha": "abc123"}),
        "put": httpx.Response(200, json={"commit": {"html_url": "https://github.com/x/commit/1"}}),
    })
    r = upload.aplicar(nuevo, "n.xlsx", "gerencia", s, repo, github_transport=transporte)
    assert r.persistido and r.commit_url.endswith("/commit/1") and r.aviso is None
    assert visto["put"]["sha"] == "abc123" and visto["put"]["branch"] == "main"
    assert base64.b64decode(visto["put"]["content"]) == nuevo
    assert "gerencia" in visto["put"]["message"]


@pytest.mark.parametrize("codigo,texto", [(401, "rechazó el token"), (403, "no permitió guardar"), (404, "no encontró el repositorio")])
def test_errores_de_github_no_pierden_la_carga_y_se_explican(entorno, codigo, texto):
    s, repo, destino = entorno
    config_github(s)
    nuevo = EXCEL.read_bytes() + b"\0"
    transporte, _ = github({"get": httpx.Response(200 if codigo != 401 else 401, json={"sha": "a"}),
                            "put": httpx.Response(codigo, json={"message": "x"})})
    r = upload.aplicar(nuevo, "n.xlsx", "gerencia", s, repo, github_transport=transporte)
    assert not r.persistido and texto in r.aviso and "Se perderá si el servicio se reinicia" in r.aviso
    assert destino.read_bytes() == nuevo  # el tablero sí usa el archivo nuevo


def test_no_disponible_si_la_fuente_no_es_un_archivo(entorno):
    s, *_ = entorno
    s.data_source = "graph"
    r = subir(EXCEL.read_bytes())
    assert r.status_code == 409


def test_permisos_solo_usuarios_autorizados_pueden_cargar(entorno):
    s, *_ = entorno
    s.auth_mode, s.auth_secret = "password", "x" * 40
    s.auth_users = f"gerencia:{hash_password('Clave-1')};consulta:{hash_password('Clave-2')}"
    s.upload_users = "gerencia"
    token = lambda u, p: {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": u, "password": p}).json()["access_token"]}
    assert client.get("/api/me", headers=token("gerencia", "Clave-1")).json()["can_upload"] is True
    assert client.get("/api/me", headers=token("consulta", "Clave-2")).json()["can_upload"] is False
    sube = lambda h: client.post("/api/datos/excel", files={"archivo": ("a.xlsx", EXCEL.read_bytes())}, headers=h)
    assert sube(token("consulta", "Clave-2")).status_code == 403
    assert sube(token("gerencia", "Clave-1")).status_code == 200
    assert client.post("/api/datos/excel", files={"archivo": ("a.xlsx", b"x")}).status_code == 401
