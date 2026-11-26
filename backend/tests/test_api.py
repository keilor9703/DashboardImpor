from datetime import date
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.data import mock
from app.data.schema import diagnostico, normalize
from app.main import app
from app.services import analytics

client = TestClient(app)
HOY = date(2026, 11, 26)
EXCEL_REAL = Path(__file__).resolve().parents[2] / "Insumos" / "Insumo1.xlsx"


@pytest.fixture(scope="module")
def df():
    return normalize(mock.generate(today=HOY))


def test_health():
    assert client.get("/api/health").json()["status"] == "ok"


def test_normalize_campos_derivados(df):
    for col in ("embarque", "unidad", "ruta", "valor_usd", "fecha_ref", "pdt", "meta_pdt", "d_transito"):
        assert col in df.columns
    assert df["estado"].isin(["Ingresado a SAP", "Tránsito internacional", "Pendiente de recogida", "Pendiente de zarpe",
                              "En nacionalización", "Pendiente de entrega"]).all()
    assert (df["valor_usd"] >= 0).all()


def test_vacios_y_franquicia_en_cero():
    raw = mock.generate(n_embarques=3, today=HOY)
    raw["Franchise"] = 0
    raw.loc[0, "Status"] = None
    out = normalize(raw)
    assert len(out) == len(raw) - 1
    assert (out["franquicia"] == "Sin franquicia").all()


def test_falla_sin_columnas_obligatorias():
    with pytest.raises(ValueError):
        normalize(pd.DataFrame({"Cliente": ["x"]}))


def test_fechas_seriales_de_graph():
    raw = mock.generate(n_embarques=2, today=HOY)
    raw["ATD"] = 46300.5  # Microsoft Graph devuelve fechas como serial de Excel
    out = normalize(raw)
    assert out["atd"].iloc[0] == pd.Timestamp("2026-10-05 12:00")


def test_pdt_igual_a_suma_de_etapas(df):
    u = analytics.unidades(df)
    cerradas = u[u["pdt"].notna()]
    etapas = cerradas[[c for c in cerradas.columns if c.startswith("d_")]].sum(axis=1)
    assert ((cerradas["pdt"] - etapas).abs() < 0.01).all()


def test_dashboard_estructura(df):
    out = analytics.dashboard(df, analytics.Filtros(date(2026, 1, 1), HOY), hoy=HOY)
    assert [k["id"] for k in out["kpis"]][:2] == ["embarques", "valor_usd"]
    en_rango = df[(df["fecha_ref"] >= "2026-01-01") & (df["fecha_ref"] < "2026-11-27")]
    assert out["kpis"][0]["value"] == en_rango["embarque"].nunique()
    assert len(out["pipeline"]) == 5 and out["rutas"] and out["etapas"]
    assert sum(p["embarques"] for p in out["pipeline"]) == out["resumen"]["en_curso"]


def test_filtro_por_modo(df):
    out = analytics.dashboard(df, analytics.Filtros(date(2025, 1, 1), HOY, modo="Terrestre"), hoy=HOY)
    assert all(r["modo"] == "Terrestre" for r in out["rutas"])


def test_endpoints():
    d = client.get("/api/dashboard").json()
    assert d["kpis"] and d["fuente"]["tipo"] == "mock"
    lista = client.get("/api/embarques", params={"tamano": 5}).json()
    assert len(lista["filas"]) == 5
    det = client.get(f"/api/embarques/{lista['filas'][0]['embarque']}").json()
    assert det["lineas"] and len(det["etapas"]) == 6
    assert client.get("/api/embarques/NO-EXISTE").status_code == 404
    assert client.get("/api/filtros").json()["dimensiones"]
    assert client.get("/api/dashboard", params={"desde": "2026-05-01", "hasta": "2026-01-01"}).status_code == 422


@pytest.mark.skipif(not EXCEL_REAL.exists(), reason="Excel real no disponible")
def test_excel_real_coincide_con_hoja_pdt():
    """El PDT calculado debe coincidir con la hoja «In Transit PDT» del cliente."""
    from app.data.sources import read_sheet
    raw, filas = read_sheet(EXCEL_REAL, "Sheet1")
    real = normalize(raw)
    assert len(real) > 1000 and filas > len(real)
    u = real[real["shipment_ref"] == "ZAV0327764"].iloc[0]
    assert round(u["pdt"]) == 144 and u["meta_pdt"] == 115
    assert round(u["d_orden"], 2) == 123.29
    assert any(h["clave"] == "filas_vacias" for h in diagnostico(filas, real))


@pytest.mark.skipif(not EXCEL_REAL.exists(), reason="Excel real no disponible")
def test_hoja_mal_configurada_usa_la_hoja_de_datos():
    from app.data.sources import read_sheet
    raw, _ = read_sheet(EXCEL_REAL, "Consolidado")
    assert "Status" in raw.columns and len(raw) > 1000


def test_fuente_no_disponible_responde_503():
    from app.services.repository import Repository, get_repository
    from app.data.sources import FileSource
    app.dependency_overrides[get_repository] = lambda: Repository(FileSource("no-existe.xlsx", "Sheet1"), 60)
    try:
        r = client.get("/api/dashboard")
        assert r.status_code == 503 and "No fue posible leer el Excel" in r.json()["detail"]
    finally:
        app.dependency_overrides.clear()
