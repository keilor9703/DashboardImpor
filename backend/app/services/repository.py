"""Caché en memoria del Excel normalizado.

Evita llamar a Microsoft Graph en cada visita: los datos se refrescan cada
``CACHE_TTL_SECONDS`` o al forzar ``/api/datos/refrescar``. En la fase 5 se agrega
la suscripción a notificaciones de Graph (webhook) para refrescar al guardar el Excel.
"""
import logging
import threading
import time
from datetime import datetime, timezone

import pandas as pd

from ..config import get_settings
from ..data import pdt
from ..data.schema import diagnostico, normalize
from ..data.sources import DataSource, build_source

log = logging.getLogger(__name__)


class DataUnavailable(RuntimeError):
    """No se pudo leer la fuente de datos y no hay datos previos en caché."""


class Repository:
    def __init__(self, source: DataSource, ttl: int, trm: float = 4000.0, eur_usd: float = 1.08):
        self.source, self.ttl, self.trm, self.eur_usd = source, ttl, trm, eur_usd
        self._calidad: list[dict] = []
        self._pdt: dict | None = None
        self._pdt_error: str | None = None
        self._duracion = 0.0
        self._df: pd.DataFrame | None = None
        self._loaded_at = 0.0
        self._updated: datetime | None = None
        self._last_error: str | None = None
        self._lock = threading.Lock()

    def _expired(self) -> bool:
        return time.time() - self._loaded_at >= self.ttl

    def data(self, force: bool = False) -> pd.DataFrame:
        if not force and self._df is not None:
            # Caché vencida: se sirven los datos actuales y se relee el Excel en segundo plano
            if self._expired() and not self._lock.locked():
                threading.Thread(target=self._reload, daemon=True).start()
            return self._df
        return self._reload(force)

    def _reload(self, force: bool = False) -> pd.DataFrame:
        with self._lock:
            if not force and self._df is not None and time.time() - self._loaded_at < self.ttl:
                return self._df
            try:
                started = time.perf_counter()
                df = normalize(self.source.fetch(), self.trm, self.eur_usd)
                self._calidad = diagnostico(self.source.raw_rows, df)
                try:  # la hoja PDT es opcional: si falla, el resto del tablero sigue funcionando
                    self._pdt, self._pdt_error = pdt.parse(*self.source.fetch_pdt(df)), None
                except Exception as exc:
                    self._pdt, self._pdt_error = None, str(exc)
                    log.warning("No se pudo leer la hoja In Transit PDT: %s", exc)
                self._duracion = time.perf_counter() - started
                self._df, self._loaded_at = df, time.time()
                self._updated = datetime.now(timezone.utc)
                self._last_error = None
                log.info("Datos cargados: %s filas en %.2fs", len(df), time.perf_counter() - started)
            except Exception as exc:  # si falla, se siguen sirviendo los últimos datos buenos
                self._last_error = str(exc)
                log.error("Error cargando datos: %s", exc)
                if self._df is None:
                    raise DataUnavailable(str(exc)) from exc
                self._loaded_at = time.time()  # reintenta en el siguiente ciclo, no en cada petición
        return self._df

    def hoja_pdt(self) -> dict:
        self.data()
        if self._pdt is None:
            raise DataUnavailable(self._pdt_error or "La hoja In Transit PDT no está disponible")
        return self._pdt

    def calidad(self) -> list[dict]:
        self.data()
        return self._calidad

    def status(self) -> dict:
        return {
            **self.source.describe(),
            "filas": 0 if self._df is None else len(self._df),
            "filas_archivo": self.source.raw_rows,
            "embarques": 0 if self._df is None else int(self._df["embarque"].nunique()),
            "segundos_carga": round(self._duracion, 1),
            "ultima_actualizacion": self._updated.isoformat() if self._updated else None,
            "ttl_segundos": self.ttl,
            "error": self._last_error,
        }


_repo: Repository | None = None


def get_repository() -> Repository:
    global _repo
    if _repo is None:
        s = get_settings()
        _repo = Repository(build_source(s), s.cache_ttl_seconds, s.trm_cop_usd, s.eur_usd)
    return _repo
