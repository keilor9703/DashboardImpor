from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import User, get_current_user
from ..config import Settings, get_settings
from ..services import analytics
from ..services.repository import Repository, get_repository

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


def filtros(
    desde: date | None = None,
    hasta: date | None = None,
    tipo: str | None = None,
    cliente: str | None = None,
    aduana: str | None = None,
    modalidad: str | None = None,
) -> analytics.Filtros:
    hasta = hasta or date.today()
    desde = desde or (hasta - timedelta(days=364))
    if desde > hasta:
        raise HTTPException(422, "La fecha inicial no puede ser mayor que la final")
    return analytics.Filtros(desde, hasta, tipo or None, cliente or None, aduana or None, modalidad or None)


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.get("/dashboard")
def dashboard(
    f: analytics.Filtros = Depends(filtros),
    repo: Repository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
):
    return {**analytics.dashboard(repo.data(), f, settings.sla_dias_tramite), "fuente": repo.status()}


@router.get("/filtros")
def opciones(repo: Repository = Depends(get_repository)):
    return analytics.opciones_filtros(repo.data())


@router.get("/operaciones")
def operaciones(
    f: analytics.Filtros = Depends(filtros),
    q: str = "",
    estado: str | None = None,
    orden: str = "fecha_apertura",
    desc: bool = True,
    pagina: int = Query(1, ge=1),
    tamano: int = Query(25, ge=1, le=200),
    repo: Repository = Depends(get_repository),
):
    return analytics.operaciones(repo.data(), f, q, estado, orden, desc, pagina, tamano)


@router.get("/datos/estado")
def estado_fuente(repo: Repository = Depends(get_repository)):
    repo.data()
    return repo.status()


@router.post("/datos/refrescar")
def refrescar(repo: Repository = Depends(get_repository)):
    repo.data(force=True)
    return repo.status()
