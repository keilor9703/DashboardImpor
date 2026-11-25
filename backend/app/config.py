"""Configuración central de la aplicación (variables de entorno / archivo .env)."""
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Dashboard Comercio Exterior"
    environment: Literal["development", "production"] = "development"
    cors_origins: str = "http://localhost:5173"

    # ---------- Autenticación (Microsoft Entra ID) ----------
    # "demo": no valida tokens (solo desarrollo). "entra": valida tokens de Microsoft.
    auth_mode: Literal["demo", "entra"] = "demo"
    azure_tenant_id: str = ""
    # Client ID de la app registrada para la API (backend)
    azure_api_client_id: str = ""
    # Audiencia esperada en el token, normalmente api://<client-id-api>
    azure_api_audience: str = ""
    # Rol de aplicación requerido (App Role). Vacío = cualquier usuario del tenant.
    auth_required_role: str = ""

    # ---------- Fuente de datos ----------
    # "mock": datos simulados. "graph": Excel en SharePoint vía Microsoft Graph.
    # "file": archivo .xlsx local (útil para pruebas con una copia del Excel real).
    data_source: Literal["mock", "graph", "file"] = "mock"
    cache_ttl_seconds: int = 120

    # Credenciales de la app "daemon" que lee el Excel (client credentials)
    graph_client_id: str = ""
    graph_client_secret: str = ""
    # Ubicación del archivo en SharePoint
    sharepoint_hostname: str = ""          # ej. empresa.sharepoint.com
    sharepoint_site_path: str = ""         # ej. /sites/Operaciones
    sharepoint_file_path: str = ""         # ej. /Consolidados/Operaciones 2026.xlsx
    excel_table_name: str = ""             # Tabla de Excel (recomendado)
    excel_sheet_name: str = "Consolidado"  # Si no hay tabla, se usa la hoja
    # "workbook": API de Excel de Graph. "download": descarga el .xlsx y lo procesa.
    graph_read_mode: Literal["workbook", "download"] = "workbook"

    local_file_path: str = ""

    # ---------- Reglas de negocio ----------
    sla_dias_tramite: float = 5.0  # meta de días de nacionalización / despacho

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
