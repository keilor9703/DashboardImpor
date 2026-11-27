from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from ..auth import User, get_current_user, require_uploader
from ..config import Settings, get_settings
from ..services import analytics, upload
from ..services.repository import Repository, get_repository

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


def filtros(
    desde: date | None = None,
    hasta: date | None = None,
    modo: str | None = None,
    origen: str | None = None,
    destino: str | None = None,
    franquicia: str | None = None,
    forwarder: str | None = None,
) -> analytics.Filtros:
    hasta = hasta or date.today()
    desde = desde or (hasta - timedelta(days=364))
    if desde > hasta:
        raise HTTPException(422, "La fecha inicial no puede ser mayor que la final")
    return analytics.Filtros(desde, hasta, modo or None, origen or None, destino or None, franquicia or None, forwarder or None)


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.get("/dashboard")
def dashboard(f: analytics.Filtros = Depends(filtros), repo: Repository = Depends(get_repository)):
    return {**analytics.dashboard(repo.data(), f), "fuente": repo.status()}


@router.get("/filtros")
def opciones(repo: Repository = Depends(get_repository)):
    return analytics.opciones_filtros(repo.data())


@router.get("/embarques")
def embarques(
    f: analytics.Filtros = Depends(filtros),
    q: str = "",
    estado: str | None = None,
    orden: str = "fecha_ref",
    desc: bool = True,
    pagina: int = Query(1, ge=1),
    tamano: int = Query(25, ge=1, le=200),
    repo: Repository = Depends(get_repository),
):
    return analytics.lista_embarques(repo.data(), f, q, estado, orden, desc, pagina, tamano)


@router.get("/embarques/{embarque}")
def detalle(embarque: str, repo: Repository = Depends(get_repository)):
    out = analytics.detalle_embarque(repo.data(), embarque)
    if out is None:
        raise HTTPException(404, "Embarque no encontrado")
    return out


@router.get("/pdt")
def hoja_pdt(repo: Repository = Depends(get_repository)):
    """Hoja «In Transit PDT» tal cual: 6 procesos + total, con sus columnas de detalle."""
    return repo.hoja_pdt()


@router.get("/datos/estado")
def estado_fuente(repo: Repository = Depends(get_repository)):
    repo.data()
    return repo.status()


@router.get("/datos/calidad")
def calidad(repo: Repository = Depends(get_repository)):
    return {"hallazgos": repo.calidad(), "fuente": repo.status()}


@router.post("/datos/refrescar")
def refrescar(repo: Repository = Depends(get_repository)):
    repo.data(force=True)
    return repo.status()


@router.post("/datos/excel")
async def cargar_excel(
    archivo: UploadFile = File(...),
    confirmar: bool = False,
    user: User = Depends(require_uploader),
    repo: Repository = Depends(get_repository),
    s: Settings = Depends(get_settings),
):
    """Carga manual del Excel. Sin ``confirmar`` solo valida y devuelve una vista previa; con ``confirmar=true`` lo aplica."""
    if s.data_source != "file":
        raise HTTPException(409, "La carga manual solo está disponible cuando la fuente de datos es un archivo.")
    limite = s.upload_max_mb * 1024 * 1024
    contenido = await archivo.read(limite + 1)  # no leer más de lo permitido
    try:
        if not confirmar:
            return {"vista": upload.validar(contenido, archivo.filename or "", s, repo).a_dict()}
        r = upload.aplicar(contenido, archivo.filename or "", user.name, s, repo)
    except upload.UploadError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"vista": r.vista.a_dict(), "persistido": r.persistido, "commit_url": r.commit_url, "aviso": r.aviso,
            "fuente": repo.status()}
