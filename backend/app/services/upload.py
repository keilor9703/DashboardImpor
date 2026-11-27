"""Carga manual del Excel desde el tablero.

Flujo:
  1. ``validar``: revisa que el archivo sea un .xlsx válido, con las hojas y columnas esperadas, y calcula
     una vista previa (embarques, líneas, registros PDT) comparada con los datos actuales. No cambia nada.
  2. ``aplicar``: reemplaza el archivo local de forma atómica (conservando el anterior), lo guarda como un
     commit en GitHub para que sobreviva a los reinicios de Render, y recarga los datos.
     Si algo falla después de reemplazar, se restaura el archivo anterior.
"""
from __future__ import annotations

import base64
import io
import logging
import os
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

from ..config import Settings
from ..data import pdt
from ..data.schema import REQUIRED_COLUMNS, diagnostico, normalize
from ..data.sources import PDT_SHEET, read_rows, read_sheet
from .repository import Repository

log = logging.getLogger(__name__)
GITHUB = "https://api.github.com"


class UploadError(ValueError):
    """Error de validación con un mensaje que el usuario puede entender y corregir."""


@dataclass
class Vista:
    nombre: str
    tamano: int
    lineas: int
    embarques: int
    registros_pdt: int
    hallazgos: list[dict] = field(default_factory=list)
    actual: dict | None = None

    def a_dict(self) -> dict:
        return self.__dict__


def _abrir_zip(contenido: bytes) -> zipfile.ZipFile:
    if not zipfile.is_zipfile(io.BytesIO(contenido)):
        raise UploadError("El archivo no es un Excel válido (.xlsx). Guárdelo de nuevo desde Excel como «Libro de Excel (*.xlsx)».")
    z = zipfile.ZipFile(io.BytesIO(contenido))
    if "xl/workbook.xml" not in z.namelist():
        raise UploadError("El archivo no tiene el formato de un libro de Excel (.xlsx).")
    # Protección contra «zip bombs»: el contenido descomprimido no debe ser desproporcionado
    total = sum(i.file_size for i in z.infolist())
    if total > 3_000_000_000:
        raise UploadError("El archivo, una vez descomprimido, es demasiado grande para procesarlo.")
    return z


def validar(contenido: bytes, nombre: str, s: Settings, repo: Repository | None = None) -> Vista:
    if not nombre.lower().endswith(".xlsx"):
        raise UploadError("Solo se aceptan archivos .xlsx.")
    if len(contenido) > s.upload_max_mb * 1024 * 1024:
        raise UploadError(f"El archivo pesa {len(contenido) / 1e6:.1f} MB y el máximo permitido es {s.upload_max_mb} MB. "
                          "Si tiene muchas filas vacías con formato, elimínelas y vuelva a guardarlo.")
    _abrir_zip(contenido)

    try:
        df_raw, filas = read_sheet(io.BytesIO(contenido), s.excel_sheet_name)
    except ValueError as exc:
        raise UploadError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - archivo dañado, protegido, etc.
        raise UploadError(f"No se pudo leer el archivo: {exc}") from exc

    try:
        df = normalize(df_raw, s.trm_cop_usd, s.eur_usd)
    except ValueError as exc:
        raise UploadError(f"La hoja «{s.excel_sheet_name}» no tiene el formato esperado. {exc}") from exc
    if df.empty:
        raise UploadError(f"La hoja «{s.excel_sheet_name}» no tiene embarques con datos (columna Status vacía).")

    try:
        header, rows, _ = read_rows(io.BytesIO(contenido), PDT_SHEET, max_empty=20)
        hoja_pdt = pdt.parse(header, rows)
    except ValueError as exc:
        raise UploadError(f"Falta o es inválida la hoja «{PDT_SHEET}». {exc}") from exc

    actual = None
    if repo is not None and repo._df is not None:  # noqa: SLF001 - solo lectura del estado cargado
        st = repo.status()
        actual = {"lineas": st["filas"], "embarques": st["embarques"], "actualizado": st["ultima_actualizacion"]}
    return Vista(
        nombre=nombre, tamano=len(contenido), lineas=len(df), embarques=int(df["embarque"].nunique()),
        registros_pdt=hoja_pdt["registros"], hallazgos=diagnostico(filas, df), actual=actual,
    )


# ----------------------------------------------------------------------------- GitHub
def _commit_github(contenido: bytes, usuario: str, s: Settings, transport: httpx.BaseTransport | None = None) -> str:
    """Guarda el archivo en GitHub (commit sobre la rama configurada). Devuelve la URL del commit."""
    cabeceras = {"Authorization": f"Bearer {s.github_token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"}
    url = f"{GITHUB}/repos/{s.github_repo}/contents/{s.github_file_path}"
    with httpx.Client(timeout=120, transport=transport, headers=cabeceras) as c:
        actual = c.get(url, params={"ref": s.github_branch})
        if actual.status_code in (401, 403):
            raise UploadError("GitHub rechazó el token (GITHUB_TOKEN). Verifique que no haya vencido y que tenga "
                              "el permiso «Contents: Read and write» sobre el repositorio.")
        if actual.status_code not in (200, 404):  # 404 = el archivo aún no existe (o el repo: lo detecta el PUT)
            raise UploadError(f"GitHub respondió {actual.status_code} al consultar el archivo actual.")
        cuerpo = {
            "message": f"Actualizar Excel desde el tablero ({usuario}, {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC)",
            "content": base64.b64encode(contenido).decode(),
            "branch": s.github_branch,
        }
        if actual.status_code == 200:
            cuerpo["sha"] = actual.json()["sha"]
        r = c.put(url, json=cuerpo)
        if r.status_code in (401, 403):
            raise UploadError("GitHub no permitió guardar el archivo. Revise los permisos del token (GITHUB_TOKEN) "
                              "y que la rama no esté protegida contra commits directos.")
        if r.status_code == 404:
            raise UploadError(f"GitHub no encontró el repositorio o la rama ({s.github_repo}, {s.github_branch}). Revise GITHUB_REPO y GITHUB_BRANCH.")
        if r.status_code == 409 or r.status_code == 422:
            raise UploadError("El archivo cambió en GitHub mientras se cargaba. Intente de nuevo.")
        r.raise_for_status()
        return r.json().get("commit", {}).get("html_url", "")


# ----------------------------------------------------------------------------- aplicar
@dataclass
class Resultado:
    vista: Vista
    persistido: bool
    commit_url: str
    aviso: str | None


def aplicar(contenido: bytes, nombre: str, usuario: str, s: Settings, repo: Repository,
            github_transport: httpx.BaseTransport | None = None) -> Resultado:
    if s.data_source != "file":
        raise UploadError("La carga manual solo está disponible cuando la fuente de datos es un archivo (DATA_SOURCE=file).")
    vista = validar(contenido, nombre, s, repo)

    destino = Path(s.local_file_path).resolve()
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".nuevo")
    anterior = destino.with_suffix(".anterior")
    existia = destino.exists()
    tmp.write_bytes(contenido)
    try:
        if existia:
            anterior.write_bytes(destino.read_bytes())
        os.replace(tmp, destino)  # atómico: nunca queda un archivo a medias
        repo.data(force=True)     # si el archivo no se puede procesar, lanza y se restaura abajo
    except Exception as exc:
        if existia and anterior.exists():
            os.replace(anterior, destino)
            try:
                repo.data(force=True)
            except Exception:  # noqa: BLE001
                log.exception("No se pudo recargar el archivo anterior tras un error de carga")
        tmp.unlink(missing_ok=True)
        raise UploadError(f"No se pudo procesar el archivo cargado; se conservó el anterior. Detalle: {exc}") from exc

    persistido, commit_url, aviso = False, "", None
    if s.github_token and s.github_repo:
        try:
            commit_url = _commit_github(contenido, usuario, s, github_transport)
            persistido = True
        except UploadError as exc:
            aviso = f"El tablero ya usa el archivo nuevo, pero no se pudo guardar en GitHub: {exc} Se perderá si el servicio se reinicia."
        except httpx.HTTPError as exc:
            aviso = f"El tablero ya usa el archivo nuevo, pero no hubo conexión con GitHub ({exc.__class__.__name__}). Se perderá si el servicio se reinicia."
    else:
        aviso = ("El tablero ya usa el archivo nuevo, pero NO quedó guardado de forma permanente: falta configurar "
                 "GITHUB_TOKEN y GITHUB_REPO en el servidor. Se perderá si el servicio se reinicia.")
    log.info("Excel cargado por %s: %s (%s líneas, %s embarques, persistido=%s)", usuario, nombre, vista.lineas, vista.embarques, persistido)
    return Resultado(vista, persistido, commit_url, aviso)
