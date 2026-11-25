from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.data import mock
from app.data.schema import normalize
from app.main import app
from app.services import analytics

client = TestClient(app)


@pytest.fixture(scope="module")
def df():
    return normalize(mock.generate(n=800, today=date(2026, 11, 25)))


def test_health():
    assert client.get("/api/health").json()["status"] == "ok"


def test_normalize_mapea_columnas(df):
    for col in ("do", "valor_usd", "tributos_cop", "dias_tramite", "en_curso"):
        assert col in df.columns
    assert df["valor_usd"].gt(0).all()


def test_normalize_falla_sin_columnas_obligatorias():
    import pandas as pd
    with pytest.raises(ValueError):
        normalize(pd.DataFrame({"Cliente": ["x"]}))


def test_fechas_seriales_de_excel():
    import pandas as pd
    raw = mock.generate(n=5).copy()
    raw["Fecha apertura"] = 46000  # Graph devuelve números seriales
    out = normalize(raw)
    assert out["fecha_apertura"].iloc[0] == pd.Timestamp("2025-12-09")


def test_dashboard_estructura(df):
    f = analytics.Filtros(date(2026, 1, 1), date(2026, 11, 25))
    out = analytics.dashboard(df, f, sla=5, hoy=date(2026, 11, 25))
    assert {k["id"] for k in out["kpis"]} >= {"operaciones", "cumplimiento_sla"}
    assert len(out["mensual"]) == 11
    assert out["kpis"][0]["value"] == sum(m["operaciones"] for m in out["mensual"])


def test_filtro_por_tipo(df):
    f = analytics.Filtros(date(2025, 6, 1), date(2026, 11, 25), tipo="Exportación")
    out = analytics.dashboard(df, f, sla=5)
    impo = next(k for k in out["kpis"] if k["id"] == "importaciones_usd")
    assert impo["value"] == 0


def test_endpoints():
    assert client.get("/api/me").json()["name"]
    d = client.get("/api/dashboard").json()
    assert d["kpis"] and d["fuente"]["tipo"] == "mock"
    ops = client.get("/api/operaciones", params={"tamano": 10}).json()
    assert len(ops["filas"]) == 10 and ops["total"] > 10
    assert client.get("/api/dashboard", params={"desde": "2026-05-01", "hasta": "2026-01-01"}).status_code == 422
