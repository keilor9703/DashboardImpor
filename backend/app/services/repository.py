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
from ..data.schema import normalize
from ..data.sources import DataSource, build_source

log = logging.getLogger(__name__)


class Repository:
    def __init__(self, source: DataSource, ttl: int):
        self.source, self.ttl = source, ttl
        self._df: pd.DataFrame | None = None
        self._loaded_at = 0.0
        self._updated: datetime | None = None
        self._last_error: str | None = None
        self._lock = threading.Lock()

    def data(self, force: bool = False) -> pd.DataFrame:
        if not force and self._df is not None and time.time() - self._loaded_at < self.ttl:
            return self._df
        with self._lock:
            if not force and self._df is not None and time.time() - self._loaded_at < self.ttl:
                return self._df
            try:
                started = time.perf_counter()
                df = normalize(self.source.fetch())
                self._df, self._loaded_at = df, time.time()
                self._updated = datetime.now(timezone.utc)
                self._last_error = None
                log.info("Datos cargados: %s filas en %.2fs", len(df), time.perf_counter() - started)
            except Exception as exc:  # si falla, se siguen sirviendo los últimos datos buenos
                self._last_error = str(exc)
                log.exception("Error cargando datos")
                if self._df is None:
                    raise
        return self._df

    def status(self) -> dict:
        return {
            **self.source.describe(),
            "filas": 0 if self._df is None else len(self._df),
            "ultima_actualizacion": self._updated.isoformat() if self._updated else None,
            "ttl_segundos": self.ttl,
            "error": self._last_error,
        }


_repo: Repository | None = None


def get_repository() -> Repository:
    global _repo
    if _repo is None:
        s = get_settings()
        _repo = Repository(build_source(s), s.cache_ttl_seconds)
    return _repo
